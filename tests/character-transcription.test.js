import { test } from "node:test";
import assert from "node:assert/strict";
import {
  characterTranscriptionConfig,
  isCharacterTranscriptionConfigured,
  normalizeCharacterRecording,
  transcribeCharacterAudio,
  transcribeCharacterReference,
} from "../server/character-transcription.js";

const privateKey = "test-asr-private-key";
const cfg = (fetch, options = {}) => characterTranscriptionConfig({
  baseUrl: "https://asr.example/v1", apiKey: privateKey, fetch,
  // Native WebAudio WAV must work even when production has no ffmpeg.
  ffmpegPath: "/this-ffmpeg-does-not-exist", ...options,
});
function wav(duration = 0.5, metadata = "") {
  const pcm = Buffer.alloc(duration * 16000 * 2);
  for (let offset = 0; offset < pcm.length; offset += 2)
    pcm.writeInt16LE(Math.round(Math.sin(offset / 2 / 16000 * 440 * Math.PI * 2) * 4000), offset);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  let data = Buffer.concat([header, pcm]);
  if (metadata) {
    const chunk = Buffer.alloc(8 + metadata.length + metadata.length % 2);
    chunk.write("JUNK", 0); chunk.writeUInt32LE(metadata.length, 4); chunk.write(metadata, 8);
    data = Buffer.concat([data, chunk]);
    data.writeUInt32LE(data.length - 8, 4);
  }
  return data;
}

test("原生PCM16单声道16k WAV直接转写，只发送规范音频，返回文字与真实时长", async () => {
  const data = wav(0.5, "PRIVATE_WAV_METADATA_NEVER_SENT");
  let calls = 0;
  const config = cfg(async (url, request) => {
    calls++;
    assert.equal(url, "https://asr.example/v1/speech_to_text");
    assert.equal(request.method, "POST");
    assert.equal(request.redirect, "error");
    assert.deepEqual(request.headers, { authorization: `Bearer ${privateKey}` });
    assert.ok(request.body instanceof FormData);
    assert.deepEqual([...request.body.keys()], ["model", "response_format", "stream", "file"]);
    assert.equal(request.body.get("model"), "asr-1.0");
    assert.equal(request.body.get("response_format"), "json");
    assert.equal(request.body.get("stream"), "false");
    const file = request.body.get("file");
    assert.equal(file.name, "character-reference.wav");
    assert.equal(file.type, "audio/wav");
    const actual = Buffer.from(await file.arrayBuffer());
    assert.equal(actual.length, 16044);
    assert.equal(actual.readUInt32LE(40), 16000);
    assert.ok(!actual.includes(Buffer.from("PRIVATE_WAV_METADATA")));
    return new Response(JSON.stringify({ text: " 我希望成为一位沉静的声音档案师。 ", duration: 999, trace_id: "NEVER_RETURN_TRACE" }));
  });
  assert.equal(isCharacterTranscriptionConfigured(config), true);
  assert.deepEqual(await transcribeCharacterAudio({ data, mimeType: "audio/wav" }, config), {
    text: "我希望成为一位沉静的声音档案师。", duration: 0.5,
  });
  assert.equal(calls, 1);
});

test("识别结果可作为纯文字灵感，WAV大小及时长边界准确", async () => {
  const config = cfg(async () => new Response('{"text":"夜航档案师"}'));
  assert.equal(await transcribeCharacterReference(wav(), "audio/wav; codecs=pcm", config), "夜航档案师");
  const maximum = await normalizeCharacterRecording(wav(60), "audio/wav", config);
  assert.equal(maximum.duration, 60);
  assert.equal(maximum.audioWav.length, 1920044);
  await assert.rejects(normalizeCharacterRecording(wav(60.1), "audio/wav", config), /不能超过60秒/);
});

