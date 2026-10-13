import { test, expect } from "@playwright/test";
import QRCode from "qrcode";

// Keep browser gesture tests deterministic without replacing the music component.
// Oscillator starts prove the component scheduled its score, beyond a label change.
async function installAudioProbe(context) {
  await context.addInitScript(() => {
    window.investigationAudioProbe = {
      contexts: 0,
      resumes: 0,
      suspends: 0,
      closes: 0,
      notesStarted: 0,
    };
    const parameter = () => ({
      value: 0,
      setValueAtTime() {},
      setTargetAtTime() {},
      linearRampToValueAtTime() {},
      exponentialRampToValueAtTime() {},
      cancelScheduledValues() {},
    });
    const node = () => ({
      connect() {},
      disconnect() {},
      gain: parameter(),
      frequency: parameter(),
      detune: parameter(),
      delayTime: parameter(),
      Q: parameter(),
    });
    class AudioContextProbe {
      constructor() {
        window.investigationAudioProbe.contexts++;
        this.state = "suspended";
        this.destination = node();
        this.createdAt = performance.now();
      }
      get currentTime() {
        return (performance.now() - this.createdAt) / 1000;
      }
      async resume() {
        window.investigationAudioProbe.resumes++;
        this.state = "running";
      }
      async suspend() {
        window.investigationAudioProbe.suspends++;
        this.state = "suspended";
      }
      async close() {
        window.investigationAudioProbe.closes++;
        this.state = "closed";
      }
      createGain() {
        return node();
      }
      createBiquadFilter() {
        return node();
      }
      createDelay() {
        return node();
      }
      createOscillator() {
        return {
          ...node(),
          start() {
            window.investigationAudioProbe.notesStarted++;
          },
          stop() {},
        };
      }
    }
    window.AudioContext = AudioContextProbe;
    window.webkitAudioContext = AudioContextProbe;
  });
}

async function enterManualClue(page, id) {
  const manual = page.locator(".public-ar-manual");
  if (!(await manual.evaluate((details) => details.open)))
    await manual.locator("summary").click();
  await page.getByLabel("线索编号或现场链接").fill(id);
  await page.getByRole("button", { name: "查看线索", exact: true }).click();
  await expect(page.getByTestId("public-ar-clue")).toContainText(id);
}

async function loadModel(page, id = "E-01") {
  await page.goto(`/ar?clue=${id}`);
  await expect(page.getByTestId("model-loaded")).toBeVisible({
    timeout: 30000,
  });
  // React sets this custom element's src property; its attribute can stay absent.
  const source = await page
    .locator("model-viewer")
    .evaluate((viewer) => viewer.src);
  expect(source).toBeTruthy();
  return new URL(source, page.url()).href;
}

async function openScene(page) {
  await page.getByTestId("enter-spatial-scene").click();
  const scene = page.getByTestId("spatial-scene");
  await expect(scene).toBeVisible();
  return scene;
}

async function expectSceneDisposed(page, canvas) {
  await expect(page.getByTestId("spatial-scene")).toHaveCount(0);
  await expect(page.getByTestId("spatial-scene-canvas")).toHaveCount(0);
  expect(await canvas.evaluate((element) => element.isConnected)).toBe(false);
  await expect
    .poll(() =>
      canvas.evaluate(
        (element) => element.getContext("webgl2")?.isContextLost() === true,
      ),
    )
    .toBe(true);
  await canvas.dispose();
}

test("直接线索链接等待用户操作后才播放氛围音乐", async ({ page, context }) => {
  await installAudioProbe(context);
  await page.goto("/ar?clue=E-01");
  await expect(page.getByTestId("public-ar-clue")).toContainText("E-01");
  await expect(page.getByTestId("investigation-music")).toHaveAttribute(
    "data-playing",
    "false",
  );
  expect(
    await page.evaluate(() => window.investigationAudioProbe.contexts),
  ).toBe(0);
  await page.getByRole("button", { name: "播放氛围音乐" }).click();
  await expect(
    page.getByRole("button", { name: "暂停氛围音乐" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() =>
      page.evaluate(() => window.investigationAudioProbe.notesStarted),
    )
    .toBeGreaterThan(0);
});

test("扫描手势开启音乐，主动暂停后切换线索及刷新保持暂停", async ({
  page,
  context,
  baseURL,
}) => {
  await installAudioProbe(context);
  await page.goto("/ar");
  await page.getByTestId("public-ar-scan").click();
  await expect(page.getByRole("dialog", { name: "扫描线索卡" })).toBeVisible();
  await expect(page.getByTestId("investigation-music")).toHaveAttribute(
    "data-playing",
    "true",
  );
  const buffer = await QRCode.toBuffer(`${baseURL}/ar?clue=E-06`, {
    width: 512,
  });
  await page.locator(".scanner-file input").setInputFiles({
    name: "E-06.png",
    mimeType: "image/png",
    buffer,
  });
  await expect(page.getByTestId("public-ar-clue")).toContainText("E-06");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => window.investigationAudioProbe.notesStarted),
    )
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "暂停氛围音乐" }).click();
  const resumes = await page.evaluate(
    () => window.investigationAudioProbe.resumes,
  );
  await enterManualClue(page, "E-02");
  await expect(page.getByTestId("investigation-music")).toHaveAttribute(
    "data-playing",
    "false",
  );
  await page.getByRole("button", { name: "继续扫描", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "扫描线索卡" })).toBeVisible();
  expect(
    await page.evaluate(() => window.investigationAudioProbe.resumes),
  ).toBe(resumes);
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByTestId("public-ar-clue")).toContainText("E-02");
  await expect(
    page.getByRole("button", { name: "播放氛围音乐" }),
  ).toHaveAttribute("aria-pressed", "false");
  expect(
    await page.evaluate(() => window.investigationAudioProbe.contexts),
  ).toBe(0);
});

