import { test, expect } from "@playwright/test";
import { avatarData } from "../profile-fixture.js";

test("GM核对付费手机号后保存名单，并查看完整已保存角色和后续报名匹配", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const guest = await browser.newContext({ baseURL });
  const future = await browser.newContext({ baseURL });
  try {
    const registration = await guest.request.post("/api/register", {
      data: {
        name: "付费名单测试宾客",
        contact: "13800007101",
        password: "paid-import-browser-password",
      },
    });
    expect(registration.ok()).toBeTruthy();
    const { id } = await registration.json();
    expect(
      (
        await guest.request.post("/api/avatar", { data: { data: avatarData } })
      ).ok(),
    ).toBeTruthy();
    const character = {
      name: "奥利维亚·莱恩",
      english: "Olivia Lane",
      profession: "档案调查员",
      skill: "洞察",
      cosplay_character: "原创调查员",
      cosplay_source: "ECHO庄园原创角色",
      motive: "取回庄园律师保管的信件",
      story:
        "我曾在庄园负责整理旧档案，与今晚赴宴的律师共同见证一封匿名信的出现。主人撒钱的开场让我想起当年那场失败的交易。",
    };
    expect(
      (await guest.request.post("/api/character", { data: character })).ok(),
    ).toBeTruthy();
    const saved = await (await guest.request.get("/api/me")).json();
    expect(saved.character.name).toBe(character.name);
    expect(saved.relations.length).toBeGreaterThan(0);
    expect(
      (
        await page.request.post("/api/login", {
          data: { account: "gm", password: "browser-gm-password" },
        })
      ).ok(),
    ).toBeTruthy();
    const fullProfile = await (
      await page.request.get(`/api/staff/players/${id}`)
    ).json();
    await page.goto("/admin");
    await page.getByRole("button", { name: /^宾客与角色/ }).click();
    await page.getByRole("textbox", { name: "搜索宾客" }).fill("13800007101");
    const playerRow = page
      .getByTestId("admin-player-table")
      .locator("tbody tr")
      .filter({ hasText: "付费名单测试宾客" });
    await expect(playerRow).toContainText("奥利维亚·莱恩");
    await expect(playerRow).toContainText("待核验付款");
    await expect(
      playerRow.getByRole("img", { name: "奥利维亚·莱恩的头像" }),
    ).toHaveAttribute("src", saved.character.avatar_url);
    await expect
      .poll(() =>
        playerRow.locator("img").evaluate((image) => image.naturalWidth),
      )
      .toBeGreaterThan(0);

    await page
      .getByRole("button", { name: "导入付费手机号", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "导入付费手机号" });
    const csv =
      "手机号,姓名\n13800007101,名单宾客\n13800007102,后续报名宾客\n13800007101,重复宾客\n13500000001,NPC\nabc,错误记录";
    await dialog.getByLabel("选择CSV或TXT文件（可选）").setInputFiles({
      name: "活动已付款.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await expect(
      dialog.getByRole("textbox", { name: "付费手机号名单", exact: true }),
    ).toHaveValue(csv);
    await dialog
      .getByRole("button", { name: "预览并核对名单", exact: true })
      .click();
    const preview = dialog.getByRole("region", { name: "付费名单导入预览" });
    await expect(preview).toBeVisible();
    for (const [label, count] of [
      ["将标记已付费", "1"],
      ["未注册待匹配", "1"],
      ["重复记录", "1"],
      ["无效记录", "1"],
      ["排除NPC", "1"],
    ]) {
      await expect(
        preview
          .locator(".payment-import-counts > div")
          .filter({ hasText: label })
          .locator("strong"),
      ).toHaveText(count);
    }
    // Preview is read only, and editing the source invalidates the reviewed version.
    expect(
      (await (await page.request.get(`/api/staff/players/${id}`)).json()).player
        .payment,
    ).toBe("pending");
    await dialog.getByLabel("名单来源（可选）").fill("活动已付款名单");
    await expect(
      dialog.getByRole("button", { name: "确认导入并标记付费" }),
    ).toHaveCount(0);
    await dialog
      .getByRole("button", { name: "预览并核对名单", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "确认导入并标记付费" }),
    ).toBeEnabled();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: testInfo.outputPath("paid-import-preview-mobile.png"),
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "确认导入并标记付费" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(playerRow).toContainText("已付费");
    await expect(playerRow).toContainText("手机号名单匹配");
    await playerRow.getByRole("button", { name: "管理", exact: true }).click();
    const profile = page.getByRole("dialog");
    for (const text of [
      character.name,
      character.english,
      character.profession,
      character.cosplay_character,
      character.cosplay_source,
      character.motive,
      character.story,
      fullProfile.character.adaptation,
      fullProfile.character.secret,
      "NPC双向剧情关系",
      "NPC演绎提示",
      "手机号名单匹配",
    ])
      await expect(profile).toContainText(text);
    await expect(
      profile.getByRole("img", { name: "奥利维亚·莱恩的头像" }),
    ).toHaveAttribute("src", saved.character.avatar_url);
    await profile.getByRole("button", { name: "关闭", exact: true }).click();
    await page.reload();
    await page.getByRole("button", { name: /^宾客与角色/ }).click();
    await page.locator(".payment-roster > summary").click();
    const pendingRow = page
      .locator(".payment-roster tr")
      .filter({ hasText: "13800007102" });
    await expect(pendingRow).toContainText("待注册匹配");
    await expect(pendingRow).toContainText("活动已付款名单");
    const futureRegistration = await future.request.post("/api/register", {
      data: {
        name: "后续报名宾客",
        contact: "13800007102",
        password: "paid-import-future-password",
      },
    });
    expect(futureRegistration.ok()).toBeTruthy();
    expect(
      (await (await future.request.get("/api/me")).json()).player.payment,
    ).toBe("paid");
    await page.reload();
    await page.getByRole("button", { name: /^宾客与角色/ }).click();
    await page.getByRole("textbox", { name: "搜索宾客" }).fill("13800007102");
    const futureRow = page
      .getByTestId("admin-player-table")
      .locator("tbody tr")
      .filter({ hasText: "后续报名宾客" });
    await expect(futureRow).toContainText("已付费");
    await expect(futureRow).toContainText("手机号名单匹配");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    expect(errors).toEqual([]);
  } finally {
    await guest.close();
    await future.close();
  }
});
