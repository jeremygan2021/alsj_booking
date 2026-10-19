import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applyEventCapacity } from "../server/migrations/event-capacity.js";

test("50人容量迁移不删除玩家，重启保留GM调低名额并拦截旧超额配置", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE settings(id INTEGER PRIMARY KEY,capacity INTEGER,price INTEGER); INSERT INTO settings VALUES(1,40,189); CREATE TABLE content_migrations(id TEXT PRIMARY KEY); CREATE TABLE players(id TEXT PRIMARY KEY); INSERT INTO players VALUES('existing-player');");
    await applyEventCapacity(db);
    assert.equal(db.prepare("SELECT capacity FROM settings").get().capacity, 50);
    assert.equal(db.prepare("SELECT price FROM settings").get().price, 198);
    db.prepare("UPDATE settings SET price=208").run();
    assert.equal(db.prepare("SELECT COUNT(*) n FROM players").get().n, 1);
    db.prepare("UPDATE settings SET capacity=24").run();
    await applyEventCapacity(db);
    assert.equal(db.prepare("SELECT capacity FROM settings").get().capacity, 24);
    assert.equal(db.prepare("SELECT price FROM settings").get().price, 208);
    db.prepare("UPDATE settings SET capacity=99").run();
    await applyEventCapacity(db);
    assert.equal(db.prepare("SELECT capacity FROM settings").get().capacity, 50);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM players").get().n, 1);
  } finally { db.close(); }
});
