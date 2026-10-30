import { applyCharacterVoice } from "./migrations/character-voice.js";
import { migrateRoleCards } from "./role-cards.js";
import { applyCharacterPhoto } from "./migrations/character-photo.js";
import { applyNpcMaterials } from "./migrations/npc-materials-v4.js";
import { applyStoryV5 } from "./migrations/story-v5.js";
import { applyAmateurNpc } from "./migrations/amateur-npc.js";
import { applyMaleNora } from "./migrations/nora-male.js";
import { applyFemaleTheodore } from "./migrations/theodore-female.js";
import { migrateFactionPlay } from "./faction-play.js";
import { applyNpcStory } from "./migrations/npc-story-v3.js";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { applyNpcOutline } from "./migrations/npc-outline-v2.js";
import { applyCharacterLinks } from "./migrations/character-links.js";
import { applyPaidPhones } from "./migrations/paid-phones.js";
import { migrateFactionState } from "./migrations/faction-state.js";
import { applyEventCapacity } from "./migrations/event-capacity.js";
import { npcs, evidence, lots } from "./content.js";
async function openSqlite(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS players(id TEXT PRIMARY KEY,name TEXT NOT NULL,contact TEXT UNIQUE NOT NULL,password TEXT NOT NULL,payment TEXT DEFAULT 'pending',checked_in INTEGER DEFAULT 0,coins INTEGER DEFAULT 0 CHECK(coins>=0),group_id INTEGER DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS characters(player_id TEXT PRIMARY KEY REFERENCES players(id),name TEXT,english TEXT,profession TEXT,skill TEXT,faction TEXT DEFAULT 'croft',story TEXT,secret TEXT,npc_id TEXT,status TEXT DEFAULT 'pending',motive TEXT);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,role TEXT,user_id TEXT,expires INTEGER);
 CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),phase INTEGER DEFAULT 1,capacity INTEGER DEFAULT 50,price INTEGER DEFAULT 189,voting INTEGER DEFAULT 0);
 INSERT OR IGNORE INTO settings(id) VALUES(1);
 CREATE TABLE IF NOT EXISTS npcs(id TEXT PRIMARY KEY,name TEXT,english TEXT,role TEXT,bio TEXT,secret TEXT);
 CREATE TABLE IF NOT EXISTS clues(id TEXT PRIMARY KEY,title TEXT,area TEXT,skill TEXT,dc INTEGER,body TEXT,detail TEXT,category TEXT,phase INTEGER DEFAULT 3);
 CREATE TABLE IF NOT EXISTS unlocks(player_id TEXT REFERENCES players(id),clue_id TEXT REFERENCES clues(id),created_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(player_id,clue_id));
 CREATE TABLE IF NOT EXISTS checks(group_id INTEGER,area TEXT,roll INTEGER,bonus INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(group_id,area));
 CREATE TABLE IF NOT EXISTS ledger(id INTEGER PRIMARY KEY,player_id TEXT REFERENCES players(id),amount INTEGER,reason TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS missions(id TEXT PRIMARY KEY,player_id TEXT REFERENCES players(id),title TEXT,npc_id TEXT,reward INTEGER,status TEXT DEFAULT 'pending');
 CREATE TABLE IF NOT EXISTS lots(id INTEGER PRIMARY KEY,title TEXT,start_price INTEGER,description TEXT,effect TEXT,status TEXT DEFAULT 'waiting',bid INTEGER DEFAULT 0,bidder TEXT REFERENCES players(id));
 CREATE TABLE IF NOT EXISTS bids(id INTEGER PRIMARY KEY,lot_id INTEGER REFERENCES lots(id),player_id TEXT REFERENCES players(id),amount INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS inventory(id INTEGER PRIMARY KEY,player_id TEXT REFERENCES players(id),lot_id INTEGER UNIQUE REFERENCES lots(id),used INTEGER DEFAULT 0);
 CREATE TABLE IF NOT EXISTS votes(player_id TEXT PRIMARY KEY REFERENCES players(id),suspect TEXT,motive TEXT,means TEXT,opportunity TEXT,decision TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,title TEXT,body TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,actor TEXT,action TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS managed_content(kind TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(kind,id));
 CREATE TABLE IF NOT EXISTS sms_challenges(id TEXT PRIMARY KEY,phone TEXT NOT NULL,ip_hash TEXT NOT NULL,code_hash TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,attempts INTEGER DEFAULT 0,status TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS sms_phone_created ON sms_challenges(phone,created_at);
 CREATE INDEX IF NOT EXISTS sms_ip_created ON sms_challenges(ip_hash,created_at);
 CREATE TABLE IF NOT EXISTS npc_phones(npc_id TEXT PRIMARY KEY REFERENCES npcs(id),phone TEXT UNIQUE NOT NULL);`);
  const seed = (sql, rows) => {
    const s = db.prepare(sql);
    rows.forEach((row) => s.run(...row));
  };
  seed("INSERT OR IGNORE INTO npcs VALUES(?,?,?,?,?,?)", npcs);
  seed(
    "INSERT OR IGNORE INTO clues(id,title,area,skill,dc,body,detail,category) VALUES(?,?,?,?,?,?,?,?)",
    evidence,
  );
  seed(
    "INSERT OR IGNORE INTO lots(id,title,start_price,description,effect) VALUES(?,?,?,?,?)",
    lots.map((l, i) => [i + 1, ...l]),
  );
  let queue = Promise.resolve();
  db.transaction = async (fn) => {
    const previous = queue;
    let release;
    queue = new Promise((r) => {
      release = r;
    });
    await previous;
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = await fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    } finally {
      release();
    }
  };
  await db.transaction(() => applyNpcOutline(db));
  await db.transaction(() => applyNpcStory(db));
  await db.transaction(() => applyNpcMaterials(db));
  await db.transaction(() => applyCharacterLinks(db));
  await db.transaction(() => applyCharacterVoice(db));
  await db.transaction(() => applyCharacterPhoto(db));
  await db.transaction(() => applyPaidPhones(db));
  await db.transaction(() => migrateRoleCards(db));
  await db.transaction(() => migrateFactionState(db));
  await db.transaction(() => applyEventCapacity(db));
  await db.transaction(() => applyStoryV5(db));
  await db.transaction(() => applyAmateurNpc(db));
  await db.transaction(() => applyMaleNora(db));
  await db.transaction(() => applyFemaleTheodore(db));
  await db.transaction(() => migrateFactionPlay(db));
  return db;
}

export async function openDb(path) {
  if (!/^postgres(?:ql)?:\/\//.test(path || "")) return openSqlite(path);
  const { openPostgres } = await import("./postgres.js");
  return openPostgres(path);
}
