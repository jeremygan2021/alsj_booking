import { lots } from "../content.js";
import materials from "../story-materials.json" with { type: "json" };
import { hasForbiddenPlot, normalizeOnsiteStory } from "../story-generation.js";

// Exact snapshot of the shipped defaults before the amateur-NPC wording change.
// Never compare against a moving import when deciding whether GM prose is custom.
const legacy = {
  "lotDescriptions": [
    "收藏一件无法发射的舞台模型，并获得一次非核心道具观察提示。核心物证核查免费开放。",
    "一次性优先询问一位NPC已知的非核心细节。演员不得编造事实，核心证言保底公开。",
    "一次性提前查看一份非核心背景档案；不得锁住破案所需的唯一事实。",
    "一次性优先取得已获证物的非核心观察提示。核心核查无需竞拍，也不因骰子失败丢失。",
    "一次性优先请诺拉核对财产遗嘱的非核心背景；数字处置规则与关键条款免费公开。",
    "一次性优先取得已获证物的非核心观察提示。致伤物与织边断口等核心事实保底公开。"
  ],
  "npcSecrets": {
    "host": "2021年创立ADS，2023年瑟琳娜去世后启动ECHO；准备23:30暂停授权不足实例交互并交独立审查。约20:58遭伊芙琳以奖杯袭击，21:07为原定数字演示。",
    "attorney": "唯一实施致命袭击者。为数字莉娅争取继续交互的时间，20:55赴约，约20:58冲动用奖杯击打索恩，随后利用既有演示掩护；没有预谋编造语音或修改门禁。",
    "detective": "以合规顾问身份调查数据交易的FBI探员；按索恩申请执行原定通行安排。20:55—21:01连续在舞台值守，发现尸体后公开身份并主动说明审批。",
    "security": "准备董事会夺权并真实购买索恩行程，隐瞒商业秘密；未参与谋杀。20:55—21:04连续在交易室，原片与参会者证言可核对。",
    "scientist": "拍卖师兼私人数据与行程交易人；按原定台本播放数字语音，未参与袭击。20:55—21:01连续在舞台；21:18裁切审批诬指诺拉删记录以转移数据调查。",
    "singer": "瑟琳娜生前好友，持有2022年真人录音与授权；20:56经过东侧走廊但未入室，20:57—21:01持续在摄影区。只听见不清楚的争执，未辨认身份。"
  }
};

function safeText(value, fallback, limit) {
  return typeof value === "string" && value.trim() && value.length <= limit && !hasForbiddenPlot(value)
    ? value.trim() : fallback;
}

function relationInput(row, npcId) {
  let hooks;
  try { hooks = JSON.parse(row.hooks || "[]"); } catch { hooks = []; }
  const phases = Array.isArray(hooks) ? [...new Set(hooks.map((hook) => hook?.phase)
    .filter((phase) => Number.isInteger(phase) && phase >= 1 && phase <= 4))] : [];
  return {
    npc_id: npcId,
    relation: safeText(row.relation, "晚宴中的公开联系人", 80),
    player_brief: safeText(row.player_brief, "请在第一幕介绍自己并听取一个公开看法。", 700),
    npc_brief: "请用公开背景接待宾客。",
    hooks: (phases.length ? phases : [1]).map((phase) => ({ phase, goal: "以礼貌问答交流一个公开看法。" })),
    mission: "介绍自己并听取一个公开看法。",
  };
}

// Run in the caller's transaction, after character-links, faction-state and
// story-v5. Gameplay identities, approvals, rewards and completed work survive.
export async function applyAmateurNpc(db) {
  const id = "amateur-npc-v1";
  await db.prepare("CREATE TABLE IF NOT EXISTS content_migrations(id TEXT PRIMARY KEY)").run();
  if (await db.prepare("SELECT id FROM content_migrations WHERE id=?").get(id)) return;

  for (const [index, description] of legacy.lotDescriptions.entries()) {
    const current = lots[index]?.[2];
    if (current && current !== description)
      await db.prepare("UPDATE lots SET description=? WHERE id=? AND description=?")
        .run(current, index + 1, description);
  }
  for (const npc of materials.npcs) {
    const old = legacy.npcSecrets[npc.id];
    if (old && npc.secret !== old)
      await db.prepare("UPDATE npcs SET secret=? WHERE id=? AND secret=?").run(npc.secret, npc.id, old);
  }

  const npcs = await db.prepare("SELECT id,name,english,role,bio FROM npcs ORDER BY id").all();
  const rows = await db.prepare(`SELECT r.*,c.name AS character_name,c.profession AS character_profession,
    c.status AS character_status,a.faction AS assigned_faction
    FROM character_relations r JOIN characters c ON c.player_id=r.player_id
    JOIN npcs n ON n.id=r.npc_id LEFT JOIN faction_assignments a ON a.player_id=r.player_id
    ORDER BY r.player_id,r.npc_id`).all();
  const completed = new Set((await db.prepare("SELECT DISTINCT player_id FROM missions WHERE status='done'").all())
    .map((row) => row.player_id));

  for (const row of rows) {
    // The current generator validates two relationships. A second real NPC is
    // only an in-memory validation companion for older one-contact characters;
    // no new relationship, mission or identity is inserted into the database.
    const companion = npcs.find((npc) => npc.id !== row.npc_id);
    if (!companion) continue;
    const normalized = normalizeOnsiteStory({
      adaptation: "受邀参加索恩庄园的ECHO晚宴，以公开话题与宾客交流。",
      relations: [relationInput(row, row.npc_id), relationInput({}, companion.id)],
    }, npcs, {
      character: { name: row.character_name, profession: row.character_profession },
      faction: row.assigned_faction || undefined,
    }).relations.find((relation) => relation.npc_id === row.npc_id);

    if (row.character_status === "pending" && !completed.has(row.player_id)) {
      await db.prepare(`UPDATE character_relations SET npc_brief=?,player_brief=?,hooks=?,mission=?
        WHERE player_id=? AND npc_id=?`).run(normalized.npc_brief, normalized.player_brief,
        JSON.stringify(normalized.hooks), normalized.mission, row.player_id, row.npc_id);
      // Only the task linked by the prior relationship text is a generated
      // counterpart. Extra manually authored tasks for the same NPC stay intact.
      await db.prepare(`UPDATE missions SET title=? WHERE player_id=? AND npc_id=?
        AND status='pending' AND title=?`).run(normalized.mission, row.player_id, row.npc_id, row.mission);
    } else {
      // Approved/rejected characters and anyone with completed work keep every
      // player-facing objective. Only the actor's delivery instructions change.
      await db.prepare("UPDATE character_relations SET npc_brief=? WHERE player_id=? AND npc_id=?")
        .run(normalized.npc_brief, row.player_id, row.npc_id);
    }
  }
  await db.prepare("INSERT INTO content_migrations(id) VALUES(?)").run(id);
}
