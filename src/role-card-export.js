import QRCode from "qrcode";

export const CARD_WIDTH = 2480;
export const CARD_HEIGHT = 1754;
const serif = '"Noto Serif SC", "Noto Serif CJK SC", "Songti SC", serif';
const sans = '"PingFang SC", "Microsoft Yahei", "Noto Sans CJK SC", sans-serif';
const display = '"Cormorant Garamond", Georgia, serif';
const palette = {
  ink: "#14231e",
  gold: "#c3a170",
  paper: "#f2ebdf",
  muted: "#7b8175",
};
let fontReady;
export function roleCardsUrl(ids = []) {
  return (
    "/role-cards" +
    (ids.length ? "?players=" + encodeURIComponent(ids.join(",")) : "")
  );
}
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("角色头像加载失败，请刷新后重试"));
    img.src = src;
  });
}
function wrap(ctx, value, width) {
  const lines = [];
  for (const paragraph of String(value || "")
    .split(/\r?\n/)
    .filter(Boolean)) {
    let line = "";
    for (const ch of Array.from(paragraph)) {
      if (line && ctx.measureText(line + ch).width > width) {
        let carry = "";
        if (
          /[，。！？、；：）》」』”’]/.test(ch) ||
          /[（《「『“‘]$/.test(line)
        ) {
          const chars = Array.from(line);
          carry = chars.pop() || "";
          line = chars.join("");
        }
        lines.push(line);
        line = carry;
      }
      line += ch;
    }
    if (line) lines.push(line);
  }
  return lines;
}
function painter(background) {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  ctx.scale(CARD_WIDTH / 1400, CARD_HEIGHT / 990);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, 1400, 990);
  const text = (
    value,
    x,
    y,
    size = 24,
    color = palette.ink,
    font = sans,
    weight = 400,
  ) => {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.fillText(String(value || ""), x, y);
  };
  const fit = (
    value,
    x,
    y,
    width,
    size = 40,
    color = palette.ink,
    font = serif,
  ) => {
    let s = size;
    const v = String(value || "");
    while (s > 18) {
      ctx.font = `500 ${s}px ${font}`;
      if (ctx.measureText(v).width <= width) break;
      s--;
    }
    let line = v;
    if (ctx.measureText(line).width > width) {
      while (line && ctx.measureText(line + "…").width > width)
        line = Array.from(line).slice(0, -1).join("");
      line += "…";
    }
    text(line, x, y, s, color, font, 500);
  };
  const paragraph = (
    value,
    x,
    y,
    width,
    maxLines,
    size = 28,
    color = palette.ink,
    height = 46,
  ) => {
    ctx.font = `400 ${size}px ${sans}`;
    wrap(ctx, value, width)
      .slice(0, maxLines)
      .forEach((line, i) => text(line, x, y + i * height, size, color));
  };
  const rule = (x, y, w, color = palette.gold) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.stroke();
  };
  const frame = (color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(32, 32, 1336, 926);
    for (const [x, y, dx, dy] of [
      [47, 47, 1, 1],
      [1353, 47, -1, 1],
      [47, 943, 1, -1],
      [1353, 943, -1, -1],
    ]) {
      ctx.beginPath();
      ctx.moveTo(x, y + dy * 20);
      ctx.lineTo(x, y);
      ctx.lineTo(x + dx * 20, y);
      ctx.stroke();
    }
  };
  const finish = () => {
    const result = {
      png: canvas.toDataURL("image/png"),
      jpeg: canvas.toDataURL("image/jpeg", 0.97),
    };
    canvas.width = canvas.height = 0;
    return result;
  };
  return { ctx, text, fit, paragraph, rule, frame, finish };
}

