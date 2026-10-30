import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../server/db.js";
import { characterVoiceConfig } from "../server/character-voice.js";
import { characterMediaStorageConfig } from "../server/character-media-storage.js";
import { createCharacterVoiceJobs, LEGACY_VOICE_TIMEOUT } from "../server/character-voice-jobs.js";

test("后台接续：离页、重启、旧超时、短暂故障、并发轮询和迟到结果", async (t) => {
  const db = await openDb(process.env.TEST_DATABASE_URL || ":memory:");
  const one = (sql, ...params) => db.prepare(sql).get(...params);
  const all = (sql, ...params) => db.prepare(sql).all(...params);
  const run = (sql, ...params) => db.prepare(sql).run(...params);
  const audio = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(125)]);
  const objects = new Map(), states = new Map(), queries = [], diagnostics = [];
  let puts = 0, queryHook, putHook;
  const voiceConfig = characterVoiceConfig({ apiKey: "private", textApiKey: "private", fetch: async (url) => {
    assert.ok(!url.endsWith("/t2a_async_v2"), "recovery never resubmits paid TTS");
    if (url.includes("/query/")) {
      const id = new URL(url).searchParams.get("task_id");
      queries.push(id);
      await queryHook?.(id);
      if (states.get(id) === "network") throw Error("private-network-detail");
      return Response.json({ status: states.get(id) || "Success", file_id: id });
    }
    return new Response(audio);
  } });
  const mediaConfig = characterMediaStorageConfig({ enabled: true, bucket: "test-media", endpoint: "oss-cn-shanghai.aliyuncs.com", accessId: "private", secret: "private", fetch: async (url, options) => {
    if (options.method === "PUT") {
      puts++;
      await putHook?.();
      objects.set(url, Buffer.from(options.body));
      return new Response("");
    }
    return new Response(objects.get(url), { status: objects.has(url) ? 200 : 404 });
  } });
  const options = { one, all, run, voiceConfig, mediaConfig, creationTimeoutMs: 1000, intervalMs: 10, log: (...args) => diagnostics.push(args) };
  let jobs = createCharacterVoiceJobs(options);
  t.after(async () => { await jobs.stop(); await db.close(); });
  const seed = async (id, status = "processing", error = null, revision = 1) => {
    await run("INSERT INTO players(id,name,contact,password) VALUES(?,?,?,'unused')", id, id, id);
    await run("INSERT INTO characters(player_id,name,profession,story,revision,status) VALUES(?,?,?, ?,?,'approved')", id, id, "记录员", "公开角色故事", revision);
    await run("INSERT INTO character_voices(player_id,character_revision,job_token,status,task_id,error,created_at,updated_at) VALUES(?,1,?,?,?,?,?,?)", id, "job-" + id, status, status === "creating" ? null : id, error, Date.now() - 3600000, Date.now() - 3600000);
  };
  await seed("1");
  jobs.start();
  for (let i = 0; i < 100; i++) {
    if ((await one("SELECT status FROM character_voices WHERE player_id='1'")).status === "ready") break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  await jobs.stop();
  assert.equal((await one("SELECT status FROM character_voices WHERE player_id='1'")).status, "ready", "no page request is needed");
  await seed("2", "error", LEGACY_VOICE_TIMEOUT);
  jobs = createCharacterVoiceJobs(options); // Simulate process restart with stored jobs.
  await jobs.tick();
  assert.equal((await one("SELECT status FROM character_voices WHERE player_id='2'")).status, "ready");
  await seed("3");
  states.set("3", "network");
  await jobs.tick();
  const retry = await one("SELECT * FROM character_voices WHERE player_id='3'");
  assert.equal(retry.status, "processing");
  assert.equal(retry.task_id, "3");
  assert.ok(!JSON.stringify(diagnostics).includes("private-network-detail"));
  states.set("3", "Success");
  await jobs.tick();
  assert.equal((await one("SELECT status FROM character_voices WHERE player_id='3'")).status, "ready");
  await seed("4");
  queryHook = async () => { await new Promise(resolve => setImmediate(resolve)); };
  await Promise.all([jobs.pollPlayer("4"), jobs.pollPlayer("4"), jobs.tick()]);
  assert.equal(queries.filter(id => id === "4").length, 1, "HTTP/background polls share one in-flight request");
  await seed("5");
  const putsBefore = puts;
  queryHook = async id => { if (id === "5") await run("UPDATE characters SET revision=2 WHERE player_id='5'"); };
  await jobs.tick();
  assert.equal(puts, putsBefore, "old revision must not upload its late result");
  assert.equal((await one("SELECT status FROM character_voices WHERE player_id='5'")).status, "processing");
  queryHook = null;
  await seed("6");
  putHook = () => run("UPDATE characters SET revision=2 WHERE player_id='6'");
  await jobs.tick();
  assert.equal((await one("SELECT status FROM character_voices WHERE player_id='6'")).status, "processing", "revision change during upload cannot publish a stale result");
  putHook = null;
  await seed("7");
  states.set("7", "Failed");
  await jobs.tick();
  assert.equal((await one("SELECT status FROM character_voices WHERE player_id='7'")).status, "error");
  await jobs.tick();
  assert.equal(queries.filter(id => id === "7").length, 1, "provider terminal failures do not loop forever");
  await seed("8", "creating");
  await jobs.tick();
  assert.equal((await one("SELECT status FROM character_voices WHERE player_id='8'")).status, "error");
  assert.equal(queries.filter(id => id === "8").length, 0, "ambiguous interrupted submissions are not charged again automatically");
  await seed("9");
  putHook = () => { throw Error("private-storage-detail"); };
  await jobs.tick();
  assert.equal((await one("SELECT status FROM character_voices WHERE player_id='9'")).status, "processing");
  putHook = null;
  await jobs.tick();
  assert.equal((await one("SELECT status FROM character_voices WHERE player_id='9'")).status, "ready");
  assert.ok(!JSON.stringify(diagnostics).includes("private-storage-detail"));
  await seed("10");
  states.set("10", "network");
  queryHook = async id => {
    if (id === "10") await run("UPDATE character_voices SET status='ready',error=NULL WHERE player_id='10'");
  };
  await jobs.tick();
  const completedElsewhere = await one("SELECT status,error FROM character_voices WHERE player_id='10'");
  assert.equal(completedElsewhere.status, "ready");
  assert.equal(completedElsewhere.error, null, "a late failed poll cannot overwrite a completed task");
});
