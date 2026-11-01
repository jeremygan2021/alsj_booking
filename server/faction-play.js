import { INVESTIGATION_GROUPS } from "../src/investigation-groups.js";

// Policy collaboration is independent of case answers and individual value votes.
// Historical faction IDs are preserved to keep existing rosters compatible.
export const factionPolicies = Object.freeze({
  fbi: {
    name: "FBI调查阵营",
    title: "独立封存，有限公开",
    clause:
      "原始审计资料交独立调查方封存；公开调查结论时遮蔽无关者的私人信息。",
    boundary: "可以协商公开时间和监督席位，不能毁损、隐匿原始调查资料。",
  },
  croft: {
    name: "索恩遗产阵营",
    title: "依照遗嘱，独立受托",
    clause:
      "冻结期间由独立受托安排管理ADS资产和关键权限；重大处置核对有效遗嘱及既有权利，不由某位高管单独决定。",
    boundary: "可以接受审计和暂停新增业务，不能借保护遗产掩盖违法交易。",
  },
  conspirator: {
    name: "杀手阵营",
    title: "保全90天，逐一审查",
    clause:
      "90天冻结期间维持既有运行与获准访问，停止不可逆删除；由独立审查逐一核对逝者意愿和授权。",
    boundary:
      "可以争取人格保全、为凶手辩护或影响判断；不能篡改官方物证。已知凶手身份和个人接头暗号以GM私有简报为准。",
  },
});

export const factionPlaySchemaSQL = [
  "CREATE TABLE IF NOT EXISTS faction_policy_proposals(faction TEXT PRIMARY KEY CHECK(faction IN ('fbi','croft','conspirator')),evidence_id TEXT NOT NULL REFERENCES clues(id),explanation TEXT NOT NULL,submitted_by TEXT NOT NULL REFERENCES players(id),group_id INTEGER NOT NULL,updated_at BIGINT NOT NULL,review_status TEXT NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending','approved','rejected')),review_note TEXT,reviewed_by TEXT,reviewed_at BIGINT)",
  "CREATE TABLE IF NOT EXISTS faction_policy_supports(group_id INTEGER PRIMARY KEY,faction TEXT NOT NULL REFERENCES faction_policy_proposals(faction),signed_by TEXT NOT NULL REFERENCES players(id),signer_faction TEXT NOT NULL CHECK(signer_faction IN ('fbi','croft','conspirator')),created_at BIGINT NOT NULL)",
];

export async function migrateFactionPlay(
  db,
  postgres = typeof db.exec !== "function",
) {
  for (const sql of factionPlaySchemaSQL) await db.prepare(sql).run();
  // Also cover local databases opened during development before GM review was added.
  const columns = postgres
    ? (
        await db
          .prepare(
            "SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='faction_policy_proposals'",
          )
          .all()
      ).map((c) => c.column_name)
    : (
        await db.prepare("PRAGMA table_info(faction_policy_proposals)").all()
      ).map((c) => c.name);
  for (const [name, type] of Object.entries({
    review_status: "TEXT NOT NULL DEFAULT 'pending'",
    review_note: "TEXT",
    reviewed_by: "TEXT",
    reviewed_at: "BIGINT",
  })) {
    if (!columns.includes(name))
      await db
        .prepare(
          `ALTER TABLE faction_policy_proposals ADD COLUMN ${name} ${type}`,
        )
        .run();
  }
}

