import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { openDb } from "../server/db.js";
import { createCharacterPhotoService, normalizeCharacterPhoto } from "../server/character-photo.js";
import { characterMediaStorageConfig, putCharacterMedia, characterMediaDownloadUrl } from "../server/character-media-storage.js";

const jpeg = await sharp({ create: { width: 1800, height: 900, channels: 3, background: "#183a5f" } })
  .withMetadata({ orientation: 6, exif: { IFD0: { Artist: "PRIVATE_CAMERA_OWNER" } } }).jpeg().toBuffer();
const dataUrl = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
const config = (fetch) => characterMediaStorageConfig({
  env: {}, enabled: true, bucket: "character-photo-test", endpoint: "oss-cn-shanghai.aliyuncs.com",
  accessId: "test-photo-access", secret: "test-photo-private-secret", fetch,
});

async function fixture(t, customFetch) {
  const db = await openDb(process.env.TEST_DATABASE_URL || ":memory:");
  t.after(() => db.close());
  const id = randomUUID(), other = randomUUID(), third = randomUUID();
  for (const playerId of [id, other, third])
    await db.prepare("INSERT INTO players(id,name,contact,password) VALUES(?,?,?,'existing-hash')")
      .run(playerId, "照片玩家", `${playerId}@example.com`);
  await db.prepare("INSERT INTO characters(player_id,name,story,avatar_url,status) VALUES(?,'原角色','原始故事','/existing-avatar','pending')").run(id);
  await db.prepare("INSERT INTO avatars(player_id,data,updated_at) VALUES(?,'existing-avatar-bytes',123)").run(id);
  await db.prepare("INSERT INTO character_recordings(id,player_id,object_key,content_type,transcript,status,created_at) VALUES(?,?,'existing-recording-key','audio/wav','既有录音','ready',123)").run(randomUUID(), id);
  const objects = new Map();
  let transactionActive = false;
  const wrappedDb = {
    prepare: db.prepare.bind(db),
    transaction: (fn) => db.transaction(async () => {
      transactionActive = true;
      try { return await fn(); } finally { transactionActive = false; }
    }),
  };
  const normalFetch = async (url, options) => {
    assert.equal(transactionActive, false, "OSS requests never hold the photo DB transaction");
    assert.equal(options.redirect, "error");
    const key = new URL(url).pathname;
    if (options.method === "PUT") {
      assert.equal(options.headers["x-oss-object-acl"], "private");
      objects.set(key, Buffer.from(options.body));
      return new Response(null);
    }
    return new Response(objects.get(key) || "missing", { status: objects.has(key) ? 200 : 404 });
  };
  const mediaConfig = config(customFetch ? (url, options) => customFetch(url, options, normalFetch) : normalFetch);
  const service = createCharacterPhotoService({ db: wrappedDb, mediaConfig });
  return { db, id, other, third, objects, service, mediaConfig, wrappedDb };
}

test("照片真实旋转缩放为1024以内WebP，剥离源图EXIF与身份元数据", async () => {
  const source = await sharp(jpeg).metadata();
  assert.equal(source.orientation, 6);
  assert.ok(source.exif);
  const result = await normalizeCharacterPhoto(dataUrl);
  assert.equal(result.contentType, "image/webp");
  assert.equal(result.width, 512);
  assert.equal(result.height, 1024);
  const metadata = await sharp(result.data).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.orientation, undefined);
  assert.equal(metadata.xmp, undefined);
  assert.ok(!result.data.includes(Buffer.from("PRIVATE_CAMERA_OWNER")));
});

