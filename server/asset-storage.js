import { createOssDownloadUrl, redirectOssDownload } from "./oss-download.js";
import { createHash, createHmac } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const verified = new Map();
let manifestPromise;

export function ossReadHeaders({ accessId, secret, bucket, key, method = 'GET', date = new Date().toUTCString() }) {
  const canonical = `${method}\n\n\n${date}\n/${bucket}/${key}`;
  const signature = createHmac('sha1', secret).update(canonical).digest('base64');
  return { Date: date, Authorization: `OSS ${accessId}:${signature}` };
}

// Called only after existing route authorization; object names come from
// a checksum-verified manifest. The AccessKey secret never leaves the server.
export async function sendStoredAsset(res, file, { env = process.env, fetcher = fetch, manifest: suppliedManifest } = {}) {
  const local = () => {
    res.set('X-Asset-Storage', 'local');
    return res.sendFile(file);
  };
  if (env.OSS_ENABLED !== 'true' || !env.OSS_ACCESS_KEY_ID || !env.OSS_ACCESS_KEY_SECRET) return local();
  let upstream;
  try {
    const manifest = suppliedManifest || await (manifestPromise ||= readFile(new URL('./asset-storage.json', import.meta.url), 'utf8').then(JSON.parse));
    const entry = manifest.assets?.[path.relative(root, file).split(path.sep).join('/').replace(/^dist\/ar-assets\//, 'public/ar-assets/')];
    if (!entry || !/^[a-f0-9]{64}$/.test(entry.sha256) || entry.key !== `alsj/assets/v1/${entry.sha256}${path.extname(file)}` || !/^[a-z0-9][a-z0-9-]+$/.test(manifest.bucket) || !/^oss-[a-z0-9-]+\.aliyuncs\.com$/.test(manifest.endpoint)) return local();
    const info = await stat(file);
    const cached = verified.get(file);
    if (!cached || cached.mtime !== info.mtimeMs || cached.size !== info.size) {
      if (info.size !== entry.bytes || createHash('sha256').update(await readFile(file)).digest('hex') !== entry.sha256) return local();
      verified.set(file, { mtime: info.mtimeMs, size: info.size, sha256: entry.sha256 });
    } else if (cached.sha256 !== entry.sha256) return local();
    const method = res.req.method === 'HEAD' ? 'HEAD' : 'GET';
    if (env.OSS_DIRECT_DOWNLOAD === 'true') {
      return redirectOssDownload(res, createOssDownloadUrl({
        bucket: manifest.bucket, endpoint: manifest.endpoint,
        accessId: env.OSS_ACCESS_KEY_ID, secret: env.OSS_ACCESS_KEY_SECRET,
        key: entry.key, method,
      }));
    }
    const headers = ossReadHeaders({ accessId: env.OSS_ACCESS_KEY_ID, secret: env.OSS_ACCESS_KEY_SECRET, bucket: manifest.bucket, key: entry.key, method });
    for (const name of ['range', 'if-range', 'if-none-match', 'if-modified-since']) {
      if (res.req.headers[name]) headers[name] = res.req.headers[name];
    }
    upstream = await fetcher(`https://${manifest.bucket}.${manifest.endpoint}/${entry.key}`, { method, headers, redirect: 'error', signal: AbortSignal.timeout(60000) });
    if (![200, 206, 304, 416].includes(upstream.status)) {
      await upstream.body?.cancel();
      return local();
    }
  } catch {
    // A storage outage keeps the event playable using the original local copy.
    return local();
  }
  res.status(upstream.status).set('X-Asset-Storage', 'oss');
  for (const name of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const value = upstream.headers.get(name);
    if (value) res.set(name, value);
  }
  if (res.req.method === 'HEAD' || upstream.status === 304 || !upstream.body) return res.end();
  try {
    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch {
    res.destroy();
  }
}