export async function renderRoleCard(card, origin = location.origin) {
  const url =
    card.character.avatar_url && new URL(card.character.avatar_url, origin);
  if (url && url.origin !== origin) throw new Error("角色头像须使用本站图片");
  fontReady ??= Promise.race([
    Promise.all([
      document.fonts.load(`500 40px ${serif}`),
      document.fonts.load(`500 40px ${display}`),
    ]).catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  await fontReady;
  const [avatar, qr] = await Promise.all([
    url ? loadImage(url.href) : null,
    QRCode.toDataURL(new URL(card.accessPath, origin).href, {
      width: 560,
      margin: 4,
      errorCorrectionLevel: "M",
      color: { dark: "#14231eff", light: "#ffffffff" },
    }).then(loadImage),
  ]);
  const { character: c, player: p, event } = card;
  const summary = card.summary?.body;
  const { ctx, text, fit, rule, frame, finish } = painter(palette.ink);
  // A large quiet monogram and fine radial lines give the front its own cover.
  ctx.save();
  ctx.globalAlpha = 0.05;
  text("A", 1005, 694, 660, palette.gold, display);
  ctx.restore();
  ctx.strokeStyle = "#26382e";
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    ctx.arc(1330, 30, 180 + i * 58, 0, Math.PI);
    ctx.stroke();
  }
  frame("#7d6a47");
  text(
    "THORNE MANOR  /  PRIVATE INVITATION",
    77,
    99,
    20,
    palette.gold,
    display,
  );
  text(
    c.status === "approved" ? "CONFIRMED GUEST" : "CHARACTER DRAFT",
    1070,
    99,
    18,
    palette.gold,
    display,
  );
  const px = 77,
    py = 157,
    pw = 502,
    ph = 675;
  if (avatar) {
    const scale = Math.max(pw / avatar.naturalWidth, ph / avatar.naturalHeight);
    const sw = pw / scale,
      sh = ph / scale;
    ctx.drawImage(
      avatar,
      (avatar.naturalWidth - sw) / 2,
      (avatar.naturalHeight - sh) / 2,
      sw,
      sh,
      px,
      py,
      pw,
      ph,
    );
  } else {
    ctx.fillStyle = "#2e4238";
    ctx.fillRect(px, py, pw, ph);
    text(
      Array.from(c.name || p.name)[0],
      px + 160,
      py + 365,
      180,
      palette.gold,
      serif,
    );
  }
  const shade = ctx.createLinearGradient(0, py + ph * 0.6, 0, py + ph);
  shade.addColorStop(0, "#14231e00");
  shade.addColorStop(1, "#14231ee8");
  ctx.fillStyle = shade;
  ctx.fillRect(px, py, pw, ph);
  ctx.strokeStyle = palette.gold;
  ctx.strokeRect(px - 8, py - 8, pw + 16, ph + 16);
  text("PERSONA", px + 27, py + ph - 42, 25, "#eee5d3", display);
  text(
    p.id.slice(0, 8).toUpperCase(),
    px + 326,
    py + ph - 42,
    20,
    "#d4bc95",
    display,
  );
  text("ALASKA NIGHTS", 661, 224, 46, palette.gold, display, 500);
  fit(`${event.title} · ${event.subtitle}`, 665, 265, 620, 21, "#b7baaa");
  rule(664, 306, 615, "#52604c");
  fit(c.name || c.cosplay_character || p.name, 658, 443, 638, 74, "#f2eadc");
  fit(
    c.english || "A GUEST OF THORNE MANOR",
    665,
    494,
    620,
    31,
    "#b7baaa",
    display,
  );
  fit(
    summary?.tagline || "每一个名字，都是故事的开始。",
    665,
    588,
    615,
    26,
    palette.gold,
  );
  fit(
    [c.profession, c.skill].filter(Boolean).join("  /  "),
    665,
    642,
    615,
    22,
    "#bbc2b3",
    sans,
  );
  rule(664, 703, 615, "#52604c");
  text("INVITED GUEST", 665, 748, 17, palette.gold, display);
  fit(p.name, 665, 794, 290, 29, "#eee5d3");
  text("INVESTIGATION GROUP", 1000, 748, 17, palette.gold, display);
  text(
    `G${String(p.group_id).padStart(2, "0")}`,
    1000,
    803,
    50,
    "#eee5d3",
    display,
  );
  rule(77, 882, 1237, "#7d6a47");
  fit(event.schedule, 77, 925, 800, 21, "#c4bda9", sans);
  text("THE LAST TESTAMENT  /  01", 1050, 925, 18, palette.gold, display);
  const front = finish();

  const back = painter(palette.paper);
  back.frame("#b9a681");
  back.text("ALASKA NIGHTS", 79, 103, 34, palette.ink, display, 500);
  back.text("STORY & FIELD NOTES  /  02", 1010, 103, 18, "#8a795b", display);
  back.rule(79, 135, 1238, "#b9a681");
  back.fit(c.name, 79, 210, 850, 39, palette.ink);
  back.text(card.synopsis, 81, 252, 20, "#7e806e");
  back.text("你的故事", 81, 333, 22, "#997743", serif, 600);
  back.paragraph(
    summary?.story || "点击生成，让你的经历化作三行故事。",
    81,
    390,
    850,
    3,
    30,
    palette.ink,
    48,
  );
  back.rule(81, 535, 850, "#d3c8b3");
  back.text("今夜，做这两件事", 81, 595, 22, "#997743", serif, 600);
  const goals = summary?.goals || [
    "结识宾客，讲述自己的来意",
    "听取故事，作出自己的选择",
  ];
  goals.forEach((goal, i) => {
    back.text(`0${i + 1}`, 81, 653 + i * 62, 23, "#a08251", display);
    back.fit(goal, 140, 653 + i * 62, 785, 27, palette.ink, sans);
  });
  back.rule(81, 763, 850, "#d3c8b3");
  (summary?.contacts || []).slice(0, 2).forEach((contact, i) => {
    const x = 81 + i * 445;
    back.fit(contact.name, x, 818, 405, 26, palette.ink);
    back.fit(contact.note, x, 856, 405, 20, "#777d6d", sans);
  });
  back.rule(988, 290, 0);
  back.ctx.strokeStyle = "#d3c8b3";
  back.ctx.beginPath();
  back.ctx.moveTo(985, 305);
  back.ctx.lineTo(985, 852);
  back.ctx.stroke();
  back.text("YOUR PRIVATE ACCESS", 1041, 342, 18, "#997743", display);
  back.ctx.drawImage(qr, 1041, 378, 260, 260);
  back.text("扫码，回到你的故事", 1039, 691, 25, palette.ink, serif);
  back.paragraph(
    "自动登录此宾客账号\n请妥善保管",
    1041,
    736,
    270,
    2,
    20,
    "#777d6d",
    34,
  );
  back.rule(79, 894, 1238, "#b9a681");
  back.text("舞会  /  拍卖  /  命案  /  庭审", 81, 932, 18, "#7e806e");
  back.fit(event.schedule, 973, 932, 340, 18, "#997743", sans);
  return { front, back: back.finish(), card };
}

export function roleCardSheets(rendered, a4 = false) {
  const pages = [];
  for (let i = 0; i < rendered.length; i += a4 ? 2 : 1) {
    const items = rendered.slice(i, i + (a4 ? 2 : 1));
    pages.push({ face: "front", items }, { face: "back", items });
  }
  return pages;
}

// A small image-only PDF writer: Chinese fonts and QR codes are baked into
// the same 300dpi artwork used for PNG export and browser preview.
export function roleCardsPdf(rendered, a4 = false) {
  if (!rendered.length) throw new Error("没有可导出的角色卡");
  const enc = new TextEncoder();
  const objects = [];
  const add = (value) => (
    objects.push(typeof value === "string" ? enc.encode(value) : value),
    objects.length
  );
  const stream = (dict, bytes) => {
    const head = enc.encode(`<< ${dict} /Length ${bytes.length} >>\nstream\n`);
    const tail = enc.encode("\nendstream");
    const result = new Uint8Array(head.length + bytes.length + tail.length);
    result.set(head);
    result.set(bytes, head.length);
    result.set(tail, head.length + bytes.length);
    return result;
  };
  const catalog = add("");
  const pages = add("");
  const pageIds = [];
  const width = (210 * 72) / 25.4,
    half = (148.5 * 72) / 25.4;
  for (const { items: group, face } of roleCardSheets(rendered, a4)) {
    const height = a4 ? half * 2 : half;
    const images = group.map((item) => {
      const bytes = Uint8Array.from(atob(item[face].jpeg.split(",")[1]), (c) =>
        c.charCodeAt(0),
      );
      return add(
        stream(
          `/Type /XObject /Subtype /Image /Width ${CARD_WIDTH} /Height ${CARD_HEIGHT} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,
          bytes,
        ),
      );
    });
    const commands = images.map(
      (_, n) =>
        `q ${width} 0 0 ${half} 0 ${height - half * (n + 1)} cm /Im${n} Do Q`,
    );
    if (a4)
      commands.push(
        `0.7 G 0.3 w [3 4] 0 d 15 ${half} m ${width - 15} ${half} l S`,
      );
    const content = add(stream("", enc.encode(commands.join("\n"))));
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << ${images.map((id, n) => `/Im${n} ${id} 0 R`).join(" ")} >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  objects[catalog - 1] = enc.encode(`<< /Type /Catalog /Pages ${pages} 0 R >>`);
  objects[pages - 1] = enc.encode(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`,
  );
  const parts = [enc.encode("%PDF-1.4\n")],
    offsets = [0];
  let length = parts[0].length;
  objects.forEach((obj, i) => {
    offsets.push(length);
    const head = enc.encode(`${i + 1} 0 obj\n`),
      tail = enc.encode("\nendobj\n");
    parts.push(head, obj, tail);
    length += head.length + obj.length + tail.length;
  });
  parts.push(
    enc.encode(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
        .join(
          "",
        )}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${length}\n%%EOF\n`,
    ),
  );
  return new Blob(parts, { type: "application/pdf" });
}

export function saveRoleCard(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function saveRoleCardPng(item, face = "front") {
  const blob = new Blob(
    [
      Uint8Array.from(atob(item[face].png.split(",")[1]), (c) =>
        c.charCodeAt(0),
      ),
    ],
    { type: "image/png" },
  );
  saveRoleCard(
    blob,
    `角色卡_${item.card.character.name || item.card.player.name}_${face === "front" ? "正面" : "背面"}.png`,
  );
}
