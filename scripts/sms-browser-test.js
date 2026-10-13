import { chromium } from "@playwright/test";
import express from "express";
import { createApp } from "../server/app.js";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const output = "output/playwright/sms";
await mkdir(output, { recursive: true });
const sent = [];
let now = Date.now();
const { app, db } = await createApp({
  dbPath: ":memory:",
  gmPassword: "sms-ui-admin",
  npcPassword: "sms-ui-npc",
  smsSender: async (payload) => sent.push(payload),
  smsNow: () => now,
});
const dist = fileURLToPath(new URL("../dist/", import.meta.url));
app.use(express.static(dist));
app.get("/{*path}", (req, res) => res.sendFile(dist + "index.html"));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [],
  checks = [];
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base + "/play?clue=E-01");
  await page.getByRole("button", { name: "已经报名，登录" }).click();
  await page.getByRole("dialog", { name: "手机号注册 / 登录" }).waitFor();
  checks.push("First login opens unified SMS registration/login");
  await page
    .getByRole("textbox", { name: "手机号", exact: true })
    .fill("13800138000");
  await page.getByRole("button", { name: "获取验证码", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "验证码已提交发送" })
    .waitFor();
  assert.equal(sent.length, 1);
  await page.getByPlaceholder("6位数字").fill(sent[0].code);
  await page
    .getByRole("textbox", { name: "你的称呼（首次报名可选）" })
    .fill("验证码测试玩家");
  await page.screenshot({ path: output + "/registration.png" });
  await page.getByRole("button", { name: "验证并进入" }).click();
  await page.waitForURL(/\/play/);
  await page.getByRole("dialog", { name: /E-01/ }).waitFor();
  checks.push("SMS verification creates account and retains pending clue URL");
  const me = await (await page.request.get(base + "/api/me")).json();
  assert.equal(me.player.contact, "13800138000");
  assert.equal(me.player.payment, "pending");
  const id = me.player.id;
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "退出登录" }).click();
  await page.getByRole("button", { name: /宾客登录/ }).click();
  now += 60001;
  await page
    .getByRole("textbox", { name: "手机号", exact: true })
    .fill("13800138000");
  await page.getByRole("button", { name: "获取验证码", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "验证码已提交发送" })
    .waitFor();
  await page.getByPlaceholder("6位数字").fill(sent[1].code);
  await page.getByRole("button", { name: "验证并进入" }).click();
  await page.getByText("验证码测试玩家", { exact: true }).first().waitFor();
  assert.equal(
    (await (await page.request.get(base + "/api/me")).json()).player.id,
    id,
  );
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM players").get()).n, 1);
  checks.push("Existing phone logs in without duplicate registration");
  await page.getByRole("button", { name: "退出登录" }).click();
  await page.getByRole("button", { name: /宾客登录/ }).click();
  assert.equal(await page.locator('input[type="password"]').count(), 0);
  checks.push("Player login exposes only phone and verification code");
  await page.goto(base + "/admin");
  await page.getByRole("button", { name: "工作人员登录" }).click();
  await page.getByRole("textbox", { name: "工作人员账号" }).waitFor();
  checks.push("Admin keeps separate staff password login");
  assert.deepEqual(errors, []);
  await writeFile(
    output + "/report.json",
    JSON.stringify({ checks, pageErrors: errors }, null, 2),
  );
  console.log(JSON.stringify({ checks, pageErrors: errors }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await db.close();
}
