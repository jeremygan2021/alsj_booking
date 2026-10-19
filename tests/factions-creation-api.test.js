import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";
import { avatarData } from "./profile-fixture.js";

const generated = () => ({
  character: {
    name: "林晚", english: "Lynn", profession: "摄影师", skill: "社交",
    motive: "与宾客交流对艺术的公开看法", cosplay_character: "雪夜来客", cosplay_source: "原创",
    story: "我以原创摄影师的身份来到阿拉斯加索恩庄园，曾在一次公开展览中向阿德里安·索恩介绍作品，也与诺拉·里德讨论过拍摄授权。这次ECHO晚宴，我希望礼貌听取宾客对艺术的不同看法。",
  },
  avatar_prompt: "An adult photographer in evening attire, portrait, no text.",
  adaptation: "你保留摄影师的公开身份与安静好奇的性格，通过礼貌交流认识索恩庄园的宾客。",
  relations: ["host", "detective"].map((npc_id) => ({
    npc_id, relation: "公开展览中的旧识", player_brief: "你曾和对方交流公开艺术话题。",
    npc_brief: "欢迎这位宾客交流艺术看法。", hooks: [{ phase: 1, goal: "交换一个公开观点" }],
    mission: "与对方完成一次自我介绍",
  })),
});

async function setup(t, count = 6) {
  const modelRequests = [];
  let failText = false;
  const { app, db } = await createApp({
    dbPath: ":memory:", gmPassword: "creation-gm", npcPassword: "creation-npc",
    llm: { baseUrl: "", apiKey: "", model: "" },
    // Do not set assignFactionsAtCreation: verify the application's default.
    minimax: {
      baseUrl: "https://minimax.fixture/v1", apiKey: "fixture-minimax-key",
      fetch: async (url, request) => {
        if (url.endsWith("/image_generation")) return Response.json({ data: { image_base64: [avatarData.split(",")[1]] } });
        modelRequests.push(JSON.parse(request.body));
        if (failText) return new Response("fixture upstream failure", { status: 502 });
        return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(generated()) } }] });
      },
    },
  });
  await db.transaction(async () => {
    for (let index = 0; index < count; index++) {
      await db.prepare("INSERT INTO players(id,name,contact,password,payment) VALUES(?,?,?,?,?)").run(`creation-${index}`, `宾客${index}`, `137${String(index).padStart(8, "0")}`, "unused", "pending");
      await db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(`creation-session-${index}`, "player", `creation-${index}`, Date.now() + 600000);
    }
    await db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run("creation-gm", "gm", "gm", Date.now() + 600000);
    await db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run("creation-npc", "npc", "detective", Date.now() + 600000);
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await db.close(); });
  const request = (path, body, session = "creation-session-0") => fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", Cookie: session ? `alaska_session=${session}` : "" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = async (path, body, session, status = 200) => {
    const response = await request(path, body, session);
    assert.equal(response.status, status, await response.clone().text());
    return response.json();
  };
  return { db, request, json, modelRequests, failNextText: () => { failText = true; } };
}

test("默认在创建流程确定正式阵营，反复生成和模型失败不会重抽或接受客户端指定", async (t) => {
  const { db, request, json, modelRequests, failNextText } = await setup(t);
  const initial = await json("/me");
  assert.equal(initial.faction.assigned, null);
  const assigned = await json("/factions/preference", { preference: "fbi", faction: "conspirator", playerId: "creation-1" });
  assert.equal(assigned.assigned, "fbi");
  assert.equal(assigned.assignmentStage, "creation");
  assert.equal(assigned.preferenceLocked, true);
  const snapshot = await db.prepare("SELECT * FROM faction_assignments WHERE player_id=?").get("creation-0");
  for (let attempt = 0; attempt < 2; attempt++) {
    const draft = await json("/character/inspire", { idea: "安静的摄影师", faction: "conspirator", player_id: "creation-1" });
    assert.equal(draft.name, generated().character.name);
    assert.deepEqual(await db.prepare("SELECT * FROM faction_assignments WHERE player_id=?").get("creation-0"), snapshot);
  }
  failNextText();
  await json("/character/inspire", {}, undefined, 502);
  assert.deepEqual(await db.prepare("SELECT * FROM faction_assignments WHERE player_id=?").get("creation-0"), snapshot);
  assert.equal((await request("/factions/preference", { preference: "conspirator" })).status, 409);
  const me = await json("/me?player_id=creation-1");
  assert.equal(me.player.id, "creation-0");
  assert.equal(me.faction.assigned, "fbi");
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM faction_assignments WHERE player_id=?").get("creation-1")).n, 0);
  assert.equal(modelRequests.length, 3);
  for (const prompt of modelRequests.map((request) => JSON.stringify(request.messages))) {
    assert.ok(prompt.includes("你关注清楚表达"));
    assert.ok(!prompt.includes("你保持低调"));
    assert.ok(!/contact_code|killerContact/.test(prompt));
  }
});

