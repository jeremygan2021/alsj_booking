import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { randomBytes } from "node:crypto";
import { createApp } from "../server/app.js";
import { avatarData } from "./profile-fixture.js";

const output = {
  character: {
    name: "林晚",
    english: "Lynn",
    profession: "档案修复师",
    skill: "洞察",
    motive: "与旧识重聚并讨论公开展览",
    cosplay_character: "雪夜档案师",
    cosplay_source: "原创",
    story:
      "我在阿拉斯加的索恩庄园晚宴前，与阿德里安·索恩讨论过ECHO公开展览，并与诺拉·里德交流了如何保存旧报纸。今晚，我带着新的修复笔记来赴约。",
  },
  avatar_prompt: "Portrait of an adult archivist in a golden mansion.",
  adaptation: "林晚受邀来到ECHO主题晚宴，与两位旧识分享公开展览的见闻。",
  relations: ["host", "detective"].map((npc_id) => ({
    npc_id,
    relation: "公开展览旧识",
    player_brief: "你曾与对方讨论公开艺术展览。",
    npc_brief: "保密的NPC演绎建议。",
    hooks: [{ phase: 1, goal: "交换一次公开见闻" }],
    mission: "向旧识介绍近期的档案修复工作",
  })),
};
const json = (data) =>
  new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
  });
async function setup(t) {
  let gate = null,
    failImage = false,
    calls = 0;
  let pool,
    schema,
    schemaCreated = false,
    db,
    server,
    databaseUrl;
  t.after(async () => {
    try {
      if (server?.listening) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
    } finally {
      try {
        await db?.close();
      } finally {
        if (pool) {
          try {
            if (schemaCreated)
              await pool.query(`DROP SCHEMA ${schema} CASCADE`);
          } finally {
            await pool.end();
          }
        }
      }
    }
  });
  if (process.env.TEST_DATABASE_URL) {
    pool = new pg.Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      max: 1,
    });
    schema = "alsj_inspiration_" + randomBytes(10).toString("hex");
    await pool.query(`CREATE SCHEMA ${schema}`);
    schemaCreated = true;
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set("options", "-c search_path=" + schema);
    databaseUrl = url.toString();
  }
  const created = await createApp({
    databaseUrl,
    dbPath: ":memory:",
    gmPassword: "inspiration-gm",
    npcPassword: "inspiration-npc",
    llm: { baseUrl: "", apiKey: "", model: "" },
    minimax: {
      apiKey: "server-secret",
      fetch: async (url) => {
        calls++;
        if (url.endsWith("/chat/completions")) {
          if (gate) await gate;
          return json({
            choices: [
              {
                finish_reason: "stop",
                message: { content: JSON.stringify(output) },
              },
            ],
          });
        }
        if (failImage)
          return json({
            base_resp: {
              status_code: 1008,
              status_msg: "do not expose server-secret",
            },
          });
        return json({ data: { image_base64: [avatarData.split(",")[1]] } });
      },
    },
  });
  const app = created.app;
  db = created.db;
  await db
    .prepare("INSERT INTO players(id,name,contact,password) VALUES(?,?,?,?)")
    .run("draft-player", "玩家", "draft-test", "unused");
  for (const [token, role, id] of [
    ["draft-session", "player", "draft-player"],
    ["gm-session", "gm", "gm"],
    ["npc-session", "npc", "host"],
  ])
    await db
      .prepare("INSERT INTO sessions VALUES(?,?,?,?)")
      .run(token, role, id, Date.now() + 600000);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const request = (url, { body, cookie = "draft-session", method, headers = {} } = {}) =>
    fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method: method || (body === undefined ? "GET" : "POST"),
      headers: {
        "content-type": "application/json",
        cookie: cookie ? `alaska_session=${cookie}` : "",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return {
    db,
    request,
    block: () => {
      let release;
      gate = new Promise((resolve) => {
        release = resolve;
      });
      return release;
    },
    failImage: () => {
      failImage = true;
    },
    calls: () => calls,
  };
}

