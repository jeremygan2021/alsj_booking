import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp, npcCredential } from "../server/app.js";
test("完整报名、权限隔离、资源幂等、竞拍、搜证和庭审流程", async (t) => {
  const { app, db } = createApp({
    dbPath: ":memory:",
    gmPassword: "gm-test-pass",
    npcPassword: "npc-test-pass",
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => {
    server.close();
    db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  function client() {
    let cookie = "";
    return async (url, body, expected = 200) => {
      const res = await fetch(base + "/api" + url, {
        method: body ? "POST" : "GET",
        headers: { "content-type": "application/json", cookie },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.headers.get("set-cookie"))
        cookie = res.headers.get("set-cookie").split(";")[0];
      assert.equal(res.status, expected, await res.clone().text());
      return res.json();
    };
  }
  const publicClient = client(),
    gm = client(),
    p = client(),
    other = client(),
    npc = client();
  await publicClient("/staff", null, 401);
  const pub = await publicClient("/public");
  assert.ok(pub.npcs.every((n) => !("secret" in n)));
  await gm("/login", { account: "gm", password: "gm-test-pass" });
  const registered = await p("/register", {
    name: "测试玩家",
    contact: "test@example.com",
    password: "test-pass-123",
  });
  await p("/character", {
    name: "莱恩·米勒",
    english: "Ryan Miller",
    profession: "调查员",
    story: "我曾在极光集团工作。",
    motive: "寻找真相",
    skill: "洞察",
  });
  const draft = await p("/me");
  assert.equal(draft.character.faction, null);
  assert.equal(draft.character.secret, null);
  await p("/clues/E-01/unlock", {}, 403);
  await gm(`/staff/players/${registered.id}`, {
    payment: "paid",
    checkin: true,
    status: "approved",
    faction: "fbi",
  });
  await gm(`/staff/players/${registered.id}`, { checkin: true });
  assert.equal((await p("/me")).player.coins, 3);
  await other("/register", {
    name: "其他玩家",
    contact: "other@example.com",
    password: "test-pass-123",
  });
  assert.equal((await other("/me")).character, undefined);
  await other(`/staff/players/${registered.id}`, null, 401);
  await npc("/login", {
    account: "npc:detective",
    password: npcCredential("npc-test-pass", "detective"),
  });
  const ns = await npc("/staff");
  assert.ok(ns.players.every((p) => !("faction" in p)));
  assert.ok(ns.npcs.every((n) => !("secret" in n)));
  const mission = (await p("/me")).missions[0];
  await npc(`/staff/missions/${mission.id}/complete`, {});
  await npc(`/staff/missions/${mission.id}/complete`, {});
  assert.equal((await p("/me")).player.coins, 5);
  await npc("/staff/phase", { phase: 3 }, 401);
  await gm("/staff/coins", {
    playerId: registered.id,
    amount: 50,
    reason: "测试集资",
  });
  await gm("/staff/phase", { phase: 2 });
  await gm("/staff/lots/1", { action: "open" });
  await p("/lots/1/bid", { amount: 18 });
  await gm(
    "/staff/coins",
    { playerId: registered.id, amount: -50, reason: "冲突扣款" },
    400,
  );
  await gm("/staff/lots/1", { action: "settle" });
  await gm("/staff/lots/1", { action: "settle" }, 400);
  assert.equal((await p("/me")).inventory.length, 1);
  await p("/clues/E-04/unlock", {}, 403);
  const list = await p("/clues");
  assert.ok(list.clues.every((c) => !("body" in c) && !("detail" in c)));
  await gm("/staff/phase", { phase: 3 });
  const clue = await p("/clues/E-04/unlock", {});
  assert.equal(clue.detail, null);
  const check = await p("/check", { clueId: "E-04", roll: 20 });
  assert.ok(check.roll >= 1 && check.roll <= 20);
  assert.deepEqual(await p("/check", { clueId: "E-04" }), check);
  await p("/clues/E-01/unlock", {});
  await p("/clues/E-05/unlock", {});
  await p(
    "/vote",
    {
      suspect: "security",
      motive: "E-01",
      means: "E-05",
      opportunity: "E-04",
      decision: "publish",
    },
    400,
  );
  await gm("/staff/phase", { phase: 4 });
  await gm("/staff/voting", { open: true });
  await p("/vote", {
    suspect: "security",
    motive: "E-01",
    means: "E-05",
    opportunity: "E-04",
    decision: "publish",
  });
  await p("/vote", {
    suspect: "security",
    motive: "E-01",
    means: "E-05",
    opportunity: "E-04",
    decision: "protect",
  });
  assert.equal((await gm("/staff")).stats.votes, 1);
  const inv = (await p("/me")).inventory[0];
  await p(`/inventory/${inv.id}/use`, {});
  await p(`/inventory/${inv.id}/use`, {}, 400);
});
