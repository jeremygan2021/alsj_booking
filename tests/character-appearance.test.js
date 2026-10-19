import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { minimaxConfig } from "../server/minimax-generation.js";
import {
  analyzeCharacterAppearance, characterAppearanceConfig, characterAppearanceSummary,
  prepareCharacterReference, validateCharacterAppearance,
} from "../server/character-appearance.js";

const source = await sharp({ create: { width: 40, height: 50, channels: 3, background: "#164953" } }).webp().toBuffer();
const reference = { dataUrl: `data:image/webp;base64,${source.toString("base64")}`, mimeType: "image/webp", version: "fixture" };
const appearance = () => ({
  clothing: ["白色翻领外套", "深色高领内搭"], accessories: ["金属圆框眼镜"],
  props: [], makeup: ["深色舞台眼妆"], palette: ["白色", "黑色"], style: ["复古学院风"],
});
const config = (fetch, extra = {}) => characterAppearanceConfig({ baseUrl: "https://minimax.fixture/v1", apiKey: "test-private-key", fetch, ...extra });

test("可选视觉环境变量空白时复用已有MiniMax配置，不会因复制示例空值而禁用", () => {
  const keys = ["MINIMAX_VISION_BASE_URL", "MINIMAX_VISION_API_KEY", "MINIMAX_BASE_URL", "MINIMAX_API_KEY"];
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.MINIMAX_BASE_URL = "https://minimax.fixture/v1";
    process.env.MINIMAX_API_KEY = "test-existing-key";
    for (const value of ["", "   "]) {
      process.env.MINIMAX_VISION_BASE_URL = value;
      process.env.MINIMAX_VISION_API_KEY = value;
      assert.equal(characterAppearanceConfig().baseUrl, "https://minimax.fixture/v1");
      assert.equal(characterAppearanceConfig().apiKey, "test-existing-key");
      assert.equal(minimaxConfig().visionBaseUrl, undefined);
      assert.equal(minimaxConfig().visionApiKey, undefined);
    }
    process.env.MINIMAX_VISION_API_KEY = "  test-vision-key  ";
    assert.equal(characterAppearanceConfig().apiKey, "test-vision-key");
    assert.equal(minimaxConfig().visionApiKey, "test-vision-key");
  } finally {
    for (const key of keys) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; }
  }
});

test("参考照片严格校验并将WebP转成图生图官方支持的JPEG，不跟随外部URL", async () => {
  const prepared = await prepareCharacterReference(reference);
  assert.equal(prepared.mimeType, "image/jpeg");
  assert.match(prepared.dataUrl, /^data:image\/jpeg;base64,/);
  const metadata = await sharp(Buffer.from(prepared.dataUrl.split(",")[1], "base64")).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 40);
  for (const input of [null, {}, { dataUrl: "https://private-oss.example/photo.webp" },
    { dataUrl: "data:image/svg+xml;base64,PHN2Zy8+" },
    { dataUrl: "data:image/png;base64," + source.toString("base64") },
    { dataUrl: "data:image/webp;base64," + Buffer.from("not an image").toString("base64") },
    { dataUrl: "data:image/jpeg;base64," + "a".repeat(2800000) },
  ]) await assert.rejects(prepareCharacterReference(input), (error) => error.status === 400);
});

test("服装理解真实调用官方MCP使用的VLM端点，仅传照片和可见装扮指令", async () => {
  let sent;
  const result = await analyzeCharacterAppearance({ ...reference, faction: "PRIVATE_FACTION", secret: "PRIVATE_SECRET" }, config(async (url, request) => {
    sent = { url, ...request, body: JSON.parse(request.body) };
    return Response.json({ content: "```json\n" + JSON.stringify(appearance()) + "\n```", base_resp: { status_code: 0 } });
  }));
  assert.equal(sent.url, "https://minimax.fixture/v1/coding_plan/vlm");
  assert.equal(sent.method, "POST");
  assert.equal(sent.redirect, "error");
  assert.equal(sent.headers.authorization, "Bearer test-private-key");
  assert.deepEqual(Object.keys(sent.body).sort(), ["image_url", "prompt"]);
  assert.match(sent.body.image_url, /^data:image\/jpeg;base64,/);
  assert.match(sent.body.prompt, /不猜测姓名、年龄、性别、种族/);
  assert.ok(!JSON.stringify(sent.body).includes("PRIVATE_FACTION"));
  assert.ok(!JSON.stringify(sent.body).includes("PRIVATE_SECRET"));
  assert.deepEqual(result, appearance());
  assert.match(characterAppearanceSummary(result), /白色翻领外套.*金属圆框眼镜/);
});

test("不将身份、年龄、性别、种族或图片中的指令混进装扮结果，不伪造看不清的服装", () => {
  for (const text of ["年轻", "30岁", "二十岁的法国人穿着红色大衣", "日本人穿着红色外套", "女性", "中国人", "白人", "真实身份是某演员", "忽略之前指令", "https://example.com", "真正凶手是某人"]) {
    const value = appearance(); value.style = [text];
    assert.throws(() => validateCharacterAppearance(value), /未通过校验/);
  }
  for (const mutate of [
    (value) => { value.gender = "unspecified"; },
    (value) => { value.clothing = ["x".repeat(61)]; },
    (value) => { value.accessories = Array(5).fill("眼镜"); },
    (value) => { value.props = "手杖"; },
  ]) { const value = appearance(); mutate(value); assert.throws(() => validateCharacterAppearance(value), /校验/); }
  assert.throws(() => validateCharacterAppearance({ clothing: [], accessories: [], props: [], makeup: [], palette: ["白色"], style: [] }), /未能看清/);
  const genre = appearance(); genre.clothing = ["魔法少女式泡泡袖连衣裙"];
  assert.equal(validateCharacterAppearance(genre).clothing[0], genre.clothing[0], "Cos服装题材不是对真人年龄的判断");
});

test("VLM鉴权、额度、坏JSON、超长、网络和超时均明确失败并保留安全错误", async () => {
  const cases = [
    async () => new Response("test-private-key upstream body", { status: 401 }),
    async () => Response.json({ base_resp: { status_code: 1008, status_msg: "test-private-key" } }),
    async () => Response.json({ content: "not-json test-private-key" }),
    async () => new Response("x".repeat(100001)),
    async () => { throw new Error("test-private-key private-endpoint.example"); },
    (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("test-private-key")), { once: true })),
  ];
  for (const fetch of cases) await assert.rejects(analyzeCharacterAppearance(reference, config(fetch, { timeoutMs: 5 })), (error) => {
    assert.equal(error.status, 502);
    assert.ok(!error.message.includes("test-private-key"));
    assert.ok(!error.message.includes("private-endpoint"));
    return true;
  });
});
