import { test, expect } from "@playwright/test";
import { avatarData } from "../profile-fixture.js";

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  launchOptions: {
    ...(process.env.CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
      : {}),
    args: [
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  },
});

test.describe("手机语音灵感录制", () => {
  test.use({ permissions: ["microphone"] });

  test("录音可试听并转为可修改的灵感，生成时使用用户确认的文字", async ({
    page,
  }) => {
    const registration = await page.request.post("/api/register", {
      data: {
        name: "语音灵感测试宾客",
        contact: "browser-reference-recording@example.com",
        password: "browser-reference-recording-password",
      },
    });
    expect(registration.ok()).toBeTruthy();
    const upload = await page.request.post("/api/avatar", {
      data: { data: avatarData },
    });
    expect(upload.ok()).toBeTruthy();
    const { avatar_url: avatarUrl } = await upload.json();
    const originalIdea = "一个有秘密的古董修复师";
    const transcript = "我替庄园修复过旧唱片，今晚想寻找一段遗失的旋律。";
    const finalIdea = `${originalIdea}\n${transcript}\n她还带着一只银色怀表。`;
    const character = {
      name: "瑟琳·墨尔",
      english: "Celine Moore",
      profession: "古董修复师",
      skill: "技术",
      motive: "寻找一段遗失的旋律",
      story:
        "我叫瑟琳，曾为庄园修复旧唱片。今晚我带着银色怀表前来赴约，邀请懂音乐的宾客一起辨认那段遗失的旋律。",
      cosplay_character: "原创古董修复师",
      cosplay_source: "原创",
      avatar_url: avatarUrl,
    };
    let recordingUploads = 0;
    let voiceCreates = 0;
    let recordingBytes;
    let releaseTranscription;
    const transcriptionGate = new Promise((resolve) => {
      releaseTranscription = resolve;
    });
    await page.route("**/api/character/inspiration", (route) =>
      route.fulfill({ json: { generating: false, character: null } }),
    );
    await page.route("**/api/character/reference-audio", async (route) => {
      recordingUploads++;
      const { data } = route.request().postDataJSON();
      expect(data).toMatch(/^data:audio\/wav;base64,/);
      recordingBytes = Buffer.from(data.split(",")[1], "base64");
      expect(recordingBytes.subarray(0, 4).toString()).toBe("RIFF");
      expect(recordingBytes.subarray(8, 12).toString()).toBe("WAVE");
      expect(recordingBytes.readUInt16LE(22)).toBe(1);
      expect(recordingBytes.readUInt32LE(24)).toBe(16000);
      expect(recordingBytes.length).toBeGreaterThan(16044);
      await transcriptionGate;
      await route.fulfill({
        json: {
          recording_id: "browser-reference",
          recording_url: "/test-character-reference.wav",
          transcript,
        },
      });
    });
    await page.route("**/test-character-reference.wav", (route) =>
      route.fulfill({ contentType: "audio/wav", body: recordingBytes }),
    );
    await page.route("**/api/character/inspire", (route) => {
      expect(route.request().postDataJSON()).toEqual({
        cosplay_character: "",
        cosplay_source: "",
        idea: finalIdea,
      });
      return route.fulfill({
        contentType: "text/event-stream",
        body: [
          { type: "text", character },
          { type: "avatar", preview: avatarUrl },
          { type: "complete", character },
        ]
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(""),
      });
    });
    await page.route("**/api/character/voice", (route) => {
      if (route.request().method() === "POST") voiceCreates++;
      return route.fulfill({ json: { status: "none" } });
    });

    await page.goto("/play");
    await page.getByRole("radio", { name: /服从安排/ }).check();
    await page.getByRole("button", { name: "保存偏好，继续创建角色" }).tap();
    await page.locator('[name="inspiration_idea"]').fill(originalIdea);
    await page.getByRole("button", { name: "录下角色灵感" }).tap();
    await expect(
      page.getByRole("button", { name: /停止并转文字 · [1-9]\d*秒/ }),
    ).toBeVisible();
    const generateButton = page.getByRole("button", {
      name: "MiniMax生成头像、姓名与故事",
    });
    await expect(generateButton).toBeDisabled();
    await page.getByRole("button", { name: /停止并转文字/ }).tap();
    await expect.poll(() => recordingUploads).toBe(1);
    await expect(generateButton).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "正在保存录音并转文字…" }),
    ).toBeDisabled();
    releaseTranscription();
    await expect(page.locator('[name="inspiration_idea"]')).toHaveValue(
      `${originalIdea}\n${transcript}`,
    );
    await expect(generateButton).toBeEnabled();
    expect(recordingUploads).toBe(1);
    const recording = page.getByLabel("试听角色灵感录音");
    await expect(recording).toHaveAttribute(
      "src",
      "/test-character-reference.wav",
    );
    await expect(recording).toHaveAttribute("controls", "");
    await page.locator('[name="inspiration_idea"]').fill(finalIdea);
    await page
      .getByRole("button", { name: "MiniMax生成头像、姓名与故事" })
      .tap();
    await expect(page.locator(".character-live-preview")).toContainText(
      character.name,
    );
    await expect(page.locator(".character-live-preview")).toContainText(
      character.story,
    );
    expect(voiceCreates).toBe(0);
    await page.reload();
    await expect(recording).toHaveAttribute(
      "src",
      "/test-character-reference.wav",
    );
    await expect(page.locator('[name="inspiration_idea"]')).toHaveValue(
      finalIdea,
    );
    await expect(page.locator(".character-live-preview")).toContainText(
      character.name,
    );
    expect(recordingUploads).toBe(1);
    expect(voiceCreates).toBe(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  });
});

