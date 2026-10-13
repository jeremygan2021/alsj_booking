import QRCode from "qrcode";

const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

export function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes)
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

/** Small, UTF-8 ZIP writer using the standard uncompressed Store method. */
export function buildStoredZip(files, date = new Date()) {
  if (files.length > 0xffff) throw new Error("二维码数量超出下载上限");
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  const dosDate =
    ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    (date.getSeconds() >> 1);
  const entries = files.map((file) => {
    const name = encoder.encode(file.name);
    const bytes =
      file.bytes instanceof Uint8Array
        ? file.bytes
        : encoder.encode(file.bytes);
    if (name.length > 0xffff || bytes.length > 0xffffffff)
      throw new Error("二维码文件过大，暂时无法下载");
    return { name, bytes, checksum: crc32(bytes) };
  });
  const localSize = entries.reduce(
    (size, entry) => size + 30 + entry.name.length + entry.bytes.length,
    0,
  );
  const centralSize = entries.reduce(
    (size, entry) => size + 46 + entry.name.length,
    0,
  );
  const totalSize = localSize + centralSize + 22;
  if (totalSize > 0xffffffff) throw new Error("二维码压缩包过大，暂时无法下载");
  const result = new Uint8Array(totalSize);
  const view = new DataView(result.buffer);
  let localOffset = 0;
  let centralOffset = localSize;
  for (const entry of entries) {
    view.setUint32(localOffset, 0x04034b50, true);
    view.setUint16(localOffset + 4, 20, true);
    view.setUint16(localOffset + 6, 0x0800, true);
    view.setUint16(localOffset + 8, 0, true);
    view.setUint16(localOffset + 10, dosTime, true);
    view.setUint16(localOffset + 12, dosDate, true);
    view.setUint32(localOffset + 14, entry.checksum, true);
    view.setUint32(localOffset + 18, entry.bytes.length, true);
    view.setUint32(localOffset + 22, entry.bytes.length, true);
    view.setUint16(localOffset + 26, entry.name.length, true);
    result.set(entry.name, localOffset + 30);
    result.set(entry.bytes, localOffset + 30 + entry.name.length);

    view.setUint32(centralOffset, 0x02014b50, true);
    view.setUint16(centralOffset + 4, 20, true);
    view.setUint16(centralOffset + 6, 20, true);
    view.setUint16(centralOffset + 8, 0x0800, true);
    view.setUint16(centralOffset + 10, 0, true);
    view.setUint16(centralOffset + 12, dosTime, true);
    view.setUint16(centralOffset + 14, dosDate, true);
    view.setUint32(centralOffset + 16, entry.checksum, true);
    view.setUint32(centralOffset + 20, entry.bytes.length, true);
    view.setUint32(centralOffset + 24, entry.bytes.length, true);
    view.setUint16(centralOffset + 28, entry.name.length, true);
    view.setUint32(centralOffset + 42, localOffset, true);
    result.set(entry.name, centralOffset + 46);
    localOffset += 30 + entry.name.length + entry.bytes.length;
    centralOffset += 46 + entry.name.length;
  }
  view.setUint32(centralOffset, 0x06054b50, true);
  view.setUint16(centralOffset + 8, entries.length, true);
  view.setUint16(centralOffset + 10, entries.length, true);
  view.setUint32(centralOffset + 12, centralSize, true);
  view.setUint32(centralOffset + 16, localSize, true);
  return result;
}

export function publicClueUrl(id, origin) {
  const site = new URL(origin);
  if (!["http:", "https:"].includes(site.protocol))
    throw new Error("请在活动网站下载二维码");
  if (id == null || String(id).trim() === "")
    throw new Error("这条证据缺少编号，无法生成二维码");
  return `${site.origin}/ar?clue=${encodeURIComponent(String(id))}`;
}

const filePart = (value) =>
  Array.from(
    String(value || "")
      .normalize("NFKC")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/[. ]+$/g, ""),
  )
    .slice(0, 70)
    .join("");

function qrFilename(clue) {
  return `证据_${[clue.id, clue.title, clue.area].map(filePart).filter(Boolean).join("_")}.png`;
}

