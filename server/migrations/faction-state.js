// Additive migration: existing characters, approvals, and GM-written factions
// remain untouched; formal assignments are added when a guest creates a role.
export async function migrateFactionState(db, postgres = false) {
  const statements = [
    "CREATE TABLE IF NOT EXISTS faction_preferences(player_id TEXT PRIMARY KEY REFERENCES players(id),preference TEXT NOT NULL CHECK(preference IN ('conspirator','fbi','croft','any')),updated_at BIGINT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS faction_draw_state(id INTEGER PRIMARY KEY CHECK(id=1),draw_id TEXT,drawn_at BIGINT,participant_count INTEGER,killer_slots INTEGER,actor TEXT)",
    "INSERT OR IGNORE INTO faction_draw_state(id) VALUES(1)",
    "CREATE TABLE IF NOT EXISTS faction_assignments(player_id TEXT PRIMARY KEY REFERENCES players(id),faction TEXT NOT NULL CHECK(faction IN ('conspirator','fbi','croft')),contact_code TEXT UNIQUE,draw_id TEXT NOT NULL,assigned_at BIGINT NOT NULL,assigned_by TEXT NOT NULL)",
  ];
  for (const statement of statements) await db.prepare(statement).run();
  const columns = postgres
    ? (await db.prepare("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='faction_draw_state'").all()).map(row => row.column_name)
    : (await db.prepare("PRAGMA table_info(faction_draw_state)").all()).map(row => row.name);
  if (!columns.includes("mode")) await db.prepare("ALTER TABLE faction_draw_state ADD COLUMN mode TEXT DEFAULT 'manual'").run();
}