test("本人照片私有存OSS并跨服务恢复，原图只供本人预览与服务端生成参考", async (t) => {
  const { db, id, other, objects, service, mediaConfig } = await fixture(t);
  const saved = await service.save(id, dataUrl);
  assert.equal(saved.status, "ready");
  assert.match(saved.version, /^[a-f0-9-]{36}$/);
  assert.equal(saved.photo_url, `/api/character/reference-photo/preview?v=${saved.version}`);
  assert.equal(saved.width, 512);
  assert.equal(saved.height, 1024);
  assert.equal(objects.size, 1);
  assert.ok([...objects.keys()][0].includes("/photo/"));
  assert.ok([...objects.keys()][0].endsWith(".webp"));
  const serialized = JSON.stringify(saved);
  for (const privateText of ["alsj/characters/", "test-photo-private-secret", "object_key", "data:image", id])
    assert.ok(!serialized.includes(privateText));
  assert.deepEqual(await service.current(id), saved);
  assert.deepEqual(await createCharacterPhotoService({ db, mediaConfig }).current(id), saved);
  assert.equal(await service.current(other), null);
  await assert.rejects(service.read(other), (error) => error.status === 404);
  const preview = await service.read(id, saved.version);
  assert.equal(preview.contentType, "image/webp");
  const reference = await service.generationReference(id);
  assert.equal(reference.version, saved.version);
  assert.equal(reference.mimeType, "image/webp");
  assert.equal(reference.dataUrl, `data:image/webp;base64,${preview.data.toString("base64")}`);
  assert.notEqual(reference.dataUrl, dataUrl);
  assert.equal((await db.prepare("SELECT story FROM characters WHERE player_id=?").get(id)).story, "原始故事");
});

test("格式、体积、伪图像、超大像素拒绝后不丢弃当前参考", async (t) => {
  const { service, id, objects } = await fixture(t);
  const saved = await service.save(id, dataUrl);
  const largePixels = await sharp({ create: { width: 4001, height: 4000, channels: 3, background: "#183a5f" } }).png().toBuffer();
  for (const input of [null, "", "data:image/svg+xml;base64,PHN2Zz4=", "data:image/jpeg;base64,@@@@",
    `data:image/jpeg;base64,${Buffer.from("<html>not an image</html>").toString("base64")}`,
    `data:image/png;base64,${largePixels.toString("base64")}`, "a".repeat(3 * 1024 * 1024 + 1)])
    await assert.rejects(service.save(id, input), (error) => [400, 413].includes(error.status));
  assert.deepEqual(await service.current(id), saved);
  assert.equal(objects.size, 1);
});

test("移除只清照片引用，不动原头像、角色、录音或其他玩家，旧预览不能读取", async (t) => {
  const { service, db, id, other, objects } = await fixture(t);
  const original = {};
  for (const table of ["characters", "avatars", "character_recordings"])
    original[table] = await db.prepare(`SELECT * FROM ${table} WHERE player_id=?`).all(id);
  const first = await service.save(id, dataUrl);
  const otherPhoto = await service.save(other, dataUrl);
  await service.remove(id, first.version);
  assert.equal(await service.current(id), null);
  const snapshot = await service.snapshot(id);
  assert.equal(snapshot.photo, null);
  assert.notEqual(snapshot.version, first.version);
  assert.ok(snapshot.updated_at > first.created_at);
  assert.equal(await service.generationReference(id), null);
  await assert.rejects(service.read(id, first.version), (error) => error.status === 404);
  assert.deepEqual(await service.current(other), otherPhoto);
  assert.equal(objects.size, 2); // Private objects may still belong to in-flight work.
  for (const [table, expected] of Object.entries(original))
    assert.deepEqual(await db.prepare(`SELECT * FROM ${table} WHERE player_id=?`).all(id), expected, table);
  const removed = await db.prepare("SELECT * FROM character_photos WHERE player_id=?").get(id);
  assert.equal(removed.object_key, null);
  assert.equal(removed.status, "removed");
  const replacement = await service.save(id, dataUrl);
  assert.notEqual(replacement.version, first.version);
  await assert.rejects(service.remove(id, first.version), (error) => error.status === 409);
  await assert.rejects(service.read(id, first.version), (error) => error.status === 409);
  assert.deepEqual(await service.current(id), replacement);
});