test("无效录音、非音频、超大文件、异常WAV头在调用供应商前拒绝", async () => {
  let calls = 0;
  const config = cfg(async () => { calls++; });
  const corruptions = [
    (value) => value.subarray(0, 80),
    (value) => { value.write("RIFF", 8); return value; },
    (value) => { value.writeUInt16LE(2, 22); return value; },
    (value) => { value.writeUInt32LE(48000, 24); return value; },
    (value) => { value.writeUInt16LE(8, 34); return value; },
    (value) => { value.writeUInt32LE(0xffffffff, 40); return value; },
  ];
  for (const mutation of corruptions)
    await assert.rejects(transcribeCharacterAudio({ data: mutation(wav()), mimeType: "audio/wav" }, config), /WAV格式/);
  for (const input of [null, {}, { data: "not a Buffer", mimeType: "audio/wav" },
    { data: wav(), mimeType: "text/plain" }, { data: Buffer.alloc(5 * 1024 * 1024 + 1), mimeType: "audio/wav" }])
    await assert.rejects(transcribeCharacterAudio(input, config), /录音|格式/);
  assert.equal(calls, 0);
});

test("录音解码与接口配置失败不会发送录音", async () => {
  let calls = 0;
  for (const options of [
    { apiKey: "" }, { baseUrl: "http://localhost/v1" },
    { baseUrl: `https://${privateKey}@asr.example/v1` },
  ]) {
    await assert.rejects(transcribeCharacterAudio({ data: wav(), mimeType: "audio/wav" },
      cfg(async () => { calls++; }, options)), /未配置|配置无效/);
  }
  await assert.rejects(transcribeCharacterAudio({ data: Buffer.alloc(64), mimeType: "audio/webm" },
    cfg(async () => { calls++; })), /处理服务/);
  assert.equal(calls, 0);
});

test("供应商HTTP错误与网络错误经过脱敏，重定向不会泄露密钥", async () => {
  for (const status of [400, 401, 402, 413, 422, 429, 500, 302]) {
    await assert.rejects(transcribeCharacterAudio({ data: wav(), mimeType: "audio/wav" },
      cfg(async () => new Response(privateKey, { status, headers: { location: `https://evil.example/${privateKey}` } }))),
    (error) => {
      assert.ok(!error.message.includes(privateKey));
      assert.ok(!error.message.includes("evil.example"));
      assert.equal(error.status, [400, 413, 422, 429].includes(status) ? status : 502);
      return true;
    });
  }
  await assert.rejects(transcribeCharacterAudio({ data: wav(), mimeType: "audio/wav" }, cfg(async () => {
    throw new Error(`request ${privateKey}`);
  })), (error) => error.status === 502 && !error.message.includes(privateKey));
});

test("空白、异常、过长及过大转写结果不会作为角色素材返回", async () => {
  for (const data of [
    { text: " " }, { text: 123 }, { text: "a".repeat(2001) },
    { text: "hi\x00" }, { text: privateKey }, { error: { message: privateKey } },
    { base_resp: { status_code: 1004, status_msg: privateKey } },
  ]) {
    await assert.rejects(transcribeCharacterAudio({ data: wav(), mimeType: "audio/wav" },
      cfg(async () => new Response(JSON.stringify(data)))), (error) => !error.message.includes(privateKey));
  }
  for (const response of [
    new Response("invalid JSON"),
    new Response("x", { headers: { "content-length": "100001" } }),
    new Response("x".repeat(100001)),
  ])
    await assert.rejects(transcribeCharacterAudio({ data: wav(), mimeType: "audio/wav" }, cfg(async () => response)), /结果|响应过大/);
});

test("识别超时会中止请求并返回安全提示", async () => {
  await assert.rejects(transcribeCharacterAudio({ data: wav(), mimeType: "audio/wav" }, cfg(async (_url, request) => {
    await new Promise((_resolve, reject) => request.signal.addEventListener("abort", () => reject(new Error(privateKey)), { once: true }));
  }, { timeoutMs: 5 })), /识别超时/);
});
