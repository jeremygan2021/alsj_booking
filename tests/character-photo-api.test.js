import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";
import { avatarData } from "./profile-fixture.js";

const output = {
  character: {
    name: "林晚",
    english: "Lynn",
    profession: "装束档案修复师",
    skill: "洞察",
    motive: "与旧识讨论服装与公开展览",
    cosplay_character: "雪夜档案师",
    cosplay_source: "原创",
    story:
      "我穿着白色翻领外套，佩戴细框圆眼镜，受邀来到阿拉斯加索恩庄园的ECHO晚宴，想与阿德里安·索恩讨论公开展览，并与诺拉·里德聊聊如何保存旧照片。",
  },
  avatar_prompt:
    "Portrait of a fictional guest in a white lapel coat and thin round glasses in the golden Thorne estate.",
  adaptation: "将装扮融入庄园晚宴的虚构身份。",
  relations: ["host", "detective"].map((npc_id) => ({
    npc_id,
    relation: "公开展览旧识",
    player_brief: "曾一起讨论服装的公开展览。",
    npc_brief: "照读公开看法。",
    hooks: [{ phase: 1, goal: "问一个公开观点" }],
    mission: "介绍自己并听取回复",
  })),
};
const appearance = {
  clothing: ["白色翻领外套"],
  accessories: ["细框圆眼镜"],
  props: [],
  makeup: [],
  palette: ["白色", "深色"],
  style: ["复古"],
};

