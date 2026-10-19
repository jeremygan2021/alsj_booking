import { test, expect } from "@playwright/test";

test("GM 取消或确认删除玩家，旧会话失效并可重新注册", async ({ page, browser }) => {
  const player = await browser.newContext();
  try {
    const contact = `delete-${Date.now()}@example.com`;
    const registered = await player.request.post("/api/register", {
      data: { name: "删除功能测试宾客", contact, password: "test-password" },
    });
    expect(registered.ok()).toBeTruthy();
    const { id } = await registered.json();
    await page.request.post("/api/login", {
      data: { account: "gm", password: "browser-gm-password" },
    });
    await page.goto("/admin");
    await page.getByRole("button", { name: "宾客与角色", exact: true }).click();
    const row = page.getByTestId("admin-player-table").getByRole("row").filter({ hasText: contact });
    await row.getByRole("button", { name: "删除玩家", exact: true }).click();
    await expect(page.getByRole("heading", { name: "确认删除玩家", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(row).toBeVisible();
    expect((await player.request.get("/api/me")).ok()).toBeTruthy();
    await row.getByRole("button", { name: "管理", exact: false }).click();
    await page.getByRole("dialog", { name: "宾客档案管理", exact: true })
      .getByRole("button", { name: "删除玩家", exact: true }).click();
    await page.getByRole("button", { name: "确认删除玩家", exact: true }).click();
    await expect(page.getByRole("heading", { name: "宾客档案管理", exact: true })).toHaveCount(0);
    await expect(row).toHaveCount(0);
    expect((await player.request.get("/api/me")).status()).toBe(401);
    const recreated = await player.request.post("/api/register", {
      data: { name: "删除功能测试宾客", contact, password: "test-password" },
    });
    expect(recreated.ok()).toBeTruthy();
    expect((await recreated.json()).id).not.toBe(id);
    const me = await (await player.request.get("/api/me")).json();
    expect(me.character).toBeFalsy();
  } finally {
    await player.close();
  }
});
