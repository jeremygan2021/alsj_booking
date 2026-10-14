import previous from "./npc-story-v3-seeds.json" with { type: "json" };
import {
  npcMaterialSeeds,
  evidenceMaterialSeeds,
  evidencePhases,
} from "../story-materials.js";

// Upgrade shipped prose only; preserve live GM edits and all stable account/clue IDs.
export async function applyNpcMaterials(db) {
  const id = "npc-materials-v4";
  if (await db.prepare("SELECT id FROM content_migrations WHERE id=?").get(id))
    return;
  for (const row of npcMaterialSeeds) {
    const old = previous.npcs.find((n) => n[0] === row[0]);
    if (!old) continue;
    for (const [field, index] of [
      ["name", 1],
      ["english", 2],
      ["role", 3],
      ["bio", 4],
      ["secret", 5],
    ]) {
      await db
        .prepare(`UPDATE npcs SET ${field}=? WHERE id=? AND ${field}=?`)
        .run(row[index], row[0], old[index]);
    }
  }
  for (const row of evidenceMaterialSeeds) {
    await db
      .prepare(
        "INSERT OR IGNORE INTO clues(id,title,area,skill,dc,body,detail,category,phase) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(...row, evidencePhases.get(row[0]));
    const old = previous.evidence.find((e) => e[0] === row[0]);
    if (old) {
      for (const [field, index] of [
        ["title", 1],
        ["area", 2],
        ["skill", 3],
        ["dc", 4],
        ["body", 5],
        ["detail", 6],
        ["category", 7],
      ]) {
        await db
          .prepare(`UPDATE clues SET ${field}=? WHERE id=? AND ${field}=?`)
          .run(row[index], row[0], old[index]);
      }
    }
    // Terminal evidence starts in act four even on fresh databases with default phase 3.
    if (evidencePhases.get(row[0]) === 4) {
      await db
        .prepare("UPDATE clues SET phase=4 WHERE id=? AND phase=3")
        .run(row[0]);
    }
  }
  await db.prepare("INSERT INTO content_migrations(id) VALUES(?)").run(id);
}
