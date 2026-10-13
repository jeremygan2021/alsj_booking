import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.ADMIN_TEST_URL || "http://127.0.0.1:3110";
if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname))
  throw new Error("管理员写入测试仅允许运行在本地测试站点");
const output = "output/playwright/admin";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks = [],
  errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const admin = await context.request.post(base + "/api/login", {
    data: { account: "admin", password: "admin-ui-test" },
  });
  assert.equal(admin.status(), 200);
  const list = await (
    await context.request.get(base + "/api/staff/manage")
  ).json();
  if (
    !list.players.some(
      (player) => player.contact === "admin-ui-player@example.com",
    )
  ) {
    const player = await browser.newContext();
    await player.request.post(base + "/api/register", {
      data: {
        name: "后台测试宾客",
        contact: "admin-ui-player@example.com",
        password: "test-player-123",
      },
    });
    await player.close();
  }
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base + "/admin");
  await page.getByRole("button", { name: "内容管理中心" }).click();
  await page.getByRole("heading", { name: "报名资料管理" }).waitFor();
  await page.screenshot({
    path: output + "/desktop-content.png",
    fullPage: true,
  });
  checks.push("Admin alias logs in and opens content manager");
  const playerRow = page
    .getByRole("row")
    .filter({ hasText: "admin-ui-player@example.com" });
  await playerRow.getByRole("button", { name: "编辑", exact: true }).click();
  await page
    .getByRole("textbox", { name: "报名姓名", exact: true })
    .fill("后台修改宾客");
  await page.getByRole("button", { name: "保存内容", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.match(await playerRow.innerText(), /后台修改宾客/);
  checks.push("Registration form edits persisted name");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出名单" }).click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /报名名单/);
  await download.saveAs(output + "/registrations.csv");
  checks.push("Registration CSV downloads");
  await page.getByRole("button", { name: /^角色卡/ }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "后台修改宾客" })
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  const values = {
    角色姓名: "后台角色",
    英文名: "Admin Tester",
    职业: "调查员",
    赴宴动机: "寻找真相",
    角色背景: "由后台建立完整角色卡",
    "角色秘密（批准后本人可见）": "仅本人和管理员知晓",
  };
  for (const [label, value] of Object.entries(values))
    await page.getByRole("textbox", { name: label, exact: true }).fill(value);
  await page.getByRole("button", { name: "保存内容", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("row").filter({ hasText: "后台角色" }).waitFor();
  checks.push("Full role-card form creates and persists card");
  await page.getByRole("button", { name: /^线索库/ }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "E-01" })
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "线索标题", exact: true })
    .fill("后台验证线索");
  await page
    .getByRole("textbox", { name: "调查区域", exact: true })
    .fill("后台测试区域");
  await page.getByRole("button", { name: "保存内容", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("row").filter({ hasText: "后台验证线索" }).waitFor();
  checks.push("Clue form updates title and investigation area");
  await page.getByRole("button", { name: /^AR场景/ }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "遗嘱证物柜" })
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "场景名称", exact: true })
    .fill("后台配置的墙面场景");
  await page
    .getByRole("button", { name: "保存并发布场景", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page
    .getByRole("row")
    .filter({ hasText: "后台配置的墙面场景" })
    .waitFor();
  await page.reload();
  await page.getByRole("button", { name: "内容管理中心" }).click();
  await page.getByRole("button", { name: /^AR场景/ }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "后台配置的墙面场景" })
    .waitFor();
  checks.push("AR scene editor persists through reload");
  await page.getByRole("button", { name: /^报名首页/ }).click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page
    .getByRole("textbox", { name: "活动主标题", exact: true })
    .fill("后台维护的活动");
  await page.getByRole("button", { name: "保存内容", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const publicPage = await context.newPage();
  await publicPage.goto(base);
  await publicPage.getByRole("heading", { name: /后台维护的活动/ }).waitFor();
  await publicPage.close();
  checks.push("Homepage content updates public page");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: output + "/mobile-content.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  checks.push("Mobile content manager has no page overflow");
  assert.deepEqual(errors, []);
  await writeFile(
    output + "/report.json",
    JSON.stringify({ checks, pageErrors: errors }, null, 2),
  );
  console.log(JSON.stringify({ checks, pageErrors: errors }, null, 2));
} finally {
  await browser.close();
}
