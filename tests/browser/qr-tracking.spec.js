import { test, expect } from "@playwright/test";
import { installQrCamera } from "./qr-camera-fixture.js";

async function alignment(page) {
  return page.evaluate(() => {
    const scene = document.querySelector('[data-testid="qr-tracking-scene"]');
    if (
      !scene ||
      scene.dataset.modelVisible !== "true" ||
      !scene.dataset.projectionCorners
    )
      return null;
    const projection = JSON.parse(scene.dataset.projectionCorners);
    const { width, height } = window.__qrCamera.dimensions;
    const rect = scene.getBoundingClientRect();
    const scale = Math.max(rect.width / width, rect.height / height);
    const expected = window.__qrCamera.corners.map((p) => ({
      x: p.x * scale + (rect.width - width * scale) / 2,
      y: p.y * scale + (rect.height - height * scale) / 2,
    }));
    const errors = projection.map((p, i) =>
      Math.hypot(p.x - expected[i].x, p.y - expected[i].y),
    );
    return {
      maximum: Math.max(...errors),
      projection,
      expected,
      id: scene.dataset.clueId,
    };
  });
}

test("全屏真实二维码连续锚定：移动/旋转/透视/竖屏裁剪/丢码恢复/切码", async ({
  page,
  context,
  baseURL,
}) => {
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) =>
    requests.push(new URL(request.url()).pathname),
  );
  await installQrCamera(context, baseURL);
  // Safari-style CSS fullscreen, independently of the desktop Fullscreen API.
  await context.addInitScript(() => {
    Object.defineProperty(Element.prototype, "requestFullscreen", {
      configurable: true,
      value: undefined,
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ar");
  await expect(page.getByTestId("public-ar-scan")).toBeEnabled();
  expect(await page.evaluate(() => window.__qrCamera.calls)).toBe(0);
  const before = await (await page.request.get("/api/public")).json();
  await page.getByTestId("public-ar-scan").click();
  const scene = page.getByTestId("qr-tracking-scene");
  await expect(scene).toBeVisible();
  await expect(scene).toHaveAttribute("data-model-visible", "true", {
    timeout: 30000,
  });
  await expect
    .poll(async () => (await alignment(page))?.maximum ?? 1000)
    .toBeLessThan(8);
  expect(
    await scene.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return (
        box.x === 0 &&
        box.y === 0 &&
        Math.abs(box.width - innerWidth) < 1 &&
        Math.abs(box.height - innerHeight) < 1
      );
    }),
  ).toBeTruthy();
  expect(
    await page.evaluate(
      () => window.__qrCamera.constraints[0].video.facingMode.ideal,
    ),
  ).toBe("environment");
  const frontal = await alignment(page);
  for (const pose of [
    { x: 0.17, y: 0.13, z: 4.5, rz: 0 },
    { x: -0.1, y: -0.12, z: 4.8, rz: 24 },
    { x: 0, y: 0, z: 4.8, rz: 90 },
    { x: 0.04, y: 0.02, z: 4.4, rx: 17, ry: -28, rz: -12 },
  ]) {
    await page.evaluate((value) => window.__qrCamera.set(value), pose);
    await expect
      .poll(async () => (await alignment(page))?.maximum ?? 1000)
      .toBeLessThan(8);
  }
  const tilted = await alignment(page);
  expect(tilted.projection).not.toEqual(frontal.projection);
  expect(await page.evaluate(() => window.__qrCamera.calls)).toBe(1);
  await page.screenshot({ path: "output/playwright/qr-ar-wall-anchored.png" });
  await page.evaluate(() => window.__qrCamera.set({ visible: false }));
  await expect(scene).toHaveAttribute("data-model-visible", "false");
  await expect(page.getByTestId("qr-tracking-status")).toContainText(
    "重新对准",
  );
  await page.evaluate(() => window.__qrCamera.set({ visible: true }));
  await expect
    .poll(async () => (await alignment(page))?.maximum ?? 1000)
    .toBeLessThan(8);
  // A second model finishing late must not replace the current QR's model.
  let requestedB;
  const bRequested = new Promise((resolve) => {
    requestedB = resolve;
  });
  let releaseB;
  const gateB = new Promise((resolve) => {
    releaseB = resolve;
  });
  let completedB;
  const bCompleted = new Promise((resolve) => {
    completedB = resolve;
  });
  const modelRoute = "**/api/ar/models/evidence-case.glb";
  await page.route(modelRoute, async (route) => {
    requestedB();
    await gateB;
    try {
      await route.continue();
    } catch {
      /* cancelled when QR switched */
    }
    completedB();
  });
  await page.evaluate(() => window.__qrCamera.set({ id: "E-06" }));
  await bRequested;
  await expect(scene).toHaveAttribute("data-clue-id", "E-06");
  await page.evaluate(() => window.__qrCamera.set({ id: "E-01" }));
  await expect(scene).toHaveAttribute("data-clue-id", "E-01");
  await expect(scene).toHaveAttribute("data-model-visible", "true");
  releaseB();
  await bCompleted;
  await page.unroute(modelRoute);
  await expect
    .poll(async () => (await alignment(page))?.maximum ?? 1000)
    .toBeLessThan(8);
  await expect(scene).toHaveAttribute("data-clue-id", "E-01");
  await page.evaluate(() =>
    window.__qrCamera.set({ id: "E-06", rx: 0, ry: 0, rz: 0 }),
  );
  await expect(scene).toHaveAttribute("data-clue-id", "E-06");
  await expect(scene).toHaveAttribute("data-model-visible", "true");
  await expect(page.getByTestId("qr-tracking-evidence")).toContainText("E-06");
  await expect
    .poll(async () => (await alignment(page))?.maximum ?? 1000)
    .toBeLessThan(8);
  expect(await page.evaluate(() => window.__qrCamera.calls)).toBe(1);
  // A syntactically valid but unknown QR must never display the previous model.
  await page.evaluate(() => window.__qrCamera.set({ id: "E-99" }));
  await expect(scene).toHaveAttribute("data-clue-id", "E-99");
  await expect(scene).toHaveAttribute("data-model-visible", "false");
  await expect(scene.getByRole("alert")).toContainText("没有对应");
  await page.evaluate(() => window.__qrCamera.set({ id: "E-01" }));
  await expect(scene).toHaveAttribute("data-clue-id", "E-01");
  await expect
    .poll(async () => (await alignment(page))?.maximum ?? 1000)
    .toBeLessThan(8);
  await page.getByRole("button", { name: "关闭摄像头", exact: true }).click();
  await expect(scene).toHaveCount(0);
  expect(await page.evaluate(() => window.__qrCamera.tracks)).toEqual([
    "ended",
  ]);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
    "hidden",
  );
  expect(await page.context().cookies()).toEqual([]);
  expect(requests.filter((path) => /^\/api\/clues\//.test(path))).toEqual([]);
  const after = await (await page.request.get("/api/public")).json();
  expect(after.registered).toBe(before.registered);
  expect(after.settings).toEqual(before.settings);
  expect(errors).toEqual([]);
});

test("二维码相机授权未返回时退出，迟到流停止且可再次进入", async ({
  page,
  context,
  baseURL,
}) => {
  await installQrCamera(context, baseURL, { delayed: true });
  await page.goto("/");
  await page.getByRole("button", { name: "AR搜证", exact: true }).click();
  await expect(page.getByTestId("public-ar-scan")).toBeEnabled();
  expect(await page.evaluate(() => window.__qrCamera.calls)).toBe(0);
  await page.getByTestId("public-ar-scan").click();
  await expect(page.getByTestId("qr-tracking-scene")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__qrCamera.calls)).toBe(1);
  await page.getByRole("button", { name: "关闭摄像头", exact: true }).click();
  await expect(page.getByTestId("qr-tracking-scene")).toHaveCount(0);
  await page.evaluate(() => window.__qrCamera.release());
  await expect
    .poll(() => page.evaluate(() => window.__qrCamera.tracks))
    .toEqual(["ended"]);
  await page.getByTestId("public-ar-scan").click();
  await expect.poll(() => page.evaluate(() => window.__qrCamera.calls)).toBe(2);
  await page.evaluate(() => window.__qrCamera.release());
  await expect(page.getByTestId("qr-tracking-scene")).toHaveAttribute(
    "data-model-visible",
    "true",
    { timeout: 30000 },
  );
  await page.evaluate(() => history.back());
  await expect(page).toHaveURL(baseURL + "/");
  await expect(page.getByTestId("qr-tracking-scene")).toHaveCount(0);
  expect(await page.evaluate(() => window.__qrCamera.tracks)).toEqual([
    "ended",
    "ended",
  ]);
});