test("手动查看线索的有效提交手势开启音乐", async ({ page, context }) => {
  await installAudioProbe(context);
  await page.goto("/ar");
  await enterManualClue(page, "E-01");
  await expect(page.getByTestId("investigation-music")).toHaveAttribute(
    "data-playing",
    "true",
  );
  await expect
    .poll(() =>
      page.evaluate(() => window.investigationAudioProbe.notesStarted),
    )
    .toBeGreaterThan(0);
});

test("桌面空间搜证显示真实场景、重播扫描，并在关闭时释放画布", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const modelUrl = await loadModel(page);
  let release;
  let intercepted = 0;
  const pendingModel = new Promise((resolve) => {
    release = resolve;
  });
  await page.route(modelUrl, async (route) => {
    intercepted++;
    await pendingModel;
    await route.continue();
  });
  const scene = await openScene(page);
  await expect.poll(() => intercepted).toBe(1);
  await expect(scene).toHaveAttribute("data-ready", "false");
  await expect(
    scene.getByText("正在打开物证场景", { exact: true }),
  ).toBeVisible();
  release();
  await expect(scene).toHaveAttribute("data-ready", "true", { timeout: 30000 });
  await expect(scene).toHaveAttribute("data-mode", "3d");
  await expect(scene.getByTestId("spatial-scene-canvas")).toBeVisible();
  await expect(scene.getByRole("status")).toContainText("拖动环绕观察");
  const canvas = await scene
    .getByTestId("spatial-scene-canvas")
    .elementHandle();
  expect(
    await canvas.evaluate((element) => ({
      hasSize: element.width > 0 && element.height > 0,
      contextLost: element.getContext("webgl2").isContextLost(),
    })),
  ).toEqual({ hasSize: true, contextLost: false });
  await scene.getByTestId("spatial-scan").click();
  await expect(scene.getByTestId("spatial-scan")).toBeDisabled();
  await expect(scene.getByTestId("spatial-scan")).toContainText("扫描光带中");
  await page.keyboard.press("Escape");
  await expectSceneDisposed(page, canvas);
  await expect(page.getByTestId("enter-spatial-scene")).toBeFocused();
  const reopened = await openScene(page);
  await expect(reopened).toHaveAttribute("data-ready", "true", {
    timeout: 30000,
  });
  const newCanvas = await reopened
    .getByTestId("spatial-scene-canvas")
    .elementHandle();
  await reopened.getByRole("button", { name: "关闭空间搜证" }).click();
  await expectSceneDisposed(page, newCanvas);
  expect(errors).toEqual([]);
});

test("390像素手机空间搜证控件可见且没有横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadModel(page, "E-06");
  const scene = await openScene(page);
  await expect(scene).toHaveAttribute("data-ready", "true", { timeout: 30000 });
  await expect(scene.getByTestId("spatial-scene-canvas")).toBeVisible();
  await expect(
    scene.getByRole("button", { name: "关闭空间搜证" }),
  ).toBeVisible();
  await expect(scene.getByTestId("spatial-scan")).toBeVisible();
  expect(
    await scene.evaluate((element) => {
      const controls = [...element.querySelectorAll("button")];
      return (
        document.documentElement.scrollWidth <= innerWidth &&
        element.scrollWidth <= element.clientWidth &&
        controls.every((control) => {
          const rect = control.getBoundingClientRect();
          return (
            rect.left >= 0 &&
            rect.right <= innerWidth &&
            rect.top >= 0 &&
            rect.bottom <= innerHeight
          );
        })
      );
    }),
  ).toBe(true);
  await scene.getByRole("button", { name: "关闭空间搜证" }).click();
  await expect(page.getByTestId("spatial-scene-canvas")).toHaveCount(0);
});

test("空间搜证模型加载失败可重试恢复，也可直接返回线索", async ({ page }) => {
  const modelUrl = await loadModel(page);
  let fail = true;
  await page.route(modelUrl, (route) =>
    fail
      ? route.fulfill({ status: 503, body: "temporarily unavailable" })
      : route.continue(),
  );
  const scene = await openScene(page);
  await expect(scene.getByRole("alert")).toContainText("物证模型读取失败");
  await expect(scene.getByTestId("spatial-scan")).toBeDisabled();
  await expect(
    scene.getByRole("button", { name: "重新加载场景" }),
  ).toBeEnabled();
  const failedCanvas = await scene
    .getByTestId("spatial-scene-canvas")
    .elementHandle();
  await scene.getByRole("button", { name: "关闭空间搜证" }).click();
  await expectSceneDisposed(page, failedCanvas);
  await expect(page.getByTestId("public-ar-clue")).toContainText("E-01");
  const retryScene = await openScene(page);
  await expect(retryScene.getByRole("alert")).toContainText("物证模型读取失败");
  fail = false;
  await retryScene.getByRole("button", { name: "重新加载场景" }).click();
  await expect(retryScene).toHaveAttribute("data-ready", "true", {
    timeout: 30000,
  });
  await expect(retryScene.getByRole("alert")).toHaveCount(0);
  await expect(retryScene.getByTestId("spatial-scene-canvas")).toHaveCount(1);
  await retryScene.getByRole("button", { name: "关闭空间搜证" }).click();
  await expect(page.getByTestId("spatial-scene-canvas")).toHaveCount(0);
});
