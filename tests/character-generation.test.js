import { resolveEvidenceModel } from "../server/evidence/models.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import pg from "pg";
import { randomBytes } from "node:crypto";
import { createApp } from "../server/app.js";
import { validateGeneratedStory } from "../server/story-generation.js";
import { npcs } from "../server/content.js";
import { avatarData, cosplay } from "./profile-fixture.js";

const profile = {
  ...cosplay,
  name: "莱恩",
  english: "Ryan",
  profession: "调查员",
  skill: "洞察",
  motive: "结识晚宴中的调查同好",
  story:
    "我以福尔摩斯的形象赴宴，喜欢细察人的行为，曾在一次公开展览上认识晚宴中的访客。",
};
const output = (name = "莱恩") => ({
  adaptation: `${name}以福尔摩斯的形象进入ECHO晚宴，保留敏锐的性格，以普通调查员的身份结识访客。`,
  relations: ["detective", "host"].map((npc_id) => ({
    npc_id,
    relation: "在公开展览中结识的旧友",
    player_brief: `你曾在展览上和${npc_id === "host" ? "阿德里安·索恩" : "诺拉·里德"}讨论公开艺术品。今晚可以重提那场讨论。`,
    npc_brief: `${name}是公开展览中的旧相识，请用一句共同话题接待他。NPC专属演绎提示。`,
    hooks: [
      { phase: 1, goal: "介绍角色，并交换一次公开见闻" },
      { phase: 4, goal: "聆听对方基于现场证据的判断" },
    ],
    mission: "介绍角色，并交换一次公开见闻",
  })),
});
const completion = (value) =>
  new Response(
    JSON.stringify({
      choices: [
        { finish_reason: "stop", message: { content: JSON.stringify(value) } },
      ],
    }),
    { status: 200 },
  );
const llmOptions = (fetch) => ({
  baseUrl: "https://llm.example/v1",
  apiKey: "private-api-key",
  model: "test-model",
  fetch,
});

async function setup(t, llm = { baseUrl: "", apiKey: "", model: "" }) {
  const sent = [];
  const options = {
    allowLegacyRegistration: true,
    smsSender: async (payload) => sent.push(payload),
    dbPath: ":memory:",
    gmPassword: "gm-generation-password",
    npcPassword: "npc-generation-password",
    llm,
  };
  let pool,
    schema,
    schemaCreated = false,
    db,
    server,
    cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    try {
      if (server?.listening) {
        server.closeAllConnections();
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
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
  };
  // Register before any creation, including denied CREATE SCHEMA permissions.
  t.after(cleanup);
  try {
    if (process.env.TEST_DATABASE_URL) {
      pool = new pg.Pool({
        connectionString: process.env.TEST_DATABASE_URL,
        max: 1,
      });
      schema = "alsj_character_" + randomBytes(10).toString("hex");
      await pool.query(`CREATE SCHEMA ${schema}`);
      schemaCreated = true;
      const url = new URL(process.env.TEST_DATABASE_URL);
      // No public fallback: this setup can only read/write its unique schema.
      url.searchParams.set("options", "-c search_path=" + schema);
      options.databaseUrl = url.toString();
    }
    const created = await createApp(options);
    db = created.db;
    server = created.app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "角色测试初始化与清理失败",
      );
    }
    throw error;
  }
  const base = `http://127.0.0.1:${server.address().port}/api`;
  function client() {
    let cookie = "";
    return async (route, body, expected = 200, binary = false) => {
      const res = await fetch(base + route, {
        method: body === undefined ? "GET" : "POST",
        headers: { "content-type": "application/json", cookie },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.headers.get("set-cookie"))
        cookie = res.headers.get("set-cookie").split(";")[0];
      assert.equal(
        res.status,
        expected,
        binary ? res.statusText : await res.clone().text(),
      );
      return binary
        ? { bytes: Buffer.from(await res.arrayBuffer()), headers: res.headers }
        : res.json();
    };
  }
  const gm = client(),
    p = client(),
    npc = client(),
    outsider = client();
  await gm("/login", { account: "gm", password: options.gmPassword });
  const { id } = await p("/register", {
    name: "玩家称呼",
    contact: "generation@example.com",
    password: "player-generation-password",
  });
  await db
    .prepare("INSERT INTO npc_phones(npc_id,phone) VALUES(?,?)")
    .run("detective", "13500000011");
  await db
    .prepare("INSERT INTO npc_phones(npc_id,phone) VALUES(?,?)")
    .run("security", "13500000012");
  await npc("/auth/sms/send", { phone: "13500000011" });
  await npc("/auth/sms/login", {
    phone: "13500000011",
    code: sent.at(-1).code,
  });
  await outsider("/auth/sms/send", { phone: "13500000012" });
  await outsider("/auth/sms/login", {
    phone: "13500000012",
    code: sent.at(-1).code,
  });
  return { options, client, gm, p, npc, outsider, id, db };
}

