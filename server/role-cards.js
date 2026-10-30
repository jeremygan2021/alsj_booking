import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { generateRoleCardSummary, summaryHash } from "./role-card-summary.js";
import { isGenerationConfigured } from "./story-generation.js";

export async function migrateRoleCards(db) {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS role_card_access(player_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,nonce TEXT NOT NULL,updated_at BIGINT NOT NULL)",
    )
    .run();
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS role_card_summaries(player_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,source_hash TEXT NOT NULL,body TEXT NOT NULL,generator TEXT NOT NULL,generated_at BIGINT NOT NULL)",
    )
    .run();
}

export function mountRoleCardRoutes(
  app,
  { auth, one, all, run, tx, fail, session, secret, store, audit, generation },
) {
  const sign = (id, nonce) =>
    createHmac("sha256", secret)
      .update(`alaska-role-card:v1:${id}:${nonce}`)
      .digest("base64url");
  const eligible = async (id) => {
    const player = await one(
      "SELECT id,name,payment,group_id FROM players WHERE id=?",
      id,
    );
    if (!player) fail("宾客档案不存在", 404);
    if (player.payment !== "paid") fail("仅已付款宾客可查看和导出角色卡", 403);
    const character = await one(
      "SELECT * FROM characters WHERE player_id=?",
      id,
    );
    if (!character) fail("请先建立角色，再导出角色卡", 409);
    return { player, character };
  };
  const allowed = (req, id) => {
    if (req.auth.role !== "gm" && req.auth.user_id !== id)
      fail("只能查看自己的角色卡", 403);
  };
  const accessFor = async (id) => {
    await run(
      "INSERT OR IGNORE INTO role_card_access(player_id,nonce,updated_at) VALUES(?,?,?)",
      id,
      randomBytes(24).toString("hex"),
      Date.now(),
    );
    const { nonce } = await one(
      "SELECT nonce FROM role_card_access WHERE player_id=?",
      id,
    );
    // Fragments stay out of HTTP requests and Referer headers.
    return `/role-cards#access=${id}.${sign(id, nonce)}`;
  };
  const factionFor = async (id, status) => {
    const assignment = await one(
      "SELECT faction,contact_code FROM faction_assignments WHERE player_id=?",
      id,
    );
    const brief = {
      fbi: {
        label: "FBI调查阵营",
        mission: "还原故事线与作案手法，锁定并抓捕真凶",
        clue: "21:07的声音，未必能证明索恩当时还活着。\n核对声音来源，再重排案发时间线。",
      },
      croft: {
        label: "索恩遗产阵营",
        mission: "找到并抓捕杀手阵营的人",
        clue: "你要找到并抓捕的杀手，都有接头暗号。\n听说，暗号像四字一组的诗句。",
      },
      conspirator: { label: "杀手阵营", mission: "保护真正的凶手" },
    }[assignment?.faction];
    if (!brief) return null;
    const faction = { id: assignment.faction, ...brief };
    if (assignment.faction !== "conspirator") return faction;
    // These private fields are projected only into an authorized paid card.
    // Keep them separate from the public story sent to the summary model.
    faction.contact = null;
    if (status !== "approved") {
      faction.notice = "角色审核通过后开放接头暗号";
      return faction;
    }
    const roster = await all(
      "SELECT a.player_id,a.contact_code FROM faction_assignments a JOIN players p ON p.id=a.player_id JOIN characters c ON c.player_id=a.player_id WHERE a.faction='conspirator' AND p.payment='paid' AND c.status='approved' AND a.contact_code IS NOT NULL AND a.contact_code<>'' ORDER BY a.assigned_at,a.player_id",
    );
    const index = roster.findIndex((p) => p.player_id === id);
    // A circular hand-off gives each ready accomplice one other contact,
    // without exporting the killer roster or inventing a new password.
    const partner =
      index >= 0 && roster.length > 1
        ? roster[(index + 1) % roster.length]
        : null;
    faction.contact = {
      own: assignment.contact_code || null,
      partner: partner?.contact_code || null,
    };
    if (!faction.contact.own) faction.notice = "请联系GM确认本人接头暗号";
    else if (!partner) faction.notice = "同伴尚未就绪，请联系GM确认";
    return faction;
  };
  const cardFor = async (id) => {
    const { player, character: c } = await eligible(id);
    const site = await store.getSite();
    const card = {
      player,
      character: Object.fromEntries(
        [
          "name",
          "english",
          "profession",
          "skill",
          "cosplay_character",
          "cosplay_source",
          "avatar_url",
          "story",
          "motive",
          "status",
        ].map((key) => [key, c[key]]),
      ),
      relations:
        c.status === "approved"
          ? await all(
              "SELECT n.name npc_name,r.relation,r.player_brief,r.mission FROM character_relations r JOIN npcs n ON n.id=r.npc_id WHERE r.player_id=? ORDER BY r.npc_id",
              id,
            )
          : [],
      event: {
        title: site.title,
        subtitle: site.subtitle,
        schedule: site.schedule,
      },
      synopsis: "万圣夜，索恩庄园。一场关于记忆、秘密与选择的晚宴。",
      faction: await factionFor(id, c.status),
    };
    card.character.adaptation = c.status === "approved" ? c.adaptation : null;
    const cached = await one(
      "SELECT * FROM role_card_summaries WHERE player_id=?",
      id,
    );
    card.summary =
      cached?.source_hash === summaryHash(card)
        ? {
            body: JSON.parse(cached.body),
            generator: cached.generator,
            generatedAt: Number(cached.generated_at),
          }
        : null;
    return card;
  };
  app.post("/api/role-cards", auth("player", "gm"), async (req, res) => {
    const ids = req.body?.playerIds ?? [req.auth.user_id];
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 200 ||
      ids.some(
        (id) => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(id),
      )
    )
      fail("请选择有效的宾客角色");
    const unique = [...new Set(ids)];
    for (const id of unique) allowed(req, id);
    const cards = await tx(async () => {
      const profiles = [];
      // Validate the whole batch before creating credentials.
      for (const id of unique) profiles.push(await eligible(id));
      const output = [];
      for (const { player } of profiles) {
        output.push({
          ...(await cardFor(player.id)),
          accessPath: await accessFor(player.id),
        });
      }
      return output;
    });
    res.set("Cache-Control", "private, no-store").json({
      cards,
      role: req.auth.role,
      generation: { configured: isGenerationConfigured(generation) },
    });
  });
  const generating = new Set();
  app.post(
    "/api/role-cards/:id/generate",
    auth("player", "gm"),
    async (req, res) => {
      const id = req.params.id;
      allowed(req, id);
      const card = await cardFor(id);
      if (card.summary && !req.body?.force)
        return res.json({ summary: card.summary });
      if (generating.has(id)) fail("这位宾客的摘要正在生成，请稍候", 409);
      if (
        req.body?.force &&
        card.summary &&
        Date.now() - card.summary.generatedAt < 15000
      )
        fail("请稍候再重新生成摘要", 429);
      generating.add(id);
      try {
        // The provider call must not hold the shared game transaction lock.
        const result = await generateRoleCardSummary(card, generation);
        const generatedAt = Date.now();
        await tx(async () => {
          const current = await cardFor(id);
          if (summaryHash(current) !== summaryHash(card))
            fail("角色资料已更新，请重新生成", 409);
          await run(
            "INSERT INTO role_card_summaries(player_id,source_hash,body,generator,generated_at) VALUES(?,?,?,?,?) ON CONFLICT(player_id) DO UPDATE SET source_hash=excluded.source_hash,body=excluded.body,generator=excluded.generator,generated_at=excluded.generated_at",
            id,
            summaryHash(card),
            JSON.stringify(result.body),
            result.generator,
            generatedAt,
          );
        });
        res.json({ summary: { ...result, generatedAt } });
      } catch (error) {
        if (error.status) throw error;
        fail(error.message, 502);
      } finally {
        generating.delete(id);
      }
    },
  );
  app.post("/api/role-cards/:id/reset", auth("gm"), async (req, res) => {
    await tx(async () => {
      await eligible(req.params.id);
      await run(
        "INSERT INTO role_card_access(player_id,nonce,updated_at) VALUES(?,?,?) ON CONFLICT(player_id) DO UPDATE SET nonce=excluded.nonce,updated_at=excluded.updated_at",
        req.params.id,
        randomBytes(24).toString("hex"),
        Date.now(),
      );
      await audit(req, `重置角色卡登录二维码 ${req.params.id}`);
    });
    res.json({ ok: true });
  });
  app.post("/api/auth/role-card", async (req, res) => {
    const match =
      typeof req.body?.access === "string" &&
      /^([a-zA-Z0-9_-]{1,80})\.([A-Za-z0-9_-]{43})$/.exec(req.body.access);
    if (!match) fail("角色卡二维码无效或已重置，请使用最新角色卡", 401);
    await tx(async () => {
      const [, id, signature] = match;
      const access = await one(
        "SELECT nonce FROM role_card_access WHERE player_id=?",
        id,
      );
      if (
        !access ||
        !timingSafeEqual(
          Buffer.from(signature),
          Buffer.from(sign(id, access.nonce)),
        )
      )
        fail("角色卡二维码无效或已重置，请使用最新角色卡", 401);
      await eligible(id);
      await session(res, "player", id);
    });
    res
      .set("Cache-Control", "private, no-store")
      .json({ role: "player", id: match[1] });
  });
}
