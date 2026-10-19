import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";
import { defaultArScenes } from "../server/ar/scenes.js";
import { defaultSite } from "../server/admin/content-store.js";

test("Admin管理内容、权限、账目锁定和AR持久化", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "alsj-admin-"));
  const sent = [];
  const options = {
    smsSender: async (payload) => sent.push(payload),
    allowLegacyRegistration: true,
    databaseUrl: process.env.TEST_DATABASE_URL,
    dbPath: join(dir, "test.sqlite"),
    gmPassword: "admin-test",
    npcPassword: "npc-test",
    arScenes: defaultArScenes,
  };
  let app, db, server, base;
  const start = async () => {
    ({ app, db } = await createApp(options));
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${server.address().port}/api`;
  };
  const close = async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  };
  await start();
  t.after(async () => {
    await close();
    rmSync(dir, { recursive: true, force: true });
  });
  const client = () => {
    let cookie = "";
    return async (path, body, status = 200) => {
      const res = await fetch(base + path, {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.headers.get("set-cookie"))
        cookie = res.headers.get("set-cookie").split(";")[0];
      assert.equal(res.status, status, await res.clone().text());
      assert.match(res.headers.get("Cache-Control"), /(?:^|,\s*)no-store(?:,|$)/);
      return res.json();
    };
  };
  const admin = client(),
    player = client(),
    npc = client(),
    anon = client(),
    other = client();
  await anon("/staff/manage", undefined, 401);
  await admin("/login", { account: "admin", password: "admin-test" });
  await db
    .prepare("INSERT INTO npc_phones(npc_id,phone) VALUES(?,?)")
    .run("host", "13500000002");
  await npc("/auth/sms/send", { phone: "13500000002" });
  await npc("/auth/sms/login", {
    phone: "13500000002",
    code: sent.at(-1).code,
  });
  await npc("/staff/manage", undefined, 401);
  const reg = await player("/register", {
    name: "玩家",
    contact: "admin-player@example.com",
    password: "test-password",
  });
  await other("/register", {
    name: "另一个玩家",
    contact: "other-admin@example.com",
    password: "test-password",
  });
  await player("/staff/manage", undefined, 401);
  const card = {
    name: "测试角色",
    english: "Test",
    profession: "调查员",
    skill: "技术",
    npc_id: "scientist",
    story: "角色背景",
    secret: "角色私密",
    motive: "寻找真相",
    faction: "fbi",
    status: "approved",
  };
  await admin(`/staff/manage/characters/${reg.id}`, card);
  assert.equal((await player("/me")).character.secret, "角色私密");
  await admin(`/staff/manage/players/${reg.id}`, {
    name: "更新玩家",
    contact: "updated-admin@example.com",
  });
  await admin(
    `/staff/manage/players/${reg.id}`,
    { name: "玩家", contact: "other-admin@example.com" },
    400,
  );
  await admin(`/staff/players/${reg.id}`, { payment: "paid", checkin: true });
  const before = (await player("/me")).player.coins;
  await admin(`/staff/manage/characters/${reg.id}`, {
    ...card,
    story: "编辑背景",
  });
  assert.equal((await player("/me")).player.coins, before);
  const clue = {
    id: "E-90",
    title: "新增证物",
    area: "实验室",
    skill: "技术",
    dc: 12,
    body: "基础新证据",
    detail: "进阶新证据",
    category: "技术证据",
    phase: 3,
  };
  await admin("/staff/manage/clues", clue);
  await admin("/staff/manage/clues", clue, 400);
  await admin("/staff/manage/clues/E-90", { ...clue, title: "修改证物" });
  await player("/staff/manage/clues", clue, 401);
  await admin("/staff/manage/npcs", {
    id: "archivist",
    name: "档案员",
    english: "Archivist",
    role: "档案管理",
    bio: "公开背景",
    secret: "保密设定",
  });
  await admin("/staff/manage/npcs/archivist", {
    name: "新档案员",
    english: "Archivist",
    role: "档案管理",
    bio: "更新背景",
    secret: "更新秘密",
    phone: "13600136000",
  });
  const npcByPhone = client();
  await npcByPhone("/auth/sms/send", { phone: "13600136000" });
  assert.equal(
    (
      await npcByPhone("/auth/sms/login", {
        phone: "13600136000",
        code: sent.at(-1).code,
      })
    ).role,
    "npc",
  );
  await npcByPhone("/staff/manage", undefined, 401);
  await admin(
    `/staff/manage/players/${reg.id}`,
    { name: "不可混用", contact: "13600136000" },
    400,
  );
  const mission = await admin("/staff/manage/missions", {
    player_id: reg.id,
    npc_id: "archivist",
    title: "档案委托",
    reward: 3,
  });
  await admin(`/staff/manage/missions/${mission.id}`, {
    player_id: reg.id,
    npc_id: "archivist",
    title: "更新委托",
    reward: 2,
  });
  await admin(`/staff/missions/${mission.id}/complete`, {});
  await admin(
    `/staff/manage/missions/${mission.id}`,
    { player_id: reg.id, npc_id: "archivist", title: "非法修改", reward: 10 },
    400,
  );
  const lot = await admin("/staff/manage/lots", {
    title: "新拍品",
    start_price: 5,
    description: "拍品说明",
    effect: "鉴定",
  });
  await admin(`/staff/manage/lots/${lot.id}`, {
    title: "修改拍品",
    start_price: 8,
    description: "更新说明",
    effect: "鉴定",
  });
  await admin("/staff/phase", { phase: 2 });
  await admin(`/staff/lots/${lot.id}`, { action: "open" });
  await admin(
    `/staff/manage/lots/${lot.id}`,
    { title: "不应修改", start_price: 3, description: "说明", effect: "鉴定" },
    400,
  );
  await admin("/staff/events", { title: "测试广播", body: "广播正文" });
  const list = await admin("/staff/manage");
  await admin(`/staff/manage/events/${list.events[0].id}`, {
    title: "更新广播",
    body: "更新正文",
  });
  assert.ok(list.players.every((item) => !("password" in item)));
  const site = { ...defaultSite, title: "新活动标题", description: "新介绍" };
  await admin("/staff/manage/site", site);
  const pub = await anon("/public");
  assert.equal(pub.site.title, "新活动标题");
  assert.ok(pub.npcs.every((item) => !("secret" in item)));
  const scene = structuredClone(defaultArScenes[0]);
  scene.title = "新版墙面";
  scene.hotspots = [{ ...scene.hotspots[0], clueId: "E-90" }];
  await admin("/staff/manage/scenes/wall-study", scene);
  await admin("/staff/phase", { phase: 3 });
  assert.equal((await player("/ar/scenes/wall-study")).title, "新版墙面");
  const acquired = await player(
    "/ar/scenes/wall-study/hotspots/document/collect",
    {},
  );
  assert.equal(acquired.id, "E-90");
  await admin("/staff/manage/scenes/wall-study", { ...scene, enabled: false });
  await player("/ar/scenes/wall-study", undefined, 404);
  await admin(
    "/staff/manage/scenes/wall-study",
    {
      ...scene,
      enabled: true,
      tracking: { ...scene.tracking, targetKey: "../evil.mind" },
    },
    400,
  );
  await admin(
    "/staff/manage/scenes/wall-study",
    {
      ...scene,
      enabled: true,
      hotspots: [{ ...scene.hotspots[0], clueId: "E-99" }],
    },
    404,
  );
  await close();
  await start();
  await admin("/login", { account: "admin", password: "admin-test" });
  const restarted = await admin("/staff/manage");
  assert.equal(
    restarted.scenes.find((item) => item.id === "wall-study").enabled,
    false,
  );
  assert.equal(restarted.site.title, "新活动标题");
  assert.ok(
    (await admin("/staff")).audit.some((item) =>
      item.action.includes("发布AR场景"),
    ),
  );
  // Deletion removes the complete game identity and invalidates old sessions.
  const deletion = `/staff/manage/players/${reg.id}/delete`;
  await anon(deletion, {}, 401);
  await npc(deletion, {}, 401);
  await player(deletion, {}, 401);
  await db.prepare("INSERT INTO paid_phones(phone,imported_by,imported_at) VALUES(?,?,?)")
    .run("13800138000", "admin", Date.now());
  await admin(`/staff/manage/players/${reg.id}`, { name: "待删除玩家", contact: "13800138000" });
  await db.prepare("INSERT INTO faction_policy_proposals(faction,evidence_id,explanation,submitted_by,group_id,updated_at) VALUES('fbi','E-01','测试',?,1,?)")
    .run(reg.id, Date.now());
  const otherId = (await db.prepare("SELECT id FROM players WHERE contact=?").get("other-admin@example.com")).id;
  await db.prepare("INSERT INTO faction_policy_supports(group_id,faction,signed_by,signer_faction,created_at) VALUES(1,'fbi',?,'croft',?)")
    .run(otherId, Date.now());
  await db.prepare("INSERT INTO generation_requests(id,player_id,requested_at) VALUES('delete-test',?,?)").run(reg.id, Date.now());
  await db.prepare("INSERT INTO votes(player_id,suspect) VALUES(?,?)").run(reg.id, "host");
  await db.prepare("UPDATE lots SET bidder=?,bid=5 WHERE id=?").run(reg.id, lot.id);
  await db.prepare("INSERT INTO bids(player_id,lot_id,amount) VALUES(?,?,5)").run(reg.id, lot.id);
  await db.prepare("INSERT INTO character_photos(player_id,version,status,created_at) VALUES(?,'delete-photo','removed',?)").run(reg.id, Date.now());
  await db.prepare("INSERT INTO character_photo_requests(id,player_id,created_at) VALUES('delete-photo-request',?,?)").run(reg.id, Date.now());
  await admin(deletion, {});
  await admin(deletion, {}, 404);
  await player("/me", undefined, 401);
  assert.equal(await db.prepare("SELECT id FROM players WHERE id=?").get(reg.id), undefined);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM players WHERE id=?").get(otherId)).n, 1);
  for (const table of ["characters", "character_relations", "missions", "ledger", "unlocks", "votes", "bids", "generation_requests", "faction_assignments", "faction_preferences", "character_photos", "character_photo_requests"])
    assert.equal((await db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE player_id=?`).get(reg.id)).n, 0, table);
  const clearedLot = await db.prepare("SELECT * FROM lots WHERE id=?").get(lot.id);
  assert.equal(clearedLot.bidder, null);
  assert.equal(clearedLot.bid, 0);
  assert.equal(clearedLot.status, "open");
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM faction_policy_supports").get()).n, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM paid_phones WHERE phone=?").get("13800138000")).n, 1);
  await player("/auth/sms/send", { phone: "13800138000" });
  const recreated = await player("/auth/sms/login", { phone: "13800138000", code: sent.at(-1).code });
  assert.notEqual(recreated.id, reg.id);
  assert.equal(recreated.registered, true);
  const reset = await player("/me");
  assert.ok(!reset.character);
  assert.equal(reset.player.payment, "paid");
  assert.equal(reset.player.checked_in, 0);
  assert.equal(reset.player.coins, 0);
  assert.ok((await admin("/staff")).audit.some(item => item.action.includes(`删除玩家及角色 ${reg.id}`)));
});
