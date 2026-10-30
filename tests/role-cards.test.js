import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";
import { summaryHash } from "../server/role-card-summary.js";

test("角色卡使用正式阵营任务，杀手仅获得本人及一位已就绪同伴的真实暗号", async (t) => {
  const { app, db } = await createApp({
    dbPath: ":memory:",
    databaseUrl: process.env.TEST_DATABASE_URL,
    gmPassword: "faction-card-gm",
    npcPassword: "faction-card-npc",
    allowLegacyRegistration: true,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const players = [];
  for (let i = 0; i < 6; i++) {
    const res = await fetch(base + "/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: `阵营卡宾客${i}`,
        contact: `faction-card-${i}@example.com`,
        password: "faction-card-password",
      }),
    });
    assert.equal(res.status, 200);
    const { id } = await res.json();
    players.push({ id, cookie: res.headers.get("set-cookie").split(";")[0] });
    await db.prepare("UPDATE players SET payment='paid' WHERE id=?").run(id);
    await db
      .prepare(
        "INSERT INTO characters(player_id,name,story,status,faction) VALUES(?,?,'我的公开故事','approved','conspirator')",
      )
      .run(id, `阵营卡角色${i}`);
    if (i < 5)
      await db
        .prepare(
          "INSERT INTO faction_assignments(player_id,faction,contact_code,draw_id,assigned_at,assigned_by) VALUES(?,?,?,'card-draw',?,'gm')",
        )
        .run(
          id,
          ["conspirator", "conspirator", "fbi", "croft", "conspirator"][i],
          `真实接头暗号${i}`,
          i + 1,
        );
  }
  const cardFor = async (index) => {
    const res = await fetch(base + "/role-cards", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: players[index].cookie,
      },
      body: "{}",
    });
    assert.equal(res.status, 200);
    return (await res.json()).cards[0];
  };
  const first = await cardFor(0);
  assert.deepEqual(first.faction, {
    id: "conspirator",
    label: "杀手阵营",
    mission: "保护真正的凶手",
    contact: { own: "真实接头暗号0", partner: "真实接头暗号1" },
  });
  assert.ok(!JSON.stringify(first).includes("真实接头暗号4"));
  assert.equal((await cardFor(1)).faction.contact.partner, "真实接头暗号4");
  assert.equal((await cardFor(4)).faction.contact.partner, "真实接头暗号0");
  for (const [i, label, mission] of [
    [2, "FBI调查阵营", "正确抓到凶手"],
    [3, "索恩遗产阵营", "找到并抓捕杀手阵营的人"],
  ]) {
    const card = await cardFor(i);
    assert.deepEqual(card.faction, {
      id: i === 2 ? "fbi" : "croft",
      label,
      mission,
      ...(i === 3
        ? {
            clue: "你要找到并抓捕的杀手，都有接头暗号。\n听说，暗号像四字一组的诗句。",
          }
        : {}),
    });
    assert.ok(!JSON.stringify(card).includes("真实接头暗号"));
  }
  // An old character faction cannot stand in for a formal assignment.
  assert.equal((await cardFor(5)).faction, null);
  await db
    .prepare(
      "UPDATE faction_assignments SET contact_code='更新的真实暗号' WHERE player_id=?",
    )
    .run(players[1].id);
  const updated = await cardFor(0);
  assert.equal(updated.faction.contact.partner, "更新的真实暗号");
  assert.equal(summaryHash(updated), summaryHash(first));
  await db
    .prepare("UPDATE characters SET status='pending' WHERE player_id=?")
    .run(players[1].id);
  assert.equal((await cardFor(1)).faction.contact, null);
  assert.ok(!JSON.stringify((await cardFor(1)).faction).includes("真实暗号"));
  assert.equal((await cardFor(0)).faction.contact.partner, "真实接头暗号4");
  await db
    .prepare("UPDATE players SET payment='refunded' WHERE id=?")
    .run(players[4].id);
  const alone = (await cardFor(0)).faction;
  assert.equal(alone.contact.own, "真实接头暗号0");
  assert.equal(alone.contact.partner, null);
  assert.match(alone.notice, /联系GM/);
  await db
    .prepare("UPDATE faction_assignments SET faction='fbi' WHERE player_id=?")
    .run(players[0].id);
  assert.ok(!JSON.stringify(await cardFor(0)).includes("真实接头暗号"));
});

