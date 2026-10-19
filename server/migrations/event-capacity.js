export const MAX_PLAYERS = 50;

// This event was previously configured for 40 guests. Apply the user's new
// limit once, preserving subsequent GM reductions and every existing player.
export async function applyEventCapacity(db) {
  const id = "event-capacity-50-v1";
  if (!(await db.prepare("SELECT id FROM content_migrations WHERE id=?").get(id))) {
    await db.prepare("UPDATE settings SET capacity=? WHERE id=1").run(MAX_PLAYERS);
    await db.prepare("INSERT INTO content_migrations(id) VALUES(?)").run(id);
  }
  await db.prepare("UPDATE settings SET capacity=? WHERE capacity>?").run(MAX_PLAYERS, MAX_PLAYERS);
  const priceMigration = "event-price-198-v1";
  if (!(await db.prepare("SELECT id FROM content_migrations WHERE id=?").get(priceMigration))) {
    await db.prepare("UPDATE settings SET price=198 WHERE id=1").run();
    await db.prepare("INSERT INTO content_migrations(id) VALUES(?)").run(priceMigration);
  }
}
