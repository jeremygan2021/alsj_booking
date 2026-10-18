import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import {
  createFactionPlayService,
  migrateFactionPlay,
  mountFactionPlayRoutes,
} from "../server/faction-play.js";

async function setup(t) {
  const db = new DatabaseSync(":memory:");
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE players(id TEXT PRIMARY KEY,name TEXT,group_id INTEGER,payment TEXT,checked_in INTEGER);
    CREATE TABLE characters(player_id TEXT PRIMARY KEY,status TEXT);
    CREATE TABLE faction_assignments(player_id TEXT PRIMARY KEY,faction TEXT);
    CREATE TABLE settings(id INTEGER PRIMARY KEY,phase INTEGER);
    CREATE TABLE clues(id TEXT PRIMARY KEY,title TEXT,phase INTEGER);
    CREATE TABLE unlocks(player_id TEXT,clue_id TEXT,PRIMARY KEY(player_id,clue_id));
    CREATE TABLE votes(player_id TEXT PRIMARY KEY,decision TEXT);
    INSERT INTO settings VALUES(1,3);
    INSERT INTO clues VALUES('E-01','人格处置声明',3),('E-10','90天冻结条款',3),('E-22','交易审计资料',3),('E-99','尚未开放',4);
    INSERT INTO votes VALUES('a','continue');`);
  const rows = [
    ["a", 1, "fbi"],
    ["a2", 2, "fbi"],
    ["b", 3, "croft"],
    ["b2", 3, "croft"],
    ["c", 4, "conspirator"],
    ["mixed", 1, "croft"],
    ["d", 5, "conspirator"],
    ["unsigned", 6, null],
  ];
  for (const [id, group, faction] of rows) {
    db.prepare("INSERT INTO players VALUES(?,?,?,?,?)").run(
      id,
      `宾客${id}`,
      group,
      "paid",
      1,
    );
    db.prepare("INSERT INTO characters VALUES(?,?)").run(id, "approved");
    if (faction)
      db.prepare("INSERT INTO faction_assignments VALUES(?,?)").run(
        id,
        faction,
      );
    for (const clue of ["E-01", "E-10", "E-22"])
      db.prepare("INSERT INTO unlocks VALUES(?,?)").run(id, clue);
  }
  await migrateFactionPlay(db);
  await migrateFactionPlay(db);
  let queue = Promise.resolve();
  const tx = async (fn) => {
    const previous = queue;
    let release;
    queue = new Promise((r) => {
      release = r;
    });
    await previous;
    db.exec("BEGIN IMMEDIATE");
    try {
      const r = await fn();
      db.exec("COMMIT");
      return r;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    } finally {
      release();
    }
  };
  const one = async (sql, ...params) => db.prepare(sql).get(...params);
  const all = async (sql, ...params) => db.prepare(sql).all(...params);
  const run = async (sql, ...params) => db.prepare(sql).run(...params);
  const fail = (message, status = 400) => {
    throw Object.assign(new Error(message), { status });
  };
  const service = createFactionPlayService({
    one,
    all,
    run,
    tx,
    fail,
    now: () => 1000,
  });
  t.after(() => db.close());
  return { db, service };
}
const input = {
  evidenceId: "E-10",
  explanation: "这条冻结条款明确要求保留审查时间和独立监督。",
};
const proposalFor = async (service, id) =>
  (await service.state(id)).policies.find((p) => p.id === "fbi").proposal;

test("阵营提案校验正式证据、同组取得权限与玩家参加条件", async (t) => {
  const { db, service } = await setup(t);
  await assert.rejects(service.propose("a", { ...input, evidenceId: "fake" }), {
    status: 400,
  });
  await assert.rejects(service.propose("a", { ...input, evidenceId: "E-99" }), {
    status: 403,
  });
  await assert.rejects(
    service.propose("a", { ...input, explanation: "随便" }),
    { status: 400 },
  );
  db.prepare("DELETE FROM unlocks WHERE player_id='a2'").run();
  await assert.rejects(service.propose("a2", input), { status: 403 });
  // Another actual member of the same group may supply the evidence.
  db.prepare("UPDATE players SET group_id=1 WHERE id='a2'").run();
  await service.propose("a2", input);
  assert.equal(
    (await service.adminState()).policies.find((p) => p.id === "fbi").proposal
      .groupId,
    1,
  );
  for (const [column, value] of [
    ["payment", "pending"],
    ["checked_in", 0],
  ]) {
    db.prepare(`UPDATE players SET ${column}=? WHERE id='b'`).run(value);
    await assert.rejects(service.propose("b", input), { status: 403 });
    db.prepare(
      "UPDATE players SET payment='paid',checked_in=1 WHERE id='b'",
    ).run();
  }
  await assert.rejects(service.propose("unsigned", input), { status: 403 });
});

test("第三幕开放协商、第四幕只读结算，价值票与事实资料不受影响", async (t) => {
  const { db, service } = await setup(t);
  db.prepare("UPDATE settings SET phase=1").run();
  await assert.rejects(service.propose("a", input), { status: 403 });
  const early = await service.state("a");
  assert.equal(early.evidence.length, 0);
  assert.ok(early.policies.every((p) => !p.proposal));
  db.prepare("UPDATE settings SET phase=3").run();
  await service.propose("a", input);
  const proposal = await proposalFor(service, "a");
  await service.support("b", {
    faction: "fbi",
    proposalUpdatedAt: proposal.updatedAt,
  });
  assert.equal(
    (await service.state("a")).policies.find((p) => p.id === "fbi").achieved,
    false,
  );
  await service.review("gm", {
    faction: "fbi",
    status: "approved",
    proposalUpdatedAt: proposal.updatedAt,
  });
  db.prepare("UPDATE settings SET phase=4").run();
  await assert.rejects(service.propose("c", input), { status: 403 });
  await assert.rejects(
    service.support("c", {
      faction: "fbi",
      proposalUpdatedAt: proposal.updatedAt,
    }),
    { status: 403 },
  );
  const after = await service.state("a");
  assert.equal(after.open, false);
  assert.equal(after.policies.find((p) => p.id === "fbi").achieved, true);
  assert.deepEqual(
    { ...db.prepare("SELECT * FROM votes").get() },
    { player_id: "a", decision: "continue" },
  );
});

test("签署必须来自外阵营、外调查组，身份与组号不能用请求体假冒", async (t) => {
  const { db, service } = await setup(t);
  await service.propose("a", input);
  const proposal = await proposalFor(service, "a"),
    sign = { faction: "fbi", proposalUpdatedAt: proposal.updatedAt };
  await assert.rejects(service.support("a2", sign), { status: 403 });
  await assert.rejects(service.support("mixed", sign), { status: 403 });
  assert.equal(
    (await service.state("mixed")).policies.find((p) => p.id === "fbi")
      .canSupport,
    false,
  );
  assert.equal(
    (await service.state("b")).policies.find((p) => p.id === "fbi").canSupport,
    true,
  );
  await service.support("b", {
    ...sign,
    groupId: 99,
    signedBy: "c",
    playerId: "a",
  });
  const row = db.prepare("SELECT * FROM faction_policy_supports").get();
  assert.equal(row.group_id, 3);
  assert.equal(row.signed_by, "b");
  assert.equal(row.signer_faction, "croft");
  const playerView = JSON.stringify(await service.state("a"));
  assert.ok(!playerView.includes('"signedBy"'));
  const publicPolicy = (await service.state("a")).policies.find(
    (p) => p.id === "fbi",
  );
  assert.equal(publicPolicy.proposal.groupId, undefined);
  assert.equal(publicPolicy.proposal.submittedBy, undefined);
  assert.deepEqual(publicPolicy.supports, [{ groupId: 3 }]);
  const adminView = await service.adminState();
  assert.equal(
    adminView.policies.find((p) => p.id === "fbi").supports[0].signedBy,
    "b",
  );
});

test("每组最多支持一条，重复请求幂等、同组并发不能重复签署", async (t) => {
  const { db, service } = await setup(t);
  await service.propose("a", input);
  await service.propose("c", input);
  const state = await service.state("b"),
    fbi = state.policies.find((p) => p.id === "fbi"),
    preservation = state.policies.find((p) => p.id === "conspirator");
  const results = await Promise.allSettled([
    service.support("b", {
      faction: "fbi",
      proposalUpdatedAt: fbi.proposal.updatedAt,
    }),
    service.support("b2", {
      faction: "conspirator",
      proposalUpdatedAt: preservation.proposal.updatedAt,
    }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.find((r) => r.status === "rejected").reason.status, 409);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM faction_policy_supports").get().n,
    1,
  );
  await service.support("b2", {
    faction: "fbi",
    proposalUpdatedAt: fbi.proposal.updatedAt,
  });
  assert.equal(
    db.prepare("SELECT signed_by FROM faction_policy_supports").get().signed_by,
    "b",
  );
});

test("签名前核对提案版本，签后锁定，不能拿签字换另一份解释", async (t) => {
  const { service } = await setup(t);
  await service.propose("a", input);
  const old = await proposalFor(service, "a");
  await service.propose("a", {
    ...input,
    explanation: "我方要求保护原始资料，同时保留独立审查和隐私保护。",
  });
  const next = await proposalFor(service, "a");
  assert.ok(next.updatedAt > old.updatedAt);
  await assert.rejects(
    service.support("b", { faction: "fbi", proposalUpdatedAt: old.updatedAt }),
    { status: 409 },
  );
  await service.support("b", {
    faction: "fbi",
    proposalUpdatedAt: next.updatedAt,
  });
  await assert.rejects(service.propose("a", input), { status: 409 });
});

test("GM复核拒绝会公布说明并撤回原支持；补写清除旧复核，价值票不参与达成", async (t) => {
  const { db, service } = await setup(t);
  await service.propose("a", input);
  const old = await proposalFor(service, "a");
  await service.support("b", {
    faction: "fbi",
    proposalUpdatedAt: old.updatedAt,
  });
  await service.review("gm", {
    faction: "fbi",
    status: "rejected",
    note: "请解释审计资料为什么需要独立封存。",
    proposalUpdatedAt: old.updatedAt,
  });
  const rejected = (await service.state("a")).policies.find(
    (p) => p.id === "fbi",
  );
  assert.equal(rejected.achieved, false);
  assert.equal(rejected.supports.length, 0);
  assert.match(rejected.proposal.reviewNote, /第3组原支持已撤回/);
  assert.equal((await service.state("b")).groupSupport, null);
  await assert.rejects(
    service.support("c", { faction: "fbi", proposalUpdatedAt: old.updatedAt }),
    { status: 409 },
  );
  await service.propose("a", {
    ...input,
    explanation:
      "审计资料含有私人数据，因此原始副本需要独立封存，公开摘要应遮蔽私人内容。",
  });
  const next = await proposalFor(service, "a");
  assert.equal(next.reviewStatus, "pending");
  assert.equal(next.reviewNote, null);
  await assert.rejects(
    service.review("gm", {
      faction: "fbi",
      status: "approved",
      proposalUpdatedAt: old.updatedAt,
    }),
    { status: 409 },
  );
  await service.review("gm", {
    faction: "fbi",
    status: "approved",
    proposalUpdatedAt: next.updatedAt,
  });
  assert.equal(
    (await service.state("a")).policies.find((p) => p.id === "fbi").achieved,
    false,
  );
  await service.support("b", {
    faction: "fbi",
    proposalUpdatedAt: next.updatedAt,
  });
  assert.equal(
    (await service.state("a")).policies.find((p) => p.id === "fbi").achieved,
    true,
  );
  for (const id of ["unsigned", "a"]) {
    if (id === "a")
      db.prepare("UPDATE players SET checked_in=0 WHERE id='a'").run();
    const locked = await service.state(id);
    assert.equal(locked.canParticipate, false);
    assert.equal(locked.groupSupport, null);
    assert.equal(locked.evidence.length, 0);
    assert.ok(locked.policies.every((p) => !p.proposal && !p.supports.length));
  }
});

test("HTTP路由只允许玩家本人提交，只有GM可查签署人，NPC和匿名均无写入权限", async (t) => {
  const { service } = await setup(t);
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const identity = req.get("x-test-session");
    req.auth = identity
      ? {
          role: ["gm", "npc"].includes(identity) ? identity : "player",
          user_id: identity,
        }
      : null;
    next();
  });
  const auth = (role) => (req, res, next) =>
    req.auth?.role === role
      ? next()
      : res.status(401).json({ error: "请登录" });
  mountFactionPlayRoutes(app, {
    auth,
    player: async (req) => ({ id: req.auth.user_id }),
    playable: async (req) => ({ p: { id: req.auth.user_id } }),
    factionPlay: service,
  });
  app.use((error, req, res, next) =>
    res.status(error.status || 500).json({ error: error.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });
  const request = (path, identity, body) =>
    fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        ...(identity ? { "x-test-session": identity } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  for (const identity of [null, "npc", "gm"]) {
    assert.equal(
      (await request("/faction-play/proposal", identity, input)).status,
      401,
    );
  }
  for (const identity of [null, "npc", "a"]) {
    assert.equal((await request("/staff/faction-play", identity)).status, 401);
  }
  for (const identity of [null, "npc", "a"]) {
    assert.equal(
      (
        await request("/staff/faction-play/review", identity, {
          faction: "fbi",
          status: "approved",
        })
      ).status,
      401,
    );
  }
  const saved = await request("/faction-play/proposal", "a", {
    ...input,
    faction: "conspirator",
    playerId: "c",
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.headers.get("cache-control"), "private, no-store");
  const board = await (await request("/staff/faction-play", "gm")).json();
  assert.equal(
    board.policies.find((p) => p.id === "fbi").proposal.submittedBy,
    "a",
  );
  assert.equal(
    board.policies.find((p) => p.id === "conspirator").proposal,
    null,
  );
});
