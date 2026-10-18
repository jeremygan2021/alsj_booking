// Additive migration: approved characters and all existing game records survive.
export async function applyCharacterLinks(db, postgres = false) {
  const columns = postgres
    ? (
        await db
          .prepare(
            "SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='characters'",
          )
          .all()
      ).map((c) => c.column_name)
    : (await db.prepare("PRAGMA table_info(characters)").all()).map(
        (c) => c.name,
      );
  const additions = {
    cosplay_character: "TEXT",
    cosplay_source: "TEXT",
    avatar_url: "TEXT",
    adaptation: "TEXT",
    generation_status: "TEXT DEFAULT 'unconfigured'",
    generator: "TEXT DEFAULT 'curated-template'",
    generation_error: "TEXT",
    revision: "INTEGER DEFAULT 0",
    generation_pending: "INTEGER DEFAULT 0",
    generation_lock: "TEXT",
    generation_started_at: "BIGINT",
  };
  for (const [name, type] of Object.entries(additions))
    if (!columns.includes(name))
      await db
        .prepare(`ALTER TABLE characters ADD COLUMN ${name} ${type}`)
        .run();
  // WebP bytes are encoded as base64 for both SQLite and PostgreSQL adapters.
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS avatars(player_id TEXT PRIMARY KEY REFERENCES players(id),data TEXT NOT NULL,updated_at BIGINT NOT NULL)",
    )
    .run();
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS character_relations(player_id TEXT REFERENCES players(id),npc_id TEXT REFERENCES npcs(id),relation TEXT NOT NULL,player_brief TEXT NOT NULL,npc_brief TEXT NOT NULL,hooks TEXT NOT NULL,mission TEXT NOT NULL,PRIMARY KEY(player_id,npc_id))",
    )
    .run();
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS generation_requests(id TEXT PRIMARY KEY,player_id TEXT REFERENCES players(id),requested_at BIGINT NOT NULL)",
    )
    .run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS character_inspirations(player_id TEXT PRIMARY KEY REFERENCES players(id),data TEXT NOT NULL,avatar_version BIGINT NOT NULL,created_at BIGINT NOT NULL)",
  ).run();
  const id = "character-links-v1";
  if (await db.prepare("SELECT id FROM content_migrations WHERE id=?").get(id))
    return;
  const legacy = await db
    .prepare(
      "SELECT c.player_id,c.name,c.npc_id,n.name npc_name FROM characters c JOIN npcs n ON c.npc_id=n.id",
    )
    .all();
  for (const c of legacy)
    await db
      .prepare(
        "INSERT OR IGNORE INTO character_relations(player_id,npc_id,relation,player_brief,npc_brief,hooks,mission) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        c.player_id,
        c.npc_id,
        "旧档案中的晚宴联系人",
        `你的晚宴联系人是${c.npc_name}，请在第一幕向对方介绍自己。`,
        `${c.name}的旧档案指定你为联系人，请用公开背景完成破冰互动。`,
        JSON.stringify([{ phase: 1, goal: "介绍角色并交换一条公开情报" }]),
        "介绍自己并交换一条公开情报",
      );
  await db.prepare("INSERT INTO content_migrations(id) VALUES(?)").run(id);
}
