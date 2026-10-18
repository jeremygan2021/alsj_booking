import { test, expect } from "@playwright/test";

let registrationNumber = 0;
async function mockPlayer(page, initialFaction, character) {
  const registration = await page.request.post("/api/register", {
    data: {
      name: "阵营浏览器测试宾客",
      contact: `faction-${Date.now()}-${registrationNumber++}@example.com`,
      password: "faction-browser-password",
    },
  });
  expect(registration.ok()).toBeTruthy();
  let faction = initialFaction;
  const requests = [];
  await page.route("**/api/me", async (route) => {
    const response = await route.fetch();
    const me = await response.json();
    await route.fulfill({
      response,
      json: { ...me, faction, ...(character ? { character } : {}) },
    });
  });
  await page.route("**/api/factions/preference", async (route) => {
    const data = route.request().postDataJSON();
    requests.push(data);
    faction = { ...faction, preference: data.preference };
    await route.fulfill({ json: { faction } });
  });
  return requests;
}

test("玩家先选择阵营偏好，杀手报名有抽签提示，保存后才创建角色且可修改", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const requests = await mockPlayer(page, {
    preference: null,
    assigned: null,
    drawn: false,
  });
  await page.goto("/play");
  await expect(
    page.getByRole("heading", { name: "先选择你的阵营偏好" }),
  ).toBeVisible();
  await expect(page.locator('[name="cosplay_character"]')).toHaveCount(0);
  await expect(page.getByRole("radio")).toHaveCount(4);
  await expect(
    page.getByRole("button", { name: "保存偏好，继续创建角色" }),
  ).toBeDisabled();
  await expect(page.locator(".faction-lottery-notice")).toContainText(
    "不保证入选",
  );
  await expect(page.locator(".faction-lottery-notice")).toContainText(
    "杀手阵营需要抽签",
  );
  await expect(page.locator(".faction-lottery-notice")).toContainText(
    "其余玩家会尽量平均分到另外两个阵营",
  );
  await expect(page.locator(".faction-lottery-notice")).toContainText(
    "2–5个名额",
  );
  await page.getByRole("radio", { name: /杀手阵营/ }).check();
  await page.getByRole("button", { name: "保存偏好，继续创建角色" }).click();
  await expect(page.locator(".cosplay-form")).toBeVisible();
  expect(requests).toEqual([{ preference: "conspirator" }]);
  await expect(page.locator(".faction-preference-saved")).toContainText(
    "正式阵营等待GM抽签",
  );
  await expect(
    page.getByText("你是杀手阵营的一员", { exact: true }),
  ).toHaveCount(0);
  await page.getByText("手动填写 / 指定Cos角色", { exact: true }).click();
  await page.locator('[name="cosplay_character"]').fill("原创侦探");
  await page.getByRole("button", { name: "修改阵营偏好" }).click();
  await page.getByRole("radio", { name: /服从安排/ }).check();
  await page.getByRole("button", { name: "保存阵营偏好", exact: true }).click();
  await expect(page.locator(".faction-preference-saved")).toContainText(
    "服从安排",
  );
  await expect(page.locator('[name="cosplay_character"]')).toHaveValue(
    "原创侦探",
  );
  expect(requests.at(-1)).toEqual({ preference: "any" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "修改阵营偏好" }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});

test("偏好保存失败时保留选择，成功保存之前不能创建角色", async ({ page }) => {
  await mockPlayer(page, { preference: null, assigned: null, drawn: false });
  await page.route("**/api/factions/preference", (route) =>
    route.fulfill({
      status: 409,
      json: { error: "阵营已经抽签，请刷新后查看身份" },
    }),
  );
  await page.goto("/play");
  await page.getByRole("radio", { name: /FBI调查阵营/ }).check();
  await page.getByRole("button", { name: "保存偏好，继续创建角色" }).click();
  await expect(page.locator(".toast")).toContainText("阵营已经抽签");
  await expect(page.getByRole("radio", { name: /FBI调查阵营/ })).toBeChecked();
  await expect(page.locator('[name="cosplay_character"]')).toHaveCount(0);
});

