import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import {
  characterMediaStorageConfig,
  isCharacterMediaStorageConfigured,
  putCharacterMedia,
  readCharacterMedia,
  MAX_CHARACTER_MEDIA_BYTES,
} from "../server/character-media-storage.js";

const data = Buffer.from("ID3" + "private character voice bytes".repeat(8));
const date = "Sun, 18 Oct 2026 00:00:00 GMT";
const config = (fetch, options = {}) => characterMediaStorageConfig({
  env: {}, enabled: true, bucket: "character-test", endpoint: "oss-cn-shanghai.aliyuncs.com",
  accessId: "test-access", secret: "test-secret", fetch,
  now: () => new Date(date), ...options,
});
const upload = (options = {}) => ({
  playerId: "private-owner", kind: "intro", data, contentType: "audio/mpeg", ...options,
});

test("OSS配置复用已有清单位置且未配置时拒绝存储，不回退本地", async () => {
  const c = characterMediaStorageConfig({ env: {} });
  assert.ok(c.bucket);
  assert.match(c.endpoint, /^oss-/);
  assert.equal(isCharacterMediaStorageConfigured(c), false);
  await assert.rejects(putCharacterMedia(upload(), c), (error) => {
    assert.equal(error.status, 503);
    assert.match(error.message, /尚未配置/);
    return true;
  });
  const envConfig = characterMediaStorageConfig({ env: {
    OSS_ENABLED: "true", OSS_BUCKET: "env-characters", OSS_ENDPOINT: "oss-cn-beijing.aliyuncs.com",
    OSS_ACCESS_KEY_ID: "env-access", OSS_ACCESS_KEY_SECRET: "env-secret",
  } });
  assert.equal(isCharacterMediaStorageConfigured(envConfig), true);
  assert.equal(envConfig.bucket, "env-characters");
});

test("私有上传签名绑定内容、MIME、ACL、所有者与对象路径", async () => {
  let received;
  const c = config(async (url, options) => {
    received = { url, options };
    return new Response(null, { status: 200 });
  });
  const result = await putCharacterMedia(upload(), c);
  const owner = createHmac("sha256", "test-secret").update("private-owner").digest("hex");
  const sha = createHash("sha256").update(data).digest("hex");
  const md5 = createHash("md5").update(data).digest("base64");
  assert.deepEqual(result, {
    object_key: `alsj/characters/v1/${owner}/intro/${sha}.mp3`, content_type: "audio/mpeg", size: data.length,
  });
  assert.equal(received.url, `https://character-test.oss-cn-shanghai.aliyuncs.com/${result.object_key}`);
  assert.equal(received.options.method, "PUT");
  assert.equal(received.options.redirect, "error");
  assert.equal(received.options.body, data);
  const headers = received.options.headers;
  assert.equal(headers["x-oss-object-acl"], "private");
  assert.equal(headers["x-oss-meta-sha256"], sha);
  assert.equal(headers["Content-MD5"], md5);
  const canonical = `PUT\n${md5}\naudio/mpeg\n${date}\nx-oss-meta-sha256:${sha}\nx-oss-object-acl:private\n/character-test/${result.object_key}`;
  assert.equal(headers.Authorization, `OSS test-access:${createHmac("sha1", "test-secret").update(canonical).digest("base64")}`);
  assert.ok(!JSON.stringify(result).includes("test-secret"));
  assert.ok(!result.object_key.includes("private-owner"));
});

test("对象按内容寻址，隔离用户与素材种类并兼容手机录音MIME", async () => {
  const c = config(async () => new Response(null));
  const first = await putCharacterMedia(upload(), c);
  assert.equal((await putCharacterMedia(upload(), c)).object_key, first.object_key);
  assert.notEqual((await putCharacterMedia(upload({ playerId: "different-owner" }), c)).object_key, first.object_key);
  assert.notEqual((await putCharacterMedia(upload({ kind: "recording" }), c)).object_key, first.object_key);
  for (const [contentType, extension, normalized] of [
    ["audio/webm;codecs=opus", "webm", "audio/webm"],
    ["audio/mp4", "m4a", "audio/mp4"],
    ["audio/x-m4a", "m4a", "audio/mp4"],
    ["audio/ogg; codecs=opus", "ogg", "audio/ogg"],
    ["audio/x-wav", "wav", "audio/wav"],
    ["audio/aac", "aac", "audio/aac"],
  ]) {
    const value = await putCharacterMedia(upload({ kind: "recording", contentType }), c);
    assert.ok(value.object_key.endsWith(`.${extension}`));
    assert.equal(value.content_type, normalized);
  }
});

