import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import materials from "../server/story-materials.json" with { type: "json" };
import { applyMaleNora } from "../server/migrations/nora-male.js";
import { applyFemaleTheodore, femaleTheodoreReferences } from "../server/migrations/theodore-female.js";

test("Nora's canonical public and actor material consistently uses male FBI casting", () => {
  const nora = materials.npcs.find((n) => n.id === "detective");
  assert.equal(nora.gender, "男");
  assert.match(nora.role, /FBI/);
  assert.match(nora.publicBio, /他/);
  assert.doesNotMatch(nora.publicBio, /她|女声/);
  assert.match(nora.story, /保留西奥多的说法/);
  assert.doesNotMatch(JSON.stringify(nora), /她|女声/);
  assert.match(nora.publicBio, /登场时公开/);
  const evelyn = materials.npcs.find((n) => n.id === "attorney");
  assert.match(evelyn.publicBio, /没有她，就没有ECHO/);
  const theodore = materials.npcs.find((n) => n.id === "scientist");
  assert.equal(theodore.gender, "女");
  assert.doesNotMatch(theodore.publicBio, /他/);
  assert.match(theodore.story, /声称他删过记录/); // Nora remains male.
});

test("Theodore's honorific correction preserves the male player's own pronouns", () => {
  assert.equal(femaleTheodoreReferences("他想请教布莱克先生，尝试让他把拍卖讲解变得易懂。"), "他想请教布莱克女士，尝试让她把拍卖讲解变得易懂。");
});

test("casting migration upgrades existing Nora and preserves other women's pronouns and GM text", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE content_migrations(id TEXT PRIMARY KEY); CREATE TABLE npcs(id TEXT PRIMARY KEY,role TEXT,bio TEXT,secret TEXT)");
  db.exec("CREATE TABLE characters(player_id TEXT,story TEXT,secret TEXT,adaptation TEXT); CREATE TABLE character_relations(player_id TEXT,npc_id TEXT,relation TEXT,player_brief TEXT,npc_brief TEXT,hooks TEXT,mission TEXT); CREATE TABLE character_inspirations(player_id TEXT,data TEXT); CREATE TABLE character_voices(player_id TEXT,subtitles TEXT)");
  db.prepare("INSERT INTO character_relations VALUES(?,?,?,?,?,?,?)").run("player", "detective", "她想请教诺拉", "里德女士，不追问她私人敏感原因", "正常互动", "[]", "交谈");
  const insert = db.prepare("INSERT INTO npcs VALUES(?,?,?,?)");
  insert.run("detective", "合规顾问", "诺拉是一名受ADS聘请的外部安全顾问。她负责门禁。", "隐藏身份为FBI特别探员；她知晓通行安排。");
  insert.run("scientist", "拍卖师", "GM自定履历", "声称她删过记录。");
  insert.run("attorney", "科学家", "她是伊芙琳。", "她有一位女儿。");
  await applyMaleNora(db);
  const nora = db.prepare("SELECT * FROM npcs WHERE id='detective'").get();
  assert.match(nora.role, /FBI/);
  assert.doesNotMatch(JSON.stringify(nora), /她/);
  assert.equal(db.prepare("SELECT bio FROM npcs WHERE id='scientist'").get().bio, "GM自定履历");
  assert.equal(db.prepare("SELECT secret FROM npcs WHERE id='scientist'").get().secret, "声称他删过记录。");
  assert.equal(db.prepare("SELECT bio FROM npcs WHERE id='attorney'").get().bio, "她是伊芙琳。");
  const relation = db.prepare("SELECT * FROM character_relations").get();
  assert.equal(relation.relation, "她想请教诺拉");
  assert.equal(relation.player_brief, "里德先生，不追问他私人敏感原因");
  await applyMaleNora(db);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM content_migrations").get().n, 1);
  db.prepare("UPDATE npcs SET bio=? WHERE id='scientist'").run("西奥多是阿拉斯加之夜最受欢迎的人物之一。他经营拍卖机构。");
  db.prepare("INSERT INTO character_relations VALUES(?,?,?,?,?,?,?)").run("player", "scientist", "他来请教西奥多", "布莱克先生，听完他的回答后再复述他自愿公开的观点", "他是男宾客", "[]", "交谈");
  await applyFemaleTheodore(db);
  assert.match(db.prepare("SELECT bio FROM npcs WHERE id='scientist'").get().bio, /女性私人拍卖师/);
  const theodoreRelation = db.prepare("SELECT * FROM character_relations WHERE npc_id='scientist'").get();
  assert.equal(theodoreRelation.player_brief, "布莱克女士，听完她的回答后再复述她自愿公开的观点");
  assert.equal(theodoreRelation.npc_brief, "他是男宾客");
  assert.equal(theodoreRelation.relation, "他来请教西奥多");
  await applyFemaleTheodore(db);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM content_migrations").get().n, 2);
  db.close();
});