test("倾斜真实二维码修正不同镜头焦距，切后台停止相机且返回可恢复", async ({
  page,
  context,
  baseURL,
}) => {
  await installQrCamera(context, baseURL, { focal: 700 });
  await page.goto("/ar");
  await page.getByTestId("public-ar-scan").click();
  const scene = page.getByTestId("qr-tracking-scene");
  await expect(scene).toHaveAttribute("data-model-visible", "true", {
    timeout: 30000,
  });
  await page.evaluate(() =>
    window.__qrCamera.set({ z: 3.8, rx: 30, ry: -35, rz: 12 }),
  );
  await expect
    .poll(async () => (await alignment(page))?.maximum ?? 1000)
    .toBeLessThan(8);
  await expect
    .poll(async () => {
      const focal = Number(await scene.getAttribute("data-focal-length"));
      return Math.abs(focal / 700 - 1);
    })
    .toBeLessThan(0.2);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(() => page.evaluate(() => window.__qrCamera.tracks))
    .toEqual(["ended"]);
  await expect(scene).toHaveAttribute("data-model-visible", "false");
  await expect(page.getByTestId("qr-tracking-status")).toContainText("已暂停");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(scene).toHaveAttribute("data-model-visible", "true", {
    timeout: 30000,
  });
  await expect
    .poll(async () => (await alignment(page))?.maximum ?? 1000)
    .toBeLessThan(8);
  await page.getByRole("button", { name: "关闭摄像头", exact: true }).click();
  expect(await page.evaluate(() => window.__qrCamera.tracks)).toEqual([
    "ended",
    "ended",
  ]);
});

