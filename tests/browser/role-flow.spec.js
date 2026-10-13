import { test, expect } from "@playwright/test";
import QRCode from "qrcode";
import { avatarData } from "../profile-fixture.js";
import { npcCredential } from "../../server/app.js";

test("Cos故事与头像 → GM审核 → NPC关联玩家 → QR搜证 → 360模型鉴赏", async ({
  page,
  browser,
  baseURL,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const registration = await page.request.post("/api/register", {
    data: {
      name: "浏览器测试宾客",
      contact: "browser-cos@example.com",
      password: "browser-player-password",
    },
  });
  expect(registration.ok()).toBeTruthy();
  const { id } = await registration.json();
  await page.goto("/play");
  await expect(
    page.getByRole("heading", { name: "今晚，你要扮演谁？" }),
  ).toBeVisible();
  await page.locator(".avatar-file input").setInputFiles({
    name: "cos-avatar.png",
    mimeType: "image/png",
    buffer: Buffer.from(avatarData.split(",")[1], "base64"),
  });
  await expect(page.locator(".avatar-upload img")).toHaveAttribute(
    "src",
    /\/api\/avatars\//,
  );
  const fields = {
    cosplay_character: "蝙蝠侠",
    cosplay_source: "DC",
    story:
      "我失去了亲人，从此独自调查城市中的不公。我相信事实胜过传闻，今晚受邀来到庄园，希望用自己的调查经验帮助受害者。",
  };
  for (const [name, value] of Object.entries(fields))
    await page.locator(`[name="${name}"]`).fill(value);
  await page.getByRole("button", { name: "AR搜证", exact: true }).click();
  await page.getByRole("button", { name: "我的角色", exact: true }).click();
  await expect(page.locator('[name="story"]')).toHaveValue(fields.story);
  await expect(page.locator(".avatar-upload img")).toHaveAttribute(
    "src",
    /\/api\/avatars\//,
  );
  await page.getByRole("button", { name: "提交角色，等待GM确认" }).click();
  await expect(page.locator(".relation-card")).toHaveCount(2);
  await expect(page.locator(".generation-status")).toContainText("等待GM确认");
  const profile = await (await page.request.get("/api/me")).json();
  expect(profile.character.story).toBe(fields.story);
  expect(profile.character.name).toBe("蝙蝠侠");
  expect(profile.character.english).toBe("Guest");
  expect(
    profile.relations.every((relation) => !("npc_brief" in relation)),
  ).toBeTruthy();

  const npcContext = await browser.newContext({ baseURL });
  await npcContext.request.post("/api/login", {
    data: {
      account: "npc:detective",
      password: npcCredential("browser-npc-password", "detective"),
    },
  });
  expect(
    (await (await npcContext.request.get("/api/staff")).json()).relations,
  ).toHaveLength(0);
  const gmContext = await browser.newContext({ baseURL });
  await gmContext.request.post("/api/login", {
    data: { account: "gm", password: "browser-gm-password" },
  });
  const gmPage = await gmContext.newPage();
  await gmPage.goto("/admin");
  await gmPage.getByRole("button", { name: "宾客与角色" }).click();
  await gmPage.getByRole("button", { name: "管理", exact: true }).click();
  const review = gmPage.getByRole("dialog");
  await expect(review).toContainText("蝙蝠侠");
  await expect(review).toContainText("NPC演绎提示");
  await review.getByRole("button", { name: "核验付款", exact: true }).click();
  await review.getByRole("button", { name: "现场签到 · +3金币" }).click();
  await review.getByLabel("角色审核").selectOption("approved");
  await review.getByRole("button", { name: "保存并分配身份" }).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/me")).json()).character.status,
    )
    .toBe("approved");
  const npcPage = await npcContext.newPage();
  await npcPage.goto("/admin");
  await expect(
    npcPage.getByRole("heading", { name: "关联玩家", exact: true }),
  ).toBeVisible();
  await expect(npcPage.locator(".relation-card")).toHaveCount(1);
  await expect(npcPage.locator(".relation-card")).toContainText("NPC演绎提示");
  await expect(npcPage.locator(".relation-card")).toContainText("已批准");
  const npcAvatar = await npcContext.request.get(profile.character.avatar_url);
  expect(npcAvatar.ok()).toBeTruthy();

  await page.reload();
  await page.getByRole("button", { name: "证据册", exact: true }).click();
  await page.getByRole("button", { name: "360°查看证物" }).click();
  await expect(page.getByRole("dialog")).toContainText("展厅等待第一件物证");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  const gmPhase = await gmContext.request.post("/api/staff/phase", {
    data: { phase: 3 },
  });
  expect(gmPhase.ok()).toBeTruthy();
  await page.reload();
  const inaccessible = await page.request.get("/api/models/sealed-letter.glb");
  expect(inaccessible.status()).toBe(403);
  await page.getByRole("button", { name: "AR搜证", exact: true }).click();
  await page.getByRole("button", { name: "扫描线索，查看AR证物" }).click();
  const code = await QRCode.toBuffer(`${baseURL}/play?clue=E-01`, {
    width: 512,
  });
  await page
    .locator(".scanner-file input")
    .setInputFiles({ name: "E-01.png", mimeType: "image/png", buffer: code });
  await expect(page.getByRole("dialog")).toHaveAttribute(
    "aria-label",
    "AR 搜证 · E-01",
  );
  await expect(page.getByTestId("model-loaded")).toBeVisible({
    timeout: 30000,
  });
  await page.getByTestId("model-detail-options").locator("summary").click();
  await page.getByRole("button", { name: "自动旋转", exact: true }).click();
  await expect(page.getByRole("button", { name: "暂停旋转" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "重置", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("基础证据");
  await page.route("**/api/check", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await page.getByRole("button", { name: "掷D20 · 小组主要鉴定" }).click();
  await expect(
    page.getByRole("button", { name: "查看AR证物模型" }),
  ).toBeDisabled();
  await expect(page.getByRole("dialog")).toContainText(
    "本调查组该区域已完成鉴定",
  );
  await page.getByRole("button", { name: "查看AR证物模型" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByTestId("model-loaded")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  // Exercise each distinct GLB in the gallery, rather than only the letter.
  for (const clue of ["E-02", "E-06"])
    expect(
      (await page.request.post(`/api/clues/${clue}/unlock`, { data: {} })).ok(),
    ).toBeTruthy();
  await page.reload();
  await page.getByRole("button", { name: "证据册", exact: true }).click();
  await page.getByRole("button", { name: "360°查看证物" }).click();
  await expect(page.getByTestId("model-loaded")).toBeVisible({
    timeout: 30000,
  });
  for (const clue of ["E-02", "E-06"]) {
    await page.locator(".gallery-model-card").filter({ hasText: clue }).click();
    await expect(page.getByTestId("model-loaded")).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByTestId("headset-viewer")).toHaveCount(0);
    await page.getByTestId("headset-options").locator("summary").click();
    await expect(page.getByTestId("headset-viewer")).toHaveCount(1);
    await page.getByTestId("headset-options").locator("summary").click();
    await expect(page.getByTestId("headset-viewer")).toHaveCount(0);
    await expect(page.getByTestId("evidence-model-stage")).toHaveCount(1);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.locator(".evidence-model-canvas").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "output/playwright/vr-mobile.png" });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
  await gmContext.close();
  await npcContext.close();
});
