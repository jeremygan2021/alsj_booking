import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";
import {
  generateRoleCardSummary,
  validateRoleCardSummary,
} from "../server/role-card-summary.js";

const card = {
  character: {
    name: "艾琳",
    profession: "档案调查员",
    skill: "洞察",
    story: "我曾整理旧友留下的记忆，今晚受邀赴宴，希望听到不同的声音。",
    motive: "与宾客交流",
    secret: "不发送的GM秘密",
  },
  relations: [
    {
      npc_name: "阿德里安·索恩",
      relation: "受邀宾客",
      player_brief: "你受邀参加晚宴",
      mission: "介绍自己",
      npc_brief: "不发送的NPC秘密",
    },
  ],
};
const summary = {
  tagline: "在记忆的缝隙里寻找回声",
  story:
    "你曾整理旧友留下的记忆。今夜，你带着未解的疑问走进索恩庄园，希望在宾客的故事中听见不同的答案。",
  goals: ["向晚宴主人介绍自己的来意", "听取一位宾客的公开观点"],
  contacts: [{ name: "阿德里安·索恩", note: "晚宴主人，先向他问好" }],
};
const response = (value) =>
  new Response(
    JSON.stringify({
      choices: [
        { finish_reason: "stop", message: { content: JSON.stringify(value) } },
      ],
    }),
  );
const config = (fetch) => ({
  baseUrl: "https://summary.example/v1",
  apiKey: "private-key",
  model: "summary-model",
  responseFormat: "json_schema",
  timeoutMs: 1000,
  fetch,
});

test("真实AI请求使用安全资料、严格字数与已知NPC，未配置时明确标记模板", async () => {
  let calls = 0;
  const output = await generateRoleCardSummary(
    card,
    config(async (url, request) => {
      calls++;
      assert.equal(url, "https://summary.example/v1/chat/completions");
      const body = JSON.parse(request.body);
      assert.equal(body.response_format.json_schema.strict, true);
      assert.ok(!request.body.includes("不发送的"));
      return response(summary);
    }),
  );
  assert.equal(calls, 1);
  assert.equal(output.generator, "ai");
  assert.deepEqual(output.body, summary);
  const fallback = await generateRoleCardSummary(card, {
    baseUrl: "",
    apiKey: "",
    model: "",
  });
  assert.equal(fallback.generator, "concise-template");
  assert.ok(Array.from(fallback.body.story).length <= 72);
  for (const invalid of [
    { ...summary, story: "字".repeat(73) },
    { ...summary, tagline: "字".repeat(21) },
    { ...summary, goals: ["字".repeat(27)] },
    { ...summary, contacts: [{ name: "虚构NPC", note: "问好" }] },
    { ...summary, story: "真正凶手是维拉。" },
  ])
    assert.throws(() => validateRoleCardSummary(invalid, card), /短文要求/);
  await assert.rejects(
    generateRoleCardSummary(
      card,
      config(async () => {
        throw new Error("Bearer private-key https://private.example");
      }),
    ),
    (error) => !/private-key|private\.example/.test(error.message),
  );
  await assert.rejects(
    generateRoleCardSummary(
      card,
      config(async () => new Response("private-key", { status: 500 })),
    ),
    /暂不可用/,
  );
});

test("摘要仅点击生成时请求模型，缓存命中不收费，资料变化失效且迟到结果不覆盖", async (t) => {
  let calls = 0,
    provider = () => response(summary);
  const { app, db } = await createApp({
    dbPath: ":memory:",
    databaseUrl: process.env.TEST_DATABASE_URL,
    gmPassword: "summary-gm",
    npcPassword: "summary-npc",
    allowLegacyRegistration: true,
    llm: config(async () => {
      calls++;
      return provider();
    }),
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie = "";
  const request = async (path, body, status = 200) => {
    const res = await fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    });
    if (res.headers.get("set-cookie"))
      cookie = res.headers.get("set-cookie").split(";")[0];
    const value = await res.json();
    assert.equal(res.status, status, JSON.stringify(value));
    return value;
  };
  const { id } = await request("/register", {
    name: "摘要测试宾客",
    contact: "summary@example.com",
    password: "test-password",
  });
  await db.prepare("UPDATE players SET payment='paid' WHERE id=?").run(id);
  await db
    .prepare(
      "INSERT INTO characters(player_id,name,profession,skill,story,status,motive) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      id,
      "艾琳",
      "档案调查员",
      "洞察",
      card.character.story,
      "approved",
      "与宾客交流",
    );
  await db
    .prepare(
      "INSERT INTO character_relations(player_id,npc_id,relation,player_brief,npc_brief,hooks,mission) VALUES(?,?,?,?,?,?,?)",
    )
    .run(id, "host", "受邀宾客", "受邀参加晚宴", "GM秘密", "[]", "介绍自己");
  assert.equal((await request("/role-cards", {})).cards[0].summary, null);
  assert.equal(calls, 0);
  assert.equal(
    (await request(`/role-cards/${id}/generate`, {})).summary.generator,
    "ai",
  );
  assert.equal(calls, 1);
  assert.equal(
    (await request(`/role-cards/${id}/generate`, {})).summary.body.story,
    summary.story,
  );
  assert.equal(calls, 1);
  await request(`/role-cards/${id}/generate`, { force: true }, 429);
  await db
    .prepare("UPDATE characters SET story=? WHERE player_id=?")
    .run("角色背景在生成后经过了修改，需要重新精炼。", id);
  assert.equal((await request("/role-cards", {})).cards[0].summary, null);
  provider = async () => {
    await db
      .prepare(
        "UPDATE characters SET story='生成途中又更新了背景' WHERE player_id=?",
      )
      .run(id);
    return response(summary);
  };
  await request(`/role-cards/${id}/generate`, {}, 409);
  assert.equal((await request("/role-cards", {})).cards[0].summary, null);
  assert.equal(
    JSON.parse(
      (
        await db
          .prepare("SELECT body FROM role_card_summaries WHERE player_id=?")
          .get(id)
      ).body,
    ).story,
    summary.story,
  );
  provider = () => response(summary);
  await request(`/role-cards/${id}/generate`, {});
  await db.prepare("UPDATE players SET payment='refunded' WHERE id=?").run(id);
  await request(`/role-cards/${id}/generate`, {}, 403);
});