test("非法音频、种类、长度及不安全存储位置均不会触发请求", async () => {
  let calls = 0;
  const c = config(async () => { calls++; throw new Error("must not fetch"); });
  for (const input of [
    { playerId: "" }, { playerId: "x".repeat(201) }, { kind: "avatar" },
    { data: "not a Buffer" }, { data: Buffer.alloc(0) },
    { data: Buffer.alloc(MAX_CHARACTER_MEDIA_BYTES + 1) }, { contentType: "text/html" },
    { contentType: "audio/mp4" },
  ]) await assert.rejects(putCharacterMedia(upload(input), c), (error) => error.status === 400);
  for (const options of [
    { endpoint: "https://evil.example/oss-cn-shanghai.aliyuncs.com" },
    { endpoint: "http://oss-cn-shanghai.aliyuncs.com" },
    { bucket: "../other-bucket" }, { enabled: false }, { timeoutMs: 0 },
  ]) await assert.rejects(putCharacterMedia(upload(), { ...c, ...options }), (error) => error.status === 503);
  assert.equal(calls, 0);
});

test("授权代理读取使用私有GET签名，校验返回内容且不输出签名URL", async () => {
  let received;
  const c = config(async (url, options) => {
    received = { url, options };
    return options.method === "PUT" ? new Response(null) : new Response(data);
  });
  const { object_key } = await putCharacterMedia(upload(), c);
  assert.deepEqual(await readCharacterMedia(object_key, c), data);
  const canonical = `GET\n\n\n${date}\n/character-test/${object_key}`;
  assert.equal(received.options.headers.Authorization, `OSS test-access:${createHmac("sha1", "test-secret").update(canonical).digest("base64")}`);
  assert.equal(received.options.method, "GET");
  assert.equal(new URL(received.url).search, "");
});

test("读取拒绝任意键、超大或不匹配音频，STS令牌参与签名", async () => {
  let calls = 0, mode = "put", signed;
  const c = config(async (_url, options) => {
    calls++;
    signed = options.headers;
    if (mode === "put") return new Response(null);
    if (mode === "header") return new Response(data, { headers: { "content-length": String(MAX_CHARACTER_MEDIA_BYTES + 1) } });
    if (mode === "stream") return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(MAX_CHARACTER_MEDIA_BYTES));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    } }));
    return new Response("different content");
  }, { securityToken: "test-sts-token" });
  const { object_key } = await putCharacterMedia(upload(), c);
  assert.equal(signed["x-oss-security-token"], "test-sts-token");
  assert.ok(!JSON.stringify({ object_key }).includes("test-sts-token"));
  const before = calls;
  for (const key of ["https://evil.example/voice.mp3", "../voice.mp3", "alsj/assets/v1/other.mp3", object_key + "?acl", object_key.replace("/intro/", "/../")])
    await assert.rejects(readCharacterMedia(key, c), /标识无效/);
  assert.equal(calls, before);
  for (mode of ["header", "stream"]) await assert.rejects(readCharacterMedia(object_key, c), /过大/);
  mode = "wrong-content";
  await assert.rejects(readCharacterMedia(object_key, c), /校验失败/);
});

test("上传和读取的HTTP、网络与超时失败均为安全错误，失败不写本地", async () => {
  const key = (await putCharacterMedia(upload(), config(async () => new Response(null)))).object_key;
  for (const action of [(c) => putCharacterMedia(upload(), c), (c) => readCharacterMedia(key, c)]) {
    for (const fetch of [
      async () => new Response("test-secret provider XML", { status: 403 }),
      async () => { throw new Error("test-secret https://private-endpoint.example"); },
      (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("test-secret")), { once: true })),
    ]) await assert.rejects(action(config(fetch, { timeoutMs: 5 })), (error) => {
      assert.equal(error.status, 502);
      assert.ok(!error.message.includes("test-secret"));
      assert.ok(!error.message.includes("provider XML"));
      assert.ok(!error.message.includes("private-endpoint"));
      return true;
    });
  }
});
