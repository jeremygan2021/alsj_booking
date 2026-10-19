import { createOssDownloadUrl } from "./oss-download.js";
import { createHash, createHmac } from "node:crypto";
import manifest from "./asset-storage.json" with { type: "json" };

export const MAX_CHARACTER_MEDIA_BYTES = 5 * 1024 * 1024;

export class CharacterMediaStorageError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "CharacterMediaStorageError";
    this.status = status;
  }
}

export function characterMediaStorageConfig(options = {}) {
  const env = options.env ?? process.env;
  return {
    directDownload: options.directDownload ?? env.OSS_DIRECT_DOWNLOAD === "true",
    enabled: options.enabled ?? (env.OSS_MEDIA_ENABLED ?? env.OSS_ENABLED) === "true",
    bucket: options.bucket ?? env.OSS_BUCKET ?? manifest.bucket,
    endpoint: options.endpoint ?? env.OSS_ENDPOINT ?? manifest.endpoint,
    accessId: options.accessId ?? env.OSS_MEDIA_ACCESS_KEY_ID ?? env.OSS_ACCESS_KEY_ID ?? "",
    secret: options.secret ?? env.OSS_MEDIA_ACCESS_KEY_SECRET ?? env.OSS_ACCESS_KEY_SECRET ?? "",
    securityToken: options.securityToken ?? env.OSS_SECURITY_TOKEN ?? "",
    fetch: options.fetch ?? globalThis.fetch,
    timeoutMs: options.timeoutMs ?? 30000,
    now: options.now ?? (() => new Date()),
  };
}

const endpointHost = (value) => typeof value === "string"
  ? value.replace(/^https:\/\//, "").replace(/\/$/, "") : "";

export const isCharacterMediaStorageConfigured = (config) => Boolean(
  config?.enabled && config.accessId && config.secret &&
  /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.bucket) &&
  /^oss-[a-z0-9-]+\.aliyuncs\.com$/.test(endpointHost(config.endpoint)) &&
  typeof config.fetch === "function",
);

const types = new Map([
  ["audio/mpeg", { type: "audio/mpeg", extension: "mp3" }],
  ["audio/mp3", { type: "audio/mpeg", extension: "mp3" }],
  ["audio/mp4", { type: "audio/mp4", extension: "m4a" }],
  ["audio/x-m4a", { type: "audio/mp4", extension: "m4a" }],
  ["audio/webm", { type: "audio/webm", extension: "webm" }],
  ["audio/ogg", { type: "audio/ogg", extension: "ogg" }],
  ["audio/wav", { type: "audio/wav", extension: "wav" }],
  ["audio/x-wav", { type: "audio/wav", extension: "wav" }],
  ["audio/aac", { type: "audio/aac", extension: "aac" }],
  ["image/webp", { type: "image/webp", extension: "webp" }],
]);
const objectPattern = /^alsj\/characters\/v1\/[a-f0-9]{64}\/(?:(?:intro|recording)\/([a-f0-9]{64})\.(?:mp3|m4a|webm|ogg|wav|aac)|photo\/([a-f0-9]{64})\.webp)$/;

function requireConfig(config) {
  if (!isCharacterMediaStorageConfigured(config))
    throw new CharacterMediaStorageError("角色音频云存储尚未配置，请联系GM", 503);
  if (!Number.isFinite(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > 120000)
    throw new CharacterMediaStorageError("角色音频云存储配置无效，请联系GM", 503);
}

function signedHeaders(method, key, config, headers) {
  let date;
  try { date = config.now().toUTCString(); }
  catch { throw new CharacterMediaStorageError("角色音频云存储配置无效，请联系GM", 503); }
  if (date === "Invalid Date")
    throw new CharacterMediaStorageError("角色音频云存储配置无效，请联系GM", 503);
  const result = { ...headers, Date: date };
  if (config.securityToken) result["x-oss-security-token"] = config.securityToken;
  const canonicalHeaders = Object.entries(result)
    .filter(([name]) => name.toLowerCase().startsWith("x-oss-"))
    .map(([name, value]) => [name.toLowerCase(), String(value).trim()])
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([name, value]) => `${name}:${value}\n`).join("");
  const canonical = `${method}\n${result["Content-MD5"] || ""}\n${result["Content-Type"] || ""}\n${date}\n${canonicalHeaders}/${config.bucket}/${key}`;
  const signature = createHmac("sha1", config.secret).update(canonical).digest("base64");
  result.Authorization = `OSS ${config.accessId}:${signature}`;
  return result;
}

