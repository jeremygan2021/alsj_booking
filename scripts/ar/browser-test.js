import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.AR_TEST_URL || "http://127.0.0.1:3106";
const output = "output/playwright/ar";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [],
  checks = [];
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base + "/ar/demo");
  await page.getByRole("button", { name: "先查看 3D 预览" }).waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({ path: output + "/mobile-entry.png", fullPage: true });
  checks.push("390px mobile entry without horizontal overflow");
  await page.getByRole("button", { name: "先查看 3D 预览" }).click();
  await page.getByRole("status").filter({ hasText: "3D 预览" }).waitFor();
  await page.screenshot({ path: output + "/model-preview.png" });
  // Project the known hotspot through the actual preview camera contract.
  const camera = new THREE.PerspectiveCamera(45, 390 / 844, 0.01, 100);
  camera.position.set(0.65, 0.45, Math.max(3.4, 2.3 / camera.aspect));
  camera.lookAt(0, 0, 0.2);
  camera.updateMatrixWorld();
  const manifest = await (
    await context.request.get(base + "/api/ar/demo")
  ).json();
  const point = new THREE.Vector3(...manifest.hotspots[0].position).project(
    camera,
  );
  const click = { x: ((point.x + 1) / 2) * 390, y: ((1 - point.y) / 2) * 844 };
  const openedAt = Date.now();
  await page.mouse.click(click.x, click.y);
  await page.getByRole("dialog", { name: "发现的证物" }).waitFor();
  assert.ok(
    Date.now() - openedAt >= 900,
    "Evidence must open gradually before revealing the panel",
  );
  await page.waitForTimeout(800);
  const viewer = page.locator(".ar-object-viewer canvas");
  await viewer.waitFor();
  const beforeRotation = await viewer.screenshot();
  const viewerBounds = await viewer.boundingBox();
  await page.mouse.move(
    viewerBounds.x + viewerBounds.width * 0.4,
    viewerBounds.y + viewerBounds.height * 0.5,
  );
  await page.mouse.down();
  await page.mouse.move(
    viewerBounds.x + viewerBounds.width * 0.8,
    viewerBounds.y + viewerBounds.height * 0.6,
    { steps: 12 },
  );
  await page.mouse.up();
  await page.waitForTimeout(200);
  assert.equal(beforeRotation.equals(await viewer.screenshot()), false);
  checks.push(
    "Evidence opens gradually; independent 360-degree viewer changes perspective on drag",
  );
  assert.match(await page.getByRole("dialog").innerText(), /密封文件/);
  await page.screenshot({ path: output + "/evidence-found.png" });
  await page.getByRole("button", { name: "继续探索" }).click();
  assert.match(await page.locator(".ar-count").innerText(), /1 \/ 3/);
  await page.mouse.click(click.x, click.y);
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "继续探索" }).click();
  assert.match(await page.locator(".ar-count").innerText(), /1 \/ 3/);
  checks.push(
    "GLB renders, raycast click collects evidence, repeat click stays 1/3",
  );
  await page.getByRole("button", { name: "关闭相机或预览" }).click();
  assert.equal(await page.locator(".ar-stage canvas").count(), 0);
  checks.push("Preview cleanup removes renderer");
  await page.goto(base + "/ar/wall-study");
  await page.getByRole("button", { name: "登录玩家账号" }).click();
  await page
    .getByRole("textbox", { name: "手机号或邮箱" })
    .fill("ar-browser@example.com");
  await page.locator('input[type="password"]').fill("browser-test-123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "开启摄像头搜证" }).waitFor();
  assert.match(page.url(), /\/ar\/wall-study$/);
  checks.push(
    "Player login preserves AR destination and loads authorized scene",
  );
  await page.goto(base + "/ar/target");
  await page.emulateMedia({ media: "print" });
  await page.pdf({
    path: output + "/wall-target-A4.pdf",
    printBackground: true,
    preferCSSPageSize: true,
  });
  await page.emulateMedia({ media: "screen" });
  checks.push("Printable A4 target exported");

  // A real image tracker consumes a synthetic video stream; no SDK events are mocked.
  await page.addInitScript(() => {
    window.arTestFrame = { visible: true, offset: 0 };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        const image = new Image();
        image.src = "/ar-assets/targets/study-wall.png";
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 720;
        canvas.height = 1280;
        const ctx = canvas.getContext("2d");
        const draw = () => {
          ctx.fillStyle = "#b6b3a9";
          ctx.fillRect(0, 0, 720, 1280);
          if (window.arTestFrame.visible)
            ctx.drawImage(
              image,
              130 + window.arTestFrame.offset,
              290,
              450,
              600,
            );
        };
        draw();
        const timer = setInterval(draw, 60);
        const stream = canvas.captureStream(15);
        window.arTestStream = stream;
        const track = stream.getVideoTracks()[0],
          stop = track.stop.bind(track);
        track.stop = () => {
          clearInterval(timer);
          stop();
        };
        return stream;
      },
    });
  });
  await page.goto(base + "/ar/demo");
  await page.getByRole("button", { name: "开启摄像头搜证" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "已定位墙面" })
    .waitFor({ timeout: 60000 });
  await page.screenshot({ path: output + "/camera-tracked.png" });
  await page.evaluate(() => {
    window.arTestFrame.offset = 65;
  });
  await page.waitForTimeout(1500);
  assert.match(await page.locator(".ar-tracking").innerText(), /已定位/);
  await page.screenshot({ path: output + "/camera-moved.png" });
  await page.evaluate(() => {
    window.arTestFrame.visible = false;
  });
  await page
    .getByRole("status")
    .filter({ hasText: "请对准整张" })
    .waitFor({ timeout: 15000 });
  await page.screenshot({ path: output + "/camera-lost.png" });
  await page.evaluate(() => {
    window.arTestFrame.visible = true;
  });
  await page
    .getByRole("status")
    .filter({ hasText: "已定位墙面" })
    .waitFor({ timeout: 30000 });
  checks.push(
    "Real MindAR detects target, tracks translation, loses blank frame, reacquires target",
  );
  await page.getByRole("button", { name: "关闭相机或预览" }).click();
  assert.equal(
    await page.evaluate(() =>
      window.arTestStream
        .getTracks()
        .every((track) => track.readyState === "ended"),
    ),
    true,
  );
  assert.equal(await page.locator(".ar-stage video").count(), 0);
  checks.push("Camera cleanup stops media tracks and removes video");
  await page.evaluate(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        throw new DOMException("Denied", "NotAllowedError");
      },
    });
  });
  await page.getByRole("button", { name: "开启摄像头搜证" }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "相机权限未开启" })
    .waitFor({ timeout: 15000 });
  checks.push("Denied camera permission gives recovery message");
  await page.goto(base + "/ar/wall-study");
  await page.getByRole("button", { name: "开启摄像头搜证" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "已定位墙面" })
    .waitFor({ timeout: 30000 });
  await page.mouse.click(156, 316);
  await page.getByRole("dialog", { name: "发现的证物" }).waitFor();
  assert.match(await page.getByRole("dialog").innerText(), /未公开的忏悔信/);
  const acquired = await context.request.get(base + "/api/clues/E-01");
  assert.equal(acquired.status(), 200);
  assert.equal((await acquired.json()).id, "E-01");
  await page.getByRole("button", { name: "继续探索" }).click();
  await page.mouse.click(156, 316);
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "继续探索" }).click();
  assert.match(await page.locator(".ar-count").innerText(), /1 \/ 3/);
  await page.screenshot({ path: output + "/formal-collected.png" });
  await page.getByRole("button", { name: "关闭相机或预览" }).click();
  checks.push(
    "Camera raycast collects authorized formal evidence through server and evidence-book API",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + "/ar/demo");
  await page.getByRole("button", { name: "开启摄像头搜证" }).waitFor();
  await page.screenshot({
    path: output + "/desktop-entry.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  await writeFile(
    output + "/report.json",
    JSON.stringify({ checks, pageErrors: errors }, null, 2),
  );
  console.log(JSON.stringify({ checks, pageErrors: errors }, null, 2));
} finally {
  await browser.close();
}
