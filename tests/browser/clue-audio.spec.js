import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { installQrCamera } from "./qr-camera-fixture.js";

const samplePath = new URL(
  "../../server/audio/files/e-01-body.mp3",
  import.meta.url,
);

async function installClueAudio(page, { failFirst = false } = {}) {
  let requests = 0;
  const bytes = await readFile(samplePath);
  await page.route(/\/api\/ar\/(clues|nodes)\/[^/?]+$/, async (route) => {
    const response = await route.fetch();
    const clue = await response.json();
    await route.fulfill({
      response,
      json: {
        ...clue,
        audio: {
          body: {
            url: `/api/ar/clues/${clue.id}/audio`,
            duration: clue.audio?.body?.duration || 15,
            speakers: ["叙述者", "索恩"],
            credits: "配乐：Kevin MacLeod · CC BY 4.0",
          },
        },
      },
    });
  });
  await page.route(/\/api\/ar\/clues\/[^/]+\/audio$/, async (route) => {
    requests++;
    if (failFirst && requests === 1)
      return route.fulfill({ status: 503, body: "temporary" });
    await route.fulfill({
      status: 200,
      contentType: "audio/mpeg",
      body: bytes,
    });
  });
  return () => requests;
}

async function openCamera(page, { navigate = true } = {}) {
  await installQrCamera(page.context(), test.info().project.use.baseURL);
  if (navigate) await page.goto("/ar?clue=E-01");
  else await page.reload();
  await page.getByTestId("public-ar-scan").click();
  const scene = page.getByTestId("qr-tracking-scene");
  await expect(scene).toHaveAttribute("data-model-visible", "true", {
    timeout: 30000,
  });
  const panel = scene.getByTestId("qr-tracking-evidence");
  await expect(panel).toContainText("E-01");
  await expect(panel.locator(".qr-tracking-evidence-toggle")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(panel.getByTestId("clue-audio")).toBeVisible();
  return panel.getByTestId("clue-audio");
}

async function start(player) {
  await player.getByRole("button", { name: "点击聆听", exact: true }).click();
  await expect
    .poll(() => player.locator("audio").evaluate((a) => a.readyState))
    .toBeGreaterThanOrEqual(2);
  await expect
    .poll(() => player.locator("audio").evaluate((a) => a.currentTime))
    .toBeGreaterThan(0);
  await expect(
    player.getByRole("button", { name: "暂停聆听", exact: true }),
  ).toBeVisible();
}

test("主页无播放器，真实模型显示后闭合抽屉可聆听且手机无溢出", async ({
  page,
}) => {
  const requests = await installClueAudio(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ar?clue=E-01");
  await expect(page.getByTestId("public-ar-clue")).toContainText("E-01");
  await expect(page.getByTestId("clue-audio")).toHaveCount(0);
  const player = await openCamera(page);
  await expect(player).toBeVisible();
  expect(requests()).toBe(0);
  await page.screenshot({
    path: "output/playwright/clue-ar-model-audio.png",
    fullPage: false,
  });
  await start(player);
  await player.getByRole("button", { name: "暂停聆听", exact: true }).click();
  await expect(player.locator("audio")).toHaveJSProperty("paused", true);
  await player.getByRole("button", { name: "继续聆听", exact: true }).click();
  await expect(player.locator("audio")).toHaveJSProperty("paused", false);
  await player.getByText("配乐与音色署名").click();
  await expect(player).toContainText("Kevin MacLeod");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("真实模型切换二维码与关闭相机会停止并释放旧音频", async ({ page }) => {
  await installClueAudio(page);
  const player = await openCamera(page);
  await start(player);
  const old = await player.locator("audio").elementHandle();
  await page.evaluate(() => window.__qrCamera.set({ id: "E-02" }));
  const scene = page.getByTestId("qr-tracking-scene");
  const panel = scene.getByTestId("qr-tracking-evidence");
  await expect(panel).toContainText("E-02");
  await expect(scene).toHaveAttribute("data-model-visible", "true");
  expect(await old.evaluate((a) => a.paused && !a.getAttribute("src"))).toBe(
    true,
  );
  await start(panel.getByTestId("clue-audio"));
  const next = await panel.locator("audio").elementHandle();
  await page.getByRole("button", { name: "关闭摄像头", exact: true }).click();
  expect(await next.evaluate((a) => a.paused && !a.getAttribute("src"))).toBe(
    true,
  );
  await expect(page.getByTestId("clue-audio")).toHaveCount(0);
  await page.getByRole("button", { name: "活动介绍", exact: true }).click();
  await expect(page.getByTestId("clue-audio")).toHaveCount(0);
});

test("音频加载失败可重试且文字仍可读", async ({ page }) => {
  const requests = await installClueAudio(page, { failFirst: true });
  const player = await openCamera(page);
  await player.getByRole("button", { name: "点击聆听", exact: true }).click();
  await expect(player.getByRole("status")).toContainText("暂时无法播放");
  await page
    .getByTestId("qr-tracking-evidence")
    .locator(".qr-tracking-evidence-toggle")
    .click();
  await expect(page.locator("#qr-evidence-body")).toContainText("草案");
  await player.getByRole("button", { name: "重试聆听", exact: true }).click();
  await expect
    .poll(() => player.locator("audio").evaluate((a) => a.currentTime))
    .toBeGreaterThan(0);
  expect(requests()).toBeGreaterThanOrEqual(2);
});

test("模型聆听临时暂停氛围音乐且保留用户关闭意愿", async ({ page }) => {
  await installClueAudio(page);
  const player = await openCamera(page);
  const music = page.getByTestId("investigation-music");
  await expect(music).toHaveAttribute("data-playing", "true");
  await start(player);
  await expect(music).toHaveAttribute("data-playing", "false");
  expect(
    await page.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem("alsj.ar-investigation.audio"))
          ?.enabled !== false,
    ),
  ).toBe(true);
  await player.getByRole("button", { name: "暂停聆听", exact: true }).click();
  await expect(music).toHaveAttribute("data-playing", "true");
  await player.getByRole("button", { name: "继续聆听", exact: true }).click();
  // The same music control can be operated through its underlying controller;
  // the full-screen camera hides the page toolbar from pointer input.
  await page
    .getByRole("button", { name: "暂停氛围音乐", exact: true })
    .evaluate((button) => button.click());
  await player.getByRole("button", { name: "暂停聆听", exact: true }).click();
  await expect(music).toHaveAttribute("data-playing", "false");
  expect(
    await page.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem("alsj.ar-investigation.audio"))
          .enabled,
    ),
  ).toBe(false);
});

