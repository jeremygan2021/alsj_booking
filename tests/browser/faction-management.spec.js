import { test, expect } from "@playwright/test";

const players = [
  {
    id: "a",
    name: "宾客甲",
    character: "夜航记者",
    preference: "conspirator",
    assigned: null,
    code: null,
    faction: "croft",
  },
  {
    id: "b",
    name: "宾客乙",
    character: "旧宅医生",
    preference: "conspirator",
    assigned: null,
    code: null,
  },
  {
    id: "c",
    name: "宾客丙",
    character: "雪原画家",
    preference: "conspirator",
    assigned: null,
    code: null,
  },
  {
    id: "d",
    name: "宾客丁",
    character: "巡夜人",
    preference: "fbi",
    assigned: null,
    code: null,
  },
  {
    id: "e",
    name: "宾客戊",
    character: "庄园访客",
    preference: "croft",
    assigned: null,
    code: null,
  },
  {
    id: "f",
    name: "宾客己",
    character: "远方来客",
    preference: "any",
    assigned: null,
    code: null,
  },
  {
    id: "g",
    name: "宾客庚",
    character: "尚未确认偏好",
    preference: null,
    assigned: null,
    code: null,
  },
];

test("GM核对后手动抽签并锁定，可筛杀手、复制独立暗号且手机布局无溢出", async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value) => {
          window.factionClipboard = value;
        },
      },
    });
  });
  const login = await page.request.post("/api/login", {
    data: { account: "gm", password: "browser-gm-password" },
  });
  expect(login.ok()).toBeTruthy();
  let catalog = {
    drawn: false,
    quota: 2,
    eligibleCount: 6,
    candidateCount: 3,
    missingPreferenceCount: 1,
    counts: { fbi: 0, croft: 0, conspirator: 0 },
    players,
    rule: "杀手席位按总人数动态分配2–5人，40人时为3人。其余玩家平均分到其他阵营。",
  };
  let draws = 0;
  await page.route("**/api/staff/factions", (route) =>
    route.fulfill({ json: catalog }),
  );
  await page.route("**/api/staff/factions/draw", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({});
    draws++;
    catalog = {
      ...catalog,
      drawn: true,
      counts: { fbi: 2, croft: 2, conspirator: 2 },
      players: players.map((player, index) => ({
        ...player,
        assigned:
          index >= 6
            ? null
            : index < 2
              ? "conspirator"
              : index < 4
                ? "fbi"
                : "croft",
        code:
          index < 2
            ? [
                "雪鸮北窗·暮钟旧塔·银舟夜雨·归雁清泉",
                "银狐听雪·长空飞萤·霜林紫藤·山川月影",
              ][index]
            : null,
      })),
    };
    await route.fulfill({ json: catalog });
  });
  await page.goto("/admin");
  await page.getByRole("button", { name: "阵营与暗号", exact: true }).click();
  const table = page.getByTestId("faction-player-table");
  await expect(table.locator("tbody tr")).toHaveCount(7);
  await expect(table.getByText("等待抽签", { exact: true })).toHaveCount(7);
  await expect(table).toContainText("服从分配");
  await expect(page.locator(".faction-control")).toContainText(
    "抽签后将提前告知每名杀手真凶身份",
  );
  await expect(page.locator(".faction-control")).toContainText(
    "活动开始前找到凶手",
  );
  await expect(page.locator(".faction-missing-preference")).toContainText(
    "名已付费、角色已批准的玩家尚未选择阵营偏好，不会参加本次抽签",
  );
  await expect(page.locator(".faction-control")).not.toContainText(
    "不预知凶手",
  );
  await expect(page.locator(".faction-control")).not.toContainText(
    "无需与凶手接头",
  );
  await expect(page.locator(".faction-draw-rule")).toContainText("40人时为3人");
  expect(draws).toBe(0);
  await page.getByRole("button", { name: "开始阵营抽签", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "确认阵营抽签" }),
  ).toContainText("锁定结果");
  expect(draws).toBe(0);
  await page.getByRole("button", { name: "返回核对名单", exact: true }).click();
  await expect(page.getByRole("region", { name: "确认阵营抽签" })).toHaveCount(
    0,
  );
  expect(draws).toBe(0);
  await page.getByRole("button", { name: "开始阵营抽签", exact: true }).click();
  await page
    .getByRole("button", { name: "确认抽签并锁定阵营", exact: true })
    .click();
  await expect(page.locator(".faction-control")).toContainText(
    "已抽签 · 阵营已锁定",
  );
  await expect(
    page.getByRole("button", { name: "开始阵营抽签", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".faction-counts")).toContainText("杀手阵营2人");
  expect(draws).toBe(1);
  await page.getByLabel("筛选阵营名单").selectOption("conspirator");
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await expect(table).toContainText("雪鸮北窗·暮钟旧塔·银舟夜雨·归雁清泉");
  await expect(table).toContainText("银狐听雪·长空飞萤·霜林紫藤·山川月影");
  await page
    .getByRole("button", { name: "复制宾客甲的接头暗号", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.factionClipboard))
    .toBe("雪鸮北窗·暮钟旧塔·银舟夜雨·归雁清泉");
  await page
    .getByRole("button", { name: "复制杀手暗号名单", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.factionClipboard))
    .toBe(
      "宾客甲（夜航记者）：雪鸮北窗·暮钟旧塔·银舟夜雨·归雁清泉\n宾客乙（旧宅医生）：银狐听雪·长空飞萤·霜林紫藤·山川月影",
    );
  await page.getByLabel("搜索阵营名单").fill("夜航");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await page.getByLabel("搜索阵营名单").fill("");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    table.getByText("雪鸮北窗·暮钟旧塔·银舟夜雨·归雁清泉", { exact: true }),
  ).toBeVisible();
  expect(
    (await page.getByLabel("搜索阵营名单").boundingBox()).width,
  ).toBeGreaterThan(200);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: testInfo.outputPath("faction-management-mobile.png"),
    fullPage: true,
  });
  await page.reload();
  await page.getByRole("button", { name: "阵营与暗号", exact: true }).click();
  await expect(page.locator(".faction-control")).toContainText("不能重新抽签");
  expect(draws).toBe(1);
  expect(errors).toEqual([]);
});

test("NPC没有阵营暗号管理入口，也不请求完整暗号名单", async ({ page }) => {
  const login = await page.request.post("/api/auth/sms/login", {
    data: { phone: "13500000001", code: "188888" },
  });
  expect(login.ok()).toBeTruthy();
  let factionRequests = 0;
  await page.route("**/api/staff/factions**", async (route) => {
    factionRequests++;
    await route.fulfill({ status: 403, json: { error: "仅GM可访问" } });
  });
  await page.goto("/admin");
  await expect(
    page.getByRole("button", { name: "我的NPC剧本", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "阵营与暗号", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".faction-management")).toHaveCount(0);
  expect(factionRequests).toBe(0);
});
