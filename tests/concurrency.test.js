import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";
test("并发报名不超额，重复签到及落槌只结算一次", async (t) => {
  const options = {
    databaseUrl: process.env.TEST_DATABASE_URL,
    dbPath: ":memory:",
    gmPassword: "gm-concurrency-password",
    npcPassword: "npc-concurrency-password",
  };
  const apps = [await createApp(options)];
  if (process.env.TEST_DATABASE_URL) apps.push(await createApp(options));
  const servers = apps.map(({ app }) => app.listen(0, "127.0.0.1"));
  await Promise.all(
    servers.map((s) => new Promise((r) => s.once("listening", r))),
  );
  t.after(async () => {
    for (const s of servers) s.close();
    await Promise.all(apps.map(({ db }) => db.close()));
  });
  const bases = servers.map((s) => `http://127.0.0.1:${s.address().port}/api`);
  const request = async (path, body, cookie = "", index = 0) => {
    const response = await fetch(bases[index % bases.length] + path, {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json", cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: response.status,
      body: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  };
  const login = await request("/login", {
    account: "gm",
    password: options.gmPassword,
  });
  const gm = async (path, body, index = 0) =>
    request("/staff" + path, body, login.cookie, index);
  assert.equal(
    (await gm("/settings", { capacity: 1, price: 189 })).status,
    200,
  );
  const registrations = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      request(
        "/register",
        {
          name: "并发玩家",
          contact: `race${i}@example.com`,
          password: "race-player-password",
        },
        "",
        i,
      ),
    ),
  );
  assert.equal(registrations.filter((r) => r.status === 200).length, 1);
  assert.equal((await request("/public")).body.registered, 1);
  const p = registrations.find((r) => r.status === 200),
    id = p.body.id;
  const checkins = await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      gm("/players/" + id, { payment: "paid", checkin: true }, i),
    ),
  );
  assert.ok(checkins.every((r) => r.status === 200));
  assert.equal((await request("/me", null, p.cookie)).body.player.coins, 3);
  assert.equal(
    (await gm("/coins", { playerId: id, amount: 20, reason: "竞拍并发测试" }))
      .status,
    200,
  );
  assert.equal(
    (
      await request(
        "/character",
        {
          name: "并发角色",
          english: "Race Guest",
          profession: "记者",
          skill: "洞察",
          story: "参加极光宴会的记者。",
          motive: "调查",
        },
        p.cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (await gm("/players/" + id, { status: "approved", faction: "croft" }))
      .status,
    200,
  );
  await gm("/phase", { phase: 2 });
  await gm("/lots/1", { action: "open" });
  assert.equal(
    (await request("/lots/1/bid", { amount: 18 }, p.cookie)).status,
    200,
  );
  const settled = await Promise.all([
    gm("/lots/1", { action: "settle" }),
    gm("/lots/1", { action: "settle" }, 1),
  ]);
  assert.deepEqual(settled.map((r) => r.status).sort(), [200, 400]);
  const me = (await request("/me", null, p.cookie)).body;
  assert.equal(me.inventory.length, 1);
  assert.equal(me.player.coins, 5);
});