test("MiniMax角色草稿权限、隐私、WebP保存和手工提交", async (t) => {
  const { request, db, calls } = await setup(t);
  assert.equal(
    (await request("/api/character/inspire", { body: {}, cookie: "" })).status,
    401,
  );
  assert.equal(
    (
      await request("/api/character/inspire", {
        body: {},
        cookie: "npc-session",
      })
    ).status,
    401,
  );
  const response = await request("/api/character/inspire", { body: {} });
  assert.equal(response.status, 200, await response.clone().text());
  const draft = await response.json();
  assert.equal(draft.name, "林晚");
  assert.match(draft.story, /诺拉·里德/);
  assert.match(draft.avatar_url, /^\/api\/avatars\/draft-player\?v=/);
  assert.equal(calls(), 2);
  assert.ok(!JSON.stringify(draft).includes("npc_brief"));
  assert.ok(!JSON.stringify(draft).includes("avatar_prompt"));
  assert.ok(!JSON.stringify(draft).includes("server-secret"));
  assert.equal(
    await db
      .prepare("SELECT * FROM characters WHERE player_id=?")
      .get("draft-player"),
    undefined,
  );
  const avatar = await request(draft.avatar_url);
  assert.equal(avatar.headers.get("content-type"), "image/webp");
  assert.equal(
    (await request(draft.avatar_url, { cookie: "npc-session" })).status,
    403,
  );
  const saved = await request("/api/character", { body: draft });
  assert.equal(saved.status, 200, await saved.clone().text());
  assert.equal((await saved.json()).generation_status, "ready");
  assert.equal(calls(), 2, "保存原始生成草稿应复用NPC关联，不重复调用付费模型");
  const preserved = await db
    .prepare(
      "SELECT npc_brief FROM character_relations WHERE player_id=? AND npc_id=?",
    )
    .get("draft-player", "host");
  assert.match(preserved.npc_brief, /交流已完成/);
  assert.ok(preserved.npc_brief.length <= 120);
  assert.equal(
    (
      await db
        .prepare("SELECT status FROM characters WHERE player_id=?")
        .get("draft-player")
    ).status,
    "approved",
  );
  const staff = await request("/api/staff", { cookie: "gm-session" });
  assert.equal(staff.status, 200);
  const visiblePlayer = (await staff.json()).players.find(
    (player) => player.id === "draft-player",
  );
  assert.equal(visiblePlayer.character, draft.name);
  assert.equal(visiblePlayer.avatar_url, draft.avatar_url);
  const detail = await request("/api/staff/players/draft-player", {
    cookie: "gm-session",
  });
  assert.equal(detail.status, 200);
  const savedProfile = await detail.json();
  assert.equal(savedProfile.player.id, "draft-player");
  for (const field of Object.keys(output.character))
    assert.equal(savedProfile.character[field], draft[field], field);
  assert.equal(savedProfile.character.avatar_url, draft.avatar_url);
  assert.equal(savedProfile.character.status, "approved");
  assert.ok(savedProfile.relations.length >= 2);
  for (const relation of savedProfile.relations) {
    assert.equal(typeof relation.npc_brief, "string");
    assert.ok(relation.hooks.length > 0);
    assert.ok(relation.mission);
  }
  assert.equal(
    (await request(draft.avatar_url, { cookie: "gm-session" })).status,
    200,
  );
  assert.equal(
    (
      await request("/api/staff/players/draft-player", {
        cookie: "npc-session",
      })
    ).status,
    401,
  );
  await db
    .prepare("UPDATE characters SET status='approved' WHERE player_id=?")
    .run("draft-player");
  assert.equal(
    (await request("/api/character/inspire", { body: {} })).status,
    400,
  );
  assert.equal(calls(), 2);
});