test("角色生成保留失败前的草稿，可重试、跨栏目查看并人工提交", async ({
  page,
}) => {
  const registration = await page.request.post("/api/register", {
    data: {
      name: "角色灵感测试宾客",
      contact: "browser-inspiration@example.com",
      password: "browser-inspiration-password",
    },
  });
  expect(registration.ok()).toBeTruthy();
  await page.goto("/play");
  await page.getByRole("radio", { name: /服从安排/ }).check();
  await page.getByRole("button", { name: "保存偏好，继续创建角色" }).click();
  await page.getByText("手动填写 / 指定Cos角色", { exact: true }).click();
  await page.locator('[name="cosplay_character"]').fill("原创女记者");
  await page.locator('[name="cosplay_source"]').fill("原创");
  const originalStory =
    "我曾为庄园主人调查失落的档案，今晚受邀重回舞会，希望找到当年失踪的搭档。";
  await page.locator('[name="story"]').fill(originalStory);
  await page
    .locator('[name="inspiration_idea"]')
    .fill("与庄园律师有一段共同往事");
  await page.locator(".avatar-file input").setInputFiles({
    name: "original-avatar.png",
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
  const generatedStory =
    "我叫伊芙，曾受ECHO庄园律师委托追查一封匿名信。今晚，她约我在舞会的旧唱片机旁交换线索，而庄园主似乎早已知道我们的约定。";
  const partialStory = "我叫伊芙，曾受ECHO庄园律师委托追查一封匿名信。";
  await page.route("**/api/character/voice", (route) =>
    route.fulfill({
      json: { status: "processing", script: "我的名字是伊芙。" },
    }),
  );
  let attempts = 0;
  let releaseFailure;
  const failureGate = new Promise((resolve) => {
    releaseFailure = resolve;
  });
  await page.route("**/api/character/inspire", async (route) => {
    attempts++;
    expect(route.request().postDataJSON()).toEqual({
      cosplay_character: "原创女记者",
      cosplay_source: "原创",
      idea: "与庄园律师有一段共同往事",
    });
    if (attempts === 1) {
      await failureGate;
      return route.fulfill({
        contentType: "text/event-stream",
        body: [
          {
            type: "text",
            character: { name: "伊芙·温特", story: partialStory },
          },
          { type: "stage", message: "正在绘制头像" },
          { type: "error", message: "头像服务暂时繁忙" },
        ]
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(""),
      });
    }
    const character = {
      name: "伊芙·温特",
      english: "Eve Winter",
      profession: "调查记者",
      skill: "洞察",
      motive: "取回律师保管的那封旧信",
      story: generatedStory,
      cosplay_character: "原创女记者",
      cosplay_source: "原创",
      avatar_url: avatarUrl,
    };
    await route.fulfill({
      contentType: "text/event-stream",
      body: [
        {
          type: "text",
          character: {
            name: character.name,
            story: generatedStory.slice(0, 12),
          },
        },
        { type: "text", character },
        { type: "stage", message: "故事已写好，正在绘制角色头像…" },
        { type: "avatar", preview: avatarUrl },
        { type: "complete", character },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join(""),
    });
  });
  await page.getByRole("button", { name: "MiniMax生成头像、姓名与故事" }).tap();
  await expect(
    page.getByRole("button", { name: "正在生成头像和故事…" }),
  ).toBeDisabled();
  await expect(page.locator('[name="story"]')).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "提交角色，等待GM确认" }),
  ).toBeDisabled();
  const playerNavigation = page.getByRole("navigation", { name: "玩家入口" });
  await playerNavigation
    .getByRole("button", { name: "AR搜证", exact: true })
    .click();
  await playerNavigation
    .getByRole("button", { name: "我的角色", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "正在生成头像和故事…" }),
  ).toBeDisabled();
  releaseFailure();
  await expect(page.getByRole("alert")).toContainText("头像服务暂时繁忙");
  await expect(
    page.getByRole("article", { name: "角色实时预览" }),
  ).toBeVisible();
  await expect(page.locator(".character-live-preview")).toContainText(
    partialStory,
  );
  await expect(page.locator('[name="story"]')).toHaveValue(originalStory);
  await expect(page.locator(".avatar-upload img")).toHaveAttribute(
    "src",
    avatarUrl,
  );
  await page.getByRole("button", { name: "重试生成角色" }).tap();
  await expect(page.locator('[name="story"]')).toHaveValue(generatedStory);
  await expect(page.locator(".character-inspiration-success")).toContainText(
    "伊芙·温特",
  );
  expect(
    (await (await page.request.get("/api/me")).json()).character,
  ).toBeUndefined();
  await page.getByText("修改头像与角色设定（可选）", { exact: true }).click();
  await page.getByText("补充设定（可选）", { exact: true }).click();
  await expect(page.locator('[name="name"]')).toHaveValue("伊芙·温特");
  await expect(page.locator('[name="motive"]')).toHaveValue(
    "取回律师保管的那封旧信",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "提交角色，等待GM确认" }).click();
  await expect(page.locator(".generation-status")).toContainText("等待GM确认");
  const saved = await (await page.request.get("/api/me")).json();
  expect(saved.character.name).toBe("伊芙·温特");
  expect(saved.character.story).toBe(generatedStory);
  expect(saved.character.status).toBe("pending");
});

