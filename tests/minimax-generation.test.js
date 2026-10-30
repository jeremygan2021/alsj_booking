import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  generateCharacterDraft,
  generateCharacterAvatar,
  minimaxConfig,
  validateGeneratedCharacterDraft,
  validateInspirationInput,
} from "../server/minimax-generation.js";
import { generateStory, generationConfig, normalizeOnsiteStory } from "../server/story-generation.js";

const npcs = [
  {
    id: "host",
    name: "阿德里安·索恩",
    english: "Adrian Thorne",
    role: "庄园主人",
    bio: "ADS创始人",
    secret: "NEVER_SEND_HOST_SECRET",
  },
  {
    id: "detective",
    name: "诺拉·里德",
    english: "Nora Reed",
    role: "独立律师",
    bio: "受邀的法律顾问",
    secret: "NEVER_SEND_NPC_SECRET",
  },
];
const output = () => ({
  character: {
    name: "艾琳·温特",
    english: "Erin Winter",
    profession: "声音档案修复师",
    skill: "技术",
    motive: "受邀讨论数字人格的声音档案保护",
    story:
      "我以原创档案修复师的形象来到索恩庄园。去年在一次公开的声音档案展上，我曾向阿德里安·索恩演示修复旧录音的方法，也与诺拉·里德讨论过公开授权程序。这次ECHO晚宴令我想起那些夹杂风声的旧磁带。我希望向主人介绍新的保护方法，并听取律师对公开展示档案的建议。",
    cosplay_character: "冬夜档案师",
    cosplay_source: "原创角色",
  },
  avatar_prompt:
    "An adult archivist wearing a dark velvet coat, head and shoulders portrait, warm gold lighting, navy manor background, realistic illustration, no text.",
  adaptation:
    "你是应邀来到索恩庄园的声音档案修复师，在ECHO晚宴上通过自己的技术专长和旧识建立联系。",
  relations: ["host", "detective"].map((npc_id) => ({
    npc_id,
    relation: "公开展览中的旧识",
    player_brief: "你曾在档案展上与对方交流。请重提共同的公开话题。",
    npc_brief: "请用公开展览话题接待这位宾客。",
    hooks: [{ phase: 1, goal: "介绍自己的职业并交流一条公开见闻" }],
    mission: "与旧识完成一次角色介绍",
  })),
});
const onsite = (value = output(), context = {}) => normalizeOnsiteStory(
  { adaptation: value.adaptation, relations: value.relations }, npcs,
  { character: value.character, ...context },
);
const completion = (value, prefix = "") =>
  new Response(
    JSON.stringify({
      base_resp: { status_code: 0 },
      choices: [
        {
          finish_reason: "stop",
          message: { content: prefix + JSON.stringify(value) },
        },
      ],
    }),
  );
const fixtureImage = await sharp({
  create: { width: 32, height: 32, channels: 3, background: "#183a5f" },
})
  .png()
  .toBuffer();
const imageResponse = (encoded = fixtureImage.toString("base64")) =>
  new Response(
    JSON.stringify({
      base_resp: { status_code: 0 },
      data: { image_base64: [encoded] },
    }),
  );
const config = (fetch, options = {}) =>
  minimaxConfig({
    baseUrl: "https://minimax.example/v1",
    apiKey: "test-private-key",
    fetch,
    ...options,
  });

