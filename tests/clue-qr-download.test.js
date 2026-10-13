import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  buildStoredZip,
  createClueQrArchive,
  createClueQrPng,
  crc32,
  publicClueUrl,
} from "../src/clue-qr-download.js";
import { decodeQrPixels } from "../src/clue-scan.js";

function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  assert.equal(
    view.getUint32(end, true),
    0x06054b50,
    "has the standard ZIP end record",
  );
  const count = view.getUint16(end + 10, true);
  const centralStart = view.getUint32(end + 16, true);
  const files = new Map();
  let offset = 0;
  while (offset < centralStart) {
    assert.equal(view.getUint32(offset, true), 0x04034b50);
    assert.equal(
      view.getUint16(offset + 6, true),
      0x0800,
      "filenames are UTF-8",
    );
    assert.equal(
      view.getUint16(offset + 8, true),
      0,
      "uses the ZIP Store method",
    );
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const start = offset + 30 + nameLength;
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, start));
    const content = bytes.slice(start, start + size);
    assert.equal(crc32(content), view.getUint32(offset + 14, true));
    files.set(name, { content, localOffset: offset });
    offset = start + size;
  }
  assert.equal(files.size, count);
  let centralOffset = centralStart;
  for (const [name, file] of files) {
    assert.equal(view.getUint32(centralOffset, true), 0x02014b50);
    const nameLength = view.getUint16(centralOffset + 28, true);
    const centralName = new TextDecoder().decode(
      bytes.subarray(centralOffset + 46, centralOffset + 46 + nameLength),
    );
    assert.equal(centralName, name);
    assert.equal(view.getUint32(centralOffset + 42, true), file.localOffset);
    assert.equal(view.getUint32(centralOffset + 16, true), crc32(file.content));
    centralOffset += 46 + nameLength;
  }
  assert.equal(centralOffset, end);
  assert.equal(view.getUint32(end + 12, true), end - centralStart);
  return files;
}

async function decodePng(bytes) {
  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return decodeQrPixels({
    data: new Uint8ClampedArray(data),
    width: info.width,
    height: info.height,
  });
}

test("下载包包含每条可解码 PNG 和可打印公开清单，中文 ZIP 目录与 CRC 正确", async () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  const origin = "https://alsj.luna.ski";
  const clues = [
    {
      id: "E-01",
      title: "断裂的怀表",
      area: "主厅",
      body: "PRIVATE_BODY",
      detail: "PRIVATE_DETAIL",
      dc: 9191,
      secret: "PRIVATE_SECRET",
    },
    {
      id: "E-02",
      title: '<script>alert("现场")</script> / 第 #2 项',
      area: "大厅 & 阁楼",
      body: "PRIVATE_BODY",
      detail: "PRIVATE_DETAIL",
    },
    {
      id: "线索 / 03?&",
      title: "银色钥匙🗝️",
      area: "A\\B",
      body: "PRIVATE_BODY",
      detail: "PRIVATE_DETAIL",
    },
  ];
  const progress = [];
  const download = await createClueQrArchive(clues, origin, (complete, total) =>
    progress.push([complete, total]),
  );
  assert.equal(download.contentType, "application/zip");
  assert.ok(download.filename.endsWith(".zip"));
  assert.deepEqual(progress, [
    [1, 3],
    [2, 3],
    [3, 3],
  ]);
  const files = readZip(download.bytes);
  assert.equal(files.size, clues.length + 1);
  const html = new TextDecoder().decode(files.get("index.html").content);
  assert.equal(
    (html.match(/<article class="clue">/g) || []).length,
    clues.length,
  );
  assert.equal((html.match(/<img /g) || []).length, clues.length);
  assert.ok(html.includes("window.print()"));
  assert.ok(html.includes("@media print"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("大厅 &amp; 阁楼"));
  assert.ok(!html.includes("<script>"));
  for (const privateValue of [
    "PRIVATE_BODY",
    "PRIVATE_DETAIL",
    "PRIVATE_SECRET",
    "9191",
  ]) {
    assert.ok(!html.includes(privateValue), `does not include ${privateValue}`);
  }
  const images = [...files].filter(([name]) => name.endsWith(".png"));
  for (let index = 0; index < clues.length; index++) {
    const [name, file] = images[index];
    assert.match(name, /^二维码\/\d+_证据_[^\\/:*?"<>|]+\.png$/);
    const path = name.split("/").map(encodeURIComponent).join("/");
    assert.ok(
      html.includes(`src="${path}"`),
      "print sheet references the exact filename, including # and emoji",
    );
    const expected = `${origin}/ar?clue=${encodeURIComponent(clues[index].id)}`;
    assert.equal(await decodePng(file.content), expected);
    assert.ok(html.includes(`href="${expected}"`));
  }
  const single = await createClueQrPng(clues[0], origin);
  assert.equal(single.contentType, "image/png");
  assert.equal(await decodePng(single.bytes), `${origin}/ar?clue=E-01`);
});

test("二维码使用访问网站的公开 AR 入口，空列表与无编号不产生坏下载", async () => {
  assert.equal(
    publicClueUrl("E-01 &/", "https://example.com:8443"),
    "https://example.com:8443/ar?clue=E-01%20%26%2F",
  );
  assert.throws(() => publicClueUrl("E-01", "file:///example"), /活动网站/);
  assert.throws(() => publicClueUrl("", "https://example.com"), /缺少编号/);
  await assert.rejects(createClueQrArchive([], "https://example.com"), /暂无/);
  assert.equal(readZip(buildStoredZip([])).size, 0);
});