test("手机端可以重新生成角色，确认后才创建并播放匹配角色的语音介绍", async ({
  page,
}) => {
  const registration = await page.request.post("/api/register", {
    data: {
      name: "角色语音测试宾客",
      contact: "browser-character-voice@example.com",
      password: "browser-character-voice-password",
    },
  });
  expect(registration.ok()).toBeTruthy();
  const upload = await page.request.post("/api/avatar", {
    data: { data: avatarData },
  });
  expect(upload.ok()).toBeTruthy();
  const { avatar_url: avatarUrl } = await upload.json();
  const characters = [
    {
      name: "伊芙·温特",
      english: "Eve Winter",
      profession: "调查记者",
      skill: "洞察",
      motive: "找回庄园律师交给我的旧信",
      story:
        "我曾为庄园主人调查失落的档案，今晚受邀重回舞会，希望找到当年失踪的搭档。",
      cosplay_character: "原创女记者",
      cosplay_source: "原创",
      avatar_url: avatarUrl,
    },
    {
      name: "瑟琳·墨尔",
      english: "Celine Moore",
      profession: "古董修复师",
      skill: "技术",
      motive: "修复旧唱片中被抹去的声音",
      story:
        "我叫瑟琳，替庄园修复过一台旧唱片机。今晚我带着最后一张唱片赴约，追寻藏在那段旋律里的约定。",
      cosplay_character: "原创修复师",
      cosplay_source: "原创",
      avatar_url: avatarUrl,
    },
  ];
  let attempts = 0;
  let generatedAt = 0;
  let avatarRegenerations = 0;
  let regeneratedAvatarUrl;
  let voiceCreates = 0;
  let voiceQueries = 0;
  const script =
    "我是瑟琳·墨尔。旧唱片记得每一个被遗忘的名字，今晚，请和我一起听完最后一首曲子。";
  await page.route("**/api/character/inspiration", (route) =>
    route.fulfill({
      json: {
        generating: false,
        updated_at: generatedAt,
        character: attempts ? characters[attempts - 1] : null,
      },
    }),
  );
  await page.route("**/api/character/inspire", async (route) => {
    const character = characters[attempts++];
    generatedAt = Date.now();
    expect(character).toBeTruthy();
    await route.fulfill({
      contentType: "text/event-stream",
      body: [
        {
          type: "text",
          character: {
            name: character.name,
            story: character.story.slice(0, 12),
          },
        },
        { type: "text", character },
        { type: "avatar", preview: avatarUrl },
        { type: "complete", character },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join(""),
    });
  });
  await page.route("**/api/character/inspiration/avatar", async (route) => {
    avatarRegenerations++;
    expect(route.request().postDataJSON()).toEqual({});
    const replacement = await page.request.post("/api/avatar", {
      data: { data: avatarData },
    });
    expect(replacement.ok()).toBeTruthy();
    regeneratedAvatarUrl = (await replacement.json()).avatar_url;
    await route.fulfill({
      json: {
        character: { ...characters[1], avatar_url: regeneratedAvatarUrl },
      },
    });
  });
  await page.route("**/api/character/voice", async (route) => {
    if (route.request().method() === "POST") {
      voiceCreates++;
      expect(route.request().postDataJSON()).toEqual({});
      return route.fulfill({
        json: { status: "processing", script, voice_name: "温柔知性的女声" },
      });
    }
    voiceQueries++;
    return route.fulfill({
      json: {
        status: voiceQueries > 1 ? "ready" : "processing",
        script,
        voice_name: "温柔知性的女声",
        ...(voiceQueries > 1 ? { audio_url: "/test-character-intro.wav" } : {}),
      },
    });
  });
  await page.route("**/test-character-intro.wav", (route) =>
    route.fulfill({
      contentType: "audio/wav",
      body: Buffer.from(
        "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=",
        "base64",
      ),
    }),
  );
  await page.goto("/play");
  await page.getByRole("radio", { name: /服从安排/ }).check();
  await page.getByRole("button", { name: "保存偏好，继续创建角色" }).tap();
  await page.getByRole("button", { name: "MiniMax生成头像、姓名与故事" }).tap();
  await expect(page.locator(".character-live-preview")).toContainText(
    characters[0].name,
  );
  expect(voiceCreates).toBe(0);
  expect(
    (await (await page.request.get("/api/me")).json()).character,
  ).toBeUndefined();

  await page.getByRole("button", { name: "换一个角色方案" }).tap();
  await expect(page.locator(".character-live-preview")).toContainText(
    characters[1].name,
  );
  await expect(page.locator(".character-live-preview")).not.toContainText(
    characters[0].name,
  );
  expect(attempts).toBe(2);
  expect(voiceCreates).toBe(0);
  expect(
    (await (await page.request.get("/api/me")).json()).character,
  ).toBeUndefined();

  await page.getByRole("button", { name: "重新生成头像", exact: true }).tap();
  await expect.poll(() => avatarRegenerations).toBe(1);
  await expect.poll(() => regeneratedAvatarUrl).toBeTruthy();
  await expect(page.locator(".character-live-preview img")).toHaveAttribute(
    "src",
    regeneratedAvatarUrl,
  );
  await expect(page.locator(".character-live-preview")).toContainText(
    characters[1].story,
  );
  await expect(page.locator(".character-live-preview")).toContainText(
    characters[1].name,
  );
  expect(attempts).toBe(2);
  expect(voiceCreates).toBe(0);
  await page.reload();
  await expect(page.locator(".character-live-preview img")).toHaveAttribute(
    "src",
    regeneratedAvatarUrl,
  );
  await expect(page.locator(".character-live-preview")).toContainText(
    characters[1].story,
  );
  const editedStory =
    characters[1].story +
    "我还带了一只银色的怀表，想邀请懂音乐的宾客辨认它曾属于谁。";
  await page.getByText("修改头像与角色设定（可选）", { exact: true }).tap();
  await page.locator('[name="story"]').fill(editedStory);
  await expect(page.locator(".character-live-preview")).toContainText(
    editedStory,
  );
  await expect(page.locator(".character-live-preview img")).toHaveAttribute(
    "src",
    regeneratedAvatarUrl,
  );
  await page.reload();
  await expect(page.locator(".character-live-preview")).toContainText(
    characters[1].name,
  );
  await expect(page.locator(".character-live-preview img")).toHaveAttribute(
    "src",
    regeneratedAvatarUrl,
  );
  await expect(page.locator(".character-live-preview")).toContainText(
    editedStory,
  );
  await page.getByText("修改头像与角色设定（可选）", { exact: true }).tap();
  await expect(page.locator('[name="story"]')).toHaveValue(editedStory);
  expect(voiceCreates).toBe(0);
  await page.getByRole("button", { name: "提交角色，等待GM确认" }).tap();
  await expect.poll(() => voiceCreates).toBe(1);
  const voice = page.getByRole("region", { name: "角色语音自我介绍" });
  await expect(voice).toBeVisible();
  await expect(voice).toContainText("我是瑟琳·墨尔");
  const narration = voice.getByLabel("播放角色自我介绍", { exact: true });
  await expect(narration).toHaveAttribute("src", "/test-character-intro.wav");
  await expect(
    voice.getByRole("button", { name: "播放自我介绍", exact: true }),
  ).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "玩家入口" });
  await navigation.getByRole("button", { name: "AR搜证", exact: true }).tap();
  await navigation.getByRole("button", { name: "我的角色", exact: true }).tap();
  await expect(narration).toHaveAttribute("src", "/test-character-intro.wav");
  expect(voiceCreates).toBe(1);
  const saved = await (await page.request.get("/api/me")).json();
  expect(saved.character.name).toBe(characters[1].name);
  expect(saved.character.story).toBe(editedStory);
  expect(saved.character.avatar_url).toBe(regeneratedAvatarUrl);
  expect(saved.character.status).toBe("pending");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await expect(page.locator(".toast")).not.toBeVisible();
  await voice.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "output/playwright/character-voice-ready-mobile.png",
  });
});