test("Cos照片由本人私有保存、真实视觉上下文生成，换图/移除阻止迟到头像覆盖且不删除原头像", async (t) => {
  const objects = new Map(),
    calls = [];
  let imageGate, reachedImage;
  const { app, db } = await createApp({
    dbPath: ":memory:",
    gmPassword: "photo-test",
    npcPassword: "photo-test",
    minimax: {
      apiKey: "private-photo-model-key",
      baseUrl: "https://minimax.example/v1",
      fetch: async (url, options) => {
        const body = JSON.parse(options.body);
        calls.push({ url, body });
        if (url.endsWith("/coding_plan/vlm"))
          return Response.json({
            code: 0,
            content: JSON.stringify(appearance),
          });
        if (url.endsWith("/chat/completions"))
          return Response.json({
            choices: [
              {
                finish_reason: "stop",
                message: { content: JSON.stringify(output) },
              },
            ],
          });
        if (url.endsWith("/image_generation")) {
          reachedImage?.();
          if (imageGate) await imageGate;
          return Response.json({
            data: { image_base64: [avatarData.split(",")[1]] },
          });
        }
        throw new Error("unexpected provider endpoint");
      },
    },
    characterMedia: {
      enabled: true,
      bucket: "photo-test-bucket",
      endpoint: "oss-cn-shanghai.aliyuncs.com",
      accessId: "private-photo-storage-id",
      secret: "private-photo-storage-key",
      fetch: async (url, options) => {
        if (options.method === "PUT") {
          assert.equal(options.headers["x-oss-object-acl"], "private");
          objects.set(url, Buffer.from(options.body));
          return new Response("");
        }
        return new Response(objects.get(url), {
          status: objects.has(url) ? 200 : 404,
        });
      },
    },
  });
  for (const id of ["photo-owner", "photo-other"]) {
    await db
      .prepare("INSERT INTO players(id,name,contact,password) VALUES(?,?,?,?)")
      .run(id, id, id, "unused");
    await db
      .prepare("INSERT INTO sessions VALUES(?,?,?,?)")
      .run(id, "player", id, Date.now() + 600000);
  }
  for (const [id, role] of [
    ["photo-gm", "gm"],
    ["photo-npc", "npc"],
  ])
    await db
      .prepare("INSERT INTO sessions VALUES(?,?,?,?)")
      .run(id, role, role === "npc" ? "detective" : "gm", Date.now() + 600000);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  });
  const request = (
    path,
    body,
    id = "photo-owner",
    method = body === undefined ? "GET" : "POST",
  ) =>
    fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        Cookie: id ? `alaska_session=${id}` : "",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  assert.equal(
    (await request("/character/reference-photo", { data: avatarData }, ""))
      .status,
    401,
  );
  assert.equal(
    (
      await request(
        "/character/reference-photo",
        { data: avatarData },
        "photo-npc",
      )
    ).status,
    401,
  );
  const saved = await request("/character/reference-photo", {
    data: avatarData,
    player_id: "photo-other",
  });
  assert.equal(saved.status, 201, await saved.clone().text());
  const meta = await saved.json();
  assert.ok(meta.version);
  assert.ok(meta.photo_url);
  assert.ok(!JSON.stringify(meta).includes("object_key"));
  const photo = await request(meta.photo_url.replace("/api", ""));
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get("content-type"), "image/webp");
  assert.equal(
    Buffer.from(await photo.arrayBuffer()).toString("ascii", 8, 12),
    "WEBP",
  );
  assert.equal(
    (
      await request(
        meta.photo_url.replace("/api", ""),
        undefined,
        "photo-other",
      )
    ).status,
    404,
  );
  assert.equal(
    (await request(meta.photo_url.replace("/api", ""), undefined, "photo-gm"))
      .status,
    401,
  );
  assert.equal(
    (await (await request("/character/inspiration")).json()).reference_photo
      .version,
    meta.version,
  );
  const generated = await request("/character/inspire", {
    referencePhoto: { dataUrl: "https://untrusted.example/image.jpg" },
  });
  assert.equal(generated.status, 200, await generated.clone().text());
  const draft = await generated.json();
  assert.match(draft.story, /白色翻领外套|圆眼镜/);
  assert.ok(draft.avatar_url);
  assert.ok(!JSON.stringify(draft).includes("data:image"));
  assert.ok(!JSON.stringify(draft).includes("private-photo"));
  const vision = calls.find((call) => call.url.endsWith("/coding_plan/vlm"));
  assert.match(vision.body.image_url, /^data:image\/jpeg;base64,/);
  const text = calls.find((call) => call.url.endsWith("/chat/completions"));
  assert.ok(JSON.stringify(text.body).includes("白色翻领外套"));
  assert.ok(!JSON.stringify(text.body).includes("data:image"));
  const image = calls.find((call) => call.url.endsWith("/image_generation"));
  assert.equal(image.body.subject_reference[0].type, "character");
  assert.match(
    image.body.subject_reference[0].image_file,
    /^data:image\/jpeg;base64,/,
  );
  const cached = JSON.parse(
    (
      await db
        .prepare(
          "SELECT data FROM character_inspirations WHERE player_id='photo-owner'",
        )
        .get()
    ).data,
  );
  assert.equal(cached.reference_photo_version, meta.version);
  const rerolled = await request("/character/inspiration/avatar", {});
  assert.equal(rerolled.status, 200, await rerolled.clone().text());
  const currentAvatar = (await (await request("/character/inspiration")).json())
    .character.avatar_url;
  assert.equal(
    calls.filter((call) => call.url.endsWith("/coding_plan/vlm")).length,
    1,
    "avatar-only retry must not repeat appearance analysis",
  );
  assert.equal(
    (
      await request(
        "/character/reference-photo",
        { version: meta.version },
        "photo-owner",
        "DELETE",
      )
    ).status,
    200,
  );
  assert.equal(
    (await (await request("/character/inspiration")).json()).reference_photo,
    null,
  );
  assert.equal(
    (await request(currentAvatar.replace("/api", ""))).status,
    200,
    "removing a reference must preserve the generated avatar",
  );
  assert.equal(
    (await request("/character/inspiration/avatar", {})).status,
    409,
    "changed reference must not silently alter a different draft",
  );
  await request("/character/reference-photo", { data: avatarData });
  let release;
  imageGate = new Promise((resolve) => {
    release = resolve;
  });
  const waiting = new Promise((resolve) => {
    reachedImage = resolve;
  });
  const late = request("/character/inspire", {});
  await waiting;
  await request("/character/reference-photo", {}, "photo-owner", "DELETE");
  release();
  assert.equal((await late).status, 409);
  assert.equal((await request(currentAvatar.replace("/api", ""))).status, 200);
  assert.equal(
    (await (await request("/character/inspiration")).json()).reference_photo,
    null,
  );
  for (const session of ["photo-owner", "photo-gm", "photo-npc"]) {
    const data = await (
      await request(
        session === "photo-owner" ? "/me" : "/staff",
        undefined,
        session,
      )
    ).text();
    assert.ok(!data.includes("/character/reference-photo/preview"));
    assert.ok(!data.includes("/photo/"));
  }
});
