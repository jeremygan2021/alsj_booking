import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { avatarData } from "../profile-fixture.js";

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const cameraPhoto = await sharp({
  create: { width: 2400, height: 1600, channels: 3, background: "#4e7567" },
})
  .jpeg()
  .withMetadata({ orientation: 6 })
  .toBuffer();
const galleryPhoto = await readFile(
  new URL("../../src/assets/npcs/singer.webp", import.meta.url),
);
const recording = {
  recording_id: "existing-photo-idea",
  recording_url: "/photo-test-existing-recording.wav",
  status: "ready",
  transcript: "我想扮演一位温柔的古董修复师。",
};
const profile = {
  name: "瑟琳·墨尔",
  english: "Celine Moore",
  profession: "古董修复师",
  skill: "技术",
  motive: "寻找旧照片背后的故事",
  cosplay_character: "原创古董修复师",
  cosplay_source: "原创",
  story:
    "我叫瑟琳，替庄园修复过一台旧唱片机。今晚我带着一只银色怀表赴约，邀请懂音乐的宾客一起辨认那段被遗忘的旋律。",
};

async function enterCreation(page, contact) {
  const registration = await page.request.post("/api/register", {
    data: {
      name: "Cos照片测试宾客",
      contact,
      password: "reference-photo-password",
    },
  });
  expect(registration.ok()).toBeTruthy();
  await page.goto("/play");
  await page.getByRole("radio", { name: /服从安排/ }).check();
  await page.getByRole("button", { name: "保存偏好，继续创建角色" }).tap();
}

