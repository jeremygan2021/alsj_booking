import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applyCharacterVoice } from "../server/migrations/character-voice.js";
test("已有本地语音表增量补上OSS指针，保留角色音频历史和录音", async()=>{
  const db=new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE players(id TEXT PRIMARY KEY);INSERT INTO players VALUES('owner');CREATE TABLE character_voices(player_id TEXT PRIMARY KEY,character_revision INTEGER,job_token TEXT,status TEXT,script TEXT,voice_id TEXT,voice_name TEXT,task_id TEXT,file_id TEXT,audio_data TEXT,error TEXT,created_at BIGINT,updated_at BIGINT);INSERT INTO character_voices(player_id,script,audio_data) VALUES('owner','保留原介绍','old-private-audio');CREATE TABLE character_recordings(id TEXT PRIMARY KEY,player_id TEXT,object_key TEXT,content_type TEXT,transcript TEXT,status TEXT,error TEXT,created_at BIGINT);INSERT INTO character_recordings(id,player_id,transcript) VALUES('record','owner','保留原录音文字')");
    await applyCharacterVoice(db);await applyCharacterVoice(db);
    assert.ok(db.prepare("PRAGMA table_info(character_voices)").all().some(row=>row.name==="audio_object_key"));
    assert.ok(db.prepare("PRAGMA table_info(character_recordings)").all().some(row=>row.name==="attempts"));
    assert.equal(db.prepare("SELECT script FROM character_voices WHERE player_id='owner'").get().script,"保留原介绍");
    assert.equal(db.prepare("SELECT transcript FROM character_recordings WHERE id='record'").get().transcript,"保留原录音文字");
  }finally{db.close();}
});
