import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import materials from "../server/story-materials.json" with { type: "json" };
import version2 from "../server/migrations/npc-outline-v2-seeds.json" with { type: "json" };
import version3 from "../server/migrations/npc-story-v3-seeds.json" with { type: "json" };
import { npcs, evidence, lots } from "../server/content.js";
import { applyStoryV5 } from "../server/migrations/story-v5.js";

function database(seed = { npcs, evidence, lots }) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE content_migrations(id TEXT PRIMARY KEY);
    CREATE TABLE npcs(id TEXT PRIMARY KEY,name TEXT,english TEXT,role TEXT,bio TEXT,secret TEXT,gm_note TEXT);
    CREATE TABLE clues(id TEXT PRIMARY KEY,title TEXT,area TEXT,skill TEXT,dc INTEGER,body TEXT,detail TEXT,category TEXT,phase INTEGER DEFAULT 3,gm_note TEXT);
    CREATE TABLE lots(id INTEGER PRIMARY KEY,title TEXT,start_price INTEGER,description TEXT,effect TEXT,status TEXT DEFAULT 'waiting',bid INTEGER DEFAULT 0,bidder TEXT);
    CREATE TABLE unlocks(player_id TEXT,clue_id TEXT,PRIMARY KEY(player_id,clue_id));
    CREATE TABLE inventory(player_id TEXT,lot_id INTEGER,used INTEGER DEFAULT 0);
  `);
  for (const row of seed.npcs)
    db.prepare(
      "INSERT INTO npcs(id,name,english,role,bio,secret) VALUES(?,?,?,?,?,?)",
    ).run(...row);
  for (const row of seed.evidence)
    db.prepare(
      "INSERT INTO clues(id,title,area,skill,dc,body,detail,category) VALUES(?,?,?,?,?,?,?,?)",
    ).run(...row);
  for (const [index, row] of seed.lots.entries())
    db.prepare(
      "INSERT INTO lots(id,title,start_price,description,effect) VALUES(?,?,?,?,?)",
    ).run(index + 1, ...row);
  return db;
}

test("v5升级v4默认字段，保留混合GM文案、扩展字段及搜证拍卖进度，重复执行无副作用", async (t) => {
  const db = database();
  t.after(() => db.close());
  db.prepare(
    "UPDATE clues SET title=?,body=?,detail=?,phase=2,gm_note=? WHERE id='E-25'",
  ).run(
    "克拉拉摄影区记录",
    "20:59克拉拉已在摄影区，留下可核对记录。",
    "GM自定补充：摄影师实名见证",
    "已布置摄影区",
  );
  db.prepare("UPDATE clues SET body=? WHERE id='E-19'").run(
    "诺拉按演示要求确认20:51—21:02临时安全通行。",
  );
  db.prepare(
    "UPDATE npcs SET bio=?,secret=?,gm_note=? WHERE id='detective'",
  ).run(
    "GM自定合规履历",
    "隐藏身份为FBI特别探员POLARIS；知晓20:51—21:02安全通行设置，21:13发现尸体，承担调查主持。",
    "演员已排练",
  );
  // Known old prose differs by field: preserve custom secret even when bio is a shipped value.
  db.prepare("UPDATE npcs SET secret=? WHERE id='singer'").run(
    "GM自定关系：摄影师是表亲",
  );
  db.prepare(
    "UPDATE lots SET title=?,description=?,status='sold',bid=31,bidder='player-a' WHERE id=4",
  ).run("命运重掷券", "对一次小组鉴定重掷，保留较高结果。");
  db.prepare("INSERT INTO unlocks VALUES('player-a','E-25')").run();
  db.prepare("INSERT INTO inventory VALUES('player-a',4,1)").run();
  await applyStoryV5(db);
  const clue = db.prepare("SELECT * FROM clues WHERE id='E-25'").get();
  assert.equal(clue.title, "克拉拉摄影区连续工作录像");
  assert.match(clue.body, /20:57—21:01/);
  assert.equal(clue.detail, "GM自定补充：摄影师实名见证");
  assert.equal(clue.phase, 2);
  assert.equal(clue.gm_note, "已布置摄影区");
  assert.match(
    db.prepare("SELECT body FROM clues WHERE id='E-19'").get().body,
    /21:18/,
  );
  assert.equal(
    db.prepare("SELECT bio FROM npcs WHERE id='detective'").get().bio,
    "GM自定合规履历",
  );
  assert.match(
    db.prepare("SELECT secret FROM npcs WHERE id='detective'").get().secret,
    /主动说明审批/,
  );
  assert.equal(
    db.prepare("SELECT secret FROM npcs WHERE id='singer'").get().secret,
    "GM自定关系：摄影师是表亲",
  );
  const lot = db.prepare("SELECT * FROM lots WHERE id=4").get();
  assert.equal(lot.title, "加急核查券");
  assert.equal(lot.effect, "重掷");
  assert.equal(lot.status, "sold");
  assert.equal(lot.bid, 31);
  assert.equal(lot.bidder, "player-a");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM unlocks").get().n, 1);
  assert.equal(db.prepare("SELECT used FROM inventory").get().used, 1);
  const before = db.prepare("SELECT * FROM clues ORDER BY id").all();
  await applyStoryV5(db);
  assert.deepEqual(db.prepare("SELECT * FROM clues ORDER BY id").all(), before);
  assert.equal(
    db
      .prepare("SELECT COUNT(*) n FROM content_migrations WHERE id='story-v5'")
      .get().n,
    1,
  );
});

for (const [name, previous] of [
  ["v2", version2],
  ["v3", version3],
]) {
  test(`v5仅按已知${name}默认值升级，保留相同ID与自定义字段`, async (t) => {
    const db = database(previous);
    t.after(() => db.close());
    db.prepare(
      "UPDATE clues SET detail='GM现场自定细节' WHERE id='E-04'",
    ).run();
    await applyStoryV5(db);
    for (const row of evidence) {
      const clue = db.prepare("SELECT * FROM clues WHERE id=?").get(row[0]);
      assert.equal(clue.body, row[5], row[0]);
      assert.equal(
        clue.detail,
        row[0] === "E-04" ? "GM现场自定细节" : row[6],
        row[0],
      );
    }
    assert.equal(db.prepare("SELECT COUNT(*) n FROM clues").get().n, 26);
  });
}

test("新种子保持26条稳定证据映射、纯玩家文案及六种兼容拍品行", async (t) => {
  const db = database();
  t.after(() => db.close());
  await applyStoryV5(db);
  assert.deepEqual(
    evidence.map((e) => e[0]),
    Array.from({ length: 26 }, (_, i) => `E-${String(i + 1).padStart(2, "0")}`),
  );
  assert.equal(materials.evidence.length, 25);
  assert.equal(new Set(materials.evidence.map((e) => e.id)).size, 25);
  assert.equal(lots.length, 6);
  assert.deepEqual(
    lots.map((l) => l[3]),
    ["鉴定", "证人", "档案", "重掷", "遗嘱", "鉴定"],
  );
  for (const row of evidence) {
    assert.ok(row[5].length > 0 && row[6].length > 0, row[0]);
    assert.doesNotMatch(
      row[5] + row[6],
      /演员|完整链|凶手只是|认罪|供认|玩家必须/,
    );
  }
  const byId = new Map(materials.evidence.map((e) => [e.clueId, e]));
  assert.match(byId.get("E-11").body, /20:55—21:01.*诺拉.*西奥多/);
  assert.match(byId.get("E-25").body, /20:57—21:01/);
  assert.match(byId.get("E-17").body, /断口形状、线迹及织纹连续相接/);
  assert.match(byId.get("E-08").body, /19:20.*完整.*21:03:18.*缺口/);
  assert.match(byId.get("E-19").detail, /私人指控.*免费核对.*历史刷卡记录完整/);
  assert.match(byId.get("E-18").detail, /维护权限与完整实例导出权限独立/);
  assert.match(byId.get("E-10").detail, /既有交互服务.*访问全部留痕/);
  assert.doesNotMatch(byId.get("E-21").detail, /临时造假|事后造假|夹页|推测/);
  assert.match(byId.get("E-21").detail, /合同、交付清单与付款记录可相互核对/);
});

test("六名NPC故事、段落及来源一致，供认要求完整解释并使用现场E编号", () => {
  for (const npc of materials.npcs) {
    assert.equal(
      npc.sections.find((s) => s.title === "第一人称故事卡").text,
      npc.story,
    );
    assert.ok(npc.sourceText.includes(npc.story), npc.id);
    assert.doesNotMatch(
      npc.sourceText,
      /EV-\d|E\d{2}|最辉煌的十年|最近，我找到了|第三阶段：玩家同时出示/,
    );
    assert.ok(npc.sections.some((s) => s.title === "三阶段证言与供认边界"));
  }
  assert.deepEqual(
    materials.chronology.map((row) => row.year),
    [2021, 2022, 2023, 2024, 2026],
  );
  const evelyn = materials.npcs.find((n) => n.id === "attorney");
  const stages = evelyn.sections.find(
    (s) => s.title === "三阶段证言与供认边界",
  ).text;
  for (const id of [
    "E-23",
    "E-14",
    "E-17",
    "E-04",
    "E-08",
    "E-12",
    "E-18",
    "E-10",
  ])
    assert.ok(stages.includes(id), id);
  assert.match(stages, /不能仅因出示固定三张卡/);
  const boundaries = evelyn.sections.find(
    (s) => s.title === "真实事实与边界",
  ).text;
  assert.match(boundaries, /2—5人抽签.*事先知道伊芙琳.*独立暗号接头/);
  assert.match(
    boundaries,
    /不自动获得袭击时刻、物证关联、预录安排或90天冻结的完整答案/,
  );
  assert.match(boundaries, /接头者未参与案发历史中的谋杀/);
  assert.match(evelyn.story, /20:55.*说服|20:55.*时间/s);
  assert.match(evelyn.story, /先想到，还能多听她九十天晚安/);
  const nora = materials.npcs.find((n) => n.id === "detective");
  assert.match(nora.story, /立即告诉所有人/);
  const theo = materials.npcs.find((n) => n.id === "scientist");
  assert.doesNotMatch(
    JSON.stringify({
      story: theo.story,
      knowledge: theo.knowledge,
      sections: theo.sections,
      sourceText: theo.sourceText,
    }),
    /临时造假|事后造假|事发后临时生成/,
  );
  assert.match(theo.story, /从开始就知道声音不是实时发言/);
  assert.match(theo.story, /声称她删过记录/);
});