test("生成并发、迟到结果与失败不覆盖原有头像，次数受限", async (t) => {
  const { request, db, block, failImage, calls } = await setup(t);
  const release = block();
  const pending = request("/api/character/inspire", { body: {} });
  while (!calls()) await new Promise((resolve) => setTimeout(resolve, 2));
  assert.equal(
    (await request("/api/character/inspire", { body: {} })).status,
    409,
  );
  const uploaded = await request("/api/avatar", { body: { data: avatarData } });
  assert.equal(uploaded.status, 200);
  const previous = await db
    .prepare("SELECT * FROM avatars WHERE player_id=?")
    .get("draft-player");
  release();
  assert.equal((await pending).status, 409);
  assert.deepEqual(
    await db
      .prepare("SELECT * FROM avatars WHERE player_id=?")
      .get("draft-player"),
    previous,
  );
  failImage();
  for (let i = 0; i < 2; i++) {
    const failure = await request("/api/character/inspire", { body: {} });
    assert.equal(failure.status, 200);
    const partial = await failure.json();
    assert.equal(partial.name, output.character.name);
    assert.ok(partial.avatar_error);
    assert.ok(!JSON.stringify(partial).includes("server-secret"));
  }
  assert.equal(
    (await request("/api/character/inspire", { body: {} })).status,
    429,
  );
  assert.deepEqual(
    await db
      .prepare("SELECT * FROM avatars WHERE player_id=?")
      .get("draft-player"),
    previous,
  );
});

test("真实GM路由隔离现场演绎清单与终局MP3，允许Range和HEAD", async (t) => {
  const { request } = await setup(t);
  for (const url of [
    "/api/staff/performance-audio",
    "/api/staff/performance-audio/A10/file",
  ]) {
    assert.equal((await request(url, { cookie: "" })).status, 401);
    assert.equal((await request(url)).status, 401);
    assert.equal((await request(url, { cookie: "npc-session" })).status, 401);
  }
  const response = await request("/api/staff/performance-audio", {
    cookie: "gm-session",
  });
  assert.equal(response.status, 200);
  const catalog = await response.json();
  assert.equal(catalog.tracks.length, 16);
  assert.equal(catalog.voices.length, 9);
  assert.equal(
    catalog.tracks.find((track) => track.id === "A10").spoiler,
    true,
  );
  assert.ok(!JSON.stringify(catalog).includes("filename"));
  const head = await request("/api/staff/performance-audio/A02/file", {
    cookie: "gm-session",
    method: "HEAD",
  });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-type"), "audio/mpeg");
  assert.equal(head.headers.get("cache-control"), "private, no-store");
});


test("流式接口立即返回阶段，完成后才写入头像；错误事件可恢复", async (t) => {
  const { request, db, block, failImage } = await setup(t);
  const release = block();
  const response = await request("/api/character/inspire", { body: {}, headers: { accept: "text/event-stream" } });
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  assert.equal(response.headers.get("x-accel-buffering"), "no");
  const reader = response.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /"type":"stage"/);
  assert.equal(await db.prepare("SELECT * FROM avatars WHERE player_id=?").get("draft-player"), undefined);
  release();
  let rest = "";
  for (;;) { const { value, done } = await reader.read(); if (done) break; rest += new TextDecoder().decode(value); }
  assert.match(rest, /"type":"text"/);
  assert.match(rest, /"type":"avatar"/);
  assert.match(rest, /"type":"complete"/);
  assert.ok(!rest.includes("npc_brief"));
  assert.ok(!rest.includes("server-secret"));
  failImage();
  const failure = await request("/api/character/inspire", { body: {}, headers: { accept: "text/event-stream" } });
  const failed = await failure.text();
  assert.match(failed, /"type":"avatar_error"/);
  assert.ok(!failed.includes("server-secret"));
  assert.ok(failed.includes('"type":"complete"'));
  const restored = await (await request("/api/character/inspiration")).json();
  assert.equal(restored.character.name, output.character.name);
  assert.ok(restored.avatar_error);
  assert.ok(!JSON.stringify(restored).includes("npc_brief"));
  assert.ok(!JSON.stringify(restored).includes("avatar_prompt"));
});
