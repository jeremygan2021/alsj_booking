import sharp from "sharp";
import { randomUUID } from "node:crypto";
import {
  isCharacterMediaStorageConfigured, putCharacterMedia, readCharacterMedia,
} from "./character-media-storage.js";

const MAX_DATA_URL_BYTES = 3 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;

export class CharacterPhotoError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "CharacterPhotoError";
    this.status = status;
  }
}

function ownerId(playerId) {
  if (typeof playerId !== "string" || !playerId.trim() || playerId.length > 200)
    throw new CharacterPhotoError("玩家标识无效", 400);
  return playerId;
}

export async function normalizeCharacterPhoto(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.length)
    throw new CharacterPhotoError("请选择一张装扮参考照片", 400);
  if (Buffer.byteLength(dataUrl) > MAX_DATA_URL_BYTES)
    throw new CharacterPhotoError("参考照片超过3MB，请压缩后重试", 413);
  const match = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match || match[1].length % 4 !== 0)
    throw new CharacterPhotoError("参考照片格式无效，请选择JPEG、PNG或WebP照片", 400);
  try {
    const bytes = Buffer.from(match[1], "base64");
    const image = sharp(bytes, { limitInputPixels: 16000000, failOn: "error" });
    const metadata = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format) ||
        (metadata.pages || 1) !== 1 || !metadata.width || !metadata.height)
      throw new Error();
    // Sharp strips EXIF/GPS and other source metadata unless explicitly kept.
    const output = await image.rotate().resize({
      width: 1024, height: 1024, fit: "inside", withoutEnlargement: true,
    }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    if (!output.data.length || output.data.length > MAX_OUTPUT_BYTES) throw new Error();
    return { data: output.data, contentType: "image/webp", width: output.info.width, height: output.info.height };
  } catch {
    throw new CharacterPhotoError("照片无法读取或像素过大，请换一张JPEG、PNG或WebP照片", 400);
  }
}

function publicMetadata(row) {
  if (!row || row.status !== "ready" || !row.object_key) return null;
  return {
    version: row.version,
    photo_url: `/api/character/reference-photo/preview?v=${encodeURIComponent(row.version)}`,
    status: "ready", summary: row.summary || "", width: row.width, height: row.height,
    created_at: Number(row.created_at),
  };
}

// Root routes pass only the authenticated player's ID. Raw photos are never
// included in /me, staff lists, character cards, generated avatars or public URLs.
export function createCharacterPhotoService({ db, mediaConfig, now = Date.now }) {
  let activeUploads = 0;
  const row = (playerId) => db.prepare("SELECT * FROM character_photos WHERE player_id=?").get(ownerId(playerId));
  const requireStorage = () => {
    if (!isCharacterMediaStorageConfigured(mediaConfig))
      throw new CharacterPhotoError("参考照片云存储尚未配置，请联系GM", 503);
  };
  const versionMatches = (actual, expected) => (actual?.version || null) === (expected?.version || null);
  const current = async (playerId) => publicMetadata(await row(playerId));
  const read = async (playerId, expectedVersion) => {
    const before = await row(playerId);
    if (!publicMetadata(before)) throw new CharacterPhotoError("未保存参考照片", 404);
    if (expectedVersion !== undefined && expectedVersion !== before.version)
      throw new CharacterPhotoError("参考照片已更新，请刷新后重试", 409);
    requireStorage();
    let data;
    try { data = await readCharacterMedia(before.object_key, mediaConfig); }
    catch { throw new CharacterPhotoError("参考照片暂时无法读取，请稍后重试"); }
    if (!versionMatches(await row(playerId), before))
      throw new CharacterPhotoError("参考照片已更新或移除，请重新生成", 409);
    return { data, contentType: "image/webp", version: before.version };
  };
  return {
    current,
    read,
    async snapshot(playerId) {
      const value = await row(playerId);
      return { photo: publicMetadata(value), version: value?.version || null, updated_at: Number(value?.created_at || 0) };
    },
    async save(playerId, dataUrl) {
      ownerId(playerId);
      requireStorage();
      if (activeUploads >= 2) throw new CharacterPhotoError("照片处理繁忙，请稍后重试", 429);
      activeUploads++;
      try {
        const previous = await row(playerId);
        if (!(await db.prepare("SELECT id FROM players WHERE id=?").get(playerId)))
          throw new CharacterPhotoError("玩家不存在", 404);
        const image = await normalizeCharacterPhoto(dataUrl);
        const requestedAt = Number(now());
        await db.transaction(async () => {
          if (!versionMatches(await row(playerId), previous))
            throw new CharacterPhotoError("参考照片已被其他操作更新，请刷新后重试", 409);
          const count = await db.prepare("SELECT COUNT(*) n FROM character_photo_requests WHERE player_id=? AND created_at>?")
            .get(playerId, requestedAt - 3600000);
          if (Number(count.n) >= 10)
            throw new CharacterPhotoError("一小时内最多上传10次参考照片，请稍后再试", 429);
          await db.prepare("INSERT INTO character_photo_requests(id,player_id,created_at) VALUES(?,?,?)")
            .run(randomUUID(), playerId, requestedAt);
        });
        let stored;
        try {
          stored = await putCharacterMedia({ playerId, kind: "photo", data: image.data, contentType: image.contentType }, mediaConfig);
        } catch { throw new CharacterPhotoError("参考照片保存失败，请稍后重试"); }
        const version = randomUUID();
        await db.transaction(async () => {
          if (!versionMatches(await row(playerId), previous))
            throw new CharacterPhotoError("参考照片已被其他操作更新，请刷新后重试", 409);
          const createdAt = Math.max(Number(now()), Number(previous?.created_at || 0) + 1);
          await db.prepare(`INSERT INTO character_photos(player_id,object_key,version,status,summary,width,height,created_at)
            VALUES(?,?,?,'ready',NULL,?,?,?) ON CONFLICT(player_id) DO UPDATE SET
            object_key=excluded.object_key,version=excluded.version,status='ready',summary=NULL,
            width=excluded.width,height=excluded.height,created_at=excluded.created_at`)
            .run(playerId, stored.object_key, version, image.width, image.height, createdAt);
        });
        return current(playerId);
      } finally { activeUploads--; }
    },
    async remove(playerId, expectedVersion) {
      await db.transaction(async () => {
        const previous = await row(playerId);
        if (expectedVersion !== undefined && previous?.version !== expectedVersion)
          throw new CharacterPhotoError("参考照片已更新，请刷新后重试", 409);
        if (!(await db.prepare("SELECT id FROM players WHERE id=?").get(playerId)))
          throw new CharacterPhotoError("玩家不存在", 404);
        // Only clear the latest reference; shared/in-flight objects remain private.
        await db.prepare(`INSERT INTO character_photos(player_id,object_key,version,status,summary,width,height,created_at)
          VALUES(?,NULL,?,'removed',NULL,NULL,NULL,?) ON CONFLICT(player_id) DO UPDATE SET
          object_key=NULL,version=excluded.version,status='removed',summary=NULL,width=NULL,height=NULL,created_at=excluded.created_at`)
          .run(playerId, randomUUID(), Math.max(Number(now()), Number(previous?.created_at || 0) + 1));
      });
    },
    async generationReference(playerId) {
      if (!await current(playerId)) return null;
      const photo = await read(playerId);
      return { dataUrl: `data:image/webp;base64,${photo.data.toString("base64")}`, mimeType: photo.contentType, version: photo.version };
    },
  };
}
