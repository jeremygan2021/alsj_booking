import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("198元门票入口显示提供的微信码，不自动核验付款", async ({ page }) => {
  const pub = await (await page.request.get("/api/public")).json();
  expect(pub.settings.price).toBe(198);
  await page.goto("/");
  await page.getByRole("button", { name: "微信购票 · ¥198", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "微信购票", exact: true });
  await expect(dialog).toContainText("¥198");
  await expect(dialog).toContainText("扫描二维码添加微信，联系付款");
  const image = dialog.getByRole("img", { name: "活动联系人的微信加好友二维码" });
  await expect(image).toBeVisible();
  await expect(image).toHaveJSProperty("naturalWidth", 888);
  const response = await page.request.get(await image.getAttribute("src"));
  expect(await response.body()).toEqual(await readFile(new URL("../../public/payment/wechat-contact.jpg", import.meta.url)));
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  const registration = await page.request.post("/api/register", {
    data: { name: "票务测试", contact: `ticket-${Date.now()}@example.com`, password: "test-password" },
  });
  expect(registration.ok()).toBeTruthy();
  await page.goto("/play");
  await page.getByRole("button", { name: "去付费 · ¥198", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(image).toBeVisible();
  expect((await (await page.request.get("/api/me")).json()).player.payment).toBe("pending");
});