function decodeDataUrl(dataUrl) {
  const binary = globalThis.atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function createClueQrPng(clue, origin) {
  const url = publicClueUrl(clue.id, origin);
  const dataUrl = await QRCode.toDataURL(url, {
    type: "image/png",
    width: 640,
    margin: 4,
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#ffffff" },
  });
  return {
    bytes: decodeDataUrl(dataUrl),
    filename: qrFilename(clue),
    contentType: "image/png",
    url,
  };
}

const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );

function printableIndex(clues) {
  const cards = clues
    .map(
      (clue) => `<article class="clue">
      <div class="metadata"><strong>${escapeHtml(clue.id)}</strong><span>${escapeHtml(clue.area)}</span></div>
      <h2>${escapeHtml(clue.title)}</h2>
      <a href="${escapeHtml(clue.url)}"><img src="${escapeHtml(clue.path.split("/").map(encodeURIComponent).join("/"))}" alt="${escapeHtml(clue.id)} 搜证二维码" width="640" height="640"></a>
      <p>扫码进入 AR 搜证 · 无需登录</p>
    </article>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>阿拉斯加之夜 · 现场证据二维码</title>
<style>
  *{box-sizing:border-box}body{font-family:"Microsoft YaHei","PingFang SC",sans-serif;color:#18201c;background:#f7f6f1;margin:0;padding:24px}
  header{max-width:960px;margin:0 auto 24px}h1{font-size:24px;margin:0 0 10px}header p{font-size:14px;line-height:1.7;color:#58665d}button{font:inherit;border:0;border-radius:6px;background:#253c31;color:white;padding:12px 20px;cursor:pointer}
  main{max-width:960px;margin:auto;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.clue{background:white;border:1px solid #bdb6a1;padding:18px;text-align:center;break-inside:avoid;page-break-inside:avoid}.metadata{display:flex;justify-content:space-between;gap:8px;text-align:left;font-size:12px;overflow-wrap:anywhere}h2{font-size:17px;line-height:1.5;min-height:2.9em;margin:14px 0 4px;overflow-wrap:anywhere}img{display:block;width:100%;max-width:230px;height:auto;margin:auto}.clue p{font-size:11px;margin:8px 0 0;color:#58665d}
  @media(max-width:650px){main{grid-template-columns:repeat(2,minmax(0,1fr))}.clue{padding:12px}h2{font-size:14px}}
  @page{size:A4;margin:12mm}@media print{body{background:white;padding:0}header{margin-bottom:6mm}h1{font-size:16pt}header p,button{display:none}main{max-width:none;grid-template-columns:repeat(3,minmax(0,1fr));gap:4mm}.clue{padding:3mm;border-color:#aaa}h2{font-size:10pt;margin:3mm 0 0}.metadata{font-size:8pt}img{width:43mm;max-width:100%}.clue p{font-size:7pt;margin:1mm 0 0}a{color:inherit;text-decoration:none}}
</style></head><body><header><h1>阿拉斯加之夜 · 现场证据二维码</h1><p>共 ${clues.length} 条证据。解压后在浏览器打开本文件，打印即可布置现场。二维码旁仅显示编号、标题与地点。</p><button type="button" onclick="window.print()">打印全部二维码</button></header><main>${cards}</main></body></html>`;
}

export async function createClueQrArchive(clues, origin, onProgress) {
  if (!Array.isArray(clues) || !clues.length)
    throw new Error("暂无可下载的证据二维码");
  const files = [];
  const publicClues = [];
  const digits = String(clues.length).length;
  for (let index = 0; index < clues.length; index++) {
    const clue = clues[index];
    const png = await createClueQrPng(clue, origin);
    const path = `二维码/${String(index + 1).padStart(digits, "0")}_${png.filename}`;
    files.push({ name: path, bytes: png.bytes });
    publicClues.push({
      id: clue.id,
      title: clue.title,
      area: clue.area,
      url: png.url,
      path,
    });
    onProgress?.(index + 1, clues.length);
    // Let the admin progress indicator paint while generating a larger bundle.
    if (typeof window !== "undefined") {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  files.unshift({
    name: "index.html",
    bytes: encoder.encode(printableIndex(publicClues)),
  });
  return {
    bytes: buildStoredZip(files),
    filename: "阿拉斯加之夜_全部证据二维码.zip",
    contentType: "application/zip",
  };
}

export function saveClueQrDownload({ bytes, filename, contentType }) {
  const blob = new Blob([bytes], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
