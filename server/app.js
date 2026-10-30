import { createCharacterVoiceJobs } from "./character-voice-jobs.js";
import { createCharacterPhotoService } from "./character-photo.js";
import { redirectOssDownload } from "./oss-download.js";
import { characterMediaStorageConfig, isCharacterMediaStorageConfigured, putCharacterMedia, readCharacterMedia, characterMediaDownloadUrl } from "./character-media-storage.js";
import { characterTranscriptionConfig, isCharacterTranscriptionConfigured, normalizeCharacterRecording, transcribeCharacterAudio } from "./character-transcription.js";
import { sendStoredAsset } from "./asset-storage.js";
import { onsitePropHint } from "./onsite-props.js";
import { selectCharacterMusic, getCharacterMusicTrack } from "./audio/character-music.js";
import { characterVoiceConfig, isCharacterVoiceConfigured, submitCharacterVoice } from "./character-voice.js";
import { modelInspectionPoints } from "../src/model-inspection.js";
import { createFactionService } from "./factions/service.js";
import { createFactionPlayService, mountFactionPlayRoutes } from "./faction-play.js";
import { MAX_PLAYERS } from "./migrations/event-capacity.js";
import { staffStoryMaterials } from "./story-materials.js";
import express from "express";
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createEvidenceService } from "./evidence/service.js";
import { mountEvidenceRoutes } from "./evidence/routes.js";
import { createClueAudioCatalog, sendClueAudio } from "./audio/catalog.js";
import { createPerformanceAudioCatalog, sendPerformanceAudio } from "./audio/performance-catalog.js";
import { minimaxConfig, isMiniMaxConfigured, generateCharacterDraft, generateCharacterAvatar } from "./minimax-generation.js";
import { createSceneCatalog } from "./ar/catalog.js";
import { mountArRoutes } from "./ar/routes.js";
import { defaultArScenes, demoEvidence } from "./ar/scenes.js";
import { createContentStore } from "./admin/content-store.js";
import { mountManagementRoutes } from "./admin/routes.js";
import { createPaidPhoneService, mountPaidPhoneRoutes } from "./payments/paid-phones.js";
import { createSmsAuth } from "./auth/sms.js";
import { randomBytes, scryptSync, createHmac } from "node:crypto";
import { openDb } from "./db.js";
import { phases, npcOrder } from "./content.js";
import {
  resolveEvidenceModel as getEvidenceModel,
  evidenceModelFilenames,
  modelFileExists,
} from "./evidence/models.js";
import {
  publicInvestigationNodes,
  findPublicInvestigationNode,
} from "./public-investigation.js";
import {
  generationConfig,
  isGenerationConfigured,
  generateStory,
  templateStory,
  normalizeOnsiteStory,
} from "./story-generation.js";
// Limit each native image job to one libvips worker on the small deployment.
sharp.concurrency(1);
const modelsRoot = fileURLToPath(new URL("../public/models/", import.meta.url));
const token = () => randomBytes(24).toString("hex");
export function hashPassword(p) {
  const salt = token();
  return `${salt}:${scryptSync(p, salt, 64).toString("hex")}`;
}
export const npcCredential = (master, id) =>
  createHmac("sha256", master).update(id).digest("base64url").slice(0, 20);
