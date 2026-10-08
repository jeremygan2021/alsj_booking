import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { npcs, evidence, lots } from "./content.js";
export function openDb(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS players(id TEXT PRIMARY KEY,name TEXT NOT NULL,contact TEXT UNIQUE NOT NULL,password TEXT NOT NULL,payment TEXT DEFAULT 'pending',checked_in INTEGER DEFAULT 0,coins INTEGER DEFAULT 0 CHECK(coins>=0),group_id INTEGER DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS characters(player_id TEXT PRIMARY KEY REFERENCES players(id),name TEXT,english TEXT,profession TEXT,skill TEXT,faction TEXT DEFAULT 'croft',story TEXT,secret TEXT,npc_id TEXT,status TEXT DEFAULT 'pending',motive TEXT);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,role TEXT,user_id TEXT,expires INTEGER);
 CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),phase INTEGER DEFAULT 1,capacity INTEGER DEFAULT 40,price INTEGER DEFAULT 189,voting INTEGER DEFAULT 0);
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
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,actor TEXT,action TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
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
  return db;
}