test("MiniMax一键生成姓名故事关联与安全WebP头像，只传公开NPC资料", async () => {
  const requests = [];
  const result = await generateCharacterDraft(
    {
      cosplay_character: "冬夜档案师",
      cosplay_source: "原创角色",
      idea: "希望通过修复旧声音与晚宴人物相识",
    },
    npcs,
    config(async (url, req) => {
      requests.push({ url, req, body: JSON.parse(req.body) });
      return requests.length === 1
        ? completion(output(), "<think>不会泄露的模型思考</think>\n")
        : imageResponse();
    }),
  );
  assert.deepEqual(result.character, output().character);
  assert.equal(result.relations.length, 2);
  assert.equal(result.avatar_prompt, undefined);
  assert.ok(Buffer.isBuffer(result.avatarWebp));
  assert.equal((await sharp(result.avatarWebp).metadata()).format, "webp");
  assert.equal(requests[0].url, "https://minimax.example/v1/chat/completions");
  assert.equal(requests[0].body.max_tokens, 8192);
  assert.equal(requests[0].body.reasoning_split, true);
  assert.equal(requests[0].body.response_format, undefined);
  assert.equal(
    requests[0].req.headers.authorization,
    "Bearer test-private-key",
  );
  assert.ok(!JSON.stringify(requests[0].body).includes("NEVER_SEND"));
  assert.ok(!JSON.stringify(requests[0].body).includes("test-private-key"));
  assert.equal(requests[1].url, "https://minimax.example/v1/image_generation");
  assert.deepEqual(requests[1].body, {
    model: "image-01",
    prompt: output().avatar_prompt,
    aspect_ratio: "1:1",
    response_format: "base64",
    n: 1,
    prompt_optimizer: false,
  });
  assert.equal(requests[1].req.redirect, "error");
});

const photoAppearance = () => ({
  clothing: ["白色翻领外套", "深色高领内搭"], accessories: ["金属圆框眼镜"],
  props: [], makeup: ["深色舞台眼妆"], palette: ["白色", "黑色"], style: ["复古学院风"],
});
const referencePhoto = {
  dataUrl: `data:image/png;base64,${fixtureImage.toString("base64")}`,
  mimeType: "image/png", version: "server-owned-photo-version",
};

test("真实装扮识别后再写故事和参考生图，照片不进入文本模型或公开进度", async () => {
  const requests = [], events = [];
  const result = await generateCharacterDraft({}, npcs, config(async (url, req) => {
    requests.push({ url, req, body: JSON.parse(req.body) });
    if (requests.length === 1) return Response.json({ content: JSON.stringify(photoAppearance()), base_resp: { status_code: 0 } });
    if (requests.length === 2) return completion(output());
    return imageResponse();
  }), (event) => { events.push(event); }, { referencePhoto, faction: "conspirator" });
  assert.equal(requests.length, 3);
  const [vision, story, avatar] = requests;
  assert.equal(vision.url, "https://minimax.example/v1/coding_plan/vlm");
  assert.deepEqual(Object.keys(vision.body).sort(), ["image_url", "prompt"]);
  assert.ok(!vision.req.body.includes("你保持低调"));
  assert.ok(!vision.req.body.includes("索恩庄园"));
  assert.ok(!vision.req.body.includes("NEVER_SEND"));
  assert.equal(story.url, "https://minimax.example/v1/chat/completions");
  assert.match(story.body.messages[0].content, /visible_costume.*白色翻领外套/);
  assert.ok(!story.req.body.includes("data:image"));
  assert.ok(!story.req.body.includes("NEVER_SEND"));
  assert.match(result.character.story, /白色翻领外套.*深色高领内搭/);
  assert.equal(result.character.cosplay_character, output().character.cosplay_character);
  assert.ok(result.relations.every((r) => r.npc_brief.length <= 120));
  assert.equal(avatar.url, "https://minimax.example/v1/image_generation");
  assert.match(avatar.body.prompt, /outfit overrides conflicting clothing/);
  assert.equal(avatar.body.subject_reference.length, 1);
  assert.equal(avatar.body.subject_reference[0].type, "character");
  const jpeg = avatar.body.subject_reference[0].image_file;
  assert.match(jpeg, /^data:image\/jpeg;base64,/);
  assert.equal((await sharp(Buffer.from(jpeg.split(",")[1], "base64")).metadata()).format, "jpeg");
  assert.match(events.find((e) => e.type === "appearance_ready").summary, /白色翻领外套/);
  assert.ok(events.findIndex((e) => e.type === "appearance_ready") < events.findIndex((e) => e.type === "text_ready"));
  assert.ok(events.filter((e) => e.type !== "avatar").every((e) => !JSON.stringify(e).includes("base64")));
  assert.ok(Buffer.isBuffer(result.avatarWebp));
});

