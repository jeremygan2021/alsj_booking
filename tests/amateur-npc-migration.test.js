import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "../server/db.js";
import { applyAmateurNpc } from "../server/migrations/amateur-npc.js";
import { lots } from "../server/content.js";
import materials from "../server/story-materials.json" with { type: "json" };

const oldDescriptions = [
  "收藏一件无法发射的舞台模型，并获得一次非核心道具观察提示。核心物证核查免费开放。",
  "一次性优先询问一位NPC已知的非核心细节。演员不得编造事实，核心证言保底公开。",
  "一次性提前查看一份非核心背景档案；不得锁住破案所需的唯一事实。",
  "一次性优先取得已获证物的非核心观察提示。核心核查无需竞拍，也不因骰子失败丢失。",
  "一次性优先请诺拉核对财产遗嘱的非核心背景；数字处置规则与关键条款免费公开。",
  "一次性优先取得已获证物的非核心观察提示。致伤物与织边断口等核心事实保底公开。",
];
const oldNoraSecret = "以合规顾问身份调查数据交易的FBI探员；按索恩申请执行原定通行安排。20:55—21:01连续在舞台值守，发现尸体后公开身份并主动说明审批。";
const run = (db, sql, ...args) => db.prepare(sql).run(...args);
const one = (db, sql, ...args) => db.prepare(sql).get(...args);
const all = (db, sql, ...args) => db.prepare(sql).all(...args);
const oldMission = "展示设备并由NPC判断";

async function seed(db) {
  await run(db, "DELETE FROM content_migrations WHERE id='amateur-npc-v1'");
  for (const [index, text] of oldDescriptions.entries())
    await run(db, "UPDATE lots SET description=? WHERE id=?", text, index + 1);
  await run(db, "UPDATE lots SET description='GM自定义拍品说明' WHERE id=2");
  await run(db, "UPDATE lots SET description=? WHERE id=3", oldDescriptions[2] + " ");
  await run(db, "UPDATE npcs SET name='现场顾问明月',role='现场安全合规顾问',secret=? WHERE id='detective'", oldNoraSecret);
  await run(db, "UPDATE npcs SET secret='GM自定义策展人秘密' WHERE id='singer'");
  for (const [id, status, coins] of [["am-pending", "pending", 7], ["am-approved", "approved", 8],
    ["am-done", "pending", 10], ["am-rejected", "rejected", 4]]) {
    await run(db, "INSERT INTO players(id,name,contact,password,payment,checked_in,coins) VALUES(?,?,?,'existing-hash','paid',1,?)", id, id, `${id}@example.com`, coins);
    await run(db, "INSERT INTO characters(player_id,name,profession,faction,story,secret,status,revision) VALUES(?,?,?,'conspirator',?,?,?,9)", id, "原创宾客", "声音档案师", "保留的完整角色故事", "保留的角色私稿", status);
    await run(db, "INSERT INTO faction_assignments(player_id,faction,contact_code,draw_id,assigned_at,assigned_by) VALUES(?,'fbi',?,'fixed-draw',123,'gm')", id, `private-code-${id}`);
    await run(db, "INSERT INTO character_relations(player_id,npc_id,relation,player_brief,npc_brief,hooks,mission) VALUES(?,'detective',?,?,?,?,?)",
      id, "公开活动中的旧识", "请带来设备并操作系统演示。", "判断玩家研究与设备演示是否足够专业。",
      JSON.stringify([{ phase: 1, goal: "展示设备" }, { phase: 3, goal: "现场判断完整证据链" }]), oldMission);
    await run(db, "INSERT INTO missions(id,player_id,title,npc_id,reward,status) VALUES(?,?,?,'detective',4,?)",
      `${id}-mission`, id, oldMission, id === "am-done" ? "done" : "pending");
  }
  // A second unfinished task cannot rewrite an already active player's goals.
  await run(db, "INSERT INTO character_relations(player_id,npc_id,relation,player_brief,npc_brief,hooks,mission) VALUES('am-done','host','旧识','既定玩家目标','旧演员提示','invalid legacy JSON','既定第二任务')");
  await run(db, "INSERT INTO missions(id,player_id,title,npc_id,reward,status) VALUES('done-sibling','am-done','既定第二任务','host',6,'pending')");
  await run(db, "INSERT INTO missions(id,player_id,title,npc_id,reward,status) VALUES('manual-extra','am-pending','GM自定额外谈话','detective',9,'pending')");
  await run(db, "INSERT INTO ledger(player_id,amount,reason) VALUES('am-done',4,'既有奖励')");
  await run(db, "UPDATE lots SET status='sold',bid=31,bidder='am-approved' WHERE id=4");
  await run(db, "INSERT INTO inventory(player_id,lot_id,used) VALUES('am-approved',4,1)");
  await run(db, "INSERT INTO bids(lot_id,player_id,amount) VALUES(4,'am-approved',31)");
  await run(db, "INSERT INTO character_voices(player_id,character_revision,job_token,status,script,audio_object_key,created_at,updated_at) VALUES('am-approved',9,'existing-job','ready','保留语音文案','private-intro-object',123,456)");
  await run(db, "INSERT INTO character_recordings(id,player_id,object_key,content_type,transcript,status,created_at) VALUES('existing-recording','am-approved','private-recording-object','audio/wav','保留录音转写','ready',123)");
}

