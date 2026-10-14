import { mkdir, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import sharp from "sharp";
import jsQR from "jsqr";
import materials from "../server/story-materials.json" with { type: "json" };
import { evidence } from "../server/content.js";
import { publicInvestigationNodes } from "../server/public-investigation.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "交付包_阿拉斯加之夜", "打印物料");
const origin = new URL(process.argv[2] || "https://alsj.luna.ski").origin;
const qrdir = path.join(output, "单张二维码");
const cardsdir = path.join(output, "单张标牌");
await mkdir(qrdir, { recursive: true });
await mkdir(cardsdir, { recursive: true });
const escape = (x) =>
  String(x).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const byClue = new Map(materials.evidence.map((e) => [e.clueId, e]));
const list = evidence.map((row) => ({
  id: row[0],
  title: row[1],
  area: row[2],
  sourceId: byClue.get(row[0])?.id || "拍卖排除线索",
  phase: byClue.get(row[0])?.phase || 3,
  type: "证据",
  url: `${origin}/ar?clue=${row[0]}`,
}));
list.push(
  ...publicInvestigationNodes.map((n) => ({
    id: n.id,
    title: n.title,
    area: n.area,
    sourceId: n.id,
    phase: 3,
    type: "验尸节点",
    url: `${origin}/ar?node=${n.id}`,
  })),
);
for (const item of list) {
  const filename = `${item.id}_${item.title.replace(/[<>:"/\\|?*]/g, "_")}.png`;
  const data = await QRCode.toBuffer(item.url, {
    width: 640,
    margin: 4,
    errorCorrectionLevel: "M",
  });
  // Decode the real exported PNG, rather than trusting the requested URL alone.
  const decoded = await sharp(data)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const qr = jsQR(
    new Uint8ClampedArray(decoded.data),
    decoded.info.width,
    decoded.info.height,
    { inversionAttempts: "attemptBoth" },
  );
  if (qr?.data !== item.url)
    throw new Error(`QR verification failed: ${item.id}`);
  await writeFile(path.join(qrdir, filename), data);
  item.path = `单张二维码/${filename}`;
  const title = Array.from(item.title);
  const lines = [title.slice(0, 16).join(""), title.slice(16).join("")].filter(
    Boolean,
  );
  const panel = Buffer.from(
    `<svg width="1000" height="1280"><rect width="1000" height="1280" fill="white"/><rect x="24" y="24" width="952" height="1232" rx="12" fill="none" stroke="#253f50" stroke-width="4"/><text x="500" y="95" text-anchor="middle" font-family="sans-serif" font-size="32" fill="#425463">阿拉斯加之夜 · 最后的遗嘱</text><text x="500" y="185" text-anchor="middle" font-family="sans-serif" font-size="54" font-weight="bold">${escape(item.id)}</text>${lines.map((t, i) => `<text x="500" y="${260 + i * 55}" text-anchor="middle" font-family="sans-serif" font-size="42">${escape(t)}</text>`).join("")}<text x="500" y="1060" text-anchor="middle" font-family="sans-serif" font-size="29">${escape(item.area)} · ${item.phase === 4 ? "终局使用" : "调查阶段"}</text><text x="500" y="1110" text-anchor="middle" font-family="sans-serif" font-size="26">扫码查看3D证物与现场记录</text><text x="500" y="1170" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#61717c">alsj.luna.ski · 剧情活动物料</text></svg>`,
  );
  await sharp(panel)
    .composite([{ input: data, left: 180, top: 365 }])
    .png()
    .toFile(path.join(cardsdir, filename));
  item.cardPath = `单张标牌/${filename}`;
}
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>线索与验尸节点二维码打印</title><style>body{font:16px/1.6 "PingFang SC",sans-serif;background:#f3f6f8;color:#172a38;margin:0;padding:20px}header{max-width:900px;margin:auto}button{padding:12px;background:#203d50;color:white;border:0;font:inherit}.group{max-width:900px;margin:20px auto;display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.card{background:white;border:1px dashed #9aa7ae;text-align:center;padding:15px;break-inside:avoid}.code{display:flex;justify-content:space-between;font-size:12px}.card h2{font-size:19px;margin:12px 0;min-height:30px}.card img{width:180px;height:180px}.card p{font-size:13px;margin:5px 0}.link{font-size:10px;color:#667680;overflow-wrap:anywhere}@page{size:A4;margin:12mm}@media print{body{background:white;padding:0}header{margin:0 0 4mm}header h1{font-size:14pt;margin:0}header p,button{display:none}.group{gap:3mm;margin:4mm 0;grid-template-columns:repeat(2,1fr)}.node-group{break-before:page}.card{padding:3mm;height:75mm;box-sizing:border-box}.card h2{font-size:11pt;margin:2mm 0;min-height:0}.card img{width:43mm;height:43mm}.card p{font-size:8pt}.code{font-size:8pt}.link{font-size:6pt}}</style><header><h1>阿拉斯加之夜 · 二维码打印物料</h1><p>26条证据、6个验尸节点；线上地址 ${origin}。终局遗言标牌由GM留存，按活动流程发放。页面不包含演员秘密或完整真相。</p><button onclick="window.print()">打印A4裁切页</button></header>${[
  "证据",
  "验尸节点",
]
  .map(
    (type) =>
      `<main class="group ${type === "验尸节点" ? "node-group" : ""}">${list
        .filter((x) => x.type === type)
        .map(
          (x) =>
            `<section class="card"><div class="code"><b>${x.id}</b><span>${escape(x.sourceId)}</span></div><h2>${escape(x.title)}</h2><img src="${escape(x.path)}" alt="${x.id}二维码"><p>${escape(x.area)} · ${x.phase === 4 ? "终局使用" : "调查阶段"}</p><p>扫码查看3D证物与现场记录</p><div class="link">${escape(x.url)}</div></section>`,
        )
        .join("")}</main>`,
  )
  .join("")}</html>`;
await writeFile(path.join(output, "二维码打印总表.html"), html);
await writeFile(
  path.join(output, "二维码清单.json"),
  JSON.stringify({ origin, verifiedCount: list.length, items: list }, null, 2),
);
const csv = [
  ["类型", "编号", "原稿编号", "标题", "地点", "阶段", "二维码地址", "PNG路径"],
  ...list.map((x) => [
    x.type,
    x.id,
    x.sourceId,
    x.title,
    x.area,
    x.phase,
    x.url,
    x.path,
  ]),
]
  .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
  .join("\r\n");
await writeFile(path.join(output, "二维码清单.csv"), "\ufeff" + csv);
await copyFile(
  path.join(root, "output/models/story/模型总览.jpg"),
  path.join(output, "3D模型总览.jpg"),
);
await writeFile(
  path.join(output, "打印说明.md"),
  `# 二维码打印说明\n\n共32个二维码：26条代码证据（含25条原稿证据及原拍卖排除线索）和6个AR验尸节点。\n\n- 全部二维码指向 ${origin} ，已逐张解码核对。\n- 单张二维码目录为纯二维码PNG；单张标牌目录为带标题的1000×1280 PNG。\n- 打开二维码打印总表.html可直接A4打印；PDF为固定裁切布局。\n- 建议原尺寸打印，二维码周围保留白边；每个调查点一块标牌。\n- E-26/EV-025为终局遗言，GM按终局流程发放。\n- 二维码页显示基础记录；模型外观不含演员秘密，鉴定和完整推理依照游戏权限与主持流程。\n`,
);
console.log(
  `Generated and decoded ${list.length} verified QR codes in ${output}`,
);
