import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
const base = process.env.AR_BUILD_URL || "http://127.0.0.1:3106";
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  const page = await browser.newPage({
    viewport: { width: 900, height: 1200 },
    deviceScaleFactor: 1,
  });
  await page.goto(base + "/ar-assets/targets/study-wall.svg");
  await page
    .locator("svg")
    .first()
    .screenshot({ path: "public/ar-assets/targets/study-wall.png" });
  await page.goto(base);
  const data = await page.evaluate(async () => {
    const { a: Compiler } =
      await import("/src/vendor/mindar/controller-mGt1s8dJ.js");
    const image = new Image();
    image.src = "/ar-assets/targets/study-wall.png";
    await image.decode();
    const compiler = new Compiler();
    await compiler.compileImageTargets([image], () => {});
    return Array.from(compiler.exportData());
  });
  await writeFile(
    "public/ar-assets/targets/study-wall.mind",
    Buffer.from(data),
  );
  console.log(`Compiled real image target: ${data.length} bytes`);
} finally {
  await browser.close();
}
