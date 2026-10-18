import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { openDb } from "../server/db.js";
import { migrateFactionState } from "../server/migrations/faction-state.js";
import { createFactionService, killerQuota } from "../server/factions/service.js";

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
async function fixture(t, { count = 0, preference = (i) => i < 6 ? "conspirator" : i % 2 ? "fbi" : "croft", path } = {}) {
  let databasePath = path || ":memory:", schema = null, schemaPool = null;
  if (!path && process.env.TEST_DATABASE_URL) {
    schema = `alsj_factions_${randomBytes(8).toString("hex")}`;
    schemaPool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
    await schemaPool.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set("options", `-c search_path=${schema}`);
    databasePath = url.toString();
  }
  const db = await openDb(databasePath);
  await migrateFactionState(db);
  t.after(async () => {
    try { await db.close(); } catch { /* A restart test may already have closed it. */ }
    if (schemaPool) {
      try { await schemaPool.query(`DROP SCHEMA ${schema} CASCADE`); }
      finally { await schemaPool.end(); }
    }
  });
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const dependencies = { one, all, run, tx: (fn) => db.transaction(fn), fail, now: () => 1792300000000, random: (max) => max - 1 };
  const service = createFactionService(dependencies);
  const add = async (id, pref = "any", { payment = "paid", status = "approved", contact = `${id}@example.com`, checkedIn = 0 } = {}) => {
    await run("INSERT INTO players(id,name,contact,password,payment,checked_in) VALUES(?,?,?,?,?,?)", id, `玩家${id}`, contact, "unused", payment, checkedIn);
    await run("INSERT INTO characters(player_id,name,status,faction,secret,story) VALUES(?,?,?,?,?,?)", id, `角色${id}`, status, "croft", "既有私人故事", "原始角色故事");
    if (pref) await service.savePreference(id, pref);
    return id;
  };
  for (let i = 0; i < count; i++) await add(`p${String(i).padStart(2, "0")}`, preference(i));
  return { db, databasePath, one, all, run, service, dependencies, add };
}

test("杀手席位按人数四舍五入并限制在2至5席", () => {
  for (const [count, expected] of [[0, 2], [4, 2], [29, 2], [30, 3], [40, 3], [50, 4], [54, 5], [1000, 5]])
    assert.equal(killerQuota(count), expected);
});

test("迁移可重复执行，不自动改写旧角色或公开旧默认阵营", async (t) => {
  const { db, run, one, service } = await fixture(t, { count: 1 });
  await run("UPDATE characters SET faction='conspirator',status='approved' WHERE player_id='p00'");
  await migrateFactionState(db);
  await migrateFactionState(db);
  const legacy = await one("SELECT * FROM characters WHERE player_id='p00'");
  assert.equal(legacy.faction, "conspirator");
  assert.equal(legacy.secret, "既有私人故事");
  assert.equal(legacy.status, "approved");
  const state = await service.getPlayerState("p00");
  assert.equal(state.assigned, null);
  assert.equal(state.code, null);
  assert.equal(state.briefing, null);
  assert.equal(state.drawn, false);
  assert.equal((await service.getAdminState()).players[0].legacy_faction, "conspirator");
});

test("角色建立前即可保存偏好；校验输入和玩家存在性", async (t) => {
  const { run, service } = await fixture(t);
  await run("INSERT INTO players(id,name,contact,password) VALUES('new','新玩家','new@example.com','unused')");
  assert.equal((await service.savePreference("new", "conspirator")).preference, "conspirator");
  assert.equal((await service.savePreference("new", "fbi")).preference, "fbi");
  assert.equal((await service.getPlayerState("new")).preferenceLocked, false);
  await assert.rejects(service.savePreference("new", "killer"), { status: 400 });
  await assert.rejects(service.savePreference("new", { preference: "any" }), { status: 400 });
  await assert.rejects(service.savePreference("missing", "any"), { status: 404 });
});