test("AR节点模型未展开文字也可聆听，丢码时保留暂停但禁止重新启动", async ({
  page,
}) => {
  await installClueAudio(page);
  await openCamera(page);
  const scene = page.getByTestId("qr-tracking-scene");
  const panel = page.getByTestId("qr-tracking-evidence");
  await page.evaluate(() => window.__qrCamera.set({ id: "AR-05" }));
  await expect(panel).toContainText("AR-05");
  await expect(scene).toHaveAttribute("data-model-visible", "true");
  await expect(panel.locator(".qr-tracking-evidence-toggle")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  const player = panel.getByTestId("clue-audio");
  await start(player);
  await expect(player.locator("audio")).toHaveAttribute("src", /AR-05\/audio$/);
  await page.evaluate(() => window.__qrCamera.set({ visible: false }));
  await expect(scene).toHaveAttribute("data-tracking-state", "lost");
  await expect(player.locator("audio")).toHaveJSProperty("paused", false);
  await player.getByRole("button", { name: "暂停聆听", exact: true }).click();
  await expect(
    player.getByRole("button", { name: "继续聆听", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => window.__qrCamera.set({ visible: true }));
  await expect(scene).toHaveAttribute("data-model-visible", "true");
  await player.getByRole("button", { name: "继续聆听", exact: true }).click();
  await expect(player.locator("audio")).toHaveJSProperty("paused", false);
});

for (const { fails, modelPending = false } of [
  { fails: false },
  { fails: true },
  { fails: true, modelPending: true },
]) {
  test(`真实相机切码时立即释放旧音频，${modelPending ? "连续加载切码，" : ""}元数据延迟${fails ? "失败" : "成功"}期间旧卡不可操作`, async ({
    page,
    context,
    baseURL,
  }) => {
    await installClueAudio(page);
    await installQrCamera(context, baseURL);
    let requested = false;
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    if (modelPending) {
      const clue = await (await page.request.get("/api/ar/clues/E-01")).json();
      await page.route(`**${clue.model_url}`, async (route) => {
        await pending;
        await route.abort();
      });
    }
    await page.route("**/api/ar/clues/E-02", async (route) => {
      requested = true;
      await pending;
      if (fails) await route.fulfill({ status: 503, body: "temporary" });
      else await route.fallback();
    });
    await page.goto("/ar");
    await page.getByTestId("public-ar-scan").click();
    const scene = page.getByTestId("qr-tracking-scene");
    const panel = scene.getByTestId("qr-tracking-evidence");
    await expect(panel).toContainText("E-01", { timeout: 30000 });
    await expect(scene).toHaveAttribute(
      "data-tracking-state",
      modelPending ? "loading" : "located",
    );
    if (modelPending)
      await expect(
        panel.getByRole("button", { name: "点击聆听", exact: true }),
      ).toBeDisabled();
    else await start(panel.getByTestId("clue-audio"));
    const oldAudio = await panel.locator("audio").elementHandle();
    try {
      await page.evaluate(() => window.__qrCamera.set({ id: "E-02" }));
      await expect.poll(() => requested).toBe(true);
      // Assert while metadata is still pending: a successful response must not
      // be needed to stop or remove the previous clue's playback controls.
      await expect
        .poll(() =>
          oldAudio.evaluate((a) => a.paused && !a.getAttribute("src")),
        )
        .toBe(true);
      await expect(panel).toHaveCount(0);
    } finally {
      release();
    }
    if (fails) {
      await expect(scene.getByRole("alert")).toContainText("暂时无法读取");
      await expect(panel).toHaveCount(0);
      expect(
        await oldAudio.evaluate((a) => a.paused && !a.getAttribute("src")),
      ).toBe(true);
    } else {
      await expect(panel).toContainText("E-02");
      await start(panel.getByTestId("clue-audio"));
    }
  });
}

test("真实相机切码元数据未返回时重新对准已加载线索，可恢复聆听并保留丢码状态", async ({
  page,
  context,
  baseURL,
}) => {
  await installClueAudio(page);
  await installQrCamera(context, baseURL);
  let requested = false;
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/ar/clues/E-02", async (route) => {
    requested = true;
    await pending;
    await route.fulfill({ status: 503, body: "temporary" });
  });
  await page.goto("/ar");
  await page.getByTestId("public-ar-scan").click();
  const scene = page.getByTestId("qr-tracking-scene");
  const panel = scene.getByTestId("qr-tracking-evidence");
  await expect(panel).toContainText("E-01", { timeout: 30000 });
  await expect(scene).toHaveAttribute("data-tracking-state", "located");
  await start(panel.getByTestId("clue-audio"));
  const oldAudio = await panel.locator("audio").elementHandle();
  try {
    await page.evaluate(() => window.__qrCamera.set({ id: "E-02" }));
    await expect.poll(() => requested).toBe(true);
    await expect(panel).toHaveCount(0);
    await page.evaluate(() => window.__qrCamera.set({ id: "E-01" }));
    await expect(scene).toHaveAttribute("data-tracking-state", "located");
    await expect(panel).toContainText("E-01");
    expect(
      await oldAudio.evaluate((a) => a.paused && !a.getAttribute("src")),
    ).toBe(true);
    await start(panel.getByTestId("clue-audio"));
    const restored = await panel.locator("audio").elementHandle();
    await page.evaluate(() => window.__qrCamera.set({ visible: false }));
    await expect(scene).toHaveAttribute("data-tracking-state", "lost");
    await expect(panel).toContainText("E-01");
    expect(await restored.evaluate((a) => a.paused)).toBe(false);
    await page.evaluate(() => window.__qrCamera.set({ visible: true }));
    await expect(scene).toHaveAttribute("data-tracking-state", "located");
    await expect(panel).toContainText("E-01");
  } finally {
    release();
  }
});

test("真实音频目录的基础线索可直接解码播放并显示配乐署名", async ({ page }) => {
  const player = await openCamera(page);
  await start(player);
  await player.getByText("配乐与音色署名").click();
  await expect(player).toContainText("Kevin MacLeod");
  await player.getByRole("button", { name: "暂停聆听", exact: true }).click();
});

test("玩家鉴定音频获准后才显示与请求，基础和鉴定互斥且关闭释放", async ({
  page,
}) => {
  const publicClue = await (
    await page.request.get("/api/ar/clues/E-01")
  ).json();
  const bytes = await readFile(samplePath);
  let checked = false;
  let detailRequests = 0;
  const audio = (part) => ({
    url: `/api/clues/E-01/audio/${part}`,
    duration: 20,
    speakers: ["叙述者"],
  });
  await page.route("**/api/session", (route) =>
    route.fulfill({ json: { role: "player", id: "audio-player" } }),
  );
  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        player: {
          id: "audio-player",
          name: "声音测试宾客",
          payment: "paid",
          checked_in: 1,
          group_id: 1,
        },
        character: { name: "调查员", status: "approved" },
        missions: [],
        ledger: [],
        relations: [],
        inventory: [],
      },
    }),
  );
  await page.route("**/api/public", async (route) => {
    const response = await route.fetch();
    const pub = await response.json();
    await route.fulfill({
      response,
      json: { ...pub, settings: { ...pub.settings, phase: 3 } },
    });
  });
  await page.route("**/api/clues", (route) =>
    route.fulfill({
      json: {
        clues: [
          { ...publicClue, phase: 3, unlocked: true, skill: "洞察", dc: 10 },
        ],
      },
    }),
  );
  await page.route("**/api/lots", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/clues/E-01", (route) =>
    route.fulfill({
      json: {
        ...publicClue,
        unlocked: true,
        skill: "洞察",
        dc: 10,
        detail: checked ? "经过鉴定后开放的证据细节。" : undefined,
        audio: {
          body: audio("body"),
          ...(checked ? { detail: audio("detail") } : {}),
        },
      },
    }),
  );
  await page.route("**/api/check", (route) => {
    checked = true;
    return route.fulfill({ json: { roll: 20, bonus: 4 } });
  });
  await page.route("**/api/clues/E-01/audio/*", (route) => {
    if (route.request().url().endsWith("/detail")) detailRequests++;
    return route.fulfill({
      status: 200,
      contentType: "audio/mpeg",
      body: bytes,
    });
  });
  await page.goto("/play?clue=E-01");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("基础证据");
  await expect(dialog.getByTestId("clue-audio")).toHaveCount(1);
  expect(detailRequests).toBe(0);
  const body = dialog.getByRole("region", {
    name: "基础证据演绎",
    exact: true,
  });
  await start(body);
  await dialog.getByRole("button", { name: "掷D20 · 小组主要鉴定" }).click();
  const detail = dialog.getByRole("region", {
    name: "鉴定细节演绎",
    exact: true,
  });
  await expect(detail).toBeVisible();
  expect(detailRequests).toBe(0);
  await start(detail);
  await expect(body.locator("audio")).toHaveJSProperty("paused", true);
  expect(detailRequests).toBe(1);
  await body.getByRole("button", { name: "继续聆听", exact: true }).click();
  await expect(detail.locator("audio")).toHaveJSProperty("paused", true);
  const current = await body.locator("audio").elementHandle();
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  expect(
    await current.evaluate((a) => a.paused && !a.getAttribute("src")),
  ).toBe(true);
});