test("照片识别失败明确停止，不假装识别成功或继续付费写故事生图", async () => {
  let calls = 0; const events = [];
  await assert.rejects(generateCharacterDraft({}, npcs, config(async () => {
    calls++;
    return Response.json({ base_resp: { status_code: 1004, status_msg: "test-private-key" } });
  }), (event) => { events.push(event); }, { referencePhoto }), (error) => {
    assert.equal(error.status, 502);
    assert.equal(error.providerCode, 1004);
    assert.match(error.message, /照片识别/);
    assert.ok(!error.message.includes("test-private-key"));
    return true;
  });
  assert.equal(calls, 1);
  assert.ok(!events.some((e) => ["appearance_ready", "text_ready", "avatar"].includes(e.type)));
});

test("照片头像重试第三参数兼容上下文，只调用一次参考图生图", async () => {
  let calls = 0, body;
  const avatar = await generateCharacterAvatar(output().avatar_prompt, config(async (url, req) => {
    calls++;
    assert.equal(url, "https://minimax.example/v1/image_generation");
    body = JSON.parse(req.body);
    return imageResponse();
  }), { referencePhoto });
  assert.equal(calls, 1);
  assert.match(body.subject_reference[0].image_file, /^data:image\/jpeg;base64,/);
  assert.ok(Buffer.isBuffer(avatar));
});

test("空灵感可生成原创角色，显式非法输入不能触发付费调用", async () => {
  assert.deepEqual(validateInspirationInput({}), {
    cosplay_character: "",
    cosplay_source: "",
    idea: "",
  });
  let called = 0;
  for (const input of [
    [],
    { idea: 3 },
    { cosplay_character: "x".repeat(101) },
    { idea: "x".repeat(2001) },
  ])
    await assert.rejects(
      generateCharacterDraft(
        input,
        npcs,
        config(async () => {
          called++;
        }),
      ),
      /灵感/,
    );
  assert.equal(called, 0);
  await assert.rejects(
    generateCharacterDraft(
      {},
      npcs,
      config(async () => {}, { apiKey: "" }),
    ),
    /尚未配置/,
  );
  for (const invalidNpcs of [undefined, [], [["host", "主人"], ["detective", "律师"]],
    [npcs[0], { ...npcs[1], id: null }], [npcs[0], { ...npcs[1], id: npcs[0].id }]])
    await assert.rejects(generateCharacterDraft({}, invalidNpcs, config(async () => {
      called++;
    })), (error) => error.status === 503 && /NPC资料/.test(error.message));
  assert.equal(called, 0);
});

test("MiniMax使用服务器指定的交流倾向并生成业余演员可照读的一分钟任务", async () => {
  let sent, calls = 0;
  const value = output();
  const result = await generateCharacterDraft({ faction: "conspirator" }, npcs, config(async (_url, request) => {
    if (++calls === 1) { sent = JSON.parse(request.body); return completion(value); }
    return imageResponse();
  }), undefined, { faction: "fbi" });
  const prompt = JSON.stringify(sent.messages);
  assert.ok(prompt.includes("30至60秒"));
  assert.ok(prompt.includes("不要求记住玩家背景"));
  assert.ok(prompt.includes("你关注清楚表达"));
  assert.ok(!prompt.includes("你保持低调"));
  assert.ok(!prompt.includes("NEVER_SEND"));
  assert.deepEqual(result.character, value.character);
  assert.match(result.relations[0].mission, /阿德里安·索恩.*30–60秒.*交流已完成/);
  assert.match(result.relations[1].mission, /诺拉·里德.*先征得本人同意/);
  assert.match(result.relations[0].player_brief, /复述对方自愿公开的观点/);
  assert.ok(result.relations.every((relation) => relation.npc_brief.length <= 120 && !relation.npc_brief.includes("fbi")));
});

