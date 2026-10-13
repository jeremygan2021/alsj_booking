import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { decodeQrPixels } from "../../src/clue-scan.js";

function unzipStored(buffer) {
  const files = new Map();
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    expect(buffer.readUInt16LE(offset + 8)).toBe(0);
    const size = buffer.readUInt32LE(offset + 18);
    const nameSize = buffer.readUInt16LE(offset + 26);
    const extraSize = buffer.readUInt16LE(offset + 28);
    const name = buffer
      .subarray(offset + 30, offset + 30 + nameSize)
      .toString("utf8");
    const start = offset + 30 + nameSize + extraSize;
    files.set(name, buffer.subarray(start, start + size));
    offset = start + size;
  }
  return files;
}

async function decodePng(buffer) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return decodeQrPixels({
    data: new Uint8ClampedArray(data),
    width: info.width,
    height: info.height,
  });
}

test("GM 能下载全部证据二维码及单条 PNG，扫码链接指向当前公开 AR 入口", async ({
  page,
  baseURL,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const login = await page.request.post("/api/login", {
    data: { account: "gm", password: "browser-gm-password" },
  });
  expect(login.ok()).toBeTruthy();
  const before = await (await page.request.get("/api/staff")).json();
  const writes = [];
  page.on("request", (request) => {
    if (
      request.method() !== "GET" &&
      new URL(request.url()).pathname.startsWith("/api/staff")
    )
      writes.push(request.url());
  });
  await page.goto("/admin");
  await page.getByRole("button", { name: "证据与二维码", exact: true }).click();
  const bulkButton = page.getByTestId("download-all-clue-qr");
  await expect(bulkButton).toHaveText("下载全部证据二维码");
  const downloadPromise = page.waitForEvent("download");
  await bulkButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("阿拉斯加之夜_全部证据二维码.zip");
  const files = unzipStored(await readFile(await download.path()));
  expect(files.size).toBe(before.clues.length + 1);
  const html = files.get("index.html").toString("utf8");
  expect(html).toContain("@media print");
  const images = [...files].filter(([name]) => name.endsWith(".png"));
  expect(images).toHaveLength(before.clues.length);
  for (let index = 0; index < before.clues.length; index++) {
    const clue = before.clues[index];
    expect(await decodePng(images[index][1])).toBe(
      `${baseURL}/ar?clue=${encodeURIComponent(clue.id)}`,
    );
    if (clue.body) expect(html).not.toContain(clue.body);
    if (clue.detail) expect(html).not.toContain(clue.detail);
  }
  await expect(bulkButton).toBeEnabled();
  await page
    .locator(".staff-clue")
    .first()
    .getByRole("button", { name: "二维码", exact: true })
    .click();
  const singlePromise = page.waitForEvent("download");
  await page.getByTestId("download-clue-qr").click();
  const single = await singlePromise;
  expect(single.suggestedFilename()).toContain(before.clues[0].id);
  expect(single.suggestedFilename()).toMatch(/\.png$/);
  expect(await decodePng(await readFile(await single.path()))).toBe(
    `${baseURL}/ar?clue=${encodeURIComponent(before.clues[0].id)}`,
  );
  expect(writes).toEqual([]);
  const after = await (await page.request.get("/api/staff")).json();
  expect(after.clues).toEqual(before.clues);
  expect(errors).toEqual([]);
});