test("只填写Cos名、来源、故事并上传头像即可建立角色，高级字段缺省持久化且显式非法值仍拒绝", async (t) => {
  const { p, db, id } = await setup(t);
  const minimal = {
    cosplay_character: "长".repeat(100),
    cosplay_source: "原创万圣节角色",
    story: profile.story,
  };
  await p("/character", minimal, 400);
  await p("/avatar", { data: avatarData });
  const result = await p("/character", minimal);
  assert.equal(result.generation_status, "unconfigured");
  const c = (await p("/me")).character;
  assert.equal(c.name, minimal.cosplay_character.slice(0, 60));
  assert.equal(c.english, "Guest");
  assert.equal(c.profession, "受邀宾客");
  assert.equal(c.motive, "应邀参加万圣节舞会");
  assert.equal(c.skill, "洞察");
  assert.equal(c.cosplay_character, minimal.cosplay_character);
  assert.equal(c.story, minimal.story);
  assert.match(c.avatar_url, /^\/api\/avatars\//);
  const persisted = await db
    .prepare(
      "SELECT name,english,profession,motive,skill FROM characters WHERE player_id=?",
    )
    .get(id);
  assert.deepEqual(
    { ...persisted },
    {
      name: minimal.cosplay_character.slice(0, 60),
      english: "Guest",
      profession: "受邀宾客",
      motive: "应邀参加万圣节舞会",
      skill: "洞察",
    },
  );
  for (const invalid of [
    { name: "" },
    { english: null },
    { profession: 4 },
    { motive: "x".repeat(101) },
    { skill: "战斗" },
    { skill: null },
  ])
    await p("/character", { ...minimal, ...invalid }, 400);
  await p("/character", {
    ...minimal,
    name: "莱恩",
    english: "Ryan",
    profession: "研究员",
    motive: "认识技术同好",
    skill: "技术",
  });
  const custom = (await p("/me")).character;
  assert.equal(custom.name, "莱恩");
  assert.equal(custom.english, "Ryan");
  assert.equal(custom.profession, "研究员");
  assert.equal(custom.motive, "认识技术同好");
  assert.equal(custom.skill, "技术");
});

test("头像重编码与权限隔离，未配置模型时明确使用模板，待审核关联不向NPC泄漏", async (t) => {
  const { client, gm, p, npc, outsider, id, db } = await setup(t);
  await p("/character", profile, 400);
  await p(
    "/avatar",
    { data: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" },
    400,
  );
  await p("/avatar", { data: "data:image/png;base64,YmFk" }, 400);
  await p(
    "/avatar",
    {
      data:
        "data:image/png;base64," +
        Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64"),
    },
    400,
  );
  const oversizedPixels = await sharp({
    create: { width: 4100, height: 4100, channels: 3, background: "#fff" },
  })
    .png()
    .toBuffer();
  await p(
    "/avatar",
    { data: "data:image/png;base64," + oversizedPixels.toString("base64") },
    400,
  );
  const largeAvatar = await sharp({
    create: { width: 1000, height: 600, channels: 3, background: "#943" },
  })
    .png()
    .toBuffer();
  const { avatar_url } = await p("/avatar", {
    data: "data:image/png;base64," + largeAvatar.toString("base64"),
  });
  const image = await p(avatar_url.replace("/api", ""), undefined, 200, true);
  const metadata = await sharp(image.bytes).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 512);
  assert.equal(metadata.height, 307);
  assert.equal(image.headers.get("cache-control"), "private, no-store");
  const anonymous = client();
  await anonymous(`/avatars/${id}`, undefined, 401);
  const otherPlayer = client();
  await otherPlayer("/register", {
    name: "其他玩家",
    contact: "avatar-other@example.com",
    password: "other-player-password",
  });
  await otherPlayer(`/avatars/${id}`, undefined, 403);
  await npc(`/avatars/${id}`, undefined, 403);
  await gm(`/avatars/${id}`, undefined, 200, true);
  await p("/character", { ...profile, story: "太短的故事" }, 400);
  await p("/character", { ...profile, cosplay_source: "" }, 400);
  const saved = await p("/character", profile);
  assert.equal(saved.generator, "curated-template");
  assert.equal(saved.generation_status, "unconfigured");
  const me = await p("/me");
  assert.equal(me.character.story, profile.story);
  assert.ok(me.character.adaptation.includes("尚未调用大模型"));
  assert.equal(me.relations.length, 2);
  assert.equal(me.missions.length, 0);
  assert.ok(me.relations.every((r) => !("npc_brief" in r)));
  assert.equal(me.character.secret, null);
  assert.equal(me.character.faction, null);
  assert.ok(!("generation_lock" in me.character));
  assert.equal((await npc("/staff")).relations.length, 0);
  assert.equal((await npc("/staff")).players.length, 0);
  assert.equal((await npc("/staff")).missions.length, 0);
  const pendingMission = await db
    .prepare("SELECT id FROM missions WHERE player_id=?")
    .get(id);
  await npc(`/staff/missions/${pendingMission.id}/complete`, {}, 403);
  const review = await gm(`/staff/players/${id}`);
  assert.equal(review.relations.length, 2);
  assert.ok(review.relations.every((r) => r.npc_brief));
  await gm(`/staff/players/${id}`, {
    status: "approved",
    payment: "paid",
    checkin: true,
  });
  const staff = await npc("/staff");
  assert.equal(staff.players.length, 1);
  assert.equal(staff.relations.length, 1);
  assert.equal(staff.relations[0].npc_id, "detective");
  assert.equal(staff.relations[0].status, "approved");
  assert.equal(staff.relations[0].cosplay_character, profile.cosplay_character);
  assert.equal((await outsider("/staff")).players.length, 0);
  await npc(`/avatars/${id}`, undefined, 200, true);
  await outsider(`/avatars/${id}`, undefined, 403);
  await p("/avatar", { data: avatarData }, 400);
  await p("/character", profile, 400);
  await p("/character/generate", {}, 400);
  await gm(`/staff/players/${id}`, { status: "pending" });
  assert.equal((await npc("/staff")).relations.length, 0);
  await npc(`/avatars/${id}`, undefined, 403);
});

test("OpenAI兼容结构化生成仅接收公开世界与Cos资料，保存原故事并使用固定任务奖励", async (t) => {
  let sent;
  const { p, gm, id, db } = await setup(
    t,
    llmOptions(async (url, request) => {
      sent = { url, request, body: JSON.parse(request.body) };
      return completion(output());
    }),
  );
  await p("/avatar", { data: avatarData });
  const saved = await p("/character", profile);
  assert.equal(saved.generator, "llm");
  assert.equal(saved.generation_status, "ready");
  assert.equal(sent.url, "https://llm.example/v1/chat/completions");
  assert.equal(sent.request.headers.authorization, "Bearer private-api-key");
  assert.equal(sent.body.response_format.type, "json_schema");
  const prompt = JSON.stringify(sent.body);
  for (const forbidden of [
    "private-api-key",
    "generation@example.com",
    "avatar_url",
    "真正凶手",
    "维拉控制的私人账户",
    "在第三幕死亡",
    "conspirator",
  ])
    assert.ok(!prompt.includes(forbidden), forbidden);
  assert.ok(prompt.includes(profile.cosplay_character));
  const me = await p("/me");
  assert.equal(me.character.story, profile.story);
  assert.equal(me.character.generation_status, "ready");
  assert.equal(me.character.generation_pending, 0);
  assert.equal(me.relations.length, 2);
  assert.ok(!JSON.stringify(me).includes("NPC专属演绎提示"));
  assert.ok(
    (
      await db.prepare("SELECT reward FROM missions WHERE player_id=?").all(id)
    ).every((m) => m.reward === 2),
  );
  assert.equal((await p("/public")).generation.configured, true);
  assert.ok(
    JSON.stringify(await gm(`/staff/players/${id}`)).includes(
      "NPC专属演绎提示",
    ),
  );
});

test("配置后的模型失败保留输入并公开安全错误，重试可恢复且不伪装成模板", async (t) => {
  let count = 0;
  const { p, gm, id, db } = await setup(
    t,
    llmOptions(async () =>
      ++count === 1
        ? new Response("private-api-key provider-secret", { status: 401 })
        : completion(output()),
    ),
  );
  await p("/avatar", { data: avatarData });
  const result = await p("/character", profile);
  assert.equal(result.generation_status, "error");
  const me = await p("/me");
  assert.equal(me.character.story, profile.story);
  assert.equal(me.character.generator, "llm");
  assert.match(me.character.generation_error, /HTTP 401/);
  assert.ok(!JSON.stringify(me).includes("private-api-key"));
  assert.equal(me.relations.length, 0);
  assert.equal(
    (
      await db
        .prepare("SELECT COUNT(*) n FROM missions WHERE player_id=?")
        .get(id)
    ).n,
    0,
  );
  assert.match(
    (await gm(`/staff/players/${id}`)).character.generation_error,
    /HTTP 401/,
  );
  await gm(`/staff/players/${id}`, { status: "approved" }, 400);
  assert.equal((await p("/character/generate", {})).generation_status, "ready");
  assert.equal((await p("/me")).character.generation_error, null);
});

test("输出校验拒绝未知与重复NPC、额外奖励、非法剧情、超长字段和无效幕次", () => {
  const publicNpcs = npcs.map(([id]) => ({ id }));
  assert.equal(
    validateGeneratedStory(output(), publicNpcs).relations.length,
    2,
  );
  const cases = [
    (v) => {
      v.relations[0].npc_id = "unknown";
    },
    (v) => {
      v.relations[1].npc_id = v.relations[0].npc_id;
    },
    (v) => {
      v.relations[0].reward = 100;
    },
    (v) => {
      v.relations[0].relation = "x".repeat(81);
    },
    (v) => {
      v.relations[0].hooks[0].phase = 5;
    },
    (v) => {
      v.relations[0].hooks[1].phase = 1;
    },
    (v) => {
      v.relations[0].hooks = [];
    },
    (v) => {
      v.adaptation = "真正凶手是维拉";
    },
    (v) => {
      v.relations = [v.relations[0]];
    },
    (v) => {
      delete v.relations[0].mission;
    },
  ];
  for (const mutate of cases) {
    const value = output();
    mutate(value);
    assert.throws(() => validateGeneratedStory(value, publicNpcs), /校验/);
  }
});

test("兼容JSON对象模式与截断、拒绝、连接中断和超时均提供可恢复错误", async (t) => {
  const failures = [
    () =>
      completion({
        ...output(),
        relations: [
          { ...output().relations[0], npc_id: "unknown" },
          output().relations[1],
        ],
      }),
    () =>
      new Response(
        JSON.stringify({
          choices: [{ finish_reason: "length", message: { content: "{}" } }],
        }),
      ),
    () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: { refusal: "不能生成", content: null },
            },
          ],
        }),
      ),
    () => {
      throw new Error("模型网络异常 private-api-key sensitive-endpoint");
    },
    (url, { signal }) =>
      new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      }),
  ];
  for (const [index, failure] of failures.entries()) {
    await t.test(`失败类型${index + 1}`, async (sub) => {
      const { p } = await setup(sub, { ...llmOptions(failure), timeoutMs: 20 });
      await p("/avatar", { data: avatarData });
      assert.equal((await p("/character", profile)).generation_status, "error");
      const c = (await p("/me")).character;
      assert.equal(c.generation_pending, 0);
      assert.ok(c.generation_error.startsWith("模型"));
      assert.ok(!c.generation_error.includes("private-api-key"));
      assert.equal(c.story, profile.story);
    });
  }
  await t.test("JSON对象格式", async (sub) => {
    let format;
    const { p } = await setup(sub, {
      ...llmOptions(async (url, req) => {
        format = JSON.parse(req.body).response_format;
        return completion(output());
      }),
      responseFormat: "json_object",
    });
    await p("/avatar", { data: avatarData });
    assert.equal((await p("/character", profile)).generation_status, "ready");
    assert.deepEqual(format, { type: "json_object" });
  });
});