test("上传过程中移除引用会拒绝迟到写入，读图过程中移除不会返回迟到旧图", async (t) => {
  let releasePut, sawPut;
  const putStarted = new Promise((resolve) => { sawPut = resolve; });
  const putGate = new Promise((resolve) => { releasePut = resolve; });
  let blockPut = true, blockGet = false, releaseGet, sawGet;
  const getStarted = new Promise((resolve) => { sawGet = resolve; });
  const getGate = new Promise((resolve) => { releaseGet = resolve; });
  const { service, id } = await fixture(t, async (url, options, normalFetch) => {
    if (options.method === "PUT" && blockPut) { sawPut(); await putGate; }
    if (options.method === "GET" && blockGet) { sawGet(); await getGate; }
    return normalFetch(url, options);
  });
  const pending = service.save(id, dataUrl);
  await putStarted;
  await service.remove(id);
  releasePut();
  await assert.rejects(pending, (error) => error.status === 409);
  assert.equal(await service.current(id), null);
  blockPut = false;
  await service.save(id, dataUrl);
  blockGet = true;
  const reading = service.read(id);
  await getStarted;
  await service.remove(id);
  releaseGet();
  await assert.rejects(reading, (error) => error.status === 409);
});

test("OSS失败保留旧照片，公开错误不含凭证，照片格式与音频种类严格隔离", async (t) => {
  let failUpload = false;
  const { service, id, mediaConfig } = await fixture(t, async (url, options, normalFetch) => {
    if (failUpload && options.method === "PUT") throw new Error("test-photo-private-secret private endpoint");
    return normalFetch(url, options);
  });
  const before = await service.save(id, dataUrl);
  failUpload = true;
  await assert.rejects(service.save(id, dataUrl), (error) => error.status === 502 && !error.message.includes("test-photo-private-secret"));
  assert.deepEqual(await service.current(id), before);
  failUpload = false;
  const image = await normalizeCharacterPhoto(dataUrl);
  for (const [kind, contentType] of [["photo", "audio/mpeg"], ["recording", "image/webp"], ["intro", "image/webp"]])
    await assert.rejects(putCharacterMedia({ playerId: id, kind, contentType, data: image.data }, mediaConfig), (error) => error.status === 400);
  const stored = await putCharacterMedia({ playerId: id, kind: "photo", contentType: image.contentType, data: image.data }, mediaConfig);
  assert.throws(() => characterMediaDownloadUrl(stored.object_key, mediaConfig), (error) => error.status === 400);
});

test("上传有效照片的OSS尝试持久化限10次每小时，超过后不再PUT", async (t) => {
  let putCount = 0;
  const { service, id, db } = await fixture(t, async (url, options, normalFetch) => {
    if (options.method === "PUT") putCount++;
    return normalFetch(url, options);
  });
  const timestamp = Date.now();
  for (let i = 0; i < 9; i++)
    await db.prepare("INSERT INTO character_photo_requests(id,player_id,created_at) VALUES(?,?,?)").run(randomUUID(), id, timestamp - 1000);
  await db.prepare("INSERT INTO character_photo_requests(id,player_id,created_at) VALUES(?,?,?)").run(randomUUID(), id, timestamp - 3600001);
  const current = await service.save(id, dataUrl);
  assert.equal(putCount, 1);
  await assert.rejects(service.save(id, dataUrl), (error) => error.status === 429 && /10次/.test(error.message));
  assert.equal(putCount, 1);
  assert.deepEqual(await service.current(id), current);
});

test("单实例最多处理两张照片，繁忙请求不会额外上传", async (t) => {
  let started = 0, sawBoth, release;
  const bothStarted = new Promise((resolve) => { sawBoth = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const { service, id, other, third } = await fixture(t, async (url, options, normalFetch) => {
    if (options.method === "PUT") {
      if (++started === 2) sawBoth();
      await gate;
    }
    return normalFetch(url, options);
  });
  const first = service.save(id, dataUrl), second = service.save(other, dataUrl);
  await bothStarted;
  await assert.rejects(service.save(third, dataUrl), (error) => error.status === 429);
  assert.equal(started, 2);
  release();
  assert.equal((await first).status, "ready");
  assert.equal((await second).status, "ready");
});