test("校验拒绝泄露主线、缺少庄园背景、改写Cos来源、未知字段及短故事", () => {
  assert.equal(
    validateGeneratedCharacterDraft(output(), npcs).relations.length,
    2,
  );
  const mutations = [
    (v) => {
      v.character.story = "真正凶手是维拉".repeat(8);
    },
    (v) => {
      v.character.story =
        "我作为普通宾客来到晚宴，曾与阿德里安·索恩和诺拉·里德相识，并期待再次讨论旧时的经历。";
    },
    (v) => {
      v.relations[0].npc_id = "invented";
    },
    (v) => {
      v.character.skill = "战斗";
    },
    (v) => {
      v.character.reward = 20;
    },
    (v) => {
      v.character.story = "短故事";
    },
    (v) => {
      v.avatar_prompt = "x".repeat(1001);
    },
  ];
  for (const mutation of mutations) {
    const v = output();
    mutation(v);
    assert.throws(
      () => validateGeneratedCharacterDraft(v, npcs),
      (error) => {
        assert.match(error.message, /校验/);
        assert.equal(error.status, 502);
        return true;
      },
    );
  }
  assert.throws(
    () =>
      validateGeneratedCharacterDraft(output(), npcs, {
        cosplay_source: "必须保持的来源",
      }),
    /校验/,
  );
  const withoutNpcNames = output();
  withoutNpcNames.character.story =
    "我是一名来到索恩庄园的受邀宾客，期待在这场ECHO晚宴中与各位交流，了解不同职业的公开经验。";
  const connected = validateGeneratedCharacterDraft(withoutNpcNames, npcs);
  for (const npc of npcs)
    assert.ok(connected.character.story.includes(npc.name));
  assert.match(connected.character.story, /赴宴联络/);
});

test("原创角色误抄空Cos输入可规范元数据，显式Cos要求与剧情边界继续严格校验", () => {
  const original = output();
  original.character.cosplay_character = "";
  original.character.cosplay_source = " ";
  const normalized = validateGeneratedCharacterDraft(original, npcs, {});
  assert.equal(normalized.character.cosplay_character, original.character.name);
  assert.equal(normalized.character.cosplay_source, "原创角色");
  assert.equal(original.character.cosplay_character, "");
  assert.throws(() => validateGeneratedCharacterDraft(original, npcs, { cosplay_character: "指定角色" }), /校验/);
  assert.throws(() => validateGeneratedCharacterDraft(original, npcs, { cosplay_source: "指定来源" }), /校验/);
  original.character.story = "真正凶手是某人".repeat(10);
  assert.throws(() => validateGeneratedCharacterDraft(original, npcs), /校验/);
});

test("模型失败、截断与响应过大均返回安全错误，故事失败不会继续付费生图", async () => {
  const failures = [
    () => new Response("provider test-private-key", { status: 401 }),
    () =>
      new Response(
        JSON.stringify({
          base_resp: { status_code: 1008, status_msg: "test-private-key" },
        }),
      ),
    () =>
      new Response(
        JSON.stringify({
          choices: [{ finish_reason: "length", message: { content: "{}" } }],
        }),
      ),
    () => new Response("not-json test-private-key"),
    () =>
      new Response(
        JSON.stringify({
          choices: [{ finish_reason: "stop", message: { content: "{}" } }],
        }),
      ),
    () => new Response("x".repeat(150001)),
    () => {
      throw new Error("test-private-key https://private-endpoint.example");
    },
  ];
  for (const failure of failures) {
    let called = 0;
    await assert.rejects(
      generateCharacterDraft(
        {},
        npcs,
        config(async () => {
          called++;
          return failure();
        }),
      ),
      (error) => {
        assert.ok(!error.message.includes("test-private-key"));
        assert.ok(!error.message.includes("private-endpoint"));
        return true;
      },
    );
    assert.equal(called, 1);
  }
});

