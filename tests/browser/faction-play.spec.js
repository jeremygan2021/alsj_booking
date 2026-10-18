import { test, expect } from "@playwright/test";
import { factionPolicies } from "../../server/faction-play.js";

const policies = () =>
  Object.entries(factionPolicies).map(([id, policy]) => ({
    id,
    ...policy,
    proposal: null,
    supports: [],
    achieved: false,
  }));

test("手机阵营任务只需提案和真实外组支持，和个人价值票保持独立", async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let state = {
    phase: 3,
    open: true,
    canParticipate: true,
    groupId: 1,
    faction: "fbi",
    policies: policies(),
    evidence: [{ id: "E-22", title: "私人数据审计记录" }],
    groupSupport: null,
  };
  state.policies.find((p) => p.id === "croft").proposal = {
    evidenceId: "E-10",
    evidenceTitle: "90天冻结条款",
    explanation: "冻结期间重大处置需要独立监督，不能由个人直接接管。",
    groupId: 3,
    updatedAt: 1000,
    reviewStatus: "approved",
    reviewNote: null,
  };
  state.policies.find((p) => p.id === "croft").canSupport = true;
  await page.route("**/api/session", (r) =>
    r.fulfill({ json: { role: "player", id: "policy-player" } }),
  );
  await page.route("**/api/public", async (r) => {
    const response = await r.fetch();
    const data = await response.json();
    await r.fulfill({
      response,
      json: { ...data, settings: { ...data.settings, phase: 3 } },
    });
  });
  await page.route("**/api/me", (r) =>
    r.fulfill({
      json: {
        player: {
          id: "policy-player",
          name: "协商宾客",
          group_id: 1,
          payment: "paid",
          checked_in: 1,
          coins: 20,
        },
        character: {
          name: "调查记者",
          status: "approved",
          story: "我带着调查资料赴宴。",
          cosplay_character: "原创记者",
          faction: "fbi",
        },
        faction: { assigned: "fbi", preference: "fbi", drawn: true },
        missions: [],
        relations: [],
        ledger: [],
        inventory: [],
        vote: null,
      },
    }),
  );
  await page.route("**/api/clues", (r) =>
    r.fulfill({ json: { clues: [], checks: [] } }),
  );
  await page.route("**/api/lots", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/faction-play", (r) => r.fulfill({ json: state }));
  const requests = [];
  await page.route("**/api/faction-play/proposal", async (r) => {
    const data = r.request().postDataJSON();
    requests.push(data);
    state.policies.find((p) => p.id === "fbi").proposal = {
      evidenceId: data.evidenceId,
      evidenceTitle: "私人数据审计记录",
      explanation: data.explanation,
      groupId: 1,
      updatedAt: 2000,
      reviewStatus: "pending",
      reviewNote: null,
    };
    await r.fulfill({ json: state });
  });
  await page.route("**/api/faction-play/support", async (r) => {
    const data = r.request().postDataJSON();
    requests.push(data);
    state.groupSupport = data.faction;
    state.policies.forEach((p) => {
      p.canSupport = false;
    });
    const target = state.policies.find((p) => p.id === data.faction);
    target.supports = [{ groupId: 1, faction: "fbi" }];
    target.achieved = true;
    await r.fulfill({ json: state });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/play");
  const card = page.locator(".faction-play");
  await expect(card).toContainText("我的阵营任务");
  await card.getByText("用一条正式证据提出保障条款", { exact: true }).click();
  await card.getByLabel("本调查组已取得的正式证据").selectOption("E-22");
  await card
    .getByLabel("说明证据如何支持条款（10—240字）")
    .fill("这份审计记录包含私密数据，应独立封存原始资料并限制公开内容。");
  await card
    .getByRole("button", { name: "提交本方证据说明", exact: true })
    .click();
  await expect(card).toContainText("待复核与外组支持");
  await card
    .getByRole("button", { name: "协商后代表本组支持", exact: true })
    .click();
  await expect(card).toContainText("签字不绑定你个人的最终价值票");
  await card
    .getByRole("button", { name: "确认代表第1组支持", exact: true })
    .click();
  await expect(card).toContainText("本调查组已支持此条款");
  expect(requests[0].evidenceId).toBe("E-22");
  expect(requests[1]).toEqual({ faction: "croft", proposalUpdatedAt: 1000 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: testInfo.outputPath("faction-play-mobile.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("GM实际按钮复核证据关联，拒绝时显示撤回支持的原因", async ({ page }) => {
  const login = await page.request.post("/api/login", {
    data: { account: "gm", password: "browser-gm-password" },
  });
  expect(login.ok()).toBeTruthy();
  let board = { phase: 3, policies: policies() };
  const target = board.policies.find((p) => p.id === "fbi");
  target.proposal = {
    evidenceId: "E-22",
    evidenceTitle: "审计资料",
    explanation: "审计资料应独立封存，并遮蔽私人内容。",
    groupId: 1,
    updatedAt: 1000,
    submittedBy: "policy-author",
    reviewStatus: "pending",
    reviewNote: null,
  };
  target.supports = [
    { groupId: 3, faction: "croft", signedBy: "policy-signer" },
  ];
  await page.route("**/api/staff/factions", (r) =>
    r.fulfill({
      json: {
        drawn: false,
        quota: 2,
        eligibleCount: 0,
        candidateCount: 0,
        counts: { fbi: 0, croft: 0, conspirator: 0 },
        players: [],
      },
    }),
  );
  await page.route("**/api/staff/faction-play", (r) =>
    r.fulfill({ json: board }),
  );
  const requests = [];
  await page.route("**/api/staff/faction-play/review", async (r) => {
    const data = r.request().postDataJSON();
    requests.push(data);
    target.proposal.reviewStatus = data.status;
    target.proposal.reviewNote =
      data.status === "rejected"
        ? "请补充原始证据的具体关联。第3组原支持已撤回；重提后需要重新签署。"
        : null;
    target.supports = data.status === "rejected" ? [] : target.supports;
    target.achieved = data.status === "approved" && target.supports.length > 0;
    await r.fulfill({ json: board });
  });
  await page.goto("/admin");
  await page.getByRole("button", { name: "阵营与暗号", exact: true }).click();
  const card = page.locator(".faction-play");
  await expect(card).toContainText("条件齐备，待GM复核");
  await card.getByRole("button", { name: "证据关联有效", exact: true }).click();
  await expect(card).toContainText("目标达成");
  expect(requests[0].status).toBe("approved");
  await card
    .getByLabel("GM复核说明（可选，最多180字）")
    .fill("请补充原始证据的具体关联。");
  await card
    .getByRole("button", { name: "需补充，撤回原支持", exact: true })
    .click();
  await expect(card).toContainText("第3组原支持已撤回");
  expect(requests[1].status).toBe("rejected");
});
