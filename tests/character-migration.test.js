import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../server/db.js";

test("旧已批准角色追加Cos字段与联系人，重启不覆盖GM关系或既有身份", async () => {
  const directory = mkdtempSync(join(tmpdir(), "alaska-character-migration-"));
  const file = join(directory, "legacy.sqlite");
  try {
    const legacy = new DatabaseSync(file);
    legacy.exec(
      "CREATE TABLE players(id TEXT PRIMARY KEY,name TEXT NOT NULL,contact TEXT UNIQUE NOT NULL,password TEXT NOT NULL,payment TEXT DEFAULT 'pending',checked_in INTEGER DEFAULT 0,coins INTEGER DEFAULT 0 CHECK(coins>=0),group_id INTEGER DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP); CREATE TABLE characters(player_id TEXT PRIMARY KEY REFERENCES players(id),name TEXT,english TEXT,profession TEXT,skill TEXT,faction TEXT DEFAULT 'croft',story TEXT,secret TEXT,npc_id TEXT,status TEXT DEFAULT 'pending',motive TEXT);",
    );
    legacy
      .prepare("INSERT INTO players(id,name,contact,password) VALUES(?,?,?,?)")
      .run("legacy", "旧玩家", "legacy@example.com", "existing-password-hash");
    legacy
      .prepare(
        "INSERT INTO characters(player_id,name,faction,story,secret,npc_id,status) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        "legacy",
        "旧角色",
        "fbi",
        "原始角色故事",
        "GM手写私密设定",
        "detective",
        "approved",
      );
    legacy.close();
    let db = await openDb(file);
    const character = await db
      .prepare("SELECT * FROM characters WHERE player_id=?")
      .get("legacy");
    assert.equal(character.status, "approved");
    assert.equal(character.faction, "fbi");
    assert.equal(character.story, "原始角色故事");
    assert.equal(character.secret, "GM手写私密设定");
    assert.equal(character.cosplay_character, null);
    assert.equal(character.generation_pending, 0);
    assert.equal(
      (
        await db
          .prepare(
            "SELECT COUNT(*) n FROM character_relations WHERE player_id=?",
          )
          .get("legacy")
      ).n,
      1,
    );
    await db
      .prepare("UPDATE character_relations SET npc_brief=? WHERE player_id=?")
      .run("GM定稿联系人提示", "legacy");
    await db.close();
    db = await openDb(file);
    assert.equal(
      (
        await db
          .prepare(
            "SELECT npc_brief FROM character_relations WHERE player_id=?",
          )
          .get("legacy")
      ).npc_brief,
      "GM定稿联系人提示",
    );
    assert.equal(
      (
        await db
          .prepare(
            "SELECT COUNT(*) n FROM character_relations WHERE player_id=?",
          )
          .get("legacy")
      ).n,
      1,
    );
    await db.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