test("手机Cos照压缩校正方向，失败重试、换图和删除均保留头像草稿及录音", async ({
  page,
}) => {
  let reference = null,
    uploadedBytes,
    photoUploads = 0,
    deletions = 0,
    generations = 0;
  let generated = null,
    generatedAt = 0;
  let releaseFailure;
  const failureGate = new Promise((resolve) => {
    releaseFailure = resolve;
  });
  await page.route("**/api/character/inspiration", (route) =>
    route.fulfill({
      json: {
        generating: false,
        character: generated,
        updated_at: generatedAt,
        reference_photo: reference,
        reference_recording: recording,
      },
    }),
  );
  await page.route("**/photo-test-existing-recording.wav", (route) =>
    route.fulfill({
      contentType: "audio/wav",
      body: Buffer.from(
        "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=",
        "base64",
      ),
    }),
  );
  await page.route("**/api/character/reference-photo/preview?v=*", (route) =>
    route.fulfill({ contentType: "image/jpeg", body: uploadedBytes }),
  );
  await page.route("**/api/character/reference-photo", async (route) => {
    if (route.request().method() === "DELETE") {
      deletions++;
      reference = null;
      return route.fulfill({ json: { ok: true } });
    }
    photoUploads++;
    const { data } = route.request().postDataJSON();
    expect(data).toMatch(/^data:image\/jpeg;base64,/);
    uploadedBytes = Buffer.from(data.split(",")[1], "base64");
    expect(uploadedBytes.length).toBeLessThanOrEqual(700 * 1024);
    const metadata = await sharp(uploadedBytes).metadata();
    expect(Math.max(metadata.width, metadata.height)).toBeLessThanOrEqual(1024);
    if (photoUploads <= 2) {
      expect(metadata.width).toBe(683);
      expect(metadata.height).toBe(1024);
    }
    if (photoUploads === 1) {
      await failureGate;
      return route.fulfill({
        status: 503,
        json: { error: "照片保存暂时繁忙" },
      });
    }
    reference = {
      version: photoUploads,
      created_at: Date.now(),
      photo_url: `/api/character/reference-photo/preview?v=${photoUploads}`,
    };
    return route.fulfill({ json: reference });
  });
  await enterCreation(page, "cos-reference-preserve@example.com");
  await expect(page.getByLabel("试听角色灵感录音")).toHaveAttribute(
    "src",
    recording.recording_url,
  );
  const originalStory =
    "我是为庄园保存旧照片的修复师，今晚带着自己珍藏的怀表赴约，希望认识愿意分享回忆的宾客。";
  await page.getByText("手动填写 / 指定Cos角色", { exact: true }).tap();
  await page.locator('[name="cosplay_character"]').fill("原创修复师");
  await page.locator('[name="cosplay_source"]').fill("原创");
  await page.locator('[name="story"]').fill(originalStory);
  await page.locator(".avatar-file input").setInputFiles({
    name: "manual-avatar.png",
    mimeType: "image/png",
    buffer: Buffer.from(avatarData.split(",")[1], "base64"),
  });
  await expect(page.locator(".avatar-upload img")).toHaveAttribute(
    "src",
    /\/api\/avatars\//,
  );
  const avatarUrl = await page
    .locator(".avatar-upload img")
    .getAttribute("src");
  const photo = page.getByRole("region", { name: "Cos照片参考" });
  const generateButton = page.getByRole("button", {
    name: "MiniMax生成头像、姓名与故事",
  });
  await expect(photo.getByLabel("拍摄Cos照片")).toHaveAttribute(
    "accept",
    "image/*",
  );
  await expect(photo.getByLabel("拍摄Cos照片")).toHaveAttribute(
    "capture",
    "environment",
  );
  await expect(photo.getByLabel("从相册选择Cos照片")).not.toHaveAttribute(
    "capture",
  );
  const chooser = page.waitForEvent("filechooser");
  await photo.getByRole("button", { name: "拍一张Cos照", exact: true }).tap();
  await (
    await chooser
  ).setFiles({
    name: "camera-rotated.jpg",
    mimeType: "image/jpeg",
    buffer: cameraPhoto,
  });
  await expect(photo.getByAltText("用于生成角色的Cos参考照片")).toBeVisible();
  await expect.poll(() => photoUploads).toBe(1);
  await expect(generateButton).toBeDisabled();
  await expect(page.locator('[name="story"]')).toHaveValue(originalStory);
  await expect(page.locator(".avatar-upload img")).toHaveAttribute(
    "src",
    avatarUrl,
  );
  await expect(page.getByLabel("试听角色灵感录音")).toHaveAttribute(
    "src",
    recording.recording_url,
  );
  releaseFailure();
  await expect(photo.getByRole("alert")).toContainText("照片保存暂时繁忙");
  await expect(photo.getByAltText("用于生成角色的Cos参考照片")).toBeVisible();
  await expect(generateButton).toBeDisabled();
  await photo.getByRole("button", { name: "重试上传照片" }).tap();
  await expect(photo).toContainText("照片已准备好");
  expect(photoUploads).toBe(2);
  await expect(generateButton).toBeEnabled();
  await expect(page.locator(".avatar-upload img")).toHaveAttribute(
    "src",
    avatarUrl,
  );
  const appearance = "深色长裙、金色配饰和手持怀表";
  await page.route("**/api/character/inspire", (route) => {
    generations++;
    expect(route.request().postDataJSON()).not.toHaveProperty(
      "reference_photo",
    );
    generated = {
      ...profile,
      name: generations === 1 ? profile.name : "艾琳·维斯",
      avatar_url: avatarUrl,
    };
    generatedAt = Date.now();
    return route.fulfill({
      contentType: "text/event-stream",
      body: [
        ...(reference
          ? [{ type: "appearance_ready", summary: appearance }]
          : []),
        { type: "text", character: generated },
        { type: "avatar", preview: avatarUrl },
        { type: "complete", character: generated },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join(""),
    });
  });
  await generateButton.tap();
  await expect(page.locator(".character-live-preview")).toContainText(
    profile.name,
  );
  await expect(page.locator(".character-appearance-note")).toContainText(
    appearance,
  );
  const gallery = page.waitForEvent("filechooser");
  await photo.getByRole("button", { name: "从相册选照片" }).tap();
  await (
    await gallery
  ).setFiles({
    name: "cos-dress.webp",
    mimeType: "image/webp",
    buffer: galleryPhoto,
  });
  await expect(photo.getByAltText("用于生成角色的Cos参考照片")).toHaveAttribute(
    "src",
    /v=3$/,
  );
  await expect(page.locator(".character-live-preview img")).toHaveAttribute(
    "src",
    avatarUrl,
  );
  await expect(page.locator(".character-live-preview")).toContainText(
    profile.story,
  );
  await expect(page.getByLabel("试听角色灵感录音")).toHaveAttribute(
    "src",
    recording.recording_url,
  );
  await expect(page.locator(".toast")).not.toBeVisible();
  await page.screenshot({
    path: "output/playwright/character-create-photo-390.png",
    fullPage: true,
  });
  await photo.getByRole("button", { name: "移除Cos参考照片" }).tap();
  await expect(photo.getByAltText("用于生成角色的Cos参考照片")).toHaveCount(0);
  expect(deletions).toBe(1);
  await expect(page.locator(".character-live-preview img")).toHaveAttribute(
    "src",
    avatarUrl,
  );
  await expect(page.locator(".character-live-preview")).toContainText(
    profile.story,
  );
  await page.getByRole("button", { name: "换一个角色方案", exact: true }).tap();
  await expect(page.locator(".character-live-preview")).toContainText(
    "艾琳·维斯",
  );
  await expect(page.locator(".character-appearance-note")).toHaveCount(0);
  await page.reload();
  await expect(photo.getByAltText("用于生成角色的Cos参考照片")).toHaveCount(0);
  await expect(page.getByLabel("试听角色灵感录音")).toHaveAttribute(
    "src",
    recording.recording_url,
  );
  await expect(page.locator(".character-live-preview")).toContainText(
    "艾琳·维斯",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("照片上传失败后刷新仍保留压缩图，直接重试且不清空文字灵感", async ({
  page,
}) => {
  let attempts = 0,
    photoData;
  let reference = null;
  await page.route("**/api/character/inspiration", (route) =>
    route.fulfill({
      json: { generating: false, character: null, reference_photo: reference },
    }),
  );
  await page.route("**/api/character/reference-photo/preview?v=*", (route) =>
    route.fulfill({ contentType: "image/jpeg", body: photoData }),
  );
  await page.route("**/api/character/reference-photo", (route) => {
    attempts++;
    photoData = Buffer.from(
      route.request().postDataJSON().data.split(",")[1],
      "base64",
    );
    if (attempts === 1)
      return route.fulfill({ status: 503, json: { error: "请稍后重试照片" } });
    reference = {
      version: 12,
      created_at: Date.now(),
      photo_url: "/api/character/reference-photo/preview?v=12",
    };
    return route.fulfill({ json: reference });
  });
  await enterCreation(page, "cos-reference-reload@example.com");
  await page
    .locator('[name="inspiration_idea"]')
    .fill("穿浅绿色斗篷的旅行者，想结识新的朋友。");
  const photo = page.getByRole("region", { name: "Cos照片参考" });
  await photo.getByLabel("从相册选择Cos照片").setInputFiles({
    name: "cos-photo.webp",
    mimeType: "image/webp",
    buffer: galleryPhoto,
  });
  await expect(photo.getByRole("alert")).toContainText("请稍后重试照片");
  await page.reload();
  await expect(photo.getByAltText("用于生成角色的Cos参考照片")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "MiniMax生成头像、姓名与故事" }),
  ).toBeDisabled();
  await expect(page.locator('[name="inspiration_idea"]')).toHaveValue(
    "穿浅绿色斗篷的旅行者，想结识新的朋友。",
  );
  await photo.getByRole("button", { name: "重试上传照片" }).tap();
  await expect(photo).toContainText("照片已准备好");
  await expect(
    page.getByRole("button", { name: "MiniMax生成头像、姓名与故事" }),
  ).toBeEnabled();
  expect(attempts).toBe(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