test("业余NPC增量迁移只升级旧种子和未开始目标，保留身份、进度、奖励、语音及GM定稿", async (t) => {
  const db = await openDb(process.env.TEST_DATABASE_URL || ":memory:");
  t.after(() => db.close());
  await db.transaction(() => seed(db));
  const before = {};
  for (const table of ["players", "characters", "ledger", "inventory", "bids", "faction_assignments", "character_voices", "character_recordings"])
    before[table] = await all(db, `SELECT * FROM ${table}`);
  const preserved = await all(db, "SELECT * FROM character_relations WHERE player_id!='am-pending' ORDER BY player_id,npc_id");
  const taskProgress = await all(db, "SELECT id,reward,status FROM missions ORDER BY id");
  const lotProgress = await one(db, "SELECT title,start_price,effect,status,bid,bidder FROM lots WHERE id=4");
  await db.transaction(() => applyAmateurNpc(db));
  for (const [table, expected] of Object.entries(before))
    assert.deepEqual(await all(db, `SELECT * FROM ${table}`), expected, table);
  assert.deepEqual(await all(db, "SELECT id,reward,status FROM missions ORDER BY id"), taskProgress);
  assert.deepEqual(await one(db, "SELECT title,start_price,effect,status,bid,bidder FROM lots WHERE id=4"), lotProgress);
  for (const row of preserved) {
    const current = await one(db, "SELECT * FROM character_relations WHERE player_id=? AND npc_id=?", row.player_id, row.npc_id);
    assert.notEqual(current.npc_brief, row.npc_brief);
    const { npc_brief: _old, ...original } = row;
    const { npc_brief: _next, ...actual } = current;
    assert.deepEqual(actual, original, row.player_id);
    assert.match(current.npc_brief, /照读.*交流已完成.*不考答案/);
  }
  const pending = await one(db, "SELECT * FROM character_relations WHERE player_id='am-pending'");
  assert.match(pending.player_brief, /现场顾问明月/);
  assert.match(pending.player_brief, /复述对方自愿公开的观点/); // formal FBI overrides stale character.faction
  assert.doesNotMatch(pending.player_brief, /带来设备|操作系统|private-code/);
  assert.match(pending.npc_brief, /照读.*交流已完成/);
  assert.deepEqual(JSON.parse(pending.hooks).map((hook) => hook.phase), [1, 3]);
  assert.equal((await one(db, "SELECT title FROM missions WHERE id='am-pending-mission'")).title, pending.mission);
  assert.equal((await one(db, "SELECT title FROM missions WHERE id='manual-extra'")).title, "GM自定额外谈话");
  assert.equal((await one(db, "SELECT COUNT(*) n FROM character_relations")).n, 5);
  for (const id of [1, 4, 5, 6])
    assert.equal((await one(db, "SELECT description FROM lots WHERE id=?", id)).description, lots[id - 1][2]);
  assert.equal((await one(db, "SELECT description FROM lots WHERE id=2")).description, "GM自定义拍品说明");
  assert.equal((await one(db, "SELECT description FROM lots WHERE id=3")).description, oldDescriptions[2] + " ");
  assert.equal((await one(db, "SELECT secret FROM npcs WHERE id='detective'")).secret, materials.npcs.find((npc) => npc.id === "detective").secret);
  assert.equal((await one(db, "SELECT secret FROM npcs WHERE id='singer'")).secret, "GM自定义策展人秘密");
  await run(db, "UPDATE character_relations SET npc_brief='GM迁移后定稿' WHERE player_id='am-pending'");
  await run(db, "UPDATE lots SET description='GM迁移后拍品文案' WHERE id=1");
  await db.transaction(() => applyAmateurNpc(db));
  assert.equal((await one(db, "SELECT npc_brief FROM character_relations WHERE player_id='am-pending'")).npc_brief, "GM迁移后定稿");
  assert.equal((await one(db, "SELECT description FROM lots WHERE id=1")).description, "GM迁移后拍品文案");
  assert.equal((await one(db, "SELECT COUNT(*) n FROM content_migrations WHERE id='amateur-npc-v1'")).n, 1);
});

test("SQLite重启自动接入迁移，旧单联系人可升级且完成任务永不重置", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "alsj-amateur-migration-"));
  const filename = path.join(root, "legacy.sqlite");
  let db;
  try {
    db = await openDb(filename);
    await db.transaction(() => seed(db));
    await db.close();
    db = await openDb(filename);
    assert.match((await one(db, "SELECT npc_brief FROM character_relations WHERE player_id='am-pending'")).npc_brief, /照读/);
    assert.equal((await one(db, "SELECT title,status FROM missions WHERE id='am-done-mission'")).title, oldMission);
    assert.equal((await one(db, "SELECT status FROM missions WHERE id='am-done-mission'")).status, "done");
    assert.equal((await one(db, "SELECT COUNT(*) n FROM character_relations WHERE player_id='am-pending'")).n, 1);
    await run(db, "UPDATE character_relations SET npc_brief='GM重启前定稿' WHERE player_id='am-pending'");
    await db.close();
    db = await openDb(filename);
    assert.equal((await one(db, "SELECT npc_brief FROM character_relations WHERE player_id='am-pending'")).npc_brief, "GM重启前定稿");
  } finally {
    if (db) await db.close();
    await rm(root, { recursive: true, force: true });
  }
});