test("40人抽签优先杀手偏好、其余平衡、无须签到；缺偏好及不合资格者排除", async (t) => {
  const { service, one, run, add } = await fixture(t, { count: 40, preference: (i) => i < 10 ? "conspirator" : i < 20 ? "any" : i % 2 ? "fbi" : "croft" });
  await add("no-pref", null);
  await add("not-paid", "conspirator", { payment: "pending" });
  await add("not-approved", "conspirator", { status: "pending" });
  await add("staff-phone", "conspirator", { contact: "13800000000" });
  await run("INSERT INTO npc_phones(npc_id,phone) VALUES('attorney','13800000000')");
  const preview = await service.getAdminState();
  assert.equal(preview.eligibleCount, 40);
  assert.equal(preview.candidateCount, 20);
  assert.equal(preview.missingPreferenceCount, 1);
  assert.equal(preview.quota, 3);
  const result = await service.draw("test-gm");
  assert.equal(result.drawn, true);
  assert.equal(result.participantCount, 40);
  assert.equal(result.quota, 3);
  assert.equal(result.counts.conspirator, 3);
  assert.equal(result.counts.fbi + result.counts.croft, 37);
  assert.ok(Math.abs(result.counts.fbi - result.counts.croft) <= 1);
  const killers = result.players.filter((player) => player.assigned === "conspirator");
  assert.ok(killers.every((player) => player.preference === "conspirator"));
  assert.equal(new Set(killers.map((player) => player.code)).size, 3);
  assert.ok(killers.every((player) => /^[\p{Script=Han}]{4}(?:·[\p{Script=Han}]{4}){3}$/u.test(player.code)));
  for (const player of result.players) {
    const state = await service.getPlayerState(player.id);
    assert.equal(state.assigned, player.assigned);
    assert.equal(state.code, player.assigned === "conspirator" ? player.code : null);
    if (player.assigned === "conspirator") {
      assert.match(state.briefing, /伊芙琳·维尔/);
      assert.match(state.briefing, /开始前/);
      assert.ok(state.briefing.includes(player.code));
    } else {
      assert.ok(!JSON.stringify(state).includes("伊芙琳"));
      for (const killer of killers) assert.ok(!JSON.stringify(state).includes(killer.code));
    }
  }
  for (const id of ["no-pref", "not-paid", "not-approved", "staff-phone"])
    assert.equal((await service.getPlayerState(id)).assigned, null);
  assert.deepEqual(result.killerContact, { npcId: "attorney", name: "伊芙琳·维尔" });
  assert.equal((await one("SELECT secret FROM characters WHERE player_id='p00'")).secret, "既有私人故事");
  const audit = await one("SELECT action FROM audit WHERE actor='test-gm'");
  assert.ok(killers.every((player) => !audit.action.includes(player.code)));
});

test("杀手偏好不足才从any补位，明确其他偏好不会被强迫为杀手", async (t) => {
  const { service } = await fixture(t, { count: 6, preference: (i) => ["conspirator", "any", "fbi", "fbi", "croft", "croft"][i] });
  const result = await service.draw();
  assert.deepEqual(result.counts, { fbi: 2, croft: 2, conspirator: 2 });
  assert.deepEqual(result.players.filter((player) => player.assigned === "conspirator").map((player) => player.preference).sort(), ["any", "conspirator"]);
});

test("不足4人、超50人、自愿杀手池不足时抽签不产生任何分配", async (t) => {
  for (const scenario of [
    { count: 3, preference: () => "any", error: /至少需要4名/ },
    { count: 51, preference: () => "any", error: /最多50人/ },
    { count: 8, preference: (i) => i ? "fbi" : "any", error: /自愿候选人/ },
  ]) {
    const { service, one } = await fixture(t, scenario);
    await assert.rejects(service.draw(), scenario.error);
    assert.equal((await one("SELECT COUNT(*) n FROM faction_assignments")).n, 0);
    assert.equal((await service.getAdminState()).drawn, false);
  }
});

test("并发抽签只成功一次，已分配玩家偏好锁定，名单和代码不会重抽", async (t) => {
  const { service, databasePath } = await fixture(t, { count: 40 });
  let other = service;
  if (process.env.TEST_DATABASE_URL) other = (await fixture(t, { path: databasePath })).service;
  const attempts = await Promise.allSettled([service.draw("gm-a"), other.draw("gm-b")]);
  assert.equal(attempts.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((entry) => entry.status === "rejected").length, 1);
  const before = await service.getAdminState();
  await assert.rejects(service.draw(), { status: 409 });
  await assert.rejects(service.savePreference("p00", "croft"), { status: 409 });
  assert.equal((await service.savePreference("p00", "conspirator")).preferenceLocked, true);
  assert.deepEqual(await service.getAdminState(), before);
});

