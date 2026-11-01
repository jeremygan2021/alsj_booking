import { INVESTIGATION_GROUP_COUNT } from "../../src/investigation-groups.js";

export const INVESTIGATION_GROUP_MIGRATION = "investigation-groups-4-v1";

// Run once inside the adapter's transaction, before accepting registrations.
export async function applyFourInvestigationGroups(db) {
  if (
    await db
      .prepare("SELECT id FROM content_migrations WHERE id=?")
      .get(INVESTIGATION_GROUP_MIGRATION)
  )
    return;

  const players = await db
    .prepare(
      "SELECT id,group_id FROM players ORDER BY CASE WHEN payment='paid' THEN 0 ELSE 1 END,created_at,id",
    )
    .all();

  // This event is still in act one. Refuse to invalidate group-scoped game
  // history if a different database has already started investigating.
  if (players.length) {
    for (const table of [
      "checks",
      "faction_policy_proposals",
      "faction_policy_supports",
    ]) {
      const { n } = await db.prepare(`SELECT COUNT(*) n FROM ${table}`).get();
      if (n) throw new Error("已有调查组游戏记录，无法安全自动重新分组");
    }
  }

  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS investigation_group_reassignments(player_id TEXT PRIMARY KEY,previous_group_id INTEGER,group_id INTEGER NOT NULL,created_at BIGINT NOT NULL)",
    )
    .run();
  const time = Date.now();
  for (const [index, player] of players.entries()) {
    const group = (index % INVESTIGATION_GROUP_COUNT) + 1;
    await db
      .prepare(
        "INSERT INTO investigation_group_reassignments(player_id,previous_group_id,group_id,created_at) VALUES(?,?,?,?)",
      )
      .run(player.id, player.group_id, group, time);
    await db
      .prepare("UPDATE players SET group_id=? WHERE id=?")
      .run(group, player.id);
  }
  await db
    .prepare("INSERT INTO content_migrations(id) VALUES(?)")
    .run(INVESTIGATION_GROUP_MIGRATION);
  await db
    .prepare("INSERT INTO audit(actor,action) VALUES(?,?)")
    .run("gm", `调查组调整为4组，已重新均匀分配${players.length}位玩家`);
}
