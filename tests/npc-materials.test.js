import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";
import { openDb } from "../server/db.js";
import { applyNpcMaterials } from "../server/migrations/npc-materials-v4.js";
import { getEvidenceModel } from "../src/evidence-models.js";
import { staffStoryMaterials } from "../server/story-materials.js";

test("演员资料按账号隔离；GM取得全套；公开档案不泄露剧本", async (t) => {
  const { app, db } = await createApp({
    dbPath: ":memory:",
    gmPassword: "materials-gm-test",
    npcPassword: "materials-npc-test",
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  for (const [token, role, id] of [
    ["materials-nora", "npc", "detective"],
    ["materials-gm", "gm", "gm"],
    ["materials-player", "player", "player"],
  ])
    await db
      .prepare("INSERT INTO sessions VALUES(?,?,?,?)")
      .run(token, role, id, Date.now() + 60000);
  const call = async (token) =>
    fetch(base + "/staff", { headers: { cookie: `alaska_session=${token}` } });
  const actor = await (await call("materials-nora")).json();
  assert.deepEqual(
    actor.storyMaterials.npcs.map((n) => n.id),
    ["detective"],
  );
  assert.ok(!("models" in actor.storyMaterials));
  assert.ok(!("truth" in actor.storyMaterials));
  assert.ok(!JSON.stringify(actor).includes("真正凶手。为了保存数字莉娅"));
  assert.ok(
    actor.storyMaterials.npcs[0].unknown.some((s) =>
      s.includes("一开始不知道"),
    ),
  );
  const gm = await (await call("materials-gm")).json();
  assert.equal(gm.storyMaterials.npcs.length, 6);
  assert.equal(gm.storyMaterials.evidence.length, 25);
  assert.equal(gm.storyMaterials.models.length, 13);
  assert.equal((await call("materials-player")).status, 401);
  const pub = await (await fetch(base + "/public")).json();
  assert.ok(!("storyMaterials" in pub));
  assert.ok(!JSON.stringify(pub).includes("真正凶手"));
});

test("故事迁移修正默认时间线且保留GM编辑和已有角色ID", async (t) => {
  const db = await openDb(":memory:");
  t.after(() => db.close());
  await db
    .prepare("DELETE FROM content_migrations WHERE id=?")
    .run("npc-materials-v4");
  await db
    .prepare("UPDATE clues SET body=? WHERE id=?")
    .run("20:54，阿德里安独自刷卡进入极光档案室。", "E-03");
  await db
    .prepare("UPDATE npcs SET bio=? WHERE id=?")
    .run("GM自定义接待背景", "singer");
  await db.transaction(() => applyNpcMaterials(db));
  assert.match(
    (await db.prepare("SELECT body FROM clues WHERE id=?").get("E-03")).body,
    /20:48/,
  );
  assert.equal(
    (await db.prepare("SELECT bio FROM npcs WHERE id=?").get("singer")).bio,
    "GM自定义接待背景",
  );
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM clues").get()).n, 26);
  const final = staffStoryMaterials("gm").evidence.find(
    (e) => e.id === "EV-025",
  );
  assert.equal(
    (await db.prepare("SELECT phase FROM clues WHERE id=?").get(final.clueId))
      .phase,
    4,
  );
  await db.transaction(() => applyNpcMaterials(db));
  assert.equal(
    (
      await db
        .prepare("SELECT COUNT(*) n FROM content_migrations WHERE id=?")
        .get("npc-materials-v4")
    ).n,
    1,
  );
});

test("待制模型可自动选用正式资产，缺失时维持旧二维码模型", () => {
  assert.equal(getEvidenceModel("E-06").filename, "evidence-case");
  assert.equal(
    getEvidenceModel("E-06", (name) => name === "aurora-trophy").filename,
    "aurora-trophy",
  );
  assert.equal(getEvidenceModel("E-06", () => false).filename, "evidence-case");
  assert.equal(getEvidenceModel("__proto__"), null);
  const materials = staffStoryMaterials("gm");
  assert.equal(new Set(materials.evidence.map((e) => e.id)).size, 25);
  assert.equal(new Set(materials.evidence.map((e) => e.clueId)).size, 25);
  assert.ok(materials.evidence.every((e) => getEvidenceModel(e.clueId)));
  assert.ok(materials.evidence.every((e) => e.clueId !== "E-09"));
});
