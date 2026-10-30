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
    res
      .set("Cache-Control", "private, no-store")
      .json({
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