test("全场已抽签但尚未分配的新增玩家仍先选偏好，不能直接创建角色", async ({
  page,
}) => {
  await mockPlayer(page, {
    preference: null,
    assigned: null,
    drawn: true,
    preferenceLocked: false,
  });
  await page.goto("/play");
  await expect(
    page.getByRole("heading", { name: "先选择你的阵营偏好" }),
  ).toBeVisible();
  await expect(page.locator('[name="cosplay_character"]')).toHaveCount(0);
  await page.getByRole("radio", { name: /服从安排/ }).check();
  await page.getByRole("button", { name: "保存偏好，继续创建角色" }).click();
  await expect(page.locator(".cosplay-form")).toBeVisible();
});

test("抽中杀手后只显示本人的暗号及后端简报，偏好锁定", async ({ page }) => {
  await mockPlayer(page, {
    preference: "conspirator",
    assigned: "conspirator",
    code: "雪松藏着第七封信",
    briefing: "真正的凶手是测试接头人。请找到佩戴蓝色胸针的她，低声完成接头。",
    drawn: true,
  });
  await page.goto("/play");
  const assignment = page.getByRole("region", { name: "我的正式阵营" });
  await expect(assignment).toContainText("你是杀手阵营的一员");
  await expect(assignment).toContainText("雪松藏着第七封信");
  await expect(assignment).toContainText("活动开始前找到凶手");
  await expect(assignment).toContainText("你的专属接头暗号");
  await expect(assignment).toContainText("真正的凶手是测试接头人");
  await expect(assignment).toContainText("佩戴蓝色胸针");
  await expect(assignment).not.toContainText("人格保全");
  await expect(page.getByRole("button", { name: "修改阵营偏好" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("radio", { name: /杀手阵营/ })).toHaveCount(0);
});

test("已有角色仍可查看，进入编辑前补选偏好；旧角色阵营不会冒充正式分配", async ({
  page,
}) => {
  const character = {
    name: "旧档案宾客",
    cosplay_character: "原创旅人",
    story: "我带着祖辈留下的信件赴约，希望在庄园找到失散的朋友。",
    status: "pending",
    faction: "conspirator",
  };
  await mockPlayer(
    page,
    { preference: null, assigned: null, drawn: false },
    character,
  );
  await page.goto("/play");
  await expect(page.locator(".simple-character-summary")).toContainText(
    "原创旅人",
  );
  await expect(
    page.getByRole("heading", { name: "先选择你的阵营偏好" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "我的正式阵营" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "修改故事" }).click();
  await expect(
    page.getByRole("heading", { name: "先选择你的阵营偏好" }),
  ).toBeVisible();
  await expect(page.locator('[name="cosplay_character"]')).toHaveCount(0);
  await page.getByRole("button", { name: "返回已提交的故事" }).click();
  await expect(page.locator(".simple-character-summary")).toContainText(
    "原创旅人",
  );
});

test("已审批的老玩家可以补选阵营偏好，同时保留可读角色档案", async ({
  page,
}) => {
  await mockPlayer(
    page,
    { preference: null, assigned: null, drawn: false },
    {
      name: "旧审批宾客",
      cosplay_character: "原创学者",
      story: "我带着一份庄园档案前来赴约。",
      status: "approved",
      faction: "croft",
    },
  );
  await page.goto("/play");
  await expect(page.locator(".simple-character-summary")).toContainText(
    "原创学者",
  );
  await page.getByRole("radio", { name: /杀手阵营/ }).check();
  await page.getByRole("button", { name: "保存阵营偏好", exact: true }).click();
  await expect(page.locator(".faction-preference-saved")).toContainText(
    "杀手阵营",
  );
  await expect(page.locator(".simple-character-summary")).toContainText(
    "原创学者",
  );
  await expect(page.locator('[name="cosplay_character"]')).toHaveCount(0);
});

test("正式阵营取自抽签结果，不使用旧角色的默认或历史阵营", async ({ page }) => {
  await mockPlayer(
    page,
    { preference: "conspirator", assigned: "fbi", drawn: true, code: null },
    {
      name: "已审批宾客",
      cosplay_character: "原创记者",
      story: "今晚我来到庄园，寻找一份失落的调查档案。",
      status: "approved",
      faction: "conspirator",
      secret: "我保存了一封未寄出的家书。",
    },
  );
  await page.goto("/play");
  await expect(
    page.getByRole("region", { name: "我的正式阵营" }),
  ).toContainText("你属于FBI调查阵营");
  await expect(page.locator(".faction-contact-code")).toHaveCount(0);
  await page.getByText("我的故事与人物关系", { exact: true }).click();
  await expect(page.getByText("隐藏同伙", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("你是杀手阵营的一员", { exact: true }),
  ).toHaveCount(0);
});
