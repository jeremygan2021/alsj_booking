import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";
import {
  applyFourInvestigationGroups,
  INVESTIGATION_GROUP_MIGRATION,
} from "../server/migrations/investigation-groups.js";

async function setup(t) {
  const result = await createApp({
    dbPath: ":memory:",
    databaseUrl: process.env.TEST_DATABASE_URL,
    gmPassword: "groups-gm",
    npcPassword: "groups-npc",
    allowLegacyRegistration: true,
    smsDevLogin: true,
  });
  const { db } = result;
  const server = result.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (process.env.TEST_DATABASE_URL) {
      assert.match(
        new URL(process.env.TEST_DATABASE_URL).searchParams.get("options"),
        /search_path=alsj_test_/,
      );
      await db.transaction(async () => {
        await db.prepare("TRUNCATE players CASCADE").run();
        await db.prepare("DELETE FROM checks").run();
        await db.prepare("DELETE FROM investigation_group_reassignments").run();
        await applyFourInvestigationGroups(db);
      });
    }
    await db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const client = () => {
    let cookie = "";
    return async (path, body, expected = 200) => {
      const response = await fetch(base + path, {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await response.json();
      assert.equal(response.status, expected, JSON.stringify(data));
      if (response.headers.get("set-cookie"))
        cookie = response.headers.get("set-cookie").split(";")[0];
      return data;
    };
  };
  return { db, client };
}

test("六组旧名单一次均分为四组，付费玩家均衡且个人数据和证据保留", async (t) => {
  const { db } = await setup(t);
  await db
    .prepare("DELETE FROM content_migrations WHERE id=?")
    .run(INVESTIGATION_GROUP_MIGRATION);
  for (let i = 0; i < 14; i++) {
    await db
      .prepare(
        "INSERT INTO players(id,name,contact,password,payment,checked_in,coins,group_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        `old-${String(i).padStart(2, "0")}`,
        `玩家${i}`,
        `old-${i}@example.com`,
        "unchanged",
        i < 11 ? "paid" : "pending",
        i % 2,
        i + 3,
        (i % 6) + 1,
        "2026-10-30 12:00:00",
      );
  }
  await db
    .prepare("INSERT INTO unlocks(player_id,clue_id) VALUES('old-00','E-01')")
    .run();
  const before = await db.prepare("SELECT * FROM players ORDER BY id").all();
  await db.transaction(() => applyFourInvestigationGroups(db));
  const after = await db.prepare("SELECT * FROM players ORDER BY id").all();
  const withoutGroup = (rows) => rows.map(({ group_id, ...player }) => player);
  assert.deepEqual(withoutGroup(after), withoutGroup(before));
  assert.deepEqual(
    (
      await db
        .prepare(
          "SELECT group_id,COUNT(*) n FROM players GROUP BY group_id ORDER BY group_id",
        )
        .all()
    ).map(({ group_id, n }) => [group_id, Number(n)]),
    [
      [1, 4],
      [2, 4],
      [3, 3],
      [4, 3],
    ],
  );
  assert.deepEqual(
    (
      await db
        .prepare(
          "SELECT group_id,COUNT(*) n FROM players WHERE payment='paid' GROUP BY group_id ORDER BY group_id",
        )
        .all()
    ).map(({ n }) => Number(n)),
    [3, 3, 3, 2],
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT COUNT(*) n FROM unlocks WHERE player_id='old-00' AND clue_id='E-01'",
        )
        .get()
    ).n,
    1,
  );
  const backup = await db
    .prepare(
      "SELECT * FROM investigation_group_reassignments ORDER BY player_id",
    )
    .all();
  assert.equal(backup.length, 14);
  assert.deepEqual(
    backup.map((r) => r.previous_group_id),
    before.map((p) => p.group_id),
  );
  // Reopening an application or a second instance must preserve later GM edits.
  await db.prepare("UPDATE players SET group_id=4 WHERE id='old-00'").run();
  await db.transaction(() => applyFourInvestigationGroups(db));
  assert.equal(
    (await db.prepare("SELECT group_id FROM players WHERE id='old-00'").get())
      .group_id,
    4,
  );
});

test("已有鉴定记录时分组迁移完整回滚", async (t) => {
  const { db } = await setup(t);
  await db
    .prepare("DELETE FROM content_migrations WHERE id=?")
    .run(INVESTIGATION_GROUP_MIGRATION);
  await db
    .prepare(
      "INSERT INTO players(id,name,contact,password,group_id) VALUES('existing','已有玩家','existing@example.com','unchanged',6)",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO checks(group_id,area,roll,bonus) VALUES(6,'档案室',20,2)",
    )
    .run();
  await assert.rejects(
    db.transaction(() => applyFourInvestigationGroups(db)),
    /已有调查组游戏记录/,
  );
  assert.equal(
    (await db.prepare("SELECT group_id FROM players WHERE id='existing'").get())
      .group_id,
    6,
  );
  assert.equal(
    (await db.prepare("SELECT roll FROM checks WHERE group_id=6").get()).roll,
    20,
  );
  assert.equal(
    await db
      .prepare("SELECT id FROM content_migrations WHERE id=?")
      .get(INVESTIGATION_GROUP_MIGRATION),
    undefined,
  );
});

test("两种报名入口只分配1–4组，GM拒绝无效组号并优先补齐人数最少组", async (t) => {
  const { db, client } = await setup(t);
  const gm = client();
  await gm("/login", { account: "gm", password: "groups-gm" });
  const registered = [];
  for (let i = 0; i < 8; i++) {
    const player = client();
    const result = await player("/register", {
      name: `报名${i}`,
      contact: `new-${i}@example.com`,
      password: "test-password",
    });
    registered.push(result.id);
    assert.equal((await player("/me")).player.group_id, (i % 4) + 1);
  }
  for (const group of [0, 5, 6, -1, 1.5, "1", null])
    await gm(`/staff/players/${registered[0]}`, { group }, 400);
  await gm(`/staff/players/${registered[0]}`, { group: 4 });
  await gm(`/staff/players/${registered[4]}`, { group: 4 });
  // Group 1 is empty; all simultaneous registrations must fill it safely.
  const newcomers = await Promise.all(
    Array.from({ length: 4 }, async (_, i) => {
      const player = client();
      await player("/auth/sms/login", {
        phone: `1390000000${i}`,
        code: "188888",
      });
      return (await player("/me")).player;
    }),
  );
  assert.ok(newcomers.every((p) => p.group_id >= 1 && p.group_id <= 4));
  assert.equal(newcomers.filter((p) => p.group_id === 1).length, 3);
  assert.deepEqual(
    (
      await db
        .prepare(
          "SELECT group_id,COUNT(*) n FROM players GROUP BY group_id ORDER BY group_id",
        )
        .all()
    ).map(({ n }) => Number(n)),
    [3, 3, 2, 4],
  );
});