test("头像失败保留校验通过的角色、私有剧情和头像重试描述", async () => {
  for (const encoded of [
    "not-base64",
    Buffer.from("<svg>bad</svg>").toString("base64"),
    "",
  ]) {
    let called = 0;
    const events = [];
    const result = await generateCharacterDraft(
        {},
        npcs,
        config(async () =>
          ++called === 1 ? completion(output()) : imageResponse(encoded),
        ),
        (event) => events.push(event),
      );
    assert.deepEqual(result.character, output().character);
    assert.deepEqual(result.relations, onsite().relations);
    assert.equal(result.avatarWebp, null);
    assert.match(result.avatarError, /头像/);
    const ready = events.find((event) => event.type === "text_ready");
    assert.equal(ready.avatar_prompt, output().avatar_prompt);
    assert.deepEqual(ready.relations, result.relations);
    assert.ok(events.indexOf(ready) < events.findIndex((event) => event.type === "avatar_error"));
    assert.equal(called, 2);
  }
  await assert.rejects(
    generateCharacterDraft(
      {},
      npcs,
      config(
        (url, { signal }) =>
          new Promise((resolve, reject) =>
            signal.addEventListener(
              "abort",
              () => reject(new Error("test-private-key")),
              { once: true },
            ),
          ),
        { timeoutMs: 5 },
      ),
    ),
    /超时/,
  );
});

test("完整故事持久化回调完成后才请求头像", async () => {
  let release, ready;
  const saved = new Promise((resolve) => { release = resolve; });
  const reached = new Promise((resolve) => { ready = resolve; });
  let calls = 0;
  const pending = generateCharacterDraft({}, npcs, config(async () =>
    ++calls === 1 ? completion(output()) : imageResponse(),
  ), async (event) => {
    if (event.type !== "text_ready") return;
    ready();
    await saved;
  });
  await reached;
  assert.equal(calls, 1);
  release();
  const result = await pending;
  assert.equal(calls, 2);
  assert.ok(result.avatarWebp);
});

test("头像单独重试只调用图像接口并保持尺寸与解码边界", async () => {
  let calls = 0;
  const events = [];
  const avatar = await generateCharacterAvatar(output().avatar_prompt, config(async (url) => {
    calls++;
    assert.equal(url, "https://minimax.example/v1/image_generation");
    return imageResponse();
  }), (event) => events.push(event));
  assert.equal(calls, 1);
  assert.equal((await sharp(avatar).metadata()).format, "webp");
  assert.equal(events.at(-1).type, "avatar");
  for (const prompt of ["", null, "x".repeat(1001)])
    await assert.rejects(generateCharacterAvatar(prompt, config(async () => {
      throw new Error("must not request invalid prompt");
    })), /头像描述无效/);
});

test("图像连接失败和超时不撤回完整故事，也不泄露底层异常", async () => {
  for (const timeout of [false, true]) {
    let calls = 0;
    const result = await generateCharacterDraft({}, npcs, config(async (_url, { signal }) => {
      if (++calls === 1) return completion(output());
      if (!timeout) throw new Error("test-private-key https://private-endpoint.example");
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("test-private-key")), { once: true }));
    }, { timeoutMs: 10 }));
    assert.equal(result.avatarWebp, null);
    assert.equal(result.character.name, output().character.name);
    assert.ok(!JSON.stringify(result).includes("test-private-key"));
    assert.ok(!JSON.stringify(result).includes("private-endpoint"));
    assert.match(result.avatarError, timeout ? /超时/ : /连接失败/);
  }
});

