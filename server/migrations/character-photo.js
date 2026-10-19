// Private outfit references are separate from generated avatars and recordings.
// A removed row is a versioned tombstone, so a late upload cannot restore it.
export async function applyCharacterPhoto(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS character_photos(
    player_id TEXT PRIMARY KEY REFERENCES players(id),object_key TEXT,version TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','removed')),
    summary TEXT,width INTEGER,height INTEGER,created_at BIGINT NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS character_photo_requests(
    id TEXT PRIMARY KEY,player_id TEXT NOT NULL REFERENCES players(id),created_at BIGINT NOT NULL
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS character_photo_requests_player_created ON character_photo_requests(player_id,created_at)").run();
}
