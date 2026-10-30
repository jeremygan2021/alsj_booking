import { test, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import sharp from "sharp";
import jsQR from "jsqr";
import { avatarData } from "../profile-fixture.js";

test("已付款角色卡：网页预览、PNG与半A4 PDF、两人合排、扫码自动登录", async ({
  page,
  browser,
  baseURL,
}) => {
  const output = "output/playwright/role-cards";
  await mkdir(output, { recursive: true });
  const stamp = Date.now();
  const contexts = [];
  const errors = [];
  const register = async (index, name, portrait) => {
    const context = await browser.newContext({ baseURL });
    contexts.push(context);
    const registered = await context.request.post("/api/register", {
      data: {
        name: `角色卡宾客${index}`,
        contact: `card-${stamp}-${index}@example.com`,
        password: "test-card-password",
      },
    });
    expect(registered.ok()).toBeTruthy();
    const { id } = await registered.json();
    await context.request.post("/api/factions/preference", {
      data: { preference: "fbi" },
    });
    if (portrait) {
      const bytes = await readFile(`src/assets/npcs/${portrait}.webp`);
      const response = await context.request.post("/api/avatar", {
        data: { data: "data:image/webp;base64," + bytes.toString("base64") },
      });
      expect(response.ok()).toBeTruthy();
    } else {
      expect(
        (
          await context.request.post("/api/avatar", {
            data: { data: avatarData },
          })
        ).ok(),
      ).toBeTruthy();
    }
    const response = await context.request.post("/api/character", {
      data: {
        name,
        english: index === 1 ? "Eileen Voss" : "Ryan Miller",
        profession: "记忆档案调查员",
        skill: "洞察",
        cosplay_character: index === 1 ? "福尔摩斯" : "原创调查员",
        cosplay_source: "最后的遗嘱",
        story:
          "我曾整理ECHO项目的早期档案，发现一份与旧友有关的邀请。今晚，我来到索恩庄园，想听听那些被保存的声音，也想知道谁有权决定它们的未来。".repeat(
            index === 2 ? 8 : 2,
          ),
        motive: "找到旧友留下的记忆档案，核实其中的授权记录。",
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return { context, id, name };
  };
  try {
    const first = await register(1, "艾琳·沃斯", "detective");
    const second = await register(2, "莱恩·米勒", "singer");
    const third = await register(3, "尚未付款的宾客", null);
    await page.request.post("/api/login", {
      data: { account: "gm", password: "browser-gm-password" },
    });
    for (const player of [first, second]) {
      expect(
        (
          await page.request.post(`/api/staff/players/${player.id}`, {
            data: { payment: "paid" },
          })
        ).ok(),
      ).toBeTruthy();
    }
    await page.goto("/admin");
    await page.getByRole("button", { name: "宾客与角色", exact: true }).click();
    const table = page.getByTestId("admin-player-table");
    const unpaidRow = table
      .getByRole("row")
      .filter({ hasText: `card-${stamp}-3@example.com` });
    await expect(
      unpaidRow.getByRole("button", { name: "角色卡", exact: true }),
    ).toBeDisabled();
    const firstRow = table
      .getByRole("row")
      .filter({ hasText: `card-${stamp}-1@example.com` });
    const popup = page.waitForEvent("popup");
    await firstRow.getByRole("link", { name: "角色卡", exact: true }).click();
    const single = await popup;
    single.on("pageerror", (e) => errors.push(e.message));
    const generateButton = single.getByRole("button", {
      name: "生成简洁角色卡",
      exact: true,
    });
    await expect(generateButton).toBeEnabled();
    await expect(
      single.getByRole("button", { name: "下载双面 PDF", exact: true }),
    ).toBeDisabled();
    await generateButton.click();
    await expect(
      single.getByRole("button", { name: "下载双面 PDF", exact: true }),
    ).toBeEnabled();
    await expect(
      single.getByRole("heading", { name: "我的故事", exact: true }),
    ).not.toBeVisible();
    const ownCards = await (
      await first.context.request.post("/api/role-cards", { data: {} })
    ).json();
    const accessUrl = new URL(ownCards.cards[0].accessPath, baseURL).href;
    expect(
      Array.from(ownCards.cards[0].summary.body.story).length,
    ).toBeLessThanOrEqual(72);
    await single.screenshot({
      path: `${output}/web-desktop.png`,
      fullPage: true,
    });
    const frontDownload = single.waitForEvent("download");
    await single
      .getByRole("button", { name: "下载正面 PNG", exact: true })
      .click();
    await (await frontDownload).saveAs(`${output}/front.png`);
    await single.getByRole("button", { name: "背面", exact: true }).click();
    await single
      .locator(".role-card-stage-turn")
      .evaluate((e) => Promise.all(e.getAnimations().map((a) => a.finished)));
    await single.screenshot({ path: `${output}/web-back.png`, fullPage: true });
    const backDownload = single.waitForEvent("download");
    await single
      .getByRole("button", { name: "下载背面 PNG", exact: true })
      .click();
    await (await backDownload).saveAs(`${output}/back.png`);
    const png = await sharp(`${output}/back.png`)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(png.info.width).toBe(2480);
    expect(png.info.height).toBe(1754);
    const qr = jsQR(
      new Uint8ClampedArray(png.data),
      png.info.width,
      png.info.height,
    );
    expect(qr?.data).toBe(accessUrl);
    const pdfDownload = single.waitForEvent("download");
    await single
      .getByRole("button", { name: "下载双面 PDF", exact: true })
      .click();
    await (await pdfDownload).saveAs(`${output}/half-a4.pdf`);
    expect(await readFile(`${output}/half-a4.pdf`, "latin1")).toContain(
      "/Count 2",
    );
    const scanContext = await browser.newContext({ baseURL });
    contexts.push(scanContext);
    const scan = await scanContext.newPage();
    scan.on("pageerror", (e) => errors.push(e.message));
    await scan.goto(qr.data);
    await expect(scan).toHaveURL(`${baseURL}/play`);
    await expect(scan.locator(".player-mini-identity strong")).toHaveText(
      first.name,
    );
    await expect(scan.locator(".role-card-workspace")).toHaveCount(0);
    expect(new URL(scan.url()).hash).toBe("");
    expect(
      await (await scanContext.request.get("/api/session")).json(),
    ).toEqual({ role: "player", id: first.id });
    const me = await (await scanContext.request.get("/api/me")).json();
    expect(me.player.checked_in).toBe(0);
    expect(me.player.coins).toBe(0);
    await scan.setViewportSize({ width: 390, height: 844 });
    await scan.screenshot({ path: `${output}/web-mobile.png`, fullPage: true });
    expect(
      await scan.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await firstRow.getByRole("checkbox").check();
    await table
      .getByRole("row")
      .filter({ hasText: `card-${stamp}-2@example.com` })
      .getByRole("checkbox")
      .check();
    const batchPopup = page.waitForEvent("popup");
    await page
      .getByRole("button", { name: "导出已选角色卡（2）", exact: true })
      .click();
    const batch = await batchPopup;
    batch.on("pageerror", (e) => errors.push(e.message));
    await expect(
      batch.getByRole("button", { name: "生成简洁角色卡", exact: true }),
    ).toBeEnabled();
    await batch
      .getByRole("button", { name: "生成简洁角色卡", exact: true })
      .click();
    await expect(
      batch.getByRole("button", { name: "下载双面 PDF", exact: true }),
    ).toBeEnabled();
    const batchDownload = batch.waitForEvent("download");
    await batch
      .getByRole("button", { name: "下载双面 PDF", exact: true })
      .click();
    await (await batchDownload).saveAs(`${output}/a4-two-guests.pdf`);
    const batchPdf = await readFile(`${output}/a4-two-guests.pdf`, "latin1");
    expect(batchPdf).toContain("/Count 2");
    expect((batchPdf.match(/\/Subtype \/Image/g) || []).length).toBe(4);
    await batch.evaluate(() => {
      window.print = () => {
        window.__printedCardsReady = [
          ...document.querySelectorAll(".role-card-print-artwork"),
        ].every((image) => image.complete && image.naturalWidth === 2480);
      };
    });
    await batch.getByRole("button", { name: "打印", exact: true }).click();
    await expect
      .poll(() => batch.evaluate(() => window.__printedCardsReady))
      .toBe(true);
    await batch.emulateMedia({ media: "print" });
    await batch.pdf({
      path: `${output}/browser-print-a4.pdf`,
      preferCSSPageSize: true,
      printBackground: true,
    });
    await batch.emulateMedia({ media: "screen" });
    // The same tab must exchange a new QR credential, rather than keep its old account.
    const secondCards = await (
      await second.context.request.post("/api/role-cards", { data: {} })
    ).json();
    await scan.goto(new URL(secondCards.cards[0].accessPath, baseURL).href);
    await expect(scan).toHaveURL(`${baseURL}/play`);
    await expect(scan.locator(".player-mini-identity strong")).toHaveText(
      second.name,
    );
    expect(
      (await (await scanContext.request.get("/api/session")).json()).id,
    ).toBe(second.id);
    await page.request.post(`/api/staff/players/${third.id}`, {
      data: { payment: "paid" },
    });
    await batch.goto(
      `/role-cards?players=${first.id},${second.id},${third.id}`,
    );
    await expect(
      batch.getByRole("button", { name: "生成简洁角色卡", exact: true }),
    ).toBeEnabled();
    await batch
      .getByRole("button", { name: "生成简洁角色卡", exact: true })
      .click();
    await expect(
      batch.getByRole("button", { name: "下载双面 PDF", exact: true }),
    ).toBeEnabled();
    const oddDownload = batch.waitForEvent("download");
    await batch
      .getByRole("button", { name: "下载双面 PDF", exact: true })
      .click();
    await (await oddDownload).saveAs(`${output}/a4-three-guests.pdf`);
    expect(await readFile(`${output}/a4-three-guests.pdf`, "latin1")).toContain(
      "/Count 4",
    );
    await single
      .getByRole("button", { name: "重置此宾客的登录二维码", exact: true })
      .click();
    await single
      .getByRole("button", { name: "重置并更新角色卡", exact: true })
      .click();
    await expect(
      single.getByRole("button", { name: "下载双面 PDF", exact: true }),
    ).toBeEnabled();
    await scan.goto(accessUrl);
    await expect(scan.getByRole("alert")).toContainText("无效或已重置");
    expect(errors).toEqual([]);
  } finally {
    for (const context of contexts) await context.close();
  }
});