test("GM单人调整受最少2名、冻结上限、非杀手平衡和自愿偏好约束", async (t) => {
  const { service, add, dependencies } = await fixture(t, { count: 8, preference: (i) => i < 2 ? "conspirator" : i % 2 ? "fbi" : "croft" });
  await assert.rejects(service.setFaction("p00", "conspirator"), /先由GM完成/);
  let state = await service.draw();
  await assert.rejects(service.setFaction("p00", "fbi"), /必须为2至2人/);
  const nonkiller = state.players.find((player) => player.assigned === "fbi");
  await assert.rejects(service.setFaction(nonkiller.id, "conspirator"), /没有自愿/);
  await assert.rejects(service.setFaction(nonkiller.id, "croft"), /人数差不能超过1人/);
  await add("late", "any");
  assert.equal((await service.getPlayerState("late")).drawn, true);
  assert.equal((await service.savePreference("late", "fbi")).preferenceLocked, false);
  await service.savePreference("late", "any");
  await assert.rejects(service.setFaction("late", "conspirator"), /必须为2至2人/);
  await dependencies.tx(() => service.setFactionInTransaction("late", "fbi", "gm-late"));
  assert.equal((await service.getPlayerState("late")).assigned, "fbi");
  await assert.rejects(service.savePreference("late", "croft"), /偏好已锁定/);
  await add("late2", "any");
  await assert.rejects(service.setFaction("late2", "fbi"), /人数差不能超过1人/);
  await service.setFaction("late2", "croft");
  // Enlarging the roster cannot silently increase the original two seats.
  for (let i = 10; i < 40; i++) await add(`later${i}`, "any");
  state = await service.getAdminState();
  assert.equal(state.eligibleCount, 40);
  assert.equal(state.quota, 2);
  assert.equal(state.participantCount, 8);
  assert.deepEqual(state.counts, { fbi: 4, croft: 4, conspirator: 2 });
});

test("GM合法调整保存原暗号，不向普通阵营投影残留暗号", async (t) => {
  const { service, one } = await fixture(t, { count: 40 });
  let admin = await service.draw();
  const killer = admin.players.find((player) => player.assigned === "conspirator");
  const lesser = admin.counts.fbi <= admin.counts.croft ? "fbi" : "croft";
  await service.setFaction(killer.id, lesser);
  let state = await service.getPlayerState(killer.id);
  assert.equal(state.code, null);
  assert.ok(!state.briefing.includes("伊芙琳"));
  admin = await service.getAdminState();
  assert.equal(admin.players.find((player) => player.id === killer.id).code, null);
  assert.equal(admin.counts.conspirator, 2);
  await service.setFaction(killer.id, "conspirator");
  state = await service.getPlayerState(killer.id);
  assert.equal(state.code, killer.code);
  assert.equal((await one("SELECT faction FROM characters WHERE player_id=?", killer.id)).faction, "conspirator");
});

test("抽签中途数据库失败会回滚整轮身份、暗号及抽签状态", async (t) => {
  const { service, dependencies, one } = await fixture(t, { count: 6 });
  let inserted = 0;
  const broken = createFactionService({ ...dependencies, run: async (sql, ...args) => {
    if (sql.startsWith("INSERT INTO faction_assignments") && ++inserted === 3) throw new Error("模拟写入中断");
    return dependencies.run(sql, ...args);
  } });
  await assert.rejects(broken.draw(), /模拟写入中断/);
  assert.equal((await one("SELECT COUNT(*) n FROM faction_assignments")).n, 0);
  assert.equal((await service.getAdminState()).drawn, false);
  assert.equal((await one("SELECT COUNT(*) n FROM characters WHERE faction!='croft'")).n, 0);
  assert.equal((await service.draw()).counts.conspirator, 2);
});

test("服务与数据库重启后抽签身份、唯一暗号和固定席位保持原值", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "alaska-factions-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "factions.sqlite");
  const initial = await fixture(t, { count: 40, path: process.env.TEST_DATABASE_URL ? undefined : path });
  const before = await initial.service.draw("gm-persist");
  await initial.db.close();
  const reopened = await fixture(t, { path: initial.databasePath });
  await migrateFactionState(reopened.db);
  assert.deepEqual(await reopened.service.getAdminState(), before);
  for (const killer of before.players.filter((player) => player.assigned === "conspirator"))
    assert.equal((await reopened.service.getPlayerState(killer.id)).code, killer.code);
  await assert.rejects(reopened.service.draw(), /不能重抽/);
});
