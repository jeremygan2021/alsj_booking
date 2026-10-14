import seeds from "./npc-story-v3-seeds.json" with { type: "json" };
const { npcs, evidence, lots } = seeds;
import previous from "./npc-outline-v2-seeds.json" with { type: "json" };

// Preserve stable IDs, account associations, and prose edited by the GM.
export async function applyNpcStory(db) {
  const id = "npc-story-v3";
  if (await db.prepare("SELECT id FROM content_migrations WHERE id=?").get(id))
    return;
  for (const row of npcs) {
    const old = previous.npcs.find((n) => n[0] === row[0]);
    await db
      .prepare("UPDATE npcs SET name=?,english=?,role=? WHERE id=?")
      .run(...row.slice(1, 4), row[0]);
    for (const [field, index] of [
      ["bio", 4],
      ["secret", 5],
    ]) {
      await db
        .prepare(`UPDATE npcs SET ${field}=? WHERE id=? AND ${field}=?`)
        .run(row[index], row[0], old[index]);
    }
  }
  for (const row of evidence) {
    const old = previous.evidence.find((e) => e[0] === row[0]);
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
  for (let i = 0; i < lots.length; i++) {
    await db
      .prepare("UPDATE lots SET description=? WHERE id=? AND description=?")
      .run(lots[i][2], i + 1, previous.lots[i][2]);
  }
  await db.prepare("INSERT INTO content_migrations(id) VALUES(?)").run(id);
}
