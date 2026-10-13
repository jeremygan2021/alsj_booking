import { test, expect } from "@playwright/test";
import QRCode from "qrcode";

test("免登录独立AR入口：扫码、编号、直接链接与手机布局", async ({
  page,
  baseURL,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  expect(await (await page.request.get("/api/session")).json()).toBeNull();
  const before = await (await page.request.get("/api/public")).json();
  await page.goto("/");
  await page.getByRole("button", { name: "AR搜证", exact: true }).click();
  await expect(page).toHaveURL(/\/ar$/);
  await expect(
    page.getByRole("heading", { name: "AR搜证", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("public-ar-clue")).toHaveCount(0);
  await page.getByTestId("public-ar-scan").click();
  const buffer = await QRCode.toBuffer(`${baseURL}/ar?clue=E-06`, {
    width: 512,
  });
  await page.locator(".scanner-file input").setInputFiles({
    name: "E-06.png",
    mimeType: "image/png",
    buffer,
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("public-ar-clue")).toContainText("E-06");
  await expect(page.getByTestId("model-loaded")).toBeVisible({
    timeout: 30000,
  });
  const clue = await (await page.request.get("/api/ar/clues/E-06")).json();
  await expect(page.getByTestId("public-ar-clue")).toContainText(clue.body);
  await expect(page.locator("model-viewer")).toHaveJSProperty(
    "src",
    clue.model_url,
  );
  await page.locator(".public-ar-manual summary").click();
  await page.getByLabel("线索编号或现场链接").fill("E-02");
  await page.getByRole("button", { name: "查看线索", exact: true }).click();
  await expect(page.getByTestId("public-ar-clue")).toContainText("E-02");
  await expect(page.getByTestId("model-loaded")).toBeVisible({
    timeout: 30000,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ar?clue=E-01");
  await expect(page.getByTestId("public-ar-clue")).toContainText("E-01");
  await expect(page.getByTestId("model-loaded")).toBeVisible({
    timeout: 30000,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "output/playwright/public-ar-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "活动介绍", exact: true }).click();
  await expect(page).toHaveURL(baseURL + "/");
  await page.goBack();
  await expect(page).toHaveURL(/\/ar\?clue=E-01$/);
  await expect(page.getByTestId("public-ar-clue")).toContainText("E-01");
  await page.goForward();
  await expect(page).toHaveURL(baseURL + "/");
  await expect(page.getByTestId("public-ar-clue")).toHaveCount(0);
  expect(await page.context().cookies()).toEqual([]);
  const after = await (await page.request.get("/api/public")).json();
  expect(after.registered).toBe(before.registered);
  expect(after.settings).toEqual(before.settings);
  expect(errors).toEqual([]);
});

test("匿名旧线索链接跳转公开AR，坏码提供可恢复提示", async ({ page }) => {
  await page.goto("/play?clue=E-01");
  await expect(page).toHaveURL(/\/ar\?clue=E-01$/);
  await expect(page.getByTestId("public-ar-clue")).toContainText("E-01");
  await page.goto("/ar?clue=E-99");
  await expect(page.getByRole("alert")).toContainText("证物不存在");
  await expect(page.getByTestId("public-ar-scan")).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "重新查看", exact: true }),
  ).toBeEnabled();
});

test("独立AR页不依赖报名及会话接口加载", async ({ page }) => {
  await page.route("**/api/session", (route) => route.abort());
  await page.route("**/api/public", (route) => route.abort());
  await page.goto("/ar?clue=E-01");
  await expect(
    page.getByRole("heading", { name: "AR搜证", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("public-ar-clue")).toContainText("E-01");
  await expect(page.getByTestId("model-loaded")).toBeVisible({
    timeout: 30000,
  });
});

test("匿名Android原生AR入口不被WebXR检测挡住", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    viewport: { width: 390, height: 844 },
  });
  try {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "xr", {
        value: undefined,
        configurable: true,
      });
    });
    const page = await context.newPage();
    await page.goto(baseURL + "/ar?clue=E-01");
    await expect(page.getByTestId("model-loaded")).toBeVisible({
      timeout: 30000,
    });
    await expect(page.locator("model-viewer")).toHaveAttribute(
      "ar-modes",
      "webxr scene-viewer quick-look",
    );
    await expect(
      page.getByRole("button", { name: "放到现实中", exact: true }),
    ).toBeEnabled();
    expect(await context.cookies()).toEqual([]);
  } finally {
    await context.close();
  }
});