async function request(method, key, config, headers = {}, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await config.fetch(`https://${config.bucket}.${endpointHost(config.endpoint)}/${key}`, {
      method, headers: signedHeaders(method, key, config, headers),
      ...(body ? { body } : {}), redirect: "error", signal: controller.signal,
    });
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => {});
      throw new CharacterMediaStorageError(`角色音频云存储请求失败（HTTP ${Number(response.status) || "未知"}），请稍后重试`);
    }
    if (method === "PUT") {
      await response.body?.cancel().catch(() => {});
      return;
    }
    if (Number(response.headers?.get("content-length")) > MAX_CHARACTER_MEDIA_BYTES) {
      await response.body?.cancel().catch(() => {});
      throw new CharacterMediaStorageError("角色音频文件过大，请联系GM");
    }
    const chunks = [];
    let size = 0;
    if (response.body?.[Symbol.asyncIterator]) {
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > MAX_CHARACTER_MEDIA_BYTES)
          throw new CharacterMediaStorageError("角色音频文件过大，请联系GM");
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks, size);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_CHARACTER_MEDIA_BYTES)
      throw new CharacterMediaStorageError("角色音频文件过大，请联系GM");
    return bytes;
  } catch (error) {
    if (controller.signal.aborted)
      throw new CharacterMediaStorageError("角色音频云存储连接超时，请稍后重试");
    if (error instanceof CharacterMediaStorageError) throw error;
    // Never return provider XML, signed headers, endpoints or network errors.
    throw new CharacterMediaStorageError("角色音频云存储连接失败，请稍后重试");
  } finally { clearTimeout(timer); }
}

// Callers authorize the player before upload; only the owning DB row may retain
// the returned key. No filesystem copy or public/signed download URL is created.
export async function putCharacterMedia({ playerId, kind, data, contentType } = {}, config = characterMediaStorageConfig()) {
  requireConfig(config);
  const mediaType = typeof contentType === "string"
    ? types.get(contentType.split(";")[0].trim().toLowerCase()) : null;
  if (typeof playerId !== "string" || !playerId.trim() || playerId.length > 200 ||
      !["intro", "recording", "photo"].includes(kind) || !Buffer.isBuffer(data) ||
      !data.length || data.length > MAX_CHARACTER_MEDIA_BYTES || !mediaType ||
      (kind === "intro" && mediaType.type !== "audio/mpeg") ||
      (kind === "photo" ? mediaType.type !== "image/webp" : mediaType.type === "image/webp"))
    throw new CharacterMediaStorageError("角色音频格式无效或超过5MB", 400);
  const owner = createHmac("sha256", config.secret).update(playerId).digest("hex");
  const sha256 = createHash("sha256").update(data).digest("hex");
  const object_key = `alsj/characters/v1/${owner}/${kind}/${sha256}.${mediaType.extension}`;
  await request("PUT", object_key, config, {
    "Content-Type": mediaType.type,
    "Content-MD5": createHash("md5").update(data).digest("base64"),
    "x-oss-object-acl": "private",
    "x-oss-meta-sha256": sha256,
  }, data);
  return { object_key, content_type: mediaType.type, size: data.length };
}

// Root routes must resolve this exact key from an authenticated owner's row;
// never pass an object key supplied directly in a request query or path.
export async function readCharacterMedia(objectKey, config = characterMediaStorageConfig()) {
  requireConfig(config);
  const match = typeof objectKey === "string" && objectPattern.exec(objectKey);
  if (!match) throw new CharacterMediaStorageError("角色音频文件标识无效", 400);
  const bytes = await request("GET", objectKey, config);
  if (!bytes.length || createHash("sha256").update(bytes).digest("hex") !== (match[1] || match[2]))
    throw new CharacterMediaStorageError("角色音频文件校验失败，请联系GM");
  return bytes;
}

export function characterMediaDownloadUrl(objectKey, config = characterMediaStorageConfig(), method = "GET") {
  requireConfig(config);
  if (!objectPattern.test(objectKey || "")) throw new CharacterMediaStorageError("角色音频文件标识无效", 400);
  if (objectKey.includes("/photo/")) throw new CharacterMediaStorageError("参考照片仅可通过本人鉴权预览", 400);
  return createOssDownloadUrl({ ...config, key: objectKey, method, now: config.now().getTime() });
}