test("证物覆盖二维码、真实点击开合与短暂遮挡无闪烁", async ({
  page,
  context,
  baseURL,
}) => {
  await installQrCamera(context, baseURL);
  await context.addInitScript(() => {
    Object.defineProperty(Element.prototype, "requestFullscreen", {
      configurable: true,
      value: undefined,
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ar");
  await page.getByTestId("public-ar-scan").click();
  const scene = page.getByTestId("qr-tracking-scene");
  await expect(scene).toHaveAttribute("data-interaction-ready", "true", {
    timeout: 30000,
  });
  await page.evaluate(() =>
    window.__qrCamera.set({ z: 6, rx: 20, ry: -22, rz: -8 }),
  );
  await expect
    .poll(async () => (await alignment(page))?.maximum ?? 1000)
    .toBeLessThan(8);
  await expect(scene).toHaveAttribute("data-model-opacity", "1.000");
  // Clicking bare wall must not activate an object; clicking its projected body does.
  await page.mouse.click(25, 300);
  await expect(scene).toHaveAttribute("data-interaction", "closed");
  const center = JSON.parse(await scene.getAttribute("data-marker-center"));
  await page.mouse.click(center.x, center.y);
  await expect(scene).toHaveAttribute("data-interaction", "opened");
  await expect(scene).toHaveAttribute("data-animation-progress", "1.000");
  await page.screenshot({ path: "output/playwright/qr-letter-open.png" });
  await page.getByTestId("qr-evidence-interact").click();
  await expect(scene).toHaveAttribute("data-animation-progress", "0.000");
  // A brief dropped frame never toggles visibility or restarts the appearance.
  const glitch = await page.evaluate(async () => {
    const el = document.querySelector('[data-testid="qr-tracking-scene"]');
    const samples = [];
    const sample = setInterval(
      () =>
        samples.push({
          visible: el.dataset.modelVisible,
          opacity: Number(el.dataset.modelOpacity),
        }),
      10,
    );
    window.__qrCamera.set({ visible: false });
    await new Promise((resolve) => setTimeout(resolve, 65));
    window.__qrCamera.set({ visible: true });
    await new Promise((resolve) => setTimeout(resolve, 350));
    clearInterval(sample);
    return samples;
  });
  expect(glitch.length).toBeGreaterThan(5);
  expect(
    glitch.every((s) => s.visible === "true" && s.opacity > 0.9),
  ).toBeTruthy();
  // Occlude one finder and move: optical flow, not a frozen old pose, must follow.
  await page.evaluate(() => window.__qrCamera.set({ occluded: true, x: 0.05 }));
  await expect(scene).toHaveAttribute("data-tracking-source", "optical-flow");
  await expect
    .poll(async () => (await alignment(page))?.maximum ?? 1000)
    .toBeLessThan(8);
  await page.evaluate(() => window.__qrCamera.set({ occluded: false }));
  await expect(scene).toHaveAttribute("data-interaction-ready", "true");
  for (const [id, kind, label] of [
    ["E-02", "terminal", "启动终端"],
    ["E-06", "case", "打开物证箱"],
  ]) {
    await page.evaluate(
      (id) => window.__qrCamera.set({ id, x: 0, rx: 27, ry: -18, rz: -6 }),
      id,
    );
    await expect(scene).toHaveAttribute("data-model-kind", kind);
    await expect(scene).toHaveAttribute("data-interaction-ready", "true");
    await expect(scene).toHaveAttribute("data-model-opacity", "1.000");
    await page.screenshot({ path: `output/playwright/qr-${kind}-closed.png` });
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(scene).toHaveAttribute("data-animation-progress", "1.000");
    await page.screenshot({ path: `output/playwright/qr-${kind}-open.png` });
  }
  await page.evaluate(() => window.__qrCamera.set({ visible: false }));
  await expect(scene).toHaveAttribute("data-model-visible", "false");
  await expect(page.getByTestId("qr-evidence-interact")).toBeDisabled();
  await page.getByRole("button", { name: "关闭摄像头", exact: true }).click();
});
