import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const portraitData =
  "data:image/webp;base64," +
  (
    await readFile(
      new URL("../../src/assets/npcs/singer.webp", import.meta.url),
    )
  ).toString("base64");
const profile = {
  name: "艾琳·维斯",
  english: "Erin Weiss",
  profession: "记忆修复师",
  skill: "洞察",
  motive: "听宾客分享一段愿意保留的记忆",
  cosplay_character: "原创记忆修复师",
  cosplay_source: "原创",
  story:
    "我叫艾琳·维斯，曾替庄园整理一箱旧照片。今晚我带着一枚停走的怀表赴约，想听听宾客如何保存自己的重要记忆，也期待遇见愿意分享故事的人。",
};
const cues = [
  { start: 0, end: 4, text: "我是艾琳·维斯，一名记忆修复师。" },
  { start: 4, end: 8, text: "停走的怀表替我守着一个未完成的约定。" },
  { start: 8, end: 12, text: "今晚，你愿意和我分享一段想留下的记忆吗？" },
];

function wavFixture(seconds = 12) {
  const rate = 16000;
  const bytes = Buffer.alloc(44 + seconds * rate * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(bytes.length - 44, 40);
  return bytes;
}

async function register(context, label) {
  const response = await context.request.post("/api/register", {
    data: {
      name: "角色舞台测试宾客",
      contact: `game-player-${label}@example.com`,
      password: "game-player-password",
    },
  });
  expect(response.ok()).toBeTruthy();
  const avatar = await context.request.post("/api/avatar", {
    data: { data: portraitData },
  });
  expect(avatar.ok()).toBeTruthy();
  return { ...profile, avatar_url: (await avatar.json()).avatar_url };
}

test("正式阵营在创建之前确认，随后才可以生成角色", async ({ page }) => {
  const character = await register(page.context(), "creation-faction");
  let generations = 0;
  await page.route("**/api/character/inspire", async (route) => {
    const me = await (await page.request.get("/api/me")).json();
    expect(["fbi", "croft", "conspirator"]).toContain(me.faction.assigned);
    expect(me.character).toBeUndefined();
    generations++;
    await route.fulfill({
      contentType: "text/event-stream",
      body: [
        { type: "text", character },
        { type: "avatar", preview: character.avatar_url },
        { type: "complete", character },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join(""),
    });
  });
  await page.goto("/play");
  await expect(
    page.getByRole("button", { name: "MiniMax生成头像、姓名与故事" }),
  ).toHaveCount(0);
  await page.getByRole("radio", { name: /FBI调查阵营/ }).check();
  await page.getByRole("button", { name: "保存偏好，继续创建角色" }).click();
  await expect(
    page.getByRole("region", { name: "我的正式阵营" }),
  ).toBeVisible();
  const assigned = (await (await page.request.get("/api/me")).json()).faction
    .assigned;
  expect(["fbi", "croft", "conspirator"]).toContain(assigned);
  await page
    .getByRole("button", { name: "MiniMax生成头像、姓名与故事" })
    .click();
  await expect(page.locator(".character-live-preview")).toContainText(
    profile.name,
  );
  expect(generations).toBe(1);
  expect(
    (await (await page.request.get("/api/me")).json()).faction.assigned,
  ).toBe(assigned);
});

test("语音失败后手动重试会继续轮询，完成后显示播放按钮", async ({ page }) => {
  const character = await register(page.context(), "voice-retry");
  expect(
    (
      await page.request.post("/api/factions/preference", {
        data: { preference: "fbi" },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (await page.request.post("/api/character", { data: character })).ok(),
  ).toBeTruthy();
  let submitted = 0;
  let pendingQueries = 0;
  await page.route("**/api/character/voice", (route) => {
    if (route.request().method() === "POST") {
      submitted++;
      return route.fulfill({ json: { status: "creating" } });
    }
    if (!submitted)
      return route.fulfill({
        json: { status: "error", error: "语音服务暂时繁忙" },
      });
    pendingQueries++;
    return route.fulfill({
      json:
        pendingQueries === 1
          ? { status: "processing", script: cues[0].text }
          : {
              status: "ready",
              script: cues.map((cue) => cue.text).join(""),
              subtitles: cues,
              duration: 12,
              audio_url: "/test-game-retried-voice.wav",
              voice_name: "沉静叙事女声",
            },
    });
  });
  await page.route("**/test-game-retried-voice.wav", (route) =>
    route.fulfill({ contentType: "audio/wav", body: wavFixture() }),
  );
  await page.goto("/play");
  const voice = page.getByRole("region", { name: "角色语音自我介绍" });
  await voice
    .getByRole("button", { name: "重试生成语音介绍", exact: true })
    .click();
  await expect(
    voice.getByRole("button", { name: "播放自我介绍", exact: true }),
  ).toBeVisible();
  expect(submitted).toBe(1);
  expect(pendingQueries).toBeGreaterThanOrEqual(2);
});

for (const width of [390, 1280]) {
  test(`${width}px角色舞台支持同步字幕、播放暂停与可关闭的背景音乐`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      viewport: { width, height: width === 390 ? 844 : 900 },
      isMobile: width === 390,
      hasTouch: width === 390,
    });
    try {
      const character = await register(context, String(width));
      const preference = await context.request.post(
        "/api/factions/preference",
        { data: { preference: "fbi" } },
      );
      expect(preference.ok()).toBeTruthy();
      const beforeCreation = await (
        await context.request.get("/api/me")
      ).json();
      expect(beforeCreation.faction.assigned).toBeTruthy();
      expect(beforeCreation.character).toBeUndefined();
      const saved = await context.request.post("/api/character", {
        data: character,
      });
      expect(saved.ok()).toBeTruthy();
      const page = await context.newPage();
      const activate = (locator) =>
        width === 390 ? locator.tap() : locator.click();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/api/character/voice", (route) =>
        route.fulfill({
          json: {
            status: "ready",
            script: cues.map((cue) => cue.text).join(""),
            voice_name: "沉静叙事女声",
            audio_url: "/test-game-narration.wav",
            subtitles: cues,
            duration: 12,
            subtitle_source: "provider",
            music: {
              id: "quiet",
              title: "记忆回廊",
              mood: "沉静 · 神秘",
              credit: "Browser audio fixture",
              licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
              changes: "Test fixture",
              url: "/test-game-bgm.wav",
            },
          },
        }),
      );
      await page.route("**/test-game-narration.wav", (route) =>
        route.fulfill({ contentType: "audio/wav", body: wavFixture() }),
      );
      await page.route("**/test-game-bgm.wav", (route) =>
        route.fulfill({ contentType: "audio/wav", body: wavFixture() }),
      );
      await page.goto("/play");
      const voice = page.getByRole("region", { name: "角色语音自我介绍" });
      await expect(voice).toBeVisible();
      await expect(voice).toContainText(profile.name);
      await expect(
        voice.getByRole("img", { name: new RegExp(profile.name) }),
      ).toBeVisible();
      const narration = voice.getByLabel("播放角色自我介绍", { exact: true });
      const background = voice.getByLabel("背景音乐音轨", { exact: true });
      const musicSwitch = voice.getByRole("switch", {
        name: "背景音乐",
        exact: true,
      });
      const subtitles = voice.getByRole("region", {
        name: "语音字幕",
        exact: true,
      });
      if ((await musicSwitch.getAttribute("aria-checked")) !== "true")
        await activate(musicSwitch);
      await activate(
        voice.getByRole("button", { name: "播放自我介绍", exact: true }),
      );
      await expect(
        voice.getByRole("button", { name: "暂停自我介绍", exact: true }),
      ).toBeVisible();
      await expect
        .poll(() => narration.evaluate((element) => element.paused))
        .toBe(false);
      await expect
        .poll(() => background.evaluate((element) => element.paused))
        .toBe(false);
      await expect(subtitles.locator('[aria-current="true"]')).toHaveText(
        cues[0].text,
      );
      await narration.evaluate((element) => {
        element.currentTime = 5;
      });
      await expect(subtitles.locator('[aria-current="true"]')).toHaveText(
        cues[1].text,
      );
      await activate(musicSwitch);
      await expect(musicSwitch).toHaveAttribute("aria-checked", "false");
      await expect
        .poll(() => background.evaluate((element) => element.paused))
        .toBe(true);
      await expect
        .poll(() => narration.evaluate((element) => element.paused))
        .toBe(false);
      await activate(musicSwitch);
      await expect
        .poll(() => background.evaluate((element) => element.paused))
        .toBe(false);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      await voice.screenshot({
        path: `output/playwright/game-character-player-${width}.png`,
        animations: "disabled",
      });
      await activate(
        voice.getByRole("button", { name: "暂停自我介绍", exact: true }),
      );
      await expect
        .poll(() => narration.evaluate((element) => element.paused))
        .toBe(true);
      await expect
        .poll(() => background.evaluate((element) => element.paused))
        .toBe(true);
      await page.screenshot({
        path: `output/playwright/game-character-page-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
      await activate(
        voice.getByRole("button", { name: "播放自我介绍", exact: true }),
      );
      await narration.evaluate((element) => {
        element.currentTime = 11.8;
      });
      await expect(
        voice.getByRole("button", { name: "播放自我介绍", exact: true }),
      ).toBeVisible();
      await expect
        .poll(() => background.evaluate((element) => element.paused))
        .toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
