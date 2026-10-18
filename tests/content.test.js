import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../server/db.js";
import { createApp } from "../server/app.js";
import { applyNpcOutline } from "../server/migrations/npc-outline-v2.js";

test("六NPC采用新大纲，公开档案不泄漏真正凶手", async (t) => {
  const { app, db } = await createApp({
    databaseUrl: process.env.TEST_DATABASE_URL,
    dbPath: ":memory:",
    gmPassword: "content-gm-password",
    npcPassword: "content-npc-password",
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    server.close();
    await db.close();
  });
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/public`,
  );
  const data = await response.json();
  assert.deepEqual(
    data.npcs.map((n) => n.name),
    [
      "阿德里安·索恩",
      "克拉拉·沃克",
      "伊芙琳·维尔",
      "诺拉·里德",
      "里昂·默瑟",
      "西奥多·布莱克",
    ],
  );
  assert.ok(data.npcs.every((n) => !("secret" in n)));
  assert.equal(
    data.npcs.find((n) => n.id === "singer").role,
    "艺术策展人、瑟琳娜生前好友",
  );
  assert.equal(
    data.npcs.find((n) => n.id === "attorney").role,
    "ADS首席人格架构师",
  );
  assert.ok(!JSON.stringify(data).includes("凶手"));
  assert.match(
    (await db.prepare("SELECT secret FROM npcs WHERE id=?").get("attorney"))
      .secret,
    /真正凶手|唯一实施致命袭击者/,
  );
});

test("旧NPC及证据升级一次，保留工作人员账号关联和GM自定义文案", async (t) => {
  const db = await openDb(process.env.TEST_DATABASE_URL || ":memory:");
  t.after(() => db.close());
  await db
    .prepare("DELETE FROM content_migrations WHERE id=?")
    .run("npc-outline-v2");
  await db
    .prepare(
      "UPDATE npcs SET name=?,english=?,role=?,bio=?,secret=? WHERE id=?",
    )
    .run(
      "达米安·克罗斯",
      "Damien Cross",
      "安保主管",
      "庄园的每扇门都在他的掌控中。他是克罗夫特最信任的旧日亲信。",
      "预设真凶。为掩盖非法数据交易，阻止男主人公开材料。",
      "security",
    );
  await db
    .prepare("UPDATE npcs SET bio=? WHERE id=?")
    .run("GM自行编写的探员背景", "detective");
  await db
    .prepare("UPDATE clues SET detail=? WHERE id=?")
    .run("收款记录指向达米安的私人账户，与旧案日期重合。", "E-02");
  await db
    .prepare("UPDATE clues SET body=? WHERE id=?")
    .run("GM自行编写的门禁证据", "E-04");
  await db
    .prepare("INSERT INTO sessions VALUES(?,?,?,?)")
    .run("content-npc-session", "npc", "security", Date.now() + 60000);
  await db.transaction(() => applyNpcOutline(db));
  assert.equal(
    (await db.prepare("SELECT name FROM npcs WHERE id=?").get("security")).name,
    "里昂·默瑟",
  );
  assert.equal(
    (await db.prepare("SELECT bio FROM npcs WHERE id=?").get("detective")).bio,
    "GM自行编写的探员背景",
  );
  assert.match(
    (await db.prepare("SELECT detail FROM clues WHERE id=?").get("E-02"))
      .detail,
    /维拉/,
  );
  assert.equal(
    (await db.prepare("SELECT body FROM clues WHERE id=?").get("E-04")).body,
    "GM自行编写的门禁证据",
  );
  assert.equal(
    (
      await db
        .prepare("SELECT user_id FROM sessions WHERE token=?")
        .get("content-npc-session")
    ).user_id,
    "security",
  );
  await db
    .prepare("UPDATE npcs SET bio=? WHERE id=?")
    .run("新版上线后的GM编辑", "security");
  await db.transaction(() => applyNpcOutline(db));
  assert.equal(
    (await db.prepare("SELECT bio FROM npcs WHERE id=?").get("security")).bio,
    "新版上线后的GM编辑",
  );
  assert.equal(
    (
      await db
        .prepare("SELECT COUNT(*) n FROM content_migrations WHERE id=?")
        .get("npc-outline-v2")
    ).n,
    1,
  );
});

test("新版故事升级保留NPC关联与自定义介绍，且可重复执行", async (t) => {
  const { applyNpcStory } =
    await import("../server/migrations/npc-story-v3.js");
  const { default: old } = await import(
    "../server/migrations/npc-outline-v2-seeds.json",
    { with: { type: "json" } }
  );
  const db = await openDb(process.env.TEST_DATABASE_URL || ":memory:");
  t.after(() => db.close());
  await db
    .prepare("DELETE FROM content_migrations WHERE id=?")
    .run("npc-story-v3");
  for (const row of old.npcs) {
    await db
      .prepare(
        "UPDATE npcs SET name=?,english=?,role=?,bio=?,secret=? WHERE id=?",
      )
      .run(...row.slice(1), row[0]);
  }
  await db
    .prepare("UPDATE npcs SET bio=? WHERE id=?")
    .run("GM自定义介绍", "security");
  await db
    .prepare("UPDATE clues SET body=? WHERE id=?")
    .run(old.evidence[4][5], "E-05");
  await db.transaction(() => applyNpcStory(db));
  assert.equal(
    (await db.prepare("SELECT name FROM npcs WHERE id=?").get("attorney")).name,
    "伊芙琳·维尔",
  );
  assert.equal(
    (await db.prepare("SELECT bio FROM npcs WHERE id=?").get("security")).bio,
    "GM自定义介绍",
  );
  assert.match(
    (await db.prepare("SELECT body FROM clues WHERE id=?").get("E-05")).body,
    /21:07/,
  );
  await db.transaction(() => applyNpcStory(db));
  assert.equal(
    (
      await db
        .prepare("SELECT COUNT(*) n FROM content_migrations WHERE id=?")
        .get("npc-story-v3")
    ).n,
    1,
  );
});
