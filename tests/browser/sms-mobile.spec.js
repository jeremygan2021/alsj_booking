import { test, expect } from "@playwright/test";

test.use({ hasTouch: true });
for (const width of [320, 390]) {
  test(`${width}px手机单击真实短信发送入口，不展示测试登录信息`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    // Even stale public metadata must never reveal or fill a test code.
    await page.route("**/api/public", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      data.auth = { ...data.auth, sms: true, devShortcut: true };
      await route.fulfill({ response, json: data });
    });
    let sends = 0;
    await page.route("**/api/auth/sms/send", async (route) => {
      sends++;
      expect(route.request().postDataJSON()).toEqual({ phone: "13500000001" });
      await route.fulfill({ json: { retryAfter: 60 } });
    });
    await page.goto("/play");
    await page.getByRole("button", { name: "第一次来，报名参加" }).tap();
    await expect(page.getByRole("dialog")).not.toContainText(/188888|快捷/);
    await page.getByRole("textbox", { name: "手机号", exact: true }).fill("13500000001");
    const button = page.getByRole("button", { name: "获取验证码", exact: true });
    await expect(button).toBeEnabled();
    expect(await page.getByRole("dialog").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBeTruthy();
    const bounds = await button.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(await page.locator('[name="phone"]').evaluate((element) => getComputedStyle(element).fontSize)).toBe("16px");
    await button.tap();
    await expect(page.getByRole("status")).toContainText("验证码已提交发送");
    expect(sends).toBe(1);
    await expect(page.getByRole("textbox", { name: "短信验证码", exact: true })).toHaveValue("");
    await expect(page.getByRole("button", { name: /秒后重发/ })).toBeDisabled();
    if (width === 390) await page.screenshot({ path: "output/playwright/sms-real-mobile.png", fullPage: true });
  });
}
