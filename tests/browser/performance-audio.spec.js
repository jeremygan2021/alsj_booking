import { test, expect } from "@playwright/test";

test("GM现场音频清单保护终局内容，播放互斥并支持下载和手机布局", async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const login = await page.request.post("/api/login", {
    data: { account: "gm", password: "browser-gm-password" },
  });
  expect(login.ok()).toBeTruthy();
  await page.goto("/admin");
  await page.getByRole("button", { name: "现场演绎音频", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "现场演绎播放台" }),
  ).toBeVisible();
  await expect(page.locator(".performance-toolbar")).toContainText("14段");
  await expect(page.locator(".performance-track")).toHaveCount(14);
  const endings = page.locator(".performance-spoilers");
  await expect(endings).not.toHaveAttribute("open");
  const audio = (id) => page.locator(`audio[aria-label^="${id} "]`);
  await expect(audio("A10")).not.toBeVisible();
  await expect(audio("A11")).not.toBeVisible();
  await expect(audio("A12")).not.toBeVisible();

  const a02 = audio("A02");
  await a02.evaluate((element) => element.play());
  await expect
    .poll(() => a02.evaluate((element) => element.paused))
    .toBe(false);
  await expect(page.locator(".performance-toolbar [role=status]")).toHaveText(
    "正在播放 A02",
  );
  const b01 = audio("B01");
  await b01.evaluate((element) => element.play());
  await expect.poll(() => a02.evaluate((element) => element.paused)).toBe(true);
  await expect
    .poll(() => b01.evaluate((element) => element.paused))
    .toBe(false);
  await expect(page.locator(".performance-toolbar [role=status]")).toHaveText(
    "正在播放 B01",
  );
  await page.getByRole("button", { name: "全部暂停", exact: true }).click();
  await expect.poll(() => b01.evaluate((element) => element.paused)).toBe(true);
  await expect(page.locator(".performance-toolbar [role=status]")).toHaveText(
    "待播放",
  );

  const links = page.locator(".performance-track .performance-links a");
  await expect(links).toHaveCount(14);
  for (const link of await links.all()) {
    await expect(link).toHaveAttribute(
      "href",
      /^\/api\/staff\/performance-audio\/[AB]\d{2}\/file$/,
    );
    await expect(link).toHaveAttribute("download", /^[AB]\d{2}\.mp3$/);
  }
  await endings.locator(":scope > summary").click();
  await expect(audio("A10")).toBeVisible();
  await expect(audio("A11")).toBeVisible();
  await expect(audio("A12")).toBeVisible();
  await audio("A10").evaluate((element) => element.play());
  await expect
    .poll(() => audio("A10").evaluate((element) => element.paused))
    .toBe(false);
  await endings.locator(":scope > summary").click();
  await expect
    .poll(() => audio("A10").evaluate((element) => element.paused))
    .toBe(true);

  await a02.evaluate((element) => element.play());
  await page.getByLabel("筛选环节").selectOption("入场公开");
  await expect(page.locator(".performance-track")).toHaveCount(3);
  await expect(page.locator(".performance-toolbar [role=status]")).toHaveText(
    "待播放",
  );
  await page.getByLabel("筛选环节").selectOption("all");
  await expect(page.locator(".performance-track")).toHaveCount(14);

  const playingAudio = await audio("A02").elementHandle();
  await playingAudio.evaluate((element) => element.play());
  await expect
    .poll(() => playingAudio.evaluate((element) => element.paused))
    .toBe(false);
  await page.getByRole("button", { name: /^宾客与角色/ }).click();
  await expect
    .poll(() => playingAudio.evaluate((element) => element.paused))
    .toBe(true);
  await expect(page.locator(".performance-audio")).toHaveCount(0);
  await page.getByRole("button", { name: "现场演绎音频", exact: true }).click();
  await expect(page.locator(".performance-track")).toHaveCount(14);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "现场演绎播放台" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: testInfo.outputPath("performance-audio-mobile.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
