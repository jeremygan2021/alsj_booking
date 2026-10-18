import { randomBytes, randomInt } from "node:crypto";
import { staffStoryMaterials } from "../story-materials.js";

const factions = new Set(["fbi", "croft", "conspirator"]);
const preferences = new Set([...factions, "any"]);
const factionNames = { fbi: "FBI调查阵营", croft: "阿德里安·索恩阵营", conspirator: "杀手阵营" };
const rule = "活动最多50人。已付费、角色已批准并保存阵营偏好的玩家参加GM手动抽签；杀手席位按参与人数÷12四舍五入，至少2人、最多5人（40人3席、50人4席）。选择杀手需抽签，优先从杀手偏好中抽取，不足时从服从分配者补足；其余玩家尽量按偏好平均分到另两个阵营。抽签后本轮席位固定，不能重抽；后加入玩家由GM手动补位，人数大幅变化请开新场。";
// Historical NPC IDs do not describe the present story roles. Keep the target
// tied to the actor-only materials, and never include it in a public projection.
const culprits = staffStoryMaterials("gm").npcs.filter((npc) =>
  /^(?:真正凶手。|唯一实施致命袭击者。)/u.test(npc.secret),
);
if (culprits.length !== 1) throw new Error("剧情材料必须指定唯一凶手接头目标");
const killerContact = Object.freeze({ npcId: culprits[0].id, name: culprits[0].name });
const codeAlphabet = [...new Set("星月风雪云海山川霜林灯火银舟青松白鹤夜雨晨霞清泉石桥秋叶冬梅春柳夏荷长空远帆归雁微光静湖竹影寒露晴岚暮潮飞萤紫藤落花听歌旧塔溪谷朝阳夕照墨羽碧水苍穹虹梦")];

export function killerQuota(participantCount) {
  return Math.max(2, Math.min(5, Math.round(Number(participantCount) / 12)));
}

