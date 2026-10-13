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
      assert.equal(res.headers.get("Cache-Control"), "no-store");
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
    id: "E-20",
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
  await admin("/staff/manage/clues/E-20", { ...clue, title: "修改证物" });
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
  scene.hotspots = [{ ...scene.hotspots[0], clueId: "E-20" }];
  await admin("/staff/manage/scenes/wall-study", scene);
  await admin("/staff/phase", { phase: 3 });
  assert.equal((await player("/ar/scenes/wall-study")).title, "新版墙面");
  const acquired = await player(
    "/ar/scenes/wall-study/hotspots/document/collect",
    {},
  );
  assert.equal(acquired.id, "E-20");
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
});
