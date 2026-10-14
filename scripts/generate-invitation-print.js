import { mkdir, writeFile } from "node:fs/promises";
import QRCode from "qrcode";
import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dir = path.join(root, "交付包_阿拉斯加之夜/打印物料/AR邀请函");
await mkdir(dir, { recursive: true });
const url = "https://alsj.luna.ski/ar?node=AR-INV&camera=1";
const qr = await QRCode.toBuffer(url, {
  width: 960,
  margin: 4,
  errorCorrectionLevel: "M",
  color: { dark: "#122923", light: "#ffffff" },
});
await writeFile(path.join(dir, "AR邀请函_纯二维码.png"), qr);
const poster = await sharp(
  path.join(root, "public/invitation/alaska-poster.jpg"),
)
  .resize(2823, 5016)
  .toBuffer();
const posterQR = await sharp(qr)
  .resize(333, 333, { kernel: "nearest" })
  .toBuffer();
const caption = Buffer.from(
  '<svg width="360" height="90"><rect width="360" height="90" fill="#f9f7f1"/><text x="180" y="48" text-anchor="middle" font-family="serif" font-size="39" fill="#182e26">AR邀请函</text><text x="180" y="79" text-anchor="middle" font-family="serif" font-size="24" fill="#69543a">扫码启封 · 接受邀请</text></svg>',
);
await sharp(poster)
  .composite([
    { input: posterQR, left: 2385, top: 4485 },
    { input: caption, left: 2373, top: 4824 },
  ])
  .png()
  .toFile(path.join(dir, "活动海报_AR邀请函二维码.png"));
const frame = Buffer.from(
  `<svg width="1400" height="2200"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#102a2a"/><stop offset="1" stop-color="#091821"/></linearGradient></defs><rect width="1400" height="2200" fill="url(#bg)"/><rect x="50" y="50" width="1300" height="2100" rx="24" fill="none" stroke="#c9a96a" stroke-width="3"/><rect x="70" y="70" width="1260" height="2060" rx="20" fill="none" stroke="#806d49"/><g text-anchor="middle"><text x="700" y="128" fill="#d6ba7b" font-size="24" letter-spacing="8" font-family="Georgia">THE THORNE ESTATE</text><text x="700" y="201" fill="#f4e8cd" font-size="59" font-family="serif">极光之夜 · 庄园邀请</text><text x="700" y="1665" fill="#f2dfb2" font-size="39" font-family="serif">2026年10月31日 · 邀请有效</text><text x="700" y="1728" fill="#c3d4c9" font-size="27" font-family="serif">扫码打开相机，再对准此码启封邀请函</text><text x="700" y="2150" fill="#e2c894" font-size="24" font-family="serif">轻触蜡封 · 欣赏海报 · 接受邀请</text></g></svg>`,
);
const inset = await sharp(poster).resize(720, 1280).toBuffer();
const cardQR = await sharp(qr)
  .resize(340, 340, { kernel: "nearest" })
  .toBuffer();
await sharp(frame)
  .composite([
    { input: inset, left: 340, top: 260 },
    { input: cardQR, left: 530, top: 1770 },
  ])
  .png()
  .toFile(path.join(dir, "黑金庄园邀请函_打印卡.png"));
await writeFile(path.join(dir, "邀请函链接.txt"), url + "\n");
await writeFile(
  path.join(dir, "打印说明.md"),
  `# AR邀请函\n\n链接：${url}\n\n- 扫码后自动进入相机搜证，按浏览器提示授权；若被浏览器限制，点击重试。\n- 镜头再次对准二维码，轻触蜡封或“启封庄园之邀”，观看信封展开、海报升起、极光、飘雪、渡鸦和钥匙动画。\n- 3D“接受邀请”按钮自动保持画面上方并面向镜头，避免遮挡邀请函；点击进入手机号注册／登录。\n- 邀请有效期截至2026年10月31日23:59:59（北京时间），本函为公开活动邀请，入场以报名确认为准。\n- 纯二维码适合单独贴牌，海报版使用原海报右下角位置，黑金打印卡采用较大二维码，便于AR识别。\n- 不要裁掉二维码白边；推荐黑金卡A4打印。\n`,
);
await writeFile(
  path.join(dir, "A4打印.html"),
  `<!doctype html><html lang="zh"><meta charset="utf-8"><title>AR庄园邀请函打印</title><style>@page{size:A4;margin:10mm}body{margin:0;background:#ecebe5}.sheet{width:190mm;height:277mm;display:flex;align-items:center;justify-content:center;background:white;break-after:page;margin:auto}.sheet img{max-width:100%;max-height:100%;object-fit:contain}@media print{body{background:white}}</style><section class="sheet"><img src="黑金庄园邀请函_打印卡.png"></section><section class="sheet"><img src="活动海报_AR邀请函二维码.png"></section></html>`,
);
console.log(dir);
