import { test } from "node:test";
import assert from "node:assert/strict";
import QRCode from "qrcode";
import { parseClueCode, decodeQrPixels } from "../src/clue-scan.js";
const origin = "https://alsj.luna.ski";
test("现场线索码解析支持编号与站内链接，拒绝其他站点及非线索二维码", () => {
  for (const raw of [
    "E-04",
    " e-04 ",
    origin + "/play?clue=E-04",
    "/play?clue=e-04",
  ])
    assert.equal(parseClueCode(raw, origin), "E-04");
  for (const raw of [
    "https://evil.example/play?clue=E-04",
    "javascript:alert(1)",
    origin + "/admin?clue=E-04",
    origin + "/play?identity=player",
    "E-4",
    "E-04<script>",
    null,
    "x".repeat(2049),
  ])
    assert.equal(parseClueCode(raw, origin), null);
});
test("能从真实生成的场景二维码像素识别线索，空白图不误识别", async () => {
  const value = origin + "/play?clue=E-04";
  const qr = QRCode.create(value, { errorCorrectionLevel: "M" }),
    margin = 4,
    scale = 6,
    size = (qr.modules.size + margin * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < qr.modules.size; y++)
    for (let x = 0; x < qr.modules.size; x++) {
      if (!qr.modules.get(y, x)) continue;
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) {
          const i =
            ((y + margin) * scale + dy) * size * 4 +
            ((x + margin) * scale + dx) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
    }
  assert.equal(
    await decodeQrPixels({ data, width: size, height: size }),
    value,
  );
  assert.equal(
    await decodeQrPixels({
      data: new Uint8ClampedArray(size * size * 4).fill(255),
      width: size,
      height: size,
    }),
    null,
  );
});