export function createFactionService({ one, all, run, tx, fail, now = Date.now, random = randomInt }) {
  const index = (max) => {
    const value = random(max);
    if (!Number.isInteger(value) || value < 0 || value >= max)
      throw new Error("阵营抽签随机源无效");
    return value;
  };
  const shuffle = (items) => {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = index(i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  };
  const drawState = async () => await one("SELECT * FROM faction_draw_state WHERE id=1");
  const playerRecord = async (id) => {
    const player = await one(
      "SELECT p.id,p.payment,c.status,f.preference,a.faction,a.contact_code,a.draw_id FROM players p LEFT JOIN characters c ON c.player_id=p.id LEFT JOIN faction_preferences f ON f.player_id=p.id LEFT JOIN faction_assignments a ON a.player_id=p.id WHERE p.id=?",
      id,
    );
    if (!player) fail("玩家不存在", 404);
    return player;
  };
  const roster = async () => (await all(
    'SELECT p.id,p.name,p.payment,p.checked_in,c.name AS "character",c.status,c.faction AS legacy_faction,f.preference,a.faction AS assigned,a.contact_code AS code,CASE WHEN EXISTS (SELECT 1 FROM npc_phones n WHERE n.phone=p.contact) THEN 1 ELSE 0 END AS is_npc FROM players p LEFT JOIN characters c ON c.player_id=p.id LEFT JOIN faction_preferences f ON f.player_id=p.id LEFT JOIN faction_assignments a ON a.player_id=p.id ORDER BY p.created_at,p.id',
  )).map(({ is_npc, ...player }) => ({
    ...player,
    preference: player.preference || null,
    assigned: player.assigned || null,
    code: player.assigned === "conspirator" ? player.code : null,
    eligible: !is_npc && player.payment === "paid" && player.status === "approved" && preferences.has(player.preference),
    awaitingPreference: !is_npc && player.payment === "paid" && player.status === "approved" && !player.preference,
  }));
  const countsFor = (players) => {
    const counts = { fbi: 0, croft: 0, conspirator: 0 };
    for (const player of players) if (factions.has(player.assigned)) counts[player.assigned]++;
    return counts;
  };
  const getAdminState = async () => {
    const state = await drawState(), players = await roster();
    const eligible = players.filter((player) => player.eligible);
    return {
      drawn: Boolean(state?.draw_id),
      drawId: state?.draw_id || null,
      drawnAt: state?.drawn_at || null,
      participantCount: state?.participant_count ?? null,
      quota: state?.draw_id ? state.killer_slots : killerQuota(eligible.length),
      eligibleCount: eligible.length,
      candidateCount: eligible.filter((player) => ["conspirator", "any"].includes(player.preference)).length,
      missingPreferenceCount: players.filter((player) => player.awaitingPreference).length,
      counts: countsFor(players),
      players,
      rule,
      killerContact,
    };
  };
  const getPlayerState = async (id) => {
    const player = await playerRecord(id), state = await drawState();
    const assigned = player.faction || null;
    const code = assigned === "conspirator" ? player.contact_code : null;
    return {
      preference: player.preference || null,
      preferenceLocked: Boolean(assigned),
      assigned,
      code,
      briefing: assigned === "conspirator"
        ? `你已分配到杀手阵营，是协助真凶的同伙，并非亲自行凶者。真正的凶手是${killerContact.name}。活动开始前，请私下找到对方，说出你专属的接头暗号：“${code}”。请保密，不要向其他玩家展示此页。`
        : assigned ? `你已分配到${factionNames[assigned]}。请按自己的角色档案与NPC互动。` : null,
      drawn: Boolean(state?.draw_id),
      quota: state?.draw_id ? state.killer_slots : null,
    };
  };
  const savePreference = async (id, preference) => {
    if (!preferences.has(preference)) fail("请选择有效的阵营偏好");
    return tx(async () => {
      const player = await playerRecord(id);
      if (player.faction && player.preference !== preference)
        fail("阵营已经分配，偏好已锁定；如需调整请联系GM", 409);
      await run(
        "INSERT INTO faction_preferences(player_id,preference,updated_at) VALUES(?,?,?) ON CONFLICT(player_id) DO UPDATE SET preference=excluded.preference,updated_at=excluded.updated_at",
        id, preference, now(),
      );
      return getPlayerState(id);
    });
  };
  // Sixteen independently chosen common Chinese characters provide over 90
  // bits of entropy, while grouped four-at-a-time remain readable at the venue.
  // Lottery injection never affects these private credentials.
  const newContactCode = async () => {
    for (let attempt = 0; attempt < 32; attempt++) {
      const chars = Array.from({ length: 16 }, () => codeAlphabet[randomInt(codeAlphabet.length)]);
      const code = Array.from({ length: 4 }, (_, i) => chars.slice(i * 4, i * 4 + 4).join("")).join("·");
      if (!(await one("SELECT player_id FROM faction_assignments WHERE contact_code=?", code))) return code;
    }
    throw new Error("接头暗号生成失败，请重试");
  };
  const assign = async (playerId, faction, state, actor) => {
    const prior = await one("SELECT contact_code FROM faction_assignments WHERE player_id=?", playerId);
    // Preserve a past credential internally when a GM changes someone's side;
    // player/GM projections return it only while that player is a conspirator.
    const code = faction === "conspirator" ? prior?.contact_code || await newContactCode() : prior?.contact_code || null;
    await run(
      "INSERT INTO faction_assignments(player_id,faction,contact_code,draw_id,assigned_at,assigned_by) VALUES(?,?,?,?,?,?) ON CONFLICT(player_id) DO UPDATE SET faction=excluded.faction,contact_code=excluded.contact_code,draw_id=excluded.draw_id,assigned_at=excluded.assigned_at,assigned_by=excluded.assigned_by",
      playerId, faction, code, state.draw_id, now(), actor,
    );
    await run("UPDATE characters SET faction=? WHERE player_id=?", faction, playerId);
  };
  const draw = async (actor = "gm") => tx(async () => {
    const state = await drawState();
    if (state?.draw_id) fail("本轮阵营已经抽签，不能重抽；如需补位请由GM单独调整", 409);
    if ((await one("SELECT COUNT(*) n FROM faction_assignments")).n)
      fail("本轮已有正式阵营分配，不能重新抽签", 409);
    const eligible = (await roster()).filter((player) => player.eligible);
    if (eligible.length < 4) fail("至少需要4名已付费、角色已批准且已保存阵营偏好的玩家才能分配三个阵营", 409);
    if (eligible.length > 50) fail("活动最多50人，请先核对参与名单后再抽签", 409);
    const quota = killerQuota(eligible.length);
    const preferred = shuffle(eligible.filter((player) => player.preference === "conspirator"));
    const flexible = shuffle(eligible.filter((player) => player.preference === "any"));
    if (preferred.length + flexible.length < quota)
      fail(`本轮需要${quota}名杀手，愿意参与杀手抽签或服从分配的玩家只有${preferred.length + flexible.length}名；请先征集足够的自愿候选人`, 409);
    const chosen = preferred.slice(0, quota);
    chosen.push(...flexible.slice(0, quota - chosen.length));
    const chosenIds = new Set(chosen.map((player) => player.id));
    const remaining = shuffle(eligible.filter((player) => !chosenIds.has(player.id)));
    const fbiCapacity = Math.floor(remaining.length / 2) + (remaining.length % 2 && index(2));
    const capacities = { fbi: fbiCapacity, croft: remaining.length - fbiCapacity };
    const assignments = chosen.map((player) => [player.id, "conspirator"]);
    const assignedIds = new Set(chosenIds);
    for (const faction of ["fbi", "croft"]) {
      for (const player of remaining.filter((entry) => entry.preference === faction).slice(0, capacities[faction])) {
        assignments.push([player.id, faction]);
        assignedIds.add(player.id);
        capacities[faction]--;
      }
    }
    for (const player of remaining.filter((entry) => !assignedIds.has(entry.id))) {
      const faction = capacities.fbi && capacities.croft
        ? (index(capacities.fbi + capacities.croft) < capacities.fbi ? "fbi" : "croft")
        : capacities.fbi ? "fbi" : "croft";
      assignments.push([player.id, faction]);
      capacities[faction]--;
    }
    const drawnAt = now(), drawId = randomBytes(16).toString("hex");
    await run(
      "UPDATE faction_draw_state SET draw_id=?,drawn_at=?,participant_count=?,killer_slots=?,actor=? WHERE id=1",
      drawId, drawnAt, eligible.length, quota, actor,
    );
    const nextState = { draw_id: drawId };
    for (const [id, faction] of assignments) await assign(id, faction, nextState, actor);
    await run("INSERT INTO audit(actor,action) VALUES(?,?)", actor, `手动完成阵营抽签：${eligible.length}人，杀手${quota}席；本轮席位已锁定`);
    return getAdminState();
  });
  const setFactionInTransaction = async (id, faction, actor = "gm") => {
    if (!factions.has(faction)) fail("阵营无效");
    const state = await drawState();
    if (!state?.draw_id) fail("请先由GM完成本轮阵营抽签，再进行单人调整", 409);
    await playerRecord(id);
    const players = await roster(), player = players.find((entry) => entry.id === id);
    if (!player.eligible) fail("请先确认该玩家已付费、角色已批准并保存阵营偏好", 409);
    if (faction === "conspirator" && !["conspirator", "any"].includes(player.preference))
      fail("该玩家没有自愿参与杀手抽签，不能强制加入杀手阵营", 409);
    if (!player.assigned && players.filter((entry) => entry.assigned).length >= 50)
      fail("活动最多50人，无法继续补位", 409);
    const counts = countsFor(players);
    if (player.assigned) counts[player.assigned]--;
    counts[faction]++;
    if (counts.conspirator < 2 || counts.conspirator > Math.min(5, state.killer_slots))
      fail(`本轮杀手必须为2至${Math.min(5, state.killer_slots)}人，抽签席位不会随人数变动`, 409);
    if (Math.abs(counts.fbi - counts.croft) > 1)
      fail("其余两个阵营人数差不能超过1人，请优先为人数较少的阵营补位或调整", 409);
    await assign(id, faction, state, actor);
    await run("INSERT INTO audit(actor,action) VALUES(?,?)", actor, `GM调整玩家 ${id.slice(0, 8)} 阵营为${factionNames[faction]}`);
    return getPlayerState(id);
  };
  const setFaction = async (...args) => tx(() => setFactionInTransaction(...args));
  return { getPlayerState, savePreference, getAdminState, draw, setFaction, setFactionInTransaction };
}
