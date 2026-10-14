import { test, expect } from "@playwright/test";
import { installQrCamera } from "./qr-camera-fixture.js";

async function guestPosition(scene) {
  return JSON.parse(await scene.getAttribute("data-guest-position"));
}

async function walk(page, scene, key, reached) {
  // Move through real keyboard events, using rendered game state for arrival.
  await page.locator(".qr-tracking-title").click();
  await page.keyboard.down(key);
  try {
    await expect
      .poll(async () => reached(await guestPosition(scene)), {
        timeout: 10000,
        intervals: [35],
      })
      .toBe(true);
  } finally {
    await page.keyboard.up(key);
  }
}

test("庄园视角、缩放、跳跃、入场与邀请函细节保留真实二维码追踪", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(90000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installQrCamera(context, baseURL);
  await context.addInitScript(() => {
    Object.defineProperty(Element.prototype, "requestFullscreen", {
      configurable: true,
      value: undefined,
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ar?node=AR-INV&camera=1");
  await page.evaluate(() => window.__qrCamera.set({ id: "AR-INV" }));
  const scene = page.getByTestId("qr-tracking-scene");
  const views = page.getByTestId("castle-view-toggle");
  await expect(scene).toHaveAttribute("data-interaction-ready", "true", {
    timeout: 30000,
  });
  await expect(scene).toHaveAttribute("data-view-preset", "overview");
  await page.screenshot({ path: "output/playwright/castle-overview.png" });
  for (const id of ["gate", "guest", "courtyard", "marker"]) {
    await views.click();
    await expect(scene).toHaveAttribute("data-view-preset", id);
    // Wait for the actual 3D view transition, not only the label.
    await page.waitForTimeout(650);
    await page.screenshot({ path: `output/playwright/castle-${id}.png` });
  }
  await page.getByRole("button", { name: "放大模型", exact: true }).click();
  await expect(scene).toHaveAttribute("data-model-zoom", "1.15");
  await page.getByRole("button", { name: "缩小模型", exact: true }).click();
  await expect(scene).toHaveAttribute("data-model-zoom", "1");
  await page.getByRole("button", { name: "跳跃躲避陷阱", exact: true }).click();
  await expect
    .poll(async () => (await guestPosition(scene))[2])
    .toBeGreaterThan(0.15);
  await expect(
    page.getByRole("button", { name: "跳跃躲避陷阱", exact: true }),
  ).toBeEnabled();
  const oldMarker = await scene.getAttribute("data-marker-center");
  await page.evaluate(() =>
    window.__qrCamera.set({ x: 0.09, rx: 15, ry: -22, rz: 8 }),
  );
  await expect
    .poll(() => scene.getAttribute("data-marker-center"))
    .not.toBe(oldMarker);
  await expect(scene).toHaveAttribute("data-view-preset", "marker");
  await page.evaluate(() =>
    window.__qrCamera.set({ x: 0, rx: 0, ry: 0, rz: 0, visible: false }),
  );
  await expect(scene).toHaveAttribute("data-model-visible", "false");
  await expect(views).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "放大模型", exact: true }),
  ).toBeDisabled();
  const pausedGuest = await scene.getAttribute("data-guest-position");
  await page.waitForTimeout(500);
  expect(await scene.getAttribute("data-guest-position")).toBe(pausedGuest);
  await page.evaluate(() => window.__qrCamera.set({ visible: true }));
  await expect(scene).toHaveAttribute("data-interaction-ready", "true");
  await walk(page, scene, "ArrowRight", ([x]) => x >= 0.135);
  await walk(page, scene, "ArrowUp", ([, y]) => y >= -0.25);
  await walk(page, scene, "ArrowLeft", ([x]) => x <= 0.02);
  await walk(page, scene, "ArrowUp", ([, y]) => y > -0.09);
  await expect(scene).toHaveAttribute("data-experience-phase", "invitation");
  await expect(scene).toHaveAttribute("data-animation-progress", "1.000");
  await page.waitForTimeout(2500);
  await page.screenshot({
    path: "output/playwright/castle-invitation-unlocked.png",
  });
  for (const id of ["front", "back", "seal", "rotate"]) {
    await views.click();
    await expect(scene).toHaveAttribute("data-view-preset", id);
    await page.screenshot({ path: `output/playwright/invitation-${id}.png` });
  }
  await page.getByRole("button", { name: "放大模型", exact: true }).click();
  await expect(scene).toHaveAttribute("data-model-zoom", "1.15");
  await page.getByRole("button", { name: "再逛一次城堡", exact: true }).click();
  await expect(scene).toHaveAttribute("data-experience-phase", "castle");
  await expect(scene).toHaveAttribute("data-view-preset", "overview");
  await expect(scene).toHaveAttribute("data-model-zoom", "1");
  await expect(page.getByLabel("体力 3 / 3")).toBeVisible();
  await expect(page.getByText("星光 0/3")).toBeVisible();
  await page.getByRole("button", { name: "关闭摄像头", exact: true }).click();
  expect(await page.evaluate(() => window.__qrCamera.tracks)).toEqual([
    "ended",
  ]);
  expect(errors).toEqual([]);
});