test("付费角色卡隔离玩家权限、稳定签名扫码登录、二维码重置与退款/删除失效", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "alaska-role-cards-"));
  const options = {
    dbPath: join(dir, "game.sqlite"),
    databaseUrl: process.env.TEST_DATABASE_URL,
    gmPassword: "role-card-gm",
    npcPassword: "role-card-npc",
    allowLegacyRegistration: true,
    smsDevLogin: true,
  };
  let { app, db } = await createApp(options);
  let server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  let base = `http://127.0.0.1:${server.address().port}/api`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const client = () => {
    let cookie = "";
    return async (path, body, status = 200, headers = {}) => {
      const res = await fetch(base + path, {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json", cookie, ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json();
      assert.equal(res.status, status, JSON.stringify(data));
      if (res.headers.get("set-cookie")) {
        assert.match(res.headers.get("set-cookie"), /HttpOnly/);
        assert.match(res.headers.get("set-cookie"), /SameSite=Strict/);
        cookie = res.headers.get("set-cookie").split(";")[0];
      }
      assert.match(res.headers.get("Cache-Control"), /no-store/);
      return data;
    };
  };
  const gm = client(),
    own = client(),
    other = client(),
    empty = client(),
    anon = client(),
    npc = client();
  await gm("/login", { account: "gm", password: options.gmPassword });
  const register = (c, name, contact) =>
    c("/register", { name, contact, password: "card-test-password" });
  const first = await register(own, "第一位宾客", "card-first@example.com");
  const second = await register(other, "第二位宾客", "card-second@example.com");
  const missing = await register(empty, "暂无角色", "card-empty@example.com");
  for (const { id } of [first, second]) {
    await db
      .prepare(
        "INSERT INTO characters(player_id,name,story,adaptation,status,motive,secret,profession,skill) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        `角色${id.slice(0, 4)}`,
        "自己的原始故事",
        "庄园中的玩家故事",
        "approved",
        "寻找自己的目标",
        "GM秘密不可导出",
        "档案调查员",
        "洞察",
      );
    await db
      .prepare(
        "INSERT INTO character_relations(player_id,npc_id,relation,player_brief,npc_brief,hooks,mission) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        id,
        "host",
        "受邀宾客",
        "玩家可以看到的关系",
        "NPC秘密不可导出",
        "[]",
        "与主人交流",
      );
  }
  await anon("/role-cards", {}, 401);
  await own("/role-cards", {}, 403);
  await gm(`/staff/players/${first.id}`, { payment: "paid" });
  await gm(`/staff/players/${second.id}`, { payment: "paid" });
  await gm(`/staff/players/${missing.id}`, { payment: "paid" });
  await empty("/role-cards", {}, 409);
  await own("/role-cards", { playerIds: [second.id] }, 403);
  await own("/role-cards", { playerIds: [first.id, second.id] }, 403);
  await own("/role-cards", { playerIds: [] }, 400);
  await own(`/role-cards/${first.id}/reset`, {}, 401);
  const batch = await gm("/role-cards", {
    playerIds: [first.id, second.id, first.id],
  });
  assert.equal(batch.cards.length, 2);
  const card = batch.cards[0];
  assert.equal(card.player.id, first.id);
  assert.equal(card.player.payment, "paid");
  assert.ok(!("contact" in card.player) && !("password" in card.player));
  assert.ok(!("faction" in card.character) && !("secret" in card.character));
  assert.ok(
    !("npc_brief" in card.relations[0]) && !("hooks" in card.relations[0]),
  );
  assert.ok(!JSON.stringify(batch).includes("秘密不可导出"));
  const access = new URL("https://example.test" + card.accessPath).hash.slice(
    8,
  );
  const different = new URL(
    "https://example.test" + batch.cards[1].accessPath,
  ).hash.slice(8);
  assert.notEqual(access, different);
  assert.equal(
    (await own("/role-cards", {})).cards[0].accessPath,
    card.accessPath,
  );
  await anon("/auth/role-card", { access: first.id }, 401);
  await anon(
    "/auth/role-card",
    { access: access.slice(0, -1) + (access.endsWith("a") ? "b" : "a") },
    401,
  );
  await anon("/auth/role-card", { access }, 403, {
    origin: "https://untrusted.example",
  });
  await anon("/auth/role-card", { access });
  assert.deepEqual(await anon("/session"), { role: "player", id: first.id });
  const me = await anon("/me");
  assert.equal(me.player.checked_in, 0);
  assert.equal(me.player.coins, 0);
  await anon("/clues/E-01/unlock", {}, 403);
  await anon("/staff", undefined, 401);
  // The card is reusable; scanning a different guest replaces the player identity.
  await anon("/auth/role-card", { access: different });
  assert.equal((await anon("/session")).id, second.id);
  await db
    .prepare("INSERT INTO npc_phones(npc_id,phone) VALUES(?,?)")
    .run("detective", "13500000009");
  await npc("/auth/sms/login", { phone: "13500000009", code: "188888" });
  await npc("/role-cards", { playerIds: [first.id] }, 401);
  // Pending drafts retain only their own submitted text.
  await db
    .prepare("UPDATE characters SET status='pending' WHERE player_id=?")
    .run(first.id);
  const draft = (await own("/role-cards", {})).cards[0];
  assert.equal(draft.character.adaptation, null);
  assert.deepEqual(draft.relations, []);
  await gm(`/role-cards/${first.id}/reset`, {});
  await anon("/auth/role-card", { access }, 401);
  const replacement = (await own("/role-cards", {})).cards[0].accessPath;
  assert.notEqual(replacement, card.accessPath);
  const newAccess = new URL("https://example.test" + replacement).hash.slice(8);
  // The nonce and signing key survive an application restart.
  await new Promise((resolve) => server.close(resolve));
  await db.close();
  ({ app, db } = await createApp(options));
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
  await anon("/auth/role-card", { access: newAccess });
  await gm(`/staff/players/${first.id}`, { payment: "refunded" });
  await anon("/auth/role-card", { access: newAccess }, 403);
  await own("/role-cards", {}, 403);
  await gm("/role-cards", { playerIds: [first.id, second.id] }, 403);
  await gm(`/staff/manage/players/${first.id}/delete`, {});
  assert.equal(
    await db
      .prepare("SELECT * FROM role_card_access WHERE player_id=?")
      .get(first.id),
    undefined,
  );
  await anon("/auth/role-card", { access: newAccess }, 401);
});
