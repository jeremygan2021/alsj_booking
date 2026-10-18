import { test, expect } from "@playwright/test";
import { avatarData } from "../profile-fixture.js";

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
        status: 503,
        json: { error: "头像服务暂时繁忙" },
      });
    }
    await route.fulfill({
      json: {
        name: "伊芙·温特",
        english: "Eve Winter",
        profession: "调查记者",
        skill: "洞察",
        motive: "取回律师保管的那封旧信",
        story: generatedStory,
        cosplay_character: "原创女记者",
        cosplay_source: "原创",
        avatar_url: avatarUrl,
      },
    });
  });
  await page
    .getByRole("button", { name: "MiniMax生成头像、姓名与故事" })
    .click();
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
  await expect(page.locator('[name="story"]')).toHaveValue(originalStory);
  await expect(page.locator(".avatar-upload img")).toHaveAttribute(
    "src",
    avatarUrl,
  );
  await page.getByRole("button", { name: "重试生成角色" }).click();
  await expect(page.locator('[name="story"]')).toHaveValue(generatedStory);
  await expect(page.locator(".character-inspiration-success")).toContainText(
    "伊芙·温特",
  );
  expect(
    (await (await page.request.get("/api/me")).json()).character,
  ).toBeUndefined();
  await page.getByText("补充设定（可选）", { exact: true }).click();
  await expect(page.locator('[name="name"]')).toHaveValue("伊芙·温特");
  await expect(page.locator('[name="motive"]')).toHaveValue(
    "取回律师保管的那封旧信",
  );
  await page.setViewportSize({ width: 390, height: 844 });
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
