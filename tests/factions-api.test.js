import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";

async function setup(t, count = 6) {
  const { app, db } = await createApp({
    dbPath: ":memory:", gmPassword: "factions-gm", npcPassword: "factions-npc",
    allowLegacyRegistration: true, smsDevLogin: true, assignFactionsAtCreation: false,
    llm: { baseUrl: "", apiKey: "", model: "" },
  });
  await db.transaction(async () => {
    for (let index = 0; index < count; index++) {
      await db.prepare("INSERT INTO players(id,name,contact,password,payment) VALUES(?,?,?,?,?)").run(`faction-${index}`, `宾客${index}`, `139${String(index).padStart(8, "0")}`, "unused", "paid");
      await db.prepare("INSERT INTO characters(player_id,name,status) VALUES(?,?,?)").run(`faction-${index}`, `角色${index}`, "approved");
      await db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(`session-${index}`, "player", `faction-${index}`, Date.now() + 600000);
    }
    await db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run("session-gm", "gm", "gm", Date.now() + 600000);
    await db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run("session-npc", "npc", "attorney", Date.now() + 600000);
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await db.close(); });
  const request = (url, body, session = "session-gm") => fetch(`http://127.0.0.1:${server.address().port}/api${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", cookie: session ? `alaska_session=${session}` : "" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { db, request };
}

test("真实阵营路由：偏好、抽签、人数平衡、独立暗号与本人/GM隔离", async (t) => {
  const { db, request } = await setup(t);
  for (const session of ["", "session-0", "session-npc"]) {
    assert.equal((await request("/staff/factions", undefined, session)).status, 401);
    assert.equal((await request("/staff/factions/draw", {}, session)).status, 401);
  }
  assert.equal((await request("/factions/preference", { preference: "conspirator" }, "")).status, 401);
  assert.equal((await request("/factions/preference", { preference: "invalid" }, "session-0")).status, 400);
  assert.equal((await request("/me", undefined, "session-0")).headers.get("cache-control"), "private, no-store");
  assert.equal((await (await request("/me", undefined, "session-0")).json()).character.faction, null);
  const preferences = ["conspirator", "conspirator", "conspirator", "fbi", "croft", "any"];
  for (let index = 0; index < preferences.length; index++) {
    const saved = await request("/factions/preference", { preference: preferences[index], playerId: "faction-5" }, `session-${index}`);
    assert.equal(saved.status, 200, await saved.clone().text());
  }
  const before = await (await request("/staff/factions")).json();
  assert.equal(before.drawn, false);
  assert.equal(before.eligibleCount, 6);
  assert.equal(before.quota, 2);
  assert.equal(before.players.filter((player) => player.code).length, 0);
  const result = await request("/staff/factions/draw", {});
  assert.equal(result.status, 200, await result.clone().text());
  const state = await result.json();
  assert.equal(state.counts.conspirator, 2);
  assert.ok(Math.abs(state.counts.fbi - state.counts.croft) <= 1);
  const killers = state.players.filter((player) => player.assigned === "conspirator");
  assert.equal(new Set(killers.map((player) => player.code)).size, 2);
  assert.ok(killers.every((player) => player.preference === "conspirator"));
  for (let index = 0; index < 6; index++) {
    const me = await (await request("/me", undefined, `session-${index}`)).json();
    const expected = state.players.find((player) => player.id === `faction-${index}`);
    assert.equal(me.faction.assigned, expected.assigned);
    assert.equal(me.character.faction, expected.assigned);
    if (expected.assigned === "conspirator") {
      assert.equal(me.faction.code, expected.code);
      assert.match(me.faction.briefing, /伊芙琳|接头/);
      for (const other of killers.filter((player) => player.id !== expected.id))
        assert.ok(!JSON.stringify(me).includes(other.code));
    } else {
      assert.equal(me.faction.code, null);
      assert.ok(!/伊芙琳|接头|真凶|暗号/.test(me.faction.briefing || ""));
    }
  }
  const publicData = await (await request("/public", undefined, "")).text();
  const npcData = await (await request("/staff", undefined, "session-npc")).text();
  for (const killer of killers) {
    assert.ok(!publicData.includes(killer.code));
    assert.ok(!npcData.includes(killer.code));
  }
  const detail = await (await request(`/staff/players/${killers[0].id}`)).json();
  assert.equal(detail.faction.code, killers[0].code);
  assert.equal((await request("/factions/preference", { preference: "fbi" }, "session-0")).status, 409);
  assert.equal((await request("/staff/factions/draw", {})).status, 409);
  assert.deepEqual((await (await request("/staff/factions")).json()).players, state.players);
  const audit = await db.prepare("SELECT action FROM audit").all();
  for (const killer of killers) assert.ok(!JSON.stringify(audit).includes(killer.code));
});

test("新旧报名接口均不能超过50，满额仍可登录，GM不能把容量放大到51", async (t) => {
  const { request, db } = await setup(t, 50);
  assert.equal((await (await request("/public")).json()).settings.capacity, 50);
  assert.equal((await request("/staff/settings", { capacity: 51, price: 189 })).status, 400);
  assert.equal((await request("/register", { name: "超额宾客", contact: "overflow-limit@example.com", password: "capacity-password" }, "")).status, 400);
  assert.equal((await request("/auth/sms/login", { phone: "13800009999", code: "188888" }, "")).status, 400);
  assert.equal((await request("/auth/sms/login", { phone: "13900000000", code: "188888" }, "")).status, 200);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM players").get()).n, 50);
  // The absolute event limit also protects against a stale database setting.
  await db.prepare("UPDATE settings SET capacity=100").run();
  assert.equal((await request("/auth/sms/login", { phone: "13800009998", code: "188888" }, "")).status, 400);
});