test("生成中进程中断后可恢复重试，旧锁和启动时间不会泄漏给玩家", async (t) => {
  const { p, gm, id, db } = await setup(t);
  await p("/avatar", { data: avatarData });
  await p("/character", profile);
  await db
    .prepare(
      "UPDATE characters SET generation_pending=1,generation_lock=?,generation_started_at=? WHERE player_id=?",
    )
    .run("old-process-lock", Date.now() - 46000, id);
  const c = (await p("/me")).character;
  assert.equal(c.generation_pending, 0);
  assert.equal(c.generation_status, "error");
  assert.match(c.generation_error, /中断/);
  assert.ok(!("generation_lock" in c));
  assert.ok(!("generation_started_at" in c));
  await gm(`/staff/players/${id}`, { status: "approved" }, 400);
  assert.equal(
    (await p("/character/generate", {})).generation_status,
    "unconfigured",
  );
  await gm(`/staff/players/${id}`, { status: "approved" });
});

test("AR与VR模型只给已批准签到且取得对应证物的玩家，NPC和匿名请求无法读取", async (t) => {
  const { client, p, gm, npc, id } = await setup(t);
  const anonymous = client();
  await anonymous("/models/sealed-letter.glb", undefined, 401);
  await npc("/models/sealed-letter.glb", undefined, 401);
  await p("/models/sealed-letter.glb", undefined, 403);
  await p("/avatar", { data: avatarData });
  await p("/character", profile);
  await gm(`/staff/players/${id}`, {
    status: "approved",
    payment: "paid",
    checkin: true,
  });
  const clues = await p("/clues");
  assert.ok(clues.clues.every((c) => !("model_url" in c)));
  await p("/models/sealed-letter.glb", undefined, 403);
  await p("/models/unknown.glb", undefined, 404);
  await p("/models/%2e%2e%2fserver%2fcontent.js", undefined, 404);
  await p("/clues/E-01", undefined, 403);
  await p("/clues/E-01/unlock", {}, 403);
  await gm("/staff/phase", { phase: 3 });
  const clue = await p("/clues/E-01/unlock", {});
  assert.equal(
    clue.model_url,
    `/api/models/${resolveEvidenceModel("E-01").filename}.glb`,
  );
  assert.equal(clue.model_label, resolveEvidenceModel("E-01").label);
  const model = await p(
    clue.model_url.replace("/api", ""),
    undefined,
    200,
    true,
  );
  assert.equal(model.bytes.subarray(0, 4).toString(), "glTF");
  assert.equal(model.headers.get("content-type"), "model/gltf-binary");
  assert.equal(model.headers.get("cache-control"), "private, no-store");
  await p("/models/echo-terminal.glb", undefined, 403);
  await gm("/staff/phase", { phase: 1 });
  assert.equal((await p("/clues/E-01")).model_url, clue.model_url);
  await p(clue.model_url.replace("/api", ""), undefined, 200, true);
  await gm("/models/echo-terminal.glb", undefined, 200, true);
  await gm(`/staff/players/${id}`, { payment: "refunded" });
  await p(clue.model_url.replace("/api", ""), undefined, 403);
});

