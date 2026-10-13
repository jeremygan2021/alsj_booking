import { test, expect } from "@playwright/test";

test("AR授权等待期间切到后台后可重新进入，不会卡在正在启动", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.xrProbe = { hidden: false, ended: 0, requested: 0 };
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => window.xrProbe.hidden,
    });
    class MockXR extends EventTarget {
      async isSessionSupported() {
        return true;
      }
      requestSession() {
        window.xrProbe.requested++;
        return new Promise((resolve) => {
          window.resolvePendingAR = () =>
            resolve({
              async end() {
                window.xrProbe.ended++;
              },
            });
        });
      }
    }
    Object.defineProperty(navigator, "xr", {
      value: new MockXR(),
      configurable: true,
    });
  });
  await page.goto("/ar?clue=E-01");
  await expect(page.getByTestId("model-loaded")).toBeVisible({
    timeout: 30000,
  });
  await page.getByTestId("enter-spatial-scene").click();
  const scene = page.getByTestId("spatial-scene");
  await expect(scene).toHaveAttribute("data-ready", "true", { timeout: 30000 });
  const start = scene.getByTestId("spatial-start-ar");
  await expect(start).toBeEnabled();
  await start.click();
  await expect(start).toContainText("正在启动");
  await expect(start).toBeDisabled();
  await page.evaluate(() => {
    window.xrProbe.hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    window.resolvePendingAR();
  });
  await expect.poll(() => page.evaluate(() => window.xrProbe.ended)).toBe(1);
  await page.evaluate(() => {
    window.xrProbe.hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(start).toContainText("进入现实 AR");
  await expect(start).toBeEnabled();
  await expect(scene).toHaveAttribute("data-mode", "3d");
  await scene.getByRole("button", { name: "关闭空间搜证" }).click();
  await expect(page.getByTestId("spatial-scene-canvas")).toHaveCount(0);
});
