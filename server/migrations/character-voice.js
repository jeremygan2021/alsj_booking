// Additive, shared SQLite/PostgreSQL storage for private confirmed-role audio.
export async function applyCharacterVoice(db, postgres = false) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS character_voices(
    player_id TEXT PRIMARY KEY REFERENCES players(id),character_revision INTEGER NOT NULL,
    job_token TEXT NOT NULL,status TEXT NOT NULL,script TEXT,voice_id TEXT,voice_name TEXT,
    task_id TEXT,file_id TEXT,audio_object_key TEXT,subtitles TEXT,duration REAL,subtitle_source TEXT,error TEXT,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS character_recordings(
    id TEXT PRIMARY KEY,player_id TEXT NOT NULL REFERENCES players(id),object_key TEXT NOT NULL,
    content_type TEXT NOT NULL,transcript TEXT,status TEXT NOT NULL,error TEXT,attempts INTEGER DEFAULT 0,created_at BIGINT NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS character_voice_requests(
    id TEXT PRIMARY KEY,player_id TEXT REFERENCES players(id),requested_at BIGINT NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS character_transcription_requests(
    id TEXT PRIMARY KEY,player_id TEXT REFERENCES players(id),requested_at BIGINT NOT NULL
  )`).run();
  for (const [table, column, type] of [["character_voices", "audio_object_key", "TEXT"], ["character_voices", "subtitles", "TEXT"], ["character_voices", "duration", "REAL"], ["character_voices", "subtitle_source", "TEXT"], ["character_recordings", "attempts", "INTEGER DEFAULT 0"]]) {
    const columns = postgres
      ? (await db.prepare("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=?").all(table)).map(row => row.column_name)
      : (await db.prepare(`PRAGMA table_info(${table})`).all()).map(row => row.name);
    if (!columns.includes(column)) await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
  }
}
