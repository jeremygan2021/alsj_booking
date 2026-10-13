import { test } from "node:test";
import assert from "node:assert/strict";
import QRCode from "qrcode";
import {
  createQrFrameTracker,
  QR_CORNERS,
} from "../src/features/ar/qr-frame-tracker.js";

function frame(x = 130, y = 100, occlude = false, blank = false) {
  const qr = QRCode.create("https://alsj.luna.ski/ar?clue=E-01", {
    errorCorrectionLevel: "M",
  });
  const width = 480,
    height = 360,
    data = new Uint8ClampedArray(width * height * 4).fill(255),
    module = 4;
  if (!blank)
    for (let py = 0; py < qr.modules.size * module; py++)
      for (let px = 0; px < qr.modules.size * module; px++) {
        const value =
          occlude && px < 38 && py < 38
            ? 120
            : qr.modules.data[
                  Math.floor(py / module) * qr.modules.size +
                    Math.floor(px / module)
                ]
              ? 0
              : 255;
        const i = ((y + py) * width + x + px) * 4;
        data[i] = data[i + 1] = data[i + 2] = value;
      }
  return { data, width, height };
}
test("printed texture follows between QR decodes and through partial finder occlusion", () => {
  const tracker = createQrFrameTracker();
  const first = tracker.update(frame(), 0);
  assert.equal(first.source, "qr");
  for (let i = 1; i <= 8; i++) {
    const result = tracker.update(frame(130 + i * 3, 100 + i, i >= 3), i * 33);
    assert.ok(result, `frame ${i} remains tracked`);
    assert.equal(result.source, "optical-flow");
    for (const k of QR_CORNERS)
      assert.ok(
        Math.hypot(
          result.location[k].x - first.location[k].x - i * 3,
          result.location[k].y - first.location[k].y - i,
        ) < 2,
        `corner ${k} follows motion`,
      );
  }
});
test("optical flow rejects an empty wall and expires unconfirmed identity", () => {
  const tracker = createQrFrameTracker();
  tracker.update(frame(), 0);
  assert.equal(tracker.update(frame(130, 100, false, true), 33), null);
  assert.equal(tracker.update(frame(), 66).source, "qr");
  assert.ok(tracker.update(frame(133, 100, true), 99));
  assert.equal(tracker.update(frame(133, 100, true), 800), null);
  assert.equal(tracker.update(frame(), 833).source, "qr");
});
