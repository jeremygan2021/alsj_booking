import { createHmac } from "node:crypto";

export const OSS_DOWNLOAD_TTL_SECONDS = 7 * 24 * 60 * 60;

// Only call after route authorization and resolving a trusted manifest/DB key.
export function createOssDownloadUrl({ bucket, endpoint, accessId, secret, key, method = "GET", now = Date.now() }) {
  const host = String(endpoint || "").replace(/^https:\/\//, "").replace(/\/$/, "");
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket || "") ||
      !/^oss-[a-z0-9-]+\.aliyuncs\.com$/.test(host) ||
      !accessId || !secret || !["GET", "HEAD"].includes(method) ||
      !/^alsj\/(?:assets\/v1\/[a-f0-9]{64}\.(?:mp3|glb)|characters\/v1\/[a-f0-9]{64}\/(?:intro|recording)\/[a-f0-9]{64}\.(?:mp3|wav|m4a|webm|ogg|aac))$/.test(key || "") ||
      !Number.isFinite(now)) throw new Error("OSS下载配置或资源标识无效");
  // Stable within each minute, so repeated access can reuse browser validation.
  const expires = Math.floor(now / 60000) * 60 + OSS_DOWNLOAD_TTL_SECONDS;
  const signature = createHmac("sha1", secret)
    .update(`${method}\n\n\n${expires}\n/${bucket}/${key}`).digest("base64");
  const url = new URL(`https://${bucket}.${host}/${key}`);
  url.search = new URLSearchParams({ OSSAccessKeyId: accessId, Expires: String(expires), Signature: signature }).toString();
  return url.href;
}

export function redirectOssDownload(res, url) {
  // Authorization always runs again at the original API URL. The signed link
  // itself remains usable for seven days, including subsequent audio ranges.
  res.set({ "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Asset-Storage": "oss-direct" });
  res.removeHeader("Content-Disposition");
  return res.redirect(307, url);
}