export async function createApp({
  dbPath,
  databaseUrl,
  gmPassword,
  npcPassword,
  secure = false,
  trustProxy = "loopback",
  llm = {},
  minimax = {},
  characterVoice = {},
  characterMedia = {},
  characterTranscription = {},
  arScenes = [],
  assetBaseUrl = "/ar-assets/",
  smsSender = null,
  smsSecret = gmPassword,
  smsNow = Date.now,
  smsTestPhone = "",
  smsTestCode = "",
  smsTestExpiresAt = 0,
  smsDevLogin = false,
  allowLegacyRegistration = false,
  assignFactionsAtCreation = true,
  audioRoot,
  performanceAudioRoot,
}) {
  const arCatalog = createSceneCatalog(arScenes, assetBaseUrl);
  const demoCatalog = createSceneCatalog(defaultArScenes, assetBaseUrl);
  const app = express(),
    db = await openDb(databaseUrl || dbPath);
  app.disable("x-powered-by");
  // Production traffic enters through the local Nginx proxy only.
  app.set("trust proxy", trustProxy);
  app.use("/api/character/reference-audio", express.json({ limit: "3mb" }));
  app.use("/api/character/reference-photo", express.json({ limit: "3mb" }));
  app.use("/api/avatar", express.json({ limit: "3mb" }));
  app.use("/api/staff/paid-phones", express.json({ limit: "128kb" }));
  app.use(
    express.json({
      limit: "32kb",
    }),
  );
  const one = (sql, ...p) => db.prepare(sql).get(...p),
    all = (sql, ...p) => db.prepare(sql).all(...p),
    run = (sql, ...p) => db.prepare(sql).run(...p);
  const fail = (message, status = 400) => {
    throw Object.assign(new Error(message), {
      status,
    });
  };
  const required = (v, label, max = 500) => {
    if (typeof v !== "string" || !v.trim() || v.length > max)
      fail(`请填写有效的${label}`);
    return v.trim();
  };
  const tx = (fn) => db.transaction(fn);
  const factionService = createFactionService({ one, all, run, tx, fail, creationMode: assignFactionsAtCreation });
  const factionPlay = createFactionPlayService({ one, all, run, tx, fail });
  const paidPhones = createPaidPhoneService({ one, all, run, fail });
  const generation = generationConfig(llm);
  const configured = isGenerationConfigured(generation);
  const generationLockMs = Math.max(45000, generation.timeoutMs + 5000);
  const inspirationConfig = minimaxConfig(minimax);
  const voiceConfig = characterVoiceConfig(characterVoice);
  const mediaConfig = characterMediaStorageConfig(characterMedia);
  const characterPhotos = createCharacterPhotoService({ db, mediaConfig });
  const transcriptionConfig = characterTranscriptionConfig(characterTranscription);
  const inspirationJobs = new Set();
  let avatarDecodes = 0;
  const relationsFor = async (id, { playerView = false } = {}) => {
    const rows = await all(
      "SELECT r.*,n.name npc_name,c.status FROM character_relations r JOIN npcs n ON n.id=r.npc_id JOIN characters c ON c.player_id=r.player_id WHERE r.player_id=? ORDER BY r.npc_id",
      id,
    );
    return rows.map(({ npc_brief, hooks, ...row }) => ({
      ...row,
      ...(playerView ? {} : { npc_brief }),
      hooks: JSON.parse(hooks),
    }));
  };
  const characterView = (c, playerView = false) => {
    if (!c) return c;
    const { generation_lock, generation_started_at, ...visible } = c;
    if (
      c.generation_pending &&
      (!generation_started_at ||
        Date.now() - Number(generation_started_at) >= generationLockMs)
    ) {
      visible.generation_pending = 0;
      visible.generation_status = "error";
      visible.generation_error = "上次剧情生成已中断，请重试";
    }
    if (playerView && c.status !== "approved")
      return { ...visible, secret: null, faction: null };
    return visible;
  };
  // Called only within a mutation transaction, including across PG instances.
  const limitGeneration = async (id) => {
    const now = Date.now();
    await run(
      "DELETE FROM generation_requests WHERE requested_at<=?",
      now - 60000,
    );
    const { n } = await one(
      "SELECT COUNT(*) n FROM generation_requests WHERE player_id=? AND requested_at>?",
      id,
      now - 60000,
    );
    if (n >= 3) fail("剧情生成太频繁，请一分钟后重试", 429);
    await run(
      "INSERT INTO generation_requests(id,player_id,requested_at) VALUES(?,?,?)",
      token(),
      id,
      now,
    );
  };
  const completeGeneration = async (id, revision, lock, c, prepared = null) => {
    const npcs = await all(
      `SELECT id,name,english,role,bio FROM npcs ORDER BY ${npcOrder}`,
    );
    const assignedFaction = (await factionService.getPlayerState(id)).assigned;
    let result,
      error = null;
    const generated = Boolean(prepared) || configured;
    try {
      result = prepared || (configured
        ? await generateStory(c, npcs, generation, { faction: assignedFaction })
        : templateStory(c, npcs, { faction: assignedFaction }));
      result = normalizeOnsiteStory(result, npcs, { character: c, faction: assignedFaction });
    } catch (e) {
      error = e.message;
    }
    return tx(async () => {
      const current = await one(
        "SELECT * FROM characters WHERE player_id=?",
        id,
      );
      if (
        current?.revision !== revision ||
        current.generation_lock !== lock ||
        current.status !== "pending"
      )
        return { ok: true, stale: true };
      await run(
        "UPDATE characters SET adaptation=?,generation_status=?,generator=?,generation_error=?,generation_pending=0,generation_lock=NULL,generation_started_at=NULL,npc_id=? WHERE player_id=?",
        result?.adaptation || null,
        error ? "error" : generated ? "ready" : "unconfigured",
        generated ? "llm" : "curated-template",
        error,
        result?.relations[0]?.npc_id || null,
        id,
      );
      await run("DELETE FROM character_relations WHERE player_id=?", id);
      await run("DELETE FROM missions WHERE player_id=?", id);
      for (const relation of result?.relations || []) {
        await run(
          "INSERT INTO character_relations(player_id,npc_id,relation,player_brief,npc_brief,hooks,mission) VALUES(?,?,?,?,?,?,?)",
          id,
          relation.npc_id,
          relation.relation,
          relation.player_brief,
          relation.npc_brief,
          JSON.stringify(relation.hooks),
          relation.mission,
        );
        await run(
          "INSERT INTO missions(id,player_id,title,npc_id,reward) VALUES(?,?,?,?,?)",
          token(),
          id,
          relation.mission,
          relation.npc_id,
          2,
        );
      }
      // Publish only after validated relations and missions are saved atomically.
      if (!error) await run("UPDATE characters SET status='approved' WHERE player_id=?", id);
      return {
        ok: true,
        generator: generated ? "llm" : "curated-template",
        generation_status: error
          ? "error"
          : generated
            ? "ready"
            : "unconfigured",
      };
    });
  };
  const audit = async (r, action) =>
    await run(
      "INSERT INTO audit(actor,action) VALUES(?,?)",
      r.auth.user_id,
      action,
    );
  const setting = async () => await one("SELECT * FROM settings");
  const contentStore = createContentStore({
    one,
    all,
    run,
    baseScenes: arScenes,
    assetBaseUrl,
  });
  const player = async (r) => {
    const p = await one("SELECT * FROM players WHERE id=?", r.auth.user_id);
    if (!p) fail("玩家不存在", 404);
    return p;
  };
  const playable = async (r) => {
    const p = await player(r);
    if (p.payment !== "paid" || !p.checked_in)
      fail("请先核验票务并完成现场签到", 403);
    const c = await one("SELECT * FROM characters WHERE player_id=?", p.id);
    if (c?.status !== "approved") fail("人物档案尚未完成自动审核", 403);
    return {
      p,
      c,
    };
  };
  const coin = async (id, amount, reason) => {
    await run("UPDATE players SET coins=coins+? WHERE id=?", amount, id);
    await run(
      "INSERT INTO ledger(player_id,amount,reason) VALUES(?,?,?)",
      id,
      amount,
      reason,
    );
  };
  const session = async (res, role, id) => {
    const t = token();
    await run(
      "INSERT INTO sessions VALUES(?,?,?,?)",
      t,
      role,
      id,
      Date.now() + 7 * 864e5,
    );
    res.cookie("alaska_session", t, {
      httpOnly: true,
      sameSite: "strict",
      secure,
      path: "/",
      maxAge: 7 * 864e5,
    });
  };
  const attachSession = async (req, res, next) => {
    const t = req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("alaska_session="))
      ?.split("=")[1];
    req.auth = t
      ? await one(
          "SELECT * FROM sessions WHERE token=? AND expires>?",
          t,
          Date.now(),
        )
      : null;
    next();
  };
  app.use("/reading", attachSession);
  app.use("/api", async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(req.method) && req.headers.origin) {
      try {
        if (new URL(req.headers.origin).host !== req.headers.host)
          fail("请求来源无效", 403);
      } catch (e) {
        return next(e);
      }
    }
    return attachSession(req, res, next);
  });
  const auth =
    (...roles) =>
    (req, res, next) =>
      req.auth && roles.includes(req.auth.role)
        ? next()
        : res.status(401).json({
            error: "请使用对应账号登录",
          });
  const readingFiles = {
    gm: fileURLToPath(new URL("./reading/brief-gm.html", import.meta.url)),
    npc: fileURLToPath(new URL("./reading/brief-npc.html", import.meta.url)),
  };
  app.get(["/reading", "/reading/"], (req, res) => {
    res.set({
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    });
    const file = readingFiles[req.auth?.role];
    if (!file) return res.redirect(302, "/admin?next=%2Freading");
    res.sendFile(file);
  });
  app.get("/reading/hero.webp", auth("gm", "npc"), (req, res) => {
    res.set({ "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" });
    res.sendFile(fileURLToPath(new URL("./reading/hero.webp", import.meta.url)));
  });
  const attempts = new Map();
  app.use(["/api/login", "/api/register"], (req, res, next) => {
    const key = req.ip,
      now = Date.now(),
      a = (attempts.get(key) || []).filter((t) => now - t < 60000);
    if (a.length >= 20)
      return res.status(429).json({
        error: "操作太频繁，请一分钟后重试",
      });
    a.push(now);
    attempts.set(key, a);
    if (attempts.size > 1000)
      for (const [k, v] of attempts)
        if (now - v.at(-1) > 60000) attempts.delete(k);
    next();
  });
  app.get("/api/public", async (r, s) =>
    s.json({
      settings: await setting(),
      site: await contentStore.getSite(),
      auth: {
        sms: Boolean(smsSender),
        expiresIn: 900,
        retryAfter: 60,
      },
      phases,
      npcs: await all(
        `SELECT id,name,english,role,bio FROM npcs ORDER BY ${npcOrder}`,
      ),
      registered: (await one("SELECT COUNT(*) n FROM players")).n,
      generation: { configured, provider: generation.minimax ? "MiniMax" : "OpenAI兼容接口", inspiration: isMiniMaxConfigured(inspirationConfig) },
      events: await all("SELECT * FROM events ORDER BY id DESC LIMIT 8"),
    }),
  );
  app.get("/api/session", (r, s) =>
    s.json(
      r.auth
        ? {
            role: r.auth.role,
            id: r.auth.user_id,
          }
        : null,
    ),
  );
  const smsAuth = createSmsAuth({
    one,
    run,
    tx,
    fail,
    sender: smsSender,
    secret: smsSecret,
    now: smsNow,
    testPhone: smsTestPhone,
    testCode: smsTestCode,
    testExpiresAt: smsTestExpiresAt,
    devShortcut: smsDevLogin,
  });
  app.post("/api/auth/sms/send", async (req, res) =>
    res.json(await smsAuth.send(req.body.phone, req.ip)),
  );
  app.post("/api/auth/sms/login", async (req, res) => {
    const result = await smsAuth.verify(
      req.body.phone,
      req.body.code,
      async (phone) => {
        const npc = await one(
          "SELECT npc_id FROM npc_phones WHERE phone=?",
          phone,
        );
        if (npc) {
          await session(res, "npc", npc.npc_id);
          return { id: npc.npc_id, role: "npc", registered: false };
        }
        let p = await one("SELECT id FROM players WHERE contact=?", phone),
          registered = false;
        if (!p) {
          const count = (await one("SELECT COUNT(*) n FROM players")).n;
          if (count >= Math.min(MAX_PLAYERS, (await setting()).capacity))
            fail("本场报名已满，已有玩家仍可登录");
          const name = req.body.name
            ? required(req.body.name, "称呼", 40)
            : `宾客${phone.slice(-4)}`;
          p = { id: token() };
          registered = true;
          await run(
            "INSERT INTO players(id,name,contact,password,group_id) VALUES(?,?,?,?,?)",
            p.id,
            name,
            phone,
            "!sms-only!",
            (count % 6) + 1,
          );
        }
        await paidPhones.matchPlayer(p.id);
        await session(res, "player", p.id);
        return { id: p.id, role: "player", registered };
      },
    );
    res.json(result);
  });
  app.post("/api/register", async (r, s) => {
    if (!allowLegacyRegistration) fail("请使用手机号验证码完成首次注册");
    const name = required(r.body.name, "称呼", 40),
      contact = required(r.body.contact, "手机号或邮箱", 100),
      password = required(r.body.password, "密码", 128);
    if (password.length < 8) fail("密码至少8位");
    if (!/^(1\d{10}|[^\s@]+@[^\s@]+\.[^\s@]+)$/.test(contact))
      fail("请输入有效手机号或邮箱");
    const id = token();
    await tx(async () => {
      if (
        (await one("SELECT COUNT(*) n FROM players")).n >=
        Math.min(MAX_PLAYERS, (await setting()).capacity)
      )
        fail("本场报名已满");
      if (await one("SELECT id FROM players WHERE contact=?", contact))
        fail("该联系方式已报名，请登录");
      await run(
        "INSERT INTO players(id,name,contact,password,group_id) VALUES(?,?,?,?,?)",
        id,
        name,
        contact,
        hashPassword(password),
        ((await one("SELECT COUNT(*) n FROM players")).n % 6) + 1,
      );
      await paidPhones.matchPlayer(id);
    });
    await session(s, "player", id);
    s.json({
      id,
    });
  });
  app.post("/api/login", async (r, s) => {
    const account = required(r.body.account, "账号", 100),
      password = required(r.body.password, "密码", 128);
    if (["gm", "admin"].includes(account) && password === gmPassword) {
      await session(s, "gm", "gm");
      return s.json({
        role: "gm",
      });
    }
    fail("仅管理员可使用密码登录，其他用户请使用手机号验证码", 401);
  });
  app.post("/api/logout", async (r, s) => {
    if (r.auth) await run("DELETE FROM sessions WHERE token=?", r.auth.token);
    s.clearCookie("alaska_session", {
      path: "/",
    }).json({
      ok: true,
    });
  });
  app.get("/api/me", auth("player"), async (r, s) => {
    const { password, ...p } = await player(r);
    const c = characterView(
      await one("SELECT * FROM characters WHERE player_id=?", p.id),
      true,
    );
    const faction = await factionService.getPlayerState(p.id);
    if (c) c.faction = faction.assigned;
    s.set("Cache-Control", "private, no-store").json({
      player: p,
      character: c,
      faction,
      relations: await relationsFor(p.id, { playerView: true }),
      missions:
        c?.status === "approved"
          ? await all("SELECT * FROM missions WHERE player_id=?", p.id)
          : [],
      inventory: (await all(
        "SELECT i.*,l.title,l.description,l.effect FROM inventory i JOIN lots l ON i.lot_id=l.id WHERE player_id=?",
        p.id,
      )).map(item => ({ ...item, hint: item.used ? onsitePropHint(item.title) : null })),
      ledger: await all(
        "SELECT * FROM ledger WHERE player_id=? ORDER BY id DESC",
        p.id,
      ),
      vote: await one("SELECT * FROM votes WHERE player_id=?", p.id),
    });
  });
  app.post("/api/factions/preference", auth("player"), async (r, s) => {
    const p = await player(r);
    s.set("Cache-Control", "private, no-store").json(
      await (async () => {
        await factionService.savePreference(p.id, r.body?.preference);
        return assignFactionsAtCreation ? factionService.assignAtCreation(p.id) : factionService.getPlayerState(p.id);
      })(),
    );
  });
  app.get("/api/staff/factions", auth("gm"), async (r, s) => {
    s.set("Cache-Control", "private, no-store").json(await factionService.getAdminState());
  });
  app.post("/api/staff/factions/draw", auth("gm"), async (r, s) => {
    await factionService.draw(r.auth.user_id);
    s.set("Cache-Control", "private, no-store").json(await factionService.getAdminState());
  });
  app.post("/api/staff/factions/:id", auth("gm"), async (r, s) => {
    await factionService.setFaction(r.params.id, r.body?.faction, r.auth.user_id);
    s.set("Cache-Control", "private, no-store").json(await factionService.getAdminState());
  });
  app.post("/api/avatar", auth("player"), async (r, s) => {
    const p = await player(r);
    const raw = r.body.data;
    if (typeof raw !== "string" || raw.length > 2800000)
      fail("头像文件不能超过2MB");
    const match =
      /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(raw);
    if (!match || match[2].length % 4 !== 0) fail("请上传PNG、JPEG或WebP头像");
    if (avatarDecodes >= 2) fail("头像处理繁忙，请稍后重试", 429);
    avatarDecodes++;
    let image;
    try {
      const input = Buffer.from(match[2], "base64");
      if (!input.length || input.length > 2 * 1024 * 1024)
        fail("头像文件不能超过2MB");
      const source = sharp(input, {
        limitInputPixels: 16000000,
        failOn: "error",
      });
      const metadata = await source.metadata();
      if (
        !["png", "jpeg", "webp"].includes(metadata.format) ||
        (metadata.pages || 1) !== 1
      )
        fail("请上传静态PNG、JPEG或WebP头像");
      image = await source
        .rotate()
        .resize({
          width: 512,
          height: 512,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 82 })
        .toBuffer();
    } catch (error) {
      if (error.status) throw error;
      fail("头像无法解码或尺寸过大，请换一张静态图片");
    } finally {
      avatarDecodes--;
    }
    if (image.length > 512 * 1024) fail("头像压缩后过大，请换一张图片");
    const avatar_url = `/api/avatars/${p.id}?v=${Date.now()}`;
    await tx(async () => {
      const c = await one(
        "SELECT status FROM characters WHERE player_id=?",
        p.id,
      );
      if (c?.status === "approved") fail("已批准角色需由GM重新开放编辑");
      await run(
        "INSERT INTO avatars(player_id,data,updated_at) VALUES(?,?,?) ON CONFLICT(player_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at",
        p.id,
        image.toString("base64"),
        Date.now(),
      );
      await run(
        "UPDATE characters SET avatar_url=? WHERE player_id=?",
        avatar_url,
        p.id,
      );
    });
    s.json({ avatar_url });
  });
  app.get("/api/avatars/:id", auth("player", "gm", "npc"), async (r, s) => {
    const own = r.auth.role === "player" && r.auth.user_id === r.params.id;
    const related =
      r.auth.role === "npc" &&
      (await one(
        "SELECT 1 FROM character_relations r JOIN characters c ON c.player_id=r.player_id WHERE r.player_id=? AND r.npc_id=? AND c.status='approved'",
        r.params.id,
        r.auth.user_id,
      ));
    if (r.auth.role !== "gm" && !own && !related)
      fail("无法查看该角色头像", 403);
    const avatar = await one(
      "SELECT data FROM avatars WHERE player_id=?",
      r.params.id,
    );
    if (!avatar) fail("头像不存在", 404);
    s.set({
      "Content-Type": "image/webp",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    }).send(Buffer.from(avatar.data, "base64"));
  });
  const recordingJobs = new Set();
  const recordingView = (row) => ({ recording_id: row.id, recording_url: `/api/character/reference-audio/${row.id}/audio`, transcript: row.transcript || "", status: row.status, ...(row.error ? { transcription_error: row.error } : {}) });
  const transcribeRecording = async (row, data) => {
    try {
      await tx(async () => {
        const current = await one("SELECT attempts FROM character_recordings WHERE id=? AND player_id=?", row.id, row.player_id);
        const { n } = await one("SELECT COUNT(*) n FROM character_transcription_requests WHERE player_id=? AND requested_at>?", row.player_id, Date.now() - 3600000);
        if (n >= 10 || Number(current?.attempts || 0) >= 5) fail("录音识别次数较多，请稍后重试", 429);
        await run("INSERT INTO character_transcription_requests(id,player_id,requested_at) VALUES(?,?,?)", token(), row.player_id, Date.now());
        await run("UPDATE character_recordings SET attempts=attempts+1,status='transcribing',error=NULL WHERE id=? AND player_id=?", row.id, row.player_id);
      });
      const result = await transcribeCharacterAudio({ data, mimeType: "audio/wav" }, transcriptionConfig);
      await run("UPDATE character_recordings SET transcript=?,status='ready',error=NULL WHERE id=? AND player_id=?", result.text.slice(0,2000), row.id, row.player_id);
    } catch (error) {
      await run("UPDATE character_recordings SET status='error',error=? WHERE id=? AND player_id=?", error.status ? error.message : "录音已保存，文字识别暂时失败，请重试", row.id, row.player_id);
    }
    return recordingView(await one("SELECT * FROM character_recordings WHERE id=? AND player_id=?", row.id, row.player_id));
  };
  app.post("/api/character/reference-audio", auth("player"), async (r, s) => {
    const p = await player(r);
    if (!isCharacterMediaStorageConfigured(mediaConfig) || !isCharacterTranscriptionConfigured(transcriptionConfig)) fail("录音识别服务尚未配置，请联系GM", 503);
    if (recordingJobs.has(p.id)) fail("这段录音正在识别，请稍候", 409);
    if (recordingJobs.size >= 3) fail("录音识别繁忙，请稍后再试", 429);
    const raw = r.body?.data;
    if (typeof raw !== "string" || raw.length > 2800000 || !/^data:audio\/wav;base64,[A-Za-z0-9+/]+={0,2}$/.test(raw)) fail("录音格式无效，请重新录制WAV音频");
    const data = Buffer.from(raw.split(",")[1], "base64");
    if (data.length > 2 * 1024 * 1024) fail("录音过大，请缩短到60秒以内", 413);
    recordingJobs.add(p.id);
    try {
      const { n } = await one("SELECT COUNT(*) n FROM character_recordings WHERE player_id=? AND created_at>?", p.id, Date.now() - 3600000);
      if (n >= 5) fail("录音次数较多，请一小时后再试", 429);
      await normalizeCharacterRecording(data, "audio/wav", transcriptionConfig);
      const stored = await putCharacterMedia({ playerId: p.id, kind: "recording", data, contentType: "audio/wav" }, mediaConfig);
      const id = token();
      await run("INSERT INTO character_recordings(id,player_id,object_key,content_type,status,created_at) VALUES(?,?,?,?,'transcribing',?)", id, p.id, stored.object_key, stored.content_type, Date.now());
      s.set("Cache-Control", "private, no-store").json(await transcribeRecording({ id, player_id: p.id }, data));
    } finally { recordingJobs.delete(p.id); }
  });
  app.post("/api/character/reference-audio/:id/transcribe", auth("player"), async (r, s) => {
    const p = await player(r);
    if (recordingJobs.has(p.id)) fail("这段录音正在识别，请稍候", 409);
    const row = await one("SELECT * FROM character_recordings WHERE id=? AND player_id=?", r.params.id, p.id);
    if (!row) fail("录音不存在", 404);
    if (row.status === "ready") return s.json(recordingView(row));
    if (recordingJobs.size >= 3) fail("录音识别繁忙，请稍后再试", 429);
    recordingJobs.add(p.id);
    try {
      const data = await readCharacterMedia(row.object_key, mediaConfig);
      s.set("Cache-Control", "private, no-store").json(await transcribeRecording(row, data));
    } finally { recordingJobs.delete(p.id); }
  });
  app.get("/api/character/reference-audio/:id/audio", auth("player"), async (r, s) => {
    const p = await player(r);
    const row = await one("SELECT * FROM character_recordings WHERE id=? AND player_id=?", r.params.id, p.id);
    if (!row) fail("录音不存在", 404);
    if (mediaConfig.directDownload && !mediaConfig.securityToken) return redirectOssDownload(s, characterMediaDownloadUrl(row.object_key, mediaConfig, r.method === "HEAD" ? "HEAD" : "GET"));
    const data = await readCharacterMedia(row.object_key, mediaConfig);
    s.set({ "Content-Type": row.content_type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes" });
    const range = /^bytes=(\d+)-(\d*)$/.exec(r.get("range") || "");
    if (range) {
      const start=Number(range[1]),end=Math.min(Number(range[2]||data.length-1),data.length-1);
      if(start>end||start>=data.length)return s.status(416).set("Content-Range",`bytes */${data.length}`).end();
      return s.status(206).set("Content-Range",`bytes ${start}-${end}/${data.length}`).send(data.subarray(start,end+1));
    }
    s.send(data);
  });

  const voiceCreationTimeoutMs = Math.max(120000, 5 * voiceConfig.timeoutMs + 30000);
  const voiceJobs = createCharacterVoiceJobs({ one, all, run, voiceConfig, mediaConfig, creationTimeoutMs: voiceCreationTimeoutMs });
  const voicePublic = (row, character) => {
    if (!row || row.character_revision !== character?.revision) return { status: "none" };
    let subtitles = [];
    try { subtitles = JSON.parse(row.subtitles || "[]"); } catch { /* Legacy task: captions estimated from loaded audio duration. */ }
    const music = selectCharacterMusic(character, row.script);
    return { status: row.status, script: row.script || "", voice_name: row.voice_name || "", error: row.error || "",
      duration: Number(row.duration) || 0, subtitles, subtitle_source: row.subtitle_source || "none",
      music: { ...music, url: `/api/character/voice/music/${music.id}` },
      ...(row.status === "ready" ? { audio_url: `/api/character/voice/audio?v=${row.updated_at}` } : {}) };
  };
  app.post("/api/character/voice", auth("player"), async (r, s) => {
    const p = await player(r);
    if (!isCharacterMediaStorageConfigured(mediaConfig)) fail("角色音频云存储尚未配置，请联系GM", 503);
    if (!isCharacterVoiceConfigured(voiceConfig)) fail("语音介绍服务尚未配置，请联系GM", 503);
    await voiceJobs.pollPlayer(p.id);
    const job = await tx(async () => {
      const c = await one("SELECT * FROM characters WHERE player_id=?", p.id);
      if (!c?.story || !c.avatar_url) fail("请先确认并提交角色，再生成语音介绍");
      const prior = await one("SELECT * FROM character_voices WHERE player_id=?", p.id);
      if (prior?.character_revision === c.revision && ["creating", "processing", "ready"].includes(prior.status) && (prior.status !== "creating" || Date.now() - prior.created_at < voiceCreationTimeoutMs))
        return { prior, c };
      const { n } = await one("SELECT COUNT(*) n FROM character_voice_requests WHERE player_id=? AND requested_at>?", p.id, Date.now() - 86400000);
      if (n >= 5) fail("今天的语音生成次数已用完，请保留当前介绍或联系GM", 429);
      const { n: active } = await one("SELECT COUNT(*) n FROM character_voices WHERE (status='creating' AND created_at>?) OR (status='processing' AND updated_at>?)", Date.now() - voiceCreationTimeoutMs, Date.now() - 600000);
      if (active >= 3) fail("语音生成繁忙，请稍后重试", 429);
      const now = Date.now(), lock = token();
      await run("INSERT INTO character_voice_requests(id,player_id,requested_at) VALUES(?,?,?)", lock, p.id, now);
      await run("INSERT INTO character_voices(player_id,character_revision,job_token,status,created_at,updated_at) VALUES(?,?,?,'creating',?,?) ON CONFLICT(player_id) DO UPDATE SET character_revision=excluded.character_revision,job_token=excluded.job_token,status='creating',script=NULL,voice_id=NULL,voice_name=NULL,task_id=NULL,file_id=NULL,audio_object_key=NULL,subtitles=NULL,duration=NULL,subtitle_source=NULL,error=NULL,created_at=excluded.created_at,updated_at=excluded.updated_at", p.id, c.revision, lock, now, now);
      return { c, lock };
    });
    if (job.prior) return s.set("Cache-Control", "private, no-store").json(voicePublic(job.prior, job.c));
    // The task survives mobile navigation; no provider request holds a DB transaction.
    void (async () => {
      try {
        const result = await submitCharacterVoice(job.c, voiceConfig, { beforeSubmit: async () => {
          const current = await one("SELECT v.job_token,v.status,v.character_revision,c.revision FROM character_voices v JOIN characters c ON c.player_id=v.player_id WHERE v.player_id=?", p.id);
          if (current?.job_token !== job.lock || current.status !== "creating" || current.character_revision !== current.revision)
            fail("角色已更新，本次语音任务已取消", 409);
        } });
        await run("UPDATE character_voices SET status='processing',script=?,voice_id=?,voice_name=?,task_id=?,file_id=?,updated_at=? WHERE player_id=? AND job_token=? AND character_revision=(SELECT revision FROM characters WHERE player_id=?)", result.script, result.voice_id, result.voice_name, String(result.task_id), String(result.file_id || ""), Date.now(), p.id, job.lock, p.id);
        await voiceJobs.pollPlayer(p.id);
      } catch (error) {
        await run("UPDATE character_voices SET status='error',error=?,updated_at=? WHERE player_id=? AND job_token=? AND status='creating'", "语音介绍暂时生成失败，请重试。" + (error.status ? error.message : ""), Date.now(), p.id, job.lock);
      }
    })().catch(() => {});
    s.status(202).set("Cache-Control", "private, no-store").json({ status: "creating" });
  });
  app.get("/api/character/voice", auth("player"), async (r, s) => {
    const p = await player(r);
    await voiceJobs.pollPlayer(p.id);
    const c = await one("SELECT * FROM characters WHERE player_id=?", p.id);
    const row = await one("SELECT * FROM character_voices WHERE player_id=?", p.id);
    s.set("Cache-Control", "private, no-store").json(voicePublic(row, c));
  });
  app.get("/api/character/voice/audio", auth("player"), async (r, s) => {
    const p = await player(r), c = await one("SELECT revision FROM characters WHERE player_id=?", p.id);
    const row = await one("SELECT * FROM character_voices WHERE player_id=?", p.id);
    if (!row || row.status !== "ready" || row.character_revision !== c?.revision || !row.audio_object_key) fail("语音介绍尚未生成", 404);
    s.set({ "Content-Type": "audio/mpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes" });
    if (mediaConfig.directDownload && !mediaConfig.securityToken) return redirectOssDownload(s, characterMediaDownloadUrl(row.audio_object_key, mediaConfig, r.method === "HEAD" ? "HEAD" : "GET"));
    const audio = await readCharacterMedia(row.audio_object_key, mediaConfig), range = /^bytes=(\d+)-(\d*)$/.exec(r.get("range") || "");
    if (range) {
      const start = Number(range[1]), end = Math.min(Number(range[2] || audio.length - 1), audio.length - 1);
      if (start > end || start >= audio.length) return s.status(416).set("Content-Range", `bytes */${audio.length}`).end();
      return s.status(206).set("Content-Range", `bytes ${start}-${end}/${audio.length}`).send(audio.subarray(start, end + 1));
    }
    s.send(audio);
  });

  app.get("/api/character/voice/music/:id", auth("player"), async (r, s) => {
    await player(r);
    const track = await getCharacterMusicTrack(r.params.id);
    if (!track) fail("背景音乐不存在", 404);
    s.set({ "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" });
    s.sendFile(track.file);
  });

  app.post("/api/character/reference-photo", auth("player"), async (r, s) => {
    const p = await player(r);
    const c = await one("SELECT status FROM characters WHERE player_id=?", p.id);
    if (c?.status === "approved") fail("已批准角色需由GM重新开放编辑");
    s.status(201).set("Cache-Control", "private, no-store").json(await characterPhotos.save(p.id, r.body?.data));
  });
  app.get("/api/character/reference-photo/preview", auth("player"), async (r, s) => {
    const p = await player(r);
    const photo = await characterPhotos.read(p.id, typeof r.query.v === "string" ? r.query.v : undefined);
    s.set({ "Content-Type": photo.contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }).send(photo.data);
  });
  app.delete("/api/character/reference-photo", auth("player"), async (r, s) => {
    const p = await player(r);
    await characterPhotos.remove(p.id, typeof r.body?.version === "string" ? r.body.version : undefined);
    s.set("Cache-Control", "private, no-store").json({ ok: true });
  });

  const inspirationView = async (id) => {
    const cached = await one("SELECT * FROM character_inspirations WHERE player_id=?", id);
    const avatar = await one("SELECT updated_at FROM avatars WHERE player_id=?", id);
    let character = null, avatar_error = "", updated_at = 0;
    if (cached && Date.now() - cached.created_at < 3 * 86400000 && Number(cached.avatar_version) === Number(avatar?.updated_at || 0)) {
      try {
        const saved = JSON.parse(cached.data);
        character = Object.fromEntries(["name", "english", "profession", "skill", "motive", "story", "cosplay_character", "cosplay_source"].map(key => [key, saved.character[key]]));
        character.avatar_url = avatar?.updated_at ? `/api/avatars/${id}?v=${avatar.updated_at}` : "";
        avatar_error = saved.avatar_error || (saved.avatar_pending && !inspirationJobs.has(id) ? "头像尚未完成，请重试生成头像" : "");
        updated_at = Number(cached.created_at);
      } catch { character = null; }
    }
    let reference = await one("SELECT * FROM character_recordings WHERE player_id=? ORDER BY created_at DESC LIMIT 1", id);
    if (reference?.status === "transcribing" && Date.now() - reference.created_at > 120000 && !recordingJobs.has(id)) {
      await run("UPDATE character_recordings SET status='error',error=? WHERE id=? AND player_id=?", "上次识别已中断，录音已保存，可重新识别", reference.id, id);
      reference = await one("SELECT * FROM character_recordings WHERE id=? AND player_id=?", reference.id, id);
    }
    const photoSnapshot = await characterPhotos.snapshot(id);
    return { generating: inspirationJobs.has(id), character, avatar_error, updated_at, reference_recording: reference ? recordingView(reference) : null, reference_photo: photoSnapshot.photo, reference_photo_updated_at: photoSnapshot.updated_at };
  };
  app.get("/api/character/inspiration", auth("player"), async (r, s) => {
    const p = await player(r);
    s.set("Cache-Control", "private, no-store").json(await inspirationView(p.id));
  });
  app.post("/api/character/inspiration/avatar", auth("player"), async (r, s) => {
    const p = await player(r);
    if (inspirationJobs.has(p.id)) fail("角色正在生成，请稍候", 409);
    inspirationJobs.add(p.id);
    try {
      const prepared = await tx(async () => {
        const c = await one("SELECT revision,status FROM characters WHERE player_id=?", p.id);
        if (c?.status === "approved") fail("已批准角色需由GM重新开放编辑");
        const cached = await one("SELECT * FROM character_inspirations WHERE player_id=?", p.id);
        const avatar = await one("SELECT updated_at FROM avatars WHERE player_id=?", p.id);
        if (!cached || Number(cached.avatar_version) !== Number(avatar?.updated_at || 0)) fail("角色草稿已更新，请重新生成", 409);
        const saved = JSON.parse(cached.data);
        if (!saved.avatar_prompt) fail("请重新生成角色后再生成头像");
        const photoVersion = (await characterPhotos.current(p.id))?.version || "";
        if ((saved.reference_photo_version || "") !== photoVersion) fail("参考照片已更换，请先重新生成角色，再更换头像", 409);
        await limitGeneration(p.id);
        return { saved, revision: c?.revision || 0, avatar: avatar?.updated_at || 0, photoVersion };
      });
      const referencePhoto = await characterPhotos.generationReference(p.id);
      if ((referencePhoto?.version || "") !== prepared.photoVersion) fail("参考照片已更新，请重新生成", 409);
      const avatarWebp = await generateCharacterAvatar(prepared.saved.avatar_prompt, inspirationConfig, { referencePhoto });
      await tx(async () => {
        const c = await one("SELECT revision,status FROM characters WHERE player_id=?", p.id);
        const avatar = await one("SELECT updated_at FROM avatars WHERE player_id=?", p.id);
        if (c?.status === "approved" || (c?.revision || 0) !== prepared.revision || Number(avatar?.updated_at || 0) !== Number(prepared.avatar) || ((await characterPhotos.current(p.id))?.version || "") !== prepared.photoVersion) fail("角色档案已更新，请刷新后重试", 409);
        const updated = Date.now();
        await run("INSERT INTO avatars(player_id,data,updated_at) VALUES(?,?,?) ON CONFLICT(player_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at", p.id, avatarWebp.toString("base64"), updated);
        await run("UPDATE character_inspirations SET data=?,avatar_version=?,created_at=? WHERE player_id=?", JSON.stringify({ ...prepared.saved, avatar_error: "", avatar_pending: false }), updated, updated, p.id);
      });
      s.set("Cache-Control", "private, no-store").json(await inspirationView(p.id));
    } finally { inspirationJobs.delete(p.id); }
  });

  app.post("/api/character/inspire", auth("player"), async (r, s) => {
    const p = await player(r);
    const faction = assignFactionsAtCreation ? await factionService.assignAtCreation(p.id) : await factionService.getPlayerState(p.id);
    if (!isMiniMaxConfigured(inspirationConfig))
      fail("角色生成服务尚未配置，请联系GM", 503);
    if (!r.body || typeof r.body !== "object" || Array.isArray(r.body))
      fail("角色灵感输入格式无效");
    const seed = {};
    for (const [key, max] of [["cosplay_character", 100], ["cosplay_source", 100], ["idea", 2000]]) {
      const value = r.body[key] ?? "";
      if (typeof value !== "string" || value.length > max) fail("角色灵感输入无效或过长");
      seed[key] = value.trim();
    }
    if (inspirationJobs.has(p.id)) fail("角色正在生成，请稍候", 409);
    if (inspirationJobs.size >= 2) fail("角色生成繁忙，请稍后重试", 429);
    inspirationJobs.add(p.id);
    const streaming = r.get("accept")?.includes("text/event-stream");
    let heartbeat, validatedDraft, persistence = Promise.resolve();
    const send = (event) => {
      if (!s.destroyed && !s.writableEnded) s.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    try {
      const snapshot = await tx(async () => {
        const current = await one("SELECT revision,status FROM characters WHERE player_id=?", p.id);
        if (current?.status === "approved") fail("已批准角色需由GM重新开放编辑");
        await limitGeneration(p.id);
        return { revision: current?.revision || 0, avatar: (await one("SELECT updated_at FROM avatars WHERE player_id=?", p.id))?.updated_at || 0, photoVersion: (await characterPhotos.current(p.id))?.version || "" };
      });
      const npcs = await all(`SELECT id,name,english,role,bio FROM npcs ORDER BY ${npcOrder}`);
      if (streaming) {
        s.set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "private, no-store", "X-Accel-Buffering": "no" });
        s.flushHeaders();
        send({ type: "stage", message: "正在构思角色与庄园的往事…" });
        heartbeat = setInterval(() => send({ type: "heartbeat" }), 5000);
      }
      const onProgress = (event) => {
        if (event.type === "text_ready") {
          validatedDraft = event;
          persistence = tx(async () => {
            const current = await one("SELECT revision,status FROM characters WHERE player_id=?", p.id);
            const avatar = await one("SELECT updated_at FROM avatars WHERE player_id=?", p.id);
            if (current?.status === "approved" || (current?.revision || 0) !== snapshot.revision || Number(avatar?.updated_at || 0) !== Number(snapshot.avatar) || ((await characterPhotos.current(p.id))?.version || "") !== snapshot.photoVersion) return;
            await run("INSERT INTO character_inspirations(player_id,data,avatar_version,created_at) VALUES(?,?,?,?) ON CONFLICT(player_id) DO UPDATE SET data=excluded.data,avatar_version=excluded.avatar_version,created_at=excluded.created_at", p.id, JSON.stringify({ character: event.character, adaptation: event.adaptation, relations: event.relations, avatar_prompt: event.avatar_prompt, avatar_pending: true, reference_photo_version: snapshot.photoVersion }), snapshot.avatar, Date.now());
          });
          persistence.catch(() => {});
          if (streaming) send({ type: "text_ready", character: event.character });
          return persistence;
        } else if (streaming) send(event);
      };
      const referencePhoto = await characterPhotos.generationReference(p.id);
      if ((referencePhoto?.version || "") !== snapshot.photoVersion) fail("参考照片已更新，请重新生成", 409);
      const result = await generateCharacterDraft(seed, npcs, inspirationConfig, onProgress, { faction: faction.assigned, referencePhoto });
      await persistence;
      const avatar_url = await tx(async () => {
        const current = await one("SELECT revision,status FROM characters WHERE player_id=?", p.id);
        const avatar = await one("SELECT updated_at FROM avatars WHERE player_id=?", p.id);
        if (current?.status === "approved" || (current?.revision || 0) !== snapshot.revision || (avatar?.updated_at || 0) !== snapshot.avatar || ((await characterPhotos.current(p.id))?.version || "") !== snapshot.photoVersion)
          fail("角色档案已更新，请刷新后再生成，已有内容已保留", 409);
        const updated = Date.now();
        if (result.avatarWebp) await run("INSERT INTO avatars(player_id,data,updated_at) VALUES(?,?,?) ON CONFLICT(player_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at", p.id, result.avatarWebp.toString("base64"), updated);
        const avatarVersion = result.avatarWebp ? updated : snapshot.avatar;
        await run("INSERT INTO character_inspirations(player_id,data,avatar_version,created_at) VALUES(?,?,?,?) ON CONFLICT(player_id) DO UPDATE SET data=excluded.data,avatar_version=excluded.avatar_version,created_at=excluded.created_at", p.id, JSON.stringify({ character: result.character, adaptation: result.adaptation, relations: result.relations, avatar_prompt: validatedDraft?.avatar_prompt, avatar_error: result.avatarError || "", avatar_pending: !result.avatarWebp, reference_photo_version: snapshot.photoVersion }), avatarVersion, updated);
        return avatarVersion ? `/api/avatars/${p.id}?v=${avatarVersion}` : "";
      });
      if (streaming) {
        send({ type: "complete", character: { ...result.character, avatar_url }, avatar_error: result.avatarError || "" });
        s.end();
      } else s.set("Cache-Control", "private, no-store").json({ ...result.character, avatar_url, ...(result.avatarError ? { avatar_error: result.avatarError } : {}) });
    } catch (error) {
      if (!s.headersSent) throw error;
      send({ type: "error", message: error.status ? error.message : "角色生成暂时失败，已保留草稿，请重试" });
      s.end();
    } finally {
      clearInterval(heartbeat);
      inspirationJobs.delete(p.id);
    }
  });
  app.post("/api/character", auth("player"), async (r, s) => {
    const playerIdentity = await player(r);
    const faction = assignFactionsAtCreation ? await factionService.assignAtCreation(playerIdentity.id) : await factionService.getPlayerState(playerIdentity.id);
    const p = playerIdentity,
      story = required(r.body.story, "虚构人物背景", 2000),
      cosplay_character = required(
        r.body.cosplay_character,
        "万圣节Cos角色",
        100,
      ),
      cosplay_source = required(
        r.body.cosplay_source,
        "Cos角色的作品或原创来源",
        100,
      ),
      name =
        r.body.name === undefined
          ? cosplay_character.slice(0, 60)
          : required(r.body.name, "角色姓名", 60),
      english =
        r.body.english === undefined
          ? "Guest"
          : required(r.body.english, "英文名", 60),
      profession =
        r.body.profession === undefined
          ? "受邀宾客"
          : required(r.body.profession, "职业", 60),
      motive =
        r.body.motive === undefined
          ? "应邀参加万圣节舞会"
          : required(r.body.motive, "赴宴动机", 100),
      skill = r.body.skill === undefined ? "洞察" : r.body.skill;
    if (!["洞察", "技术", "社交"].includes(skill)) fail("技能无效");
    if (story.length < 20)
      fail("角色故事至少20字，请描述你的Cos角色经历和性格");
    const draft = await tx(async () => {
      const existing = await one(
        "SELECT * FROM characters WHERE player_id=?",
        p.id,
      );
      if (existing?.status === "approved") fail("已批准角色需由GM重新开放编辑");
      const avatar = await one(
        "SELECT updated_at FROM avatars WHERE player_id=?",
        p.id,
      );
      if (!avatar) fail("请先上传你的角色头像");
      const revision = (existing?.revision || 0) + 1,
        lock = token();
      const avatar_url = `/api/avatars/${p.id}?v=${avatar.updated_at}`;
      const submitted = { name, english, profession, skill, story, motive, cosplay_character, cosplay_source };
      if (existing?.status === "pending" && existing.avatar_url === avatar_url && Object.entries(submitted).every(([key, value]) => existing[key] === value))
        return { unchanged: true, c: existing };
      // Reuse this player's generated relationship cards when the submitted
      // draft is unchanged. Never expose the NPC-only briefs in the preview.
      const cached = await one("SELECT * FROM character_inspirations WHERE player_id=?", p.id);
      let prepared = null;
      if (cached && cached.avatar_version === avatar.updated_at && Date.now() - cached.created_at < 3 * 86400000) {
        try {
          const saved = JSON.parse(cached.data);
          if (Object.entries(submitted).every(([key, value]) => saved.character[key] === value))
            prepared = { adaptation: saved.adaptation, relations: saved.relations };
        } catch { /* A missing or unusable cache falls back to normal generation. */ }
      }
      // Confirming an unchanged generated draft does not call the model again.
      if (!prepared) await limitGeneration(p.id);
      await run(
        `INSERT INTO characters(player_id,name,english,profession,skill,story,secret,motive,cosplay_character,cosplay_source,avatar_url,revision,generation_pending,generation_lock,generation_started_at,generation_status,generator) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?) ON CONFLICT(player_id) DO UPDATE SET name=excluded.name,english=excluded.english,profession=excluded.profession,skill=excluded.skill,story=excluded.story,secret=excluded.secret,npc_id=NULL,status='pending',motive=excluded.motive,cosplay_character=excluded.cosplay_character,cosplay_source=excluded.cosplay_source,avatar_url=excluded.avatar_url,revision=excluded.revision,generation_pending=1,generation_lock=excluded.generation_lock,generation_started_at=excluded.generation_started_at,generation_status=excluded.generation_status,generator=excluded.generator,generation_error=NULL,adaptation=NULL`,
        p.id,
        name,
        english,
        profession,
        skill,
        story,
        "你曾接触ECHO集团的一份内部材料。今晚必须决定把它交给谁。",
        motive,
        cosplay_character,
        cosplay_source,
        avatar_url,
        revision,
        lock,
        Date.now(),
        configured ? "error" : "unconfigured",
        configured ? "llm" : "curated-template",
      );
      if (faction.assigned) await run("UPDATE characters SET faction=? WHERE player_id=?", faction.assigned, p.id);
      await run("DELETE FROM character_relations WHERE player_id=?", p.id);
      await run("DELETE FROM missions WHERE player_id=?", p.id);
      await run("DELETE FROM character_inspirations WHERE player_id=?", p.id);
      return {
        revision,
        lock,
        prepared,
        c: await one("SELECT * FROM characters WHERE player_id=?", p.id),
      };
    });
    if (draft.unchanged) return s.json({ ok: true, unchanged: true, revision: draft.c.revision, generation_status: draft.c.generation_status });
    s.json(await completeGeneration(p.id, draft.revision, draft.lock, draft.c, draft.prepared));
  });
  app.post("/api/character/generate", auth("player"), async (r, s) => {
    const p = await player(r);
    const draft = await tx(async () => {
      const c = await one("SELECT * FROM characters WHERE player_id=?", p.id);
      if (!c || !c.cosplay_character || !c.cosplay_source || !c.avatar_url)
        fail("请先完成Cos角色、故事和头像档案");
      if (c.status === "approved") fail("已批准角色需由GM重新开放编辑");
      if (c.generation_pending && Date.now() - c.generation_started_at < generationLockMs)
        fail("剧情正在生成，请稍候", 409);
      await limitGeneration(p.id);
      const lock = token();
      await run(
        "UPDATE characters SET generation_pending=1,generation_lock=?,generation_started_at=?,generation_error=NULL WHERE player_id=?",
        lock,
        Date.now(),
        p.id,
      );
      return { revision: c.revision, lock, c };
    });
    s.json(await completeGeneration(p.id, draft.revision, draft.lock, draft.c));
  });
  const performanceAudio = createPerformanceAudioCatalog(performanceAudioRoot);
  app.get("/api/staff/performance-audio", auth("gm"), async (r, s) => {
    s.set("Cache-Control", "private, no-store").json(await performanceAudio.describe());
  });
  app.get("/api/staff/performance-audio/:id/file", auth("gm"), async (r, s) => {
    const track = await performanceAudio.get(r.params.id);
    if (!track) fail("现场音频不存在", 404);
    return sendPerformanceAudio(s, track);
  });
  const clueAudio = createClueAudioCatalog(audioRoot);
  const evidence = createEvidenceService({
    one,
    all,
    run,
    tx,
    fail,
    setting,
    audio: clueAudio,
  });
  const publicClue = async (rawId) => {
    const id = rawId.toUpperCase();
    if (!/^E-\d{2}$/.test(id)) fail("证物不存在", 404);
    const clue = await one(
      "SELECT id,title,area,category,body FROM clues WHERE id=?",
      id,
    );
    if (!clue) fail("证物不存在", 404);
    return clue;
  };
  const publicNode = (rawId) => {
    const node = findPublicInvestigationNode(rawId.toUpperCase());
    if (!node) fail("调查节点不存在", 404);
    return node;
  };
  const publicAudio = async (r, s, source) => {
    if ("part" in r.query || "detail" in r.query)
      fail("公开录音仅提供基础线索", 400);
    const track = await clueAudio.get(source, "body", r.path);
    if (!track) fail("录音不存在或内容已更新", 404);
    return sendClueAudio(s, track);
  };
  app.get("/api/ar/clues/:id/audio", async (r, s) =>
    publicAudio(r, s, await publicClue(r.params.id)),
  );
  app.get("/api/ar/nodes/:id/audio", async (r, s) =>
    publicAudio(r, s, publicNode(r.params.id)),
  );
  app.get("/api/ar/demo", (req, res) => {
    const manifest = demoCatalog.manifest(demoCatalog.get("wall-study"));
    res.json({
      ...manifest,
      demo: true,
      hotspots: manifest.hotspots.map((hotspot) => ({
        ...hotspot,
        ...demoEvidence[hotspot.id],
      })),
    });
  });
  // The standalone scanner exposes only the printed clue's basic evidence.
  // Advanced information, checks and player records remain in the game flow.
  app.get("/api/ar/clues/:id", async (r, s) => {
    const c = await publicClue(r.params.id);
    const model = getEvidenceModel(c.id);
    s.json({
      ...c,
      ...(await clueAudio.describe(c, { body: `/api/ar/clues/${c.id}/audio` })),
      ...(model
        ? {
            model_url: `/api/ar/models/${model.filename}.glb`,
            model_label: model.label,
            inspection_points: modelInspectionPoints(model.filename),
          }
        : {}),
    });
  });
  app.get("/api/ar/nodes/:id", async (r, s) => {
    const node = publicNode(r.params.id);
    const filename = modelFileExists(node.filename)
      ? node.filename
      : node.fallback;
    s.json({
      id: node.id,
      title: node.title,
      area: node.area,
      body: node.body,
      ...(await clueAudio.describe(node, {
        body: `/api/ar/nodes/${node.id}/audio`,
      })),
      model_url: `/api/ar/models/${filename}.glb`,
      model_label: node.title,
      ...(node.presentation === "invitation"
        ? {
            presentation: node.presentation,
            poster_url: node.poster_url,
            valid_until: node.valid_until,
            invitation_valid: Date.now() <= Date.parse(node.valid_until),
          }
        : {}),
      inspection_points: modelInspectionPoints(filename),
    });
  });
  app.get("/ar-assets/models/:filename", async (r, s) => {
    if (!/^[a-z0-9-]+\.glb$/.test(r.params.filename)) fail("模型不存在", 404);
    s.set({ "Content-Type": "model/gltf-binary", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" });
    return sendStoredAsset(s, fileURLToPath(new URL(`../${process.env.NODE_ENV === "production" ? "dist" : "public"}/ar-assets/models/${r.params.filename}`, import.meta.url)));
  });
  app.get("/api/ar/models/:filename", async (r, s) => {
    const filename = r.params.filename;
    if (!/^[a-z0-9-]+\.glb$/.test(filename)) fail("模型不存在", 404);
    const clues = await all("SELECT id FROM clues");
    if (
      !clues.some((c) =>
        evidenceModelFilenames(c.id).some((name) => name + ".glb" === filename),
      ) &&
      !publicInvestigationNodes.some((node) =>
        [node.filename, node.fallback].some(
          (name) => name + ".glb" === filename,
        ),
      )
    )
      fail("模型不存在", 404);
    s.set({
      "Content-Type": "model/gltf-binary",
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    });
    return sendStoredAsset(s, path.join(modelsRoot, filename));
  });
  app.get("/api/models/:filename", auth("player", "gm"), async (r, s) => {
    const filename = r.params.filename;
    if (!/^[a-z0-9-]+\.glb$/.test(filename)) fail("模型不存在", 404);
    const clues = (await all("SELECT id FROM clues")).filter((c) =>
      evidenceModelFilenames(c.id).some((name) => name + ".glb" === filename),
    );
    if (!clues.length) fail("模型不存在", 404);
    if (r.auth.role !== "gm") {
      const { p } = await playable(r);
      const unlocked = await all(
        "SELECT clue_id FROM unlocks WHERE player_id=?",
        p.id,
      );
      if (!clues.some((c) => unlocked.some((u) => u.clue_id === c.id)))
        fail("请先取得对应证物，再查看AR/VR模型", 403);
    }
    s.set({
      "Content-Type": "model/gltf-binary",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    return sendStoredAsset(s, path.join(modelsRoot, filename));
  });
  mountEvidenceRoutes(app, { auth, player, playable, evidence });
  mountFactionPlayRoutes(app, { auth, player, playable, factionPlay });
  mountArRoutes(app, {
    auth,
    playable,
    evidence,
    fail,
    setting,
    catalog: { get: contentStore.getScene, manifest: arCatalog.manifest },
  });
  app.get("/api/lots", auth("player"), async (r, s) =>
    s.json(
      await all(
        "SELECT id,title,start_price,description,effect,status,bid,bidder FROM lots",
      ),
    ),
  );
  app.post("/api/lots/:id/bid", auth("player"), async (r, s) => {
    const { p } = await playable(r),
      amount = r.body.amount;
    if (!Number.isSafeInteger(amount) || amount < 1) fail("出价必须是正整数");
    await tx(async () => {
      const l = await one("SELECT * FROM lots WHERE id=?", r.params.id);
      if (!l || l.status !== "open" || (await setting()).phase !== 2)
        fail("该拍品未开放");
      if (amount < Math.max(l.start_price, l.bid + 1))
        fail("出价需高于当前价格");
      const reserved = (
        await one(
          "SELECT COALESCE(SUM(bid),0) n FROM lots WHERE bidder=? AND status='open' AND id!=?",
          p.id,
          l.id,
        )
      ).n;
      if (
        amount + reserved >
        (await one("SELECT coins FROM players WHERE id=?", p.id)).coins
      )
        fail("可用金币不足，其他领先竞拍已预留金币");
      await run(
        "UPDATE lots SET bid=?,bidder=? WHERE id=?",
        amount,
        p.id,
        l.id,
      );
      await run(
        "INSERT INTO bids(lot_id,player_id,amount) VALUES(?,?,?)",
        l.id,
        p.id,
        amount,
      );
    });
    s.json({
      ok: true,
    });
  });
  app.post("/api/inventory/:id/use", auth("player"), async (r, s) => {
    const { p } = await playable(r);
    if ((await setting()).phase !== 4) fail("道具将在庭审阶段使用");
    await tx(async () => {
      const item = await one(
        "SELECT i.*,l.title FROM inventory i JOIN lots l ON l.id=i.lot_id WHERE i.id=? AND player_id=?",
        r.params.id,
        p.id,
      );
      if (!item || item.used) fail("道具不存在或已使用");
      await run("UPDATE inventory SET used=1 WHERE id=?", item.id);
      await run(
        "INSERT INTO audit(actor,action) VALUES(?,?)",
        p.id,
        `庭审申请使用${item.title}，由GM现场执行效果`,
      );
    });
    s.json({
      ok: true,
    });
  });
  app.post("/api/vote", auth("player"), async (r, s) => {
    const { p } = await playable(r);
    if ((await setting()).phase !== 4 || !(await setting()).voting)
      fail("GM尚未开放最终投票");
    const v = r.body;
    if (!(await one("SELECT id FROM npcs WHERE id=?", v.suspect)))
      fail("请选择嫌疑人");
    for (const k of ["motive", "means", "opportunity"]) {
      if (
        !(await one(
          "SELECT 1 FROM unlocks WHERE player_id=? AND clue_id=?",
          p.id,
          v[k],
        ))
      )
        fail("三项证明必须选择你已获得的证据");
    }
    if (!["publish", "protect", "destroy"].includes(v.decision))
      fail("请选择结局");
    await run(
      "INSERT INTO votes(player_id,suspect,motive,means,opportunity,decision) VALUES(?,?,?,?,?,?) ON CONFLICT(player_id) DO UPDATE SET suspect=excluded.suspect,motive=excluded.motive,means=excluded.means,opportunity=excluded.opportunity,decision=excluded.decision",
      p.id,
      v.suspect,
      v.motive,
      v.means,
      v.opportunity,
      v.decision,
    );
    s.json({
      ok: true,
    });
  });
  app.get("/api/staff", auth("gm", "npc"), async (r, s) => {
    const gm = r.auth.role === "gm";
    const staffPlayers = await all(
      `SELECT p.id,p.name,p.payment,p.checked_in,p.coins,p.group_id,c.name AS "character",c.status,c.cosplay_character,c.cosplay_source,c.avatar_url${gm ? ",p.contact,CASE WHEN EXISTS (SELECT 1 FROM paid_phones pf WHERE pf.phone=p.contact) AND NOT EXISTS (SELECT 1 FROM npc_phones nf WHERE nf.phone=p.contact) THEN 1 ELSE 0 END AS paid_phone_import,c.faction,c.generation_status,c.generator,c.generation_error,c.generation_pending" : ""} FROM players p LEFT JOIN characters c ON c.player_id=p.id ${gm ? "" : "WHERE c.status='approved' AND EXISTS (SELECT 1 FROM character_relations r WHERE r.player_id=p.id AND r.npc_id=?)"} ORDER BY p.created_at DESC`,
      ...(gm ? [] : [r.auth.user_id]),
    );
    if (gm) {
      const assignments = new Map((await factionService.getAdminState()).players.map((p) => [p.id, p]));
      for (const p of staffPlayers) {
        p.faction = assignments.get(p.id)?.assigned || null;
        p.faction_assigned = p.faction;
      }
    }
    const relationRows = await all(
      `SELECT r.*,n.name npc_name,p.name player_name,c.name character_name,c.cosplay_character,c.cosplay_source,c.avatar_url,c.status,c.generation_status,c.generator FROM character_relations r JOIN npcs n ON n.id=r.npc_id JOIN players p ON p.id=r.player_id JOIN characters c ON c.player_id=r.player_id ${gm ? "" : "WHERE r.npc_id=? AND c.status='approved'"} ORDER BY p.created_at DESC,r.npc_id`,
      ...(gm ? [] : [r.auth.user_id]),
    );
    s.set("Cache-Control", "private, no-store").json({
      settings: await setting(),
      storyMaterials: staffStoryMaterials(r.auth.role, r.auth.user_id),
      players: staffPlayers,
      relations: relationRows.map(({ hooks, ...relation }) => ({
        ...relation,
        hooks: JSON.parse(hooks),
      })),
      missions: await all(
        gm
          ? "SELECT * FROM missions"
          : "SELECT m.* FROM missions m JOIN characters c ON c.player_id=m.player_id WHERE m.npc_id=? AND c.status='approved'",
        ...(gm ? [] : [r.auth.user_id]),
      ),
      npcs: await all(
        gm
          ? `SELECT * FROM npcs ORDER BY ${npcOrder}`
          : `SELECT id,name,english,role,bio FROM npcs ORDER BY ${npcOrder}`,
      ),
      clues: gm ? await all("SELECT * FROM clues") : [],
      lots: gm ? await all("SELECT * FROM lots") : [],
      stats: {
        unlocks: (await one("SELECT COUNT(*) n FROM unlocks")).n,
        votes: gm ? (await one("SELECT COUNT(*) n FROM votes")).n : 0,
      },
      events: await all("SELECT * FROM events ORDER BY id DESC LIMIT 10"),
      votes: gm
        ? await all("SELECT suspect,COUNT(*) n FROM votes GROUP BY suspect")
        : [],
      audit: gm
        ? await all("SELECT * FROM audit ORDER BY id DESC LIMIT 20")
        : [],
    });
  });
  app.get("/api/staff/players/:id", auth("gm"), async (r, s) => {
    const p = await one(
      "SELECT p.id,p.name,p.contact,p.payment,p.group_id,p.checked_in,p.coins,CASE WHEN EXISTS (SELECT 1 FROM paid_phones pf WHERE pf.phone=p.contact) AND NOT EXISTS (SELECT 1 FROM npc_phones nf WHERE nf.phone=p.contact) THEN 1 ELSE 0 END AS paid_phone_import FROM players p WHERE p.id=?",
      r.params.id,
    );
    if (!p) fail("玩家不存在", 404);
    s.set("Cache-Control", "private, no-store").json({
      player: p,
      faction: await factionService.getPlayerState(p.id),
      character: characterView(
        await one("SELECT * FROM characters WHERE player_id=?", p.id),
      ),
      relations: await relationsFor(p.id),
    });
  });
  app.post("/api/staff/players/:id", auth("gm"), async (r, s) => {
    const id = r.params.id;
    if (!(await one("SELECT id FROM players WHERE id=?", id)))
      fail("玩家不存在", 404);
    await tx(async () => {
      if (r.body.payment) {
        if (!["pending", "paid", "refunded"].includes(r.body.payment))
          fail("票务状态无效");
        await run(
          "UPDATE players SET payment=? WHERE id=?",
          r.body.payment,
          id,
        );
      }
      if (r.body.checkin) {
        const p = await one("SELECT * FROM players WHERE id=?", id);
        if (p.payment !== "paid") fail("请先确认票务");
        if (!p.checked_in) {
          await run("UPDATE players SET checked_in=1 WHERE id=?", id);
          await coin(id, 3, "现场签到初始金币");
        }
      }
      if (r.body.status) {
        if (!["pending", "approved"].includes(r.body.status))
          fail("审核状态无效");
        const c = await one("SELECT * FROM characters WHERE player_id=?", id);
        if (!c) fail("该玩家尚未填写角色");
        if (r.body.status === "approved" && c.generation_pending)
          fail("剧情仍在生成，请完成或重试后再审核");
        if (
          r.body.status === "approved" &&
          !(await one(
            "SELECT 1 FROM character_relations WHERE player_id=?",
            id,
          ))
        )
          fail("角色尚未生成有效NPC关联，请先完成生成");
        const faction = r.body.faction ?? c.faction;
        if (faction && !["fbi", "croft", "conspirator"].includes(faction))
          fail("阵营无效");
        await run("UPDATE characters SET status=? WHERE player_id=?", r.body.status, id);
        if (r.body.faction) {
          if ((await factionService.getAdminState()).drawn) {
            if ((await factionService.getPlayerState(id)).assigned !== r.body.faction)
              await factionService.setFactionInTransaction(id, r.body.faction, r.auth.user_id);
          } else if (r.body.faction !== c.faction && r.body.faction === "conspirator")
            fail("杀手身份须在阵营与暗号中抽签分配", 409);
          else if (r.body.faction !== c.faction)
            await run("UPDATE characters SET faction=? WHERE player_id=?", r.body.faction, id);
        }
      }
      if (r.body.group) {
        if (
          !Number.isInteger(r.body.group) ||
          r.body.group < 1 ||
          r.body.group > 6
        )
          fail("调查组必须为1到6");
        await run("UPDATE players SET group_id=? WHERE id=?", r.body.group, id);
      }
      await audit(r, `更新玩家 ${id.slice(0, 8)}：${JSON.stringify(r.body)}`);
    });
    s.json({
      ok: true,
    });
  });
  app.post(
    "/api/staff/missions/:id/complete",
    auth("gm", "npc"),
    async (r, s) => {
      await tx(async () => {
        const m = await one("SELECT * FROM missions WHERE id=?", r.params.id);
        if (!m || (r.auth.role === "npc" && m.npc_id !== r.auth.user_id))
          fail("无法操作此任务", 403);
        if ((await setting()).phase !== 1) fail("破冰任务只在第一幕结算");
        const p = await one("SELECT * FROM players WHERE id=?", m.player_id);
        const c = await one(
          "SELECT status FROM characters WHERE player_id=?",
          m.player_id,
        );
        if (c?.status !== "approved") fail("玩家角色尚未通过自动审核", 403);
        if (!p.checked_in || p.payment !== "paid") fail("玩家尚未签到");
        if (m.status === "done") return;
        const earned = (
          await one(
            "SELECT COALESCE(SUM(amount),0) n FROM ledger WHERE player_id=? AND amount>0",
            p.id,
          )
        ).n;
        const award = Math.min(m.reward, Math.max(0, 10 - earned));
        await coin(p.id, award, `任务：${m.title}`);
        await run("UPDATE missions SET status='done' WHERE id=?", m.id);
        await audit(r, `完成任务 ${m.id.slice(0, 8)} +${award}`);
      });
      s.json({
        ok: true,
      });
    },
  );
  app.post("/api/staff/phase", auth("gm"), async (r, s) => {
    const phase = r.body.phase;
    if (!Number.isInteger(phase) || phase < 1 || phase > 4)
      fail("剧情阶段无效");
    await run(
      "UPDATE settings SET phase=?,voting=CASE WHEN ?=4 THEN voting ELSE 0 END",
      phase,
      phase,
    );
    await run(
      "INSERT INTO events(title,body) VALUES(?,?)",
      `第${phase}幕 · ${phases[phase - 1]}`,
      "新的剧情阶段已开启，请听从现场GM指引。",
    );
    await audit(r, `切换第${phase}幕`);
    s.json({
      ok: true,
    });
  });
  app.post("/api/staff/voting", auth("gm"), async (r, s) => {
    if ((await setting()).phase !== 4) fail("请先进入庭审");
    await run("UPDATE settings SET voting=?", r.body.open ? 1 : 0);
    await audit(r, r.body.open ? "开启最终投票" : "关闭最终投票");
    s.json({
      ok: true,
    });
  });
  app.post("/api/staff/events", auth("gm"), async (r, s) => {
    await run(
      "INSERT INTO events(title,body) VALUES(?,?)",
      required(r.body.title, "标题", 80),
      required(r.body.body, "消息", 1000),
    );
    await audit(r, "发布全场消息");
    s.json({
      ok: true,
    });
  });
  app.post("/api/staff/lots/:id", auth("gm"), async (r, s) => {
    await tx(async () => {
      const l = await one("SELECT * FROM lots WHERE id=?", r.params.id);
      if (!l) fail("拍品不存在");
      if (l.status === "sold") fail("该拍品已成交");
      if (r.body.action === "open") {
        if ((await setting()).phase !== 2) fail("拍卖只能在第二幕开放");
        await run("UPDATE lots SET status='open' WHERE id=?", l.id);
      } else if (r.body.action === "settle") {
        if (l.status !== "open" || !l.bidder) fail("暂无有效出价");
        await coin(l.bidder, -l.bid, `拍卖成交：${l.title}`);
        await run(
          "INSERT INTO inventory(player_id,lot_id) VALUES(?,?)",
          l.bidder,
          l.id,
        );
        await run("UPDATE lots SET status='sold' WHERE id=?", l.id);
      } else fail("拍卖操作无效");
      await audit(r, `拍品 ${l.title} ${r.body.action}`);
    });
    s.json({
      ok: true,
    });
  });
  app.post("/api/staff/coins", auth("gm"), async (r, s) => {
    const id = r.body.playerId,
      amount = r.body.amount;
    if (!Number.isSafeInteger(amount) || Math.abs(amount) > 1000 || !amount)
      fail("请输入有效整数金额");
    required(r.body.reason, "调整原因", 120);
    await tx(async () => {
      const p = await one("SELECT * FROM players WHERE id=?", id);
      if (!p) fail("玩家不存在");
      const reserved = (
        await one(
          "SELECT COALESCE(SUM(bid),0) n FROM lots WHERE bidder=? AND status='open'",
          id,
        )
      ).n;
      if (p.coins + amount < reserved) fail("余额不能低于已预留竞拍金币");
      await coin(id, amount, r.body.reason);
      await audit(r, `金币调整 ${id.slice(0, 8)} ${amount}：${r.body.reason}`);
    });
    s.json({
      ok: true,
    });
  });
  app.post("/api/staff/unlock", auth("gm"), async (r, s) => {
    if (
      !(await one("SELECT id FROM players WHERE id=?", r.body.playerId)) ||
      !(await one("SELECT id FROM clues WHERE id=?", r.body.clueId))
    )
      fail("玩家或证据不存在");
    await run(
      "INSERT OR IGNORE INTO unlocks(player_id,clue_id) VALUES(?,?)",
      r.body.playerId,
      r.body.clueId,
    );
    await audit(
      r,
      `应急放行 ${r.body.clueId} 给 ${r.body.playerId.slice(0, 8)}`,
    );
    s.json({
      ok: true,
    });
  });
  app.post("/api/staff/settings", auth("gm"), async (r, s) => {
    const { capacity, price } = r.body;
    if (
      !Number.isInteger(capacity) ||
      capacity < Math.max(1, (await one("SELECT COUNT(*) n FROM players")).n) ||
      capacity > MAX_PLAYERS ||
      !Number.isInteger(price) ||
      price < 0 ||
      price > 10000
    )
      fail("请输入有效名额和价格，名额最多50人且不能少于已报名人数");
    await run("UPDATE settings SET capacity=?,price=?", capacity, price);
    await audit(r, "更新活动名额与价格");
    s.json({
      ok: true,
    });
  });
  app.post("/api/staff/clues/:id", auth("gm"), async (r, s) => {
    const { dc, phase } = r.body;
    if (
      !Number.isInteger(dc) ||
      dc < 1 ||
      dc > 30 ||
      !Number.isInteger(phase) ||
      phase < 1 ||
      phase > 4
    )
      fail("难度或阶段无效");
    if (!(await one("SELECT id FROM clues WHERE id=?", r.params.id)))
      fail("证据不存在", 404);
    await run(
      "UPDATE clues SET title=?,body=?,detail=?,dc=?,phase=? WHERE id=?",
      required(r.body.title, "标题", 100),
      required(r.body.body, "基础证据", 2000),
      required(r.body.detail, "进阶信息", 2000),
      dc,
      phase,
      r.params.id,
    );
    await audit(r, `编辑证据 ${r.params.id}`);
    s.json({
      ok: true,
    });
  });
  app.post("/api/staff/npcs/:id", auth("gm"), async (r, s) => {
    if (!(await one("SELECT id FROM npcs WHERE id=?", r.params.id)))
      fail("NPC不存在", 404);
    await run(
      "UPDATE npcs SET bio=?,secret=? WHERE id=?",
      required(r.body.bio, "公开背景", 2000),
      required(r.body.secret, "保密设定", 2000),
      r.params.id,
    );
    await audit(r, `编辑NPC ${r.params.id}`);
    s.json({
      ok: true,
    });
  });
  mountPaidPhoneRoutes(app, { auth, one, all, run, tx, fail, audit, paidPhones });
  mountManagementRoutes(app, {
    auth,
    one,
    all,
    run,
    tx,
    fail,
    required,
    audit,
    token,
    store: contentStore,
    assetBaseUrl,
    paidPhones,
    factionService,
  });
  app.use("/api", (r, s) =>
    s.status(404).json({
      error: "接口不存在",
    }),
  );
  app.use((e, r, s, next) => {
    if (["23505", "23514", "SQLITE_CONSTRAINT_CHECK"].includes(e.code)) {
      e.status = 400;
      e.message = "数据已存在或操作超出限制，请刷新后重试";
    }
    if (!e.status) console.error(e);
    s.status(e.status || 500).json({
      error: e.status ? e.message : "服务暂时异常，请重试",
    });
  });
  return {
    app,
    db,
    voiceJobs,
  };
}