test("现有剧情生成使用MiniMax模式：独立思考、足够token、JSON围栏兼容", async () => {
  const { adaptation, relations } = output();
  let sent;
  const c = generationConfig({
    baseUrl: "https://api.minimax.cn/v1",
    apiKey: "test-private-key",
    fetch: async (url, req) => {
      sent = JSON.parse(req.body);
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content:
                  "<think>思考</think>\n```json\n" +
                  JSON.stringify({ adaptation, relations }) +
                  "\n```",
              },
            },
          ],
        }),
      );
    },
  });
  assert.equal(c.model, "MiniMax-M2.5");
  assert.equal(c.responseFormat, "none");
  assert.deepEqual(await generateStory(output().character, npcs, c), normalizeOnsiteStory({ adaptation, relations }, npcs, { character: output().character }));
  assert.equal(sent.max_tokens, 8192);
  assert.equal(sent.response_format, undefined);
  assert.equal(
    generationConfig({
      baseUrl: "https://legacy.example/v1",
      apiKey: "key",
      model: "legacy",
    }).responseFormat,
    "json_schema",
  );
});

test("只配置MINIMAX_API_KEY即可启用已有剧情生成，通用Schema缺省不会干扰MiniMax", () => {
  const keys = [
    "MINIMAX_API_KEY",
    "MINIMAX_BASE_URL",
    "MINIMAX_TEXT_MODEL",
    "LLM_BASE_URL",
    "LLM_API_KEY",
    "LLM_MODEL",
    "LLM_RESPONSE_FORMAT",
  ];
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    process.env.MINIMAX_API_KEY = "test-environment-key";
    process.env.LLM_RESPONSE_FORMAT = "json_schema";
    const c = generationConfig();
    assert.equal(c.baseUrl, "https://api.minimax.cn/v1");
    assert.equal(c.apiKey, "test-environment-key");
    assert.equal(c.model, "MiniMax-M2.5");
    assert.equal(c.responseFormat, "none");
    assert.equal(c.timeoutMs, 90000);
    assert.equal(
      generationConfig({ baseUrl: "", apiKey: "", model: "" }).model,
      "",
    );
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("真实SSE分片逐步提供公开人物字段，不泄露思考和NPC私稿", async () => {
  const events = [];
  const value = output();
  const content = JSON.stringify(value);
  const encoder = new TextEncoder();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let reached;
  const first = new Promise((resolve) => { reached = resolve; });
  let calls = 0;
  const pending = generateCharacterDraft({}, npcs, config(async (_url, options) => {
    calls++;
    if (calls > 1) return imageResponse();
    assert.equal(JSON.parse(options.body).stream, true);
    return new Response(new ReadableStream({
      async start(controller) {
        const frame = (data) => encoder.encode(`data: ${JSON.stringify(data)}\r\n\r\n`);
        controller.enqueue(frame({ choices: [{ delta: { reasoning_details: [{ text: "PRIVATE_THINKING" }] } }] }));
        const split = content.indexOf(value.character.story) + 28;
        const bytes = frame({ choices: [{ delta: { content: content.slice(0, split) } }] });
        // Split both SSE framing and multi-byte UTF-8 characters.
        for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
        await gate;
        controller.enqueue(frame({ choices: [{ delta: { content: content.slice(split) }, finish_reason: "stop" }] }));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }), { headers: { "content-type": "text/event-stream" } });
  }), (event) => {
    events.push(event);
    if (event.character?.story) reached();
  });
  await first;
  assert.equal(calls, 1);
  assert.equal(events.at(-1).character.name, value.character.name);
  assert.ok(events.at(-1).character.story.length < value.character.story.length);
  release();
  const result = await pending;
  assert.equal(result.character.name, value.character.name);
  assert.ok(events.some((event) => event.type === "avatar" && event.preview.startsWith("data:image/webp;base64,")));
  const ready = events.find((event) => event.type === "text_ready");
  assert.deepEqual(ready.relations, onsite(value).relations);
  assert.equal(ready.avatar_prompt, value.avatar_prompt);
  const serialized = JSON.stringify(events.filter((event) => event.type !== "text_ready"));
  assert.ok(!serialized.includes("PRIVATE_THINKING"));
  assert.ok(!serialized.includes("npc_brief"));
  assert.ok(!serialized.includes("avatar_prompt"));
});

test("细碎SSE和独立思考超过150KB仍可生成短正文，不将传输开销当作正文", async () => {
  const events = [];
  const value = output();
  const content = JSON.stringify(value);
  const frame = (delta, finish_reason = null) => `data: ${JSON.stringify({
    id: "chatcmpl-" + "a".repeat(80), object: "chat.completion.chunk",
    created: 1793318400, model: "MiniMax-M2.5",
    choices: [{ index: 0, delta, finish_reason }],
  })}\r\n\r\n`;
  const wire = frame({ reasoning_details: [{ text: "PRIVATE_THINKING" }] }).repeat(700) +
    Array.from(content, (char) => frame({ content: char })).join("") +
    frame({}, "stop") + "data: [DONE]\n\n";
  assert.ok(Buffer.byteLength(wire) > 150000);
  assert.ok(Buffer.byteLength(content) < 150000);
  let calls = 0;
  const result = await generateCharacterDraft({}, npcs, config(async () => {
    if (++calls > 1) return imageResponse();
    const bytes = new TextEncoder().encode(wire);
    return new Response(new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 4093) controller.enqueue(bytes.slice(i, i + 4093));
        controller.close();
      },
    }), { headers: { "content-type": "text/event-stream" } });
  }), (event) => events.push(event));
  assert.deepEqual(result.character, value.character);
  assert.equal(calls, 2);
  assert.ok(result.avatarWebp);
  assert.ok(events.some((event) => event.type === "text_ready"));
  assert.ok(!JSON.stringify(events).includes("PRIVATE_THINKING"));
});