test("并发生成禁止重复调用，重新提交草稿后旧模型结果不能覆盖新角色", async (t) => {
  const requests = [];
  const { p, gm, id, db } = await setup(
    t,
    llmOptions(
      (url, request) =>
        new Promise((resolve) => {
          requests.push({ request, resolve });
        }),
    ),
  );
  await p("/avatar", { data: avatarData });
  const first = p("/character", profile);
  while (requests.length < 1) await new Promise((r) => setTimeout(r, 5));
  const initial = await p("/me");
  assert.equal(initial.character.generation_pending, 1);
  await p("/character/generate", {}, 409);
  await gm(`/staff/players/${id}`, { status: "approved" }, 400);
  const second = p("/character", {
    ...profile,
    name: "新角色",
    story: profile.story + "后来我决定改用新的角色名参与晚宴。",
  });
  while (requests.length < 2) await new Promise((r) => setTimeout(r, 5));
  requests[0].resolve(completion(output("旧角色")));
  assert.equal((await first).stale, true);
  assert.equal((await p("/me")).character.name, "新角色");
  assert.equal((await p("/me")).character.generation_pending, 1);
  requests[1].resolve(completion(output("新角色")));
  assert.equal((await second).generation_status, "ready");
  const final = await p("/me");
  assert.equal(final.character.revision, 2);
  assert.ok(final.character.adaptation.startsWith("新角色"));
  assert.equal(
    (
      await db
        .prepare("SELECT COUNT(*) n FROM missions WHERE player_id=?")
        .get(id)
    ).n,
    2,
  );
  const third = p("/character/generate", {});
  while (requests.length < 3) await new Promise((r) => setTimeout(r, 5));
  requests[2].resolve(completion(output("新角色")));
  await third;
  await p("/character/generate", {}, 429);
});