test("创建期只显示本人的正式阵营，私密接头信息须付费审核且不会泄漏给其他玩家或NPC", async (t) => {
  const { db, request, json, modelRequests } = await setup(t);
  for (const index of [0, 1]) {
    const session = `creation-session-${index}`;
    const faction = await json("/factions/preference", { preference: "conspirator" }, session);
    assert.equal(faction.assigned, "conspirator");
    assert.equal(faction.code, null);
    assert.ok(!/真正的凶手|专属的接头暗号/.test(faction.briefing));
    const draft = await json("/character/inspire", {}, session);
    await json("/character", draft, session);
  }
  const secrets = await db.prepare("SELECT player_id,contact_code FROM faction_assignments ORDER BY player_id").all();
  assert.equal(secrets.length, 2);
  assert.equal(new Set(secrets.map((row) => row.contact_code)).size, 2);
  for (const index of [0, 1]) {
    const session = `creation-session-${index}`;
    let me = await json("/me", undefined, session);
    assert.equal(me.character.faction, "conspirator");
    assert.equal(me.faction.code, null);
    assert.ok(!secrets.some((row) => JSON.stringify(me).includes(row.contact_code)));
    await json(`/staff/players/creation-${index}`, { status: "approved", payment: "paid" }, "creation-gm");
    me = await json("/me", undefined, session);
    const own = secrets.find((row) => row.player_id === `creation-${index}`);
    const other = secrets.find((row) => row.player_id !== own.player_id);
    assert.equal(me.faction.code, own.contact_code);
    assert.match(me.faction.briefing, /真正的凶手.*接头暗号/);
    assert.ok(!JSON.stringify(me).includes(other.contact_code));
    assert.equal((await request(`/staff/players/${other.player_id}`, undefined, session)).status, 401);
  }
  for (const [path, session] of [["/public", ""], ["/staff", "creation-npc"]]) {
    const response = await request(path, undefined, session);
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.ok(!secrets.some((row) => body.includes(row.contact_code)));
  }
  for (const modelRequest of modelRequests)
    assert.ok(!secrets.some((row) => JSON.stringify(modelRequest).includes(row.contact_code)));
  const admin = await json("/staff/factions", undefined, "creation-gm");
  assert.equal(admin.mode, "creation");
  assert.equal(admin.counts.conspirator, 2);
  assert.equal((await request("/staff/factions/draw", {}, "creation-gm")).status, 409);
  assert.equal((await request("/staff/factions", undefined, "creation-session-0")).status, 401);
});

test("创建分配并发执行仍遵守本轮杀手席位上限，其他两方平衡且NPC不参与", async (t) => {
  const { db, json, request } = await setup(t, 6);
  const results = await Promise.all(Array.from({ length: 6 }, (_, index) =>
    json("/factions/preference", { preference: "conspirator" }, `creation-session-${index}`),
  ));
  const admin = await json("/staff/factions", undefined, "creation-gm");
  assert.equal(admin.quota, 4); // The fixed 50-seat event has four volunteer seats.
  assert.equal(results.filter((result) => result.assigned === "conspirator").length, admin.quota);
  assert.equal(admin.counts.fbi, 1);
  assert.equal(admin.counts.croft, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM faction_assignments").get()).n, 6);
  assert.equal(new Set(admin.players.filter((player) => player.code).map((player) => player.code)).size, 4);
  await db.prepare("DELETE FROM faction_assignments WHERE player_id=?").run("creation-5");
  await db.prepare("INSERT INTO npc_phones(npc_id,phone) VALUES(?,?)").run("detective", "13700000005");
  assert.equal((await request("/character/inspire", {}, "creation-session-5")).status, 403);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM faction_assignments WHERE player_id=?").get("creation-5")).n, 0);
});