test("流式正文和传输总量仍有独立上限，超限停止读取且不继续付费生图", async () => {
  for (const wire of [
    // Chinese text must be counted in UTF-8 bytes, not JS string length.
    `data: ${JSON.stringify({ choices: [{ delta: { content: "中".repeat(50001) } }] })}\n\n`,
    // Even an unterminated comment/reasoning stream has a finite wire budget.
    ":" + "x".repeat(8 * 1024 * 1024),
  ]) {
    let calls = 0, cancelled = false;
    const events = [];
    await assert.rejects(generateCharacterDraft({}, npcs, config(async () => {
      calls++;
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode(wire)); },
        cancel() { cancelled = true; },
      }), { headers: { "content-type": "text/event-stream" } });
    }), (event) => events.push(event)), /模型响应过大/);
    assert.equal(calls, 1);
    assert.equal(cancelled, true);
    assert.equal(events.some((event) => event.type === "text_ready"), false);
  }
});

test("无效流式JSON提供明确安全错误，未完成或违规故事不会发出可保存草稿", async () => {
  const events = [];
  await assert.rejects(generateCharacterDraft({}, npcs, config(async () =>
    new Response("data: {broken test-private-key}\n\n", { headers: { "content-type": "text/event-stream" } }),
  ), (event) => events.push(event)), /无效流式数据/);
  assert.equal(events.some((event) => event.type === "text_ready"), false);
  const invalid = output();
  invalid.relations[0].mission = "找到凶手并接头";
  let calls = 0;
  await assert.rejects(generateCharacterDraft({}, npcs, config(async () => {
    calls++;
    return completion(invalid);
  }), (event) => events.push(event)), (error) => {
    assert.equal(error.validationCode, "story_constraints");
    assert.ok(!JSON.stringify(error).includes("test-private-key"));
    return true;
  });
  assert.equal(calls, 1);
  assert.equal(events.some((event) => event.type === "text_ready"), false);
});