export function createFactionPlayService({
  one,
  all,
  run,
  tx,
  fail,
  now = Date.now,
}) {
  const phase = async () =>
    Number((await one("SELECT phase FROM settings WHERE id=1"))?.phase || 1);
  const actor = async (id, requirePlayable = false) => {
    const value = await one(
      "SELECT p.id,p.name,p.group_id,p.payment,p.checked_in,c.status,a.faction FROM players p LEFT JOIN characters c ON c.player_id=p.id LEFT JOIN faction_assignments a ON a.player_id=p.id WHERE p.id=?",
      id,
    );
    if (!value) fail("玩家不存在", 404);
    if (requirePlayable) {
      if (
        value.payment !== "paid" ||
        !value.checked_in ||
        value.status !== "approved"
      )
        fail("请先完成票务核验、角色审核和现场签到", 403);
      if (!factionPolicies[value.faction]) fail("请等待GM确认正式阵营", 403);
      if (!INVESTIGATION_GROUPS.includes(value.group_id))
        fail("请联系GM确认调查组", 403);
    }
    return value;
  };
  const assertOpen = async () => {
    if ((await phase()) !== 3)
      fail("阵营协商仅在第三幕开放；第四幕展示结算", 403);
  };
  const board = async (gm = false) => {
    const proposals = await all(
      "SELECT q.*,c.title AS evidence_title FROM faction_policy_proposals q JOIN clues c ON c.id=q.evidence_id ORDER BY q.faction",
    );
    const supports = await all(
      "SELECT * FROM faction_policy_supports ORDER BY group_id",
    );
    return Object.entries(factionPolicies).map(([id, policy]) => {
      const proposal = proposals.find((q) => q.faction === id);
      const signed = supports.filter((q) => q.faction === id);
      return {
        id,
        ...policy,
        proposal: proposal
          ? {
              evidenceId: proposal.evidence_id,
              evidenceTitle: proposal.evidence_title,
              explanation: proposal.explanation,
              updatedAt: proposal.updated_at,
              reviewStatus: proposal.review_status,
              reviewNote: proposal.review_note || null,
              ...(gm
                ? {
                    groupId: proposal.group_id,
                    submittedBy: proposal.submitted_by,
                  }
                : {}),
            }
          : null,
        supports: signed.map((q) => ({
          groupId: q.group_id,
          ...(gm
            ? {
                faction: q.signer_faction,
                signedBy: q.signed_by,
                createdAt: q.created_at,
              }
            : {}),
        })),
        achieved: Boolean(
          proposal?.review_status === "approved" && signed.length,
        ),
      };
    });
  };
  const state = async (playerId) => {
    const currentPhase = await phase(),
      p = await actor(playerId);
    const canParticipate =
      p.payment === "paid" &&
      Boolean(p.checked_in) &&
      p.status === "approved" &&
      Boolean(factionPolicies[p.faction]);
    const evidence =
      canParticipate && currentPhase >= 3
        ? await all(
            "SELECT DISTINCT c.id,c.title FROM clues c JOIN unlocks u ON u.clue_id=c.id JOIN players p ON p.id=u.player_id WHERE p.group_id=? AND c.phase<=? ORDER BY c.id",
            p.group_id,
            currentPhase,
          )
        : [];
    const groupSupport =
      currentPhase >= 3 && canParticipate
        ? (
            await one(
              "SELECT faction FROM faction_policy_supports WHERE group_id=?",
              p.group_id,
            )
          )?.faction || null
        : null;
    const policies =
      currentPhase >= 3 && canParticipate
        ? await board()
        : Object.entries(factionPolicies).map(([id, policy]) => ({
            id,
            ...policy,
            proposal: null,
            supports: [],
            achieved: false,
          }));
    for (const policy of policies) {
      const source = policy.proposal
        ? await one(
            "SELECT group_id FROM faction_policy_proposals WHERE faction=?",
            policy.id,
          )
        : null;
      policy.canSupport = Boolean(
        currentPhase === 3 &&
        canParticipate &&
        !groupSupport &&
        p.faction !== policy.id &&
        policy.proposal &&
        policy.proposal.reviewStatus !== "rejected" &&
        source?.group_id !== p.group_id,
      );
    }
    return {
      phase: currentPhase,
      open: currentPhase === 3,
      canParticipate,
      groupId: p.group_id,
      faction: p.faction || null,
      policies,
      evidence,
      groupSupport,
    };
  };
  const propose = async (playerId, input = {}) => {
    await tx(async () => {
      await assertOpen();
      const p = await actor(playerId, true);
      if (
        typeof input.evidenceId !== "string" ||
        !/^E-\d{2}$/.test(input.evidenceId)
      )
        fail("请选择一条正式证据");
      if (
        typeof input.explanation !== "string" ||
        input.explanation.trim().length < 10 ||
        input.explanation.length > 240
      )
        fail("请用10至240字说明这条证据如何支持本方条款");
      const clue = await one(
        "SELECT id,phase FROM clues WHERE id=?",
        input.evidenceId,
      );
      if (!clue || Number(clue.phase) > 3) fail("该证据尚未开放", 403);
      if (
        !(await one(
          "SELECT 1 FROM unlocks u JOIN players p ON p.id=u.player_id WHERE p.group_id=? AND u.clue_id=?",
          p.group_id,
          clue.id,
        ))
      )
        fail("请先由本调查组取得这条正式证据", 403);
      const old = await one(
        "SELECT * FROM faction_policy_proposals WHERE faction=?",
        p.faction,
      );
      const explanation = input.explanation.trim();
      if (old?.evidence_id === clue.id && old.explanation === explanation)
        return;
      if (
        await one(
          "SELECT 1 FROM faction_policy_supports WHERE faction=?",
          p.faction,
        )
      )
        fail("已有外组签署，提案已锁定，不能更换证据或解释", 409);
      await run(
        "INSERT INTO faction_policy_proposals(faction,evidence_id,explanation,submitted_by,group_id,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(faction) DO UPDATE SET evidence_id=excluded.evidence_id,explanation=excluded.explanation,submitted_by=excluded.submitted_by,group_id=excluded.group_id,updated_at=excluded.updated_at,review_status='pending',review_note=NULL,reviewed_by=NULL,reviewed_at=NULL",
        p.faction,
        clue.id,
        explanation,
        p.id,
        p.group_id,
        Math.max(now(), Number(old?.updated_at || 0) + 1),
      );
    });
    return state(playerId);
  };
  const support = async (playerId, input = {}) => {
    await tx(async () => {
      await assertOpen();
      const p = await actor(playerId, true);
      if (!factionPolicies[input.faction]) fail("请选择有效的阵营条款");
      if (p.faction === input.faction) fail("只能为外阵营的条款签署支持", 403);
      const proposal = await one(
        "SELECT * FROM faction_policy_proposals WHERE faction=?",
        input.faction,
      );
      if (!proposal) fail("请等待该阵营先提交正式证据", 409);
      if (proposal.review_status === "rejected")
        fail("GM要求补充证据关联，请等待该阵营重新提交后再支持", 409);
      if (proposal.group_id === p.group_id)
        fail("提交组不能为自己的提案签署外组支持", 403);
      if (Number(input.proposalUpdatedAt) !== Number(proposal.updated_at))
        fail("提案刚刚更新，请刷新阅读后再签署", 409);
      const prior = await one(
        "SELECT faction FROM faction_policy_supports WHERE group_id=?",
        p.group_id,
      );
      if (prior) {
        if (prior.faction === input.faction) return;
        fail("本调查组已签署一项外阵营条款，不能重复支持其他条款", 409);
      }
      await run(
        "INSERT INTO faction_policy_supports(group_id,faction,signed_by,signer_faction,created_at) VALUES(?,?,?,?,?)",
        p.group_id,
        input.faction,
        p.id,
        p.faction,
        now(),
      );
    });
    return state(playerId);
  };
  const adminState = async () => ({
    phase: await phase(),
    policies: await board(true),
  });
  const review = async (reviewer, input = {}) => {
    await tx(async () => {
      if ((await phase()) < 3) fail("请在第三幕开始后复核提案", 403);
      if (
        !factionPolicies[input.faction] ||
        !["approved", "rejected"].includes(input.status)
      )
        fail("请选择有效的提案与复核结果");
      const proposal = await one(
        "SELECT * FROM faction_policy_proposals WHERE faction=?",
        input.faction,
      );
      if (!proposal) fail("该阵营尚未提交证据说明", 404);
      if (Number(input.proposalUpdatedAt) !== Number(proposal.updated_at))
        fail("提案已更新，请刷新后再复核", 409);
      if (
        input.note !== undefined &&
        (typeof input.note !== "string" || input.note.length > 180)
      )
        fail("复核说明最多180字");
      let note = (input.note || "").trim();
      if (input.status === "rejected") {
        const prior = await all(
          "SELECT group_id FROM faction_policy_supports WHERE faction=?",
          input.faction,
        );
        note =
          (note || "请补充证据与条款之间的具体关联。") +
          (prior.length
            ? ` 第${prior.map((p) => p.group_id).join("、")}组原支持已撤回；重提后需要重新签署。`
            : "");
        await run(
          "DELETE FROM faction_policy_supports WHERE faction=?",
          input.faction,
        );
      }
      await run(
        "UPDATE faction_policy_proposals SET review_status=?,review_note=?,reviewed_by=?,reviewed_at=? WHERE faction=?",
        input.status,
        note || null,
        reviewer,
        now(),
        input.faction,
      );
    });
    return adminState();
  };
  return { state, propose, support, adminState, review };
}

export function mountFactionPlayRoutes(
  app,
  { auth, player, playable, factionPlay },
) {
  app.get("/api/faction-play", auth("player"), async (req, res) => {
    const p = await player(req);
    res
      .set("Cache-Control", "private, no-store")
      .json(await factionPlay.state(p.id));
  });
  for (const [path, action] of [
    ["proposal", "propose"],
    ["support", "support"],
  ]) {
    app.post(`/api/faction-play/${path}`, auth("player"), async (req, res) => {
      const { p } = await playable(req);
      res
        .set("Cache-Control", "private, no-store")
        .json(await factionPlay[action](p.id, req.body || {}));
    });
  }
  app.get("/api/staff/faction-play", auth("gm"), async (req, res) => {
    res
      .set("Cache-Control", "private, no-store")
      .json(await factionPlay.adminState());
  });
  app.post("/api/staff/faction-play/review", auth("gm"), async (req, res) => {
    res
      .set("Cache-Control", "private, no-store")
      .json(await factionPlay.review(req.auth.user_id, req.body || {}));
  });
}
