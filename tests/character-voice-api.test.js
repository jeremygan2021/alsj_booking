import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";

test("confirmed角色语音持久化、复用、私有音频和旧修订隔离", async (t) => {
  const mp3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(125)]);
  let creates = 0;
  const objects = new Map();
  const { app, db } = await createApp({ dbPath: ":memory:", gmPassword: "test", npcPassword: "test", characterMedia: {
    enabled: true, bucket: "test-character-media", endpoint: "oss-cn-shanghai.aliyuncs.com", accessId: "private-storage-id", secret: "private-storage-secret",
    fetch: async (url, options) => {
      if (options.method === "PUT") { assert.equal(options.headers["x-oss-object-acl"], "private"); objects.set(url, Buffer.from(options.body)); return new Response(""); }
      return new Response(objects.get(url), { status: objects.has(url) ? 200 : 404 });
    },
  }, characterVoice: {
    apiKey: "private-speech-key", textApiKey: "private-text-key", baseUrl: "https://minimax.example/v1", textBaseUrl: "https://minimax.example/v1",
    fetch: async (url) => {
      if (url.endsWith("/get_voice")) return Response.json({ system_voice: [{ voice_id: "test_voice", voice_name: "温柔女声", description: ["温柔", "女声"] }] });
      if (url.endsWith("/chat/completions")) return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ script: "我是林晚，一名修复旧档案的手艺人。今晚我带着一份尚未完成的修复笔记来到索恩庄园。每一道折痕都有它的来历，每一段被遗忘的故事都值得有人认真倾听。如果你也对旧物的往事感兴趣，不妨与我聊聊，或许我们能一起找到新的线索。", voice_id: "test_voice", speed: 1, pitch: 0 }) } }] });
      if (url.endsWith("/t2a_async_v2")) { creates++; return Response.json({ task_id: "123", file_id: "456" }); }
      if (url.includes("/query/t2a_async_query_v2")) return Response.json({ status: "Success", file_id: "456" });
      if (url.includes("/files/retrieve_content")) return new Response(mp3);
      throw new Error("unexpected request");
    },
  } });
  const now = Date.now();
  for (const id of ["voice-owner", "other-player"]) {
    await db.prepare("INSERT INTO players(id,name,contact,password) VALUES(?,?,?,?)").run(id, id, id, "unused");
    await db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(id, "player", id, now + 600000);
  }
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await db.close(); });
  const request = (path, body, id="voice-owner", headers={}) => fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method: body===undefined?"GET":"POST", headers: { "Content-Type":"application/json", Cookie:`alaska_session=${id}`, ...headers }, ...(body===undefined?{}:{body:JSON.stringify(body)}) });
  assert.equal((await request("/character/voice", {})).status, 400);
  await db.prepare("INSERT INTO characters(player_id,name,profession,story,avatar_url,revision,status) VALUES(?,?,?,?,?,1,'pending')").run("voice-owner", "林晚", "档案修复师", "我是一位来到索恩庄园参加晚宴的档案修复师，希望与旧识重聚并交流公开展览。", "/api/avatars/voice-owner");
  const avatarVersion = Date.now();
  await db.prepare("INSERT INTO avatars(player_id,data,updated_at) VALUES(?,'dGVzdA==',?)").run("voice-owner", avatarVersion);
  await db.prepare("UPDATE characters SET avatar_url=?,english='Lin Wan',skill='洞察',motive='分享旧物的公开故事',cosplay_character='原创档案修复师',cosplay_source='原创' WHERE player_id=?").run(`/api/avatars/voice-owner?v=${avatarVersion}`, "voice-owner");
  await db.prepare("INSERT INTO character_voices(player_id,character_revision,job_token,status,created_at,updated_at) VALUES(?,1,'slow-create','creating',?,?)").run("voice-owner", Date.now() - 130000, Date.now() - 130000);
  assert.equal((await (await request("/character/voice")).json()).status, "creating");
  assert.equal((await request("/character/voice", {})).status, 200);
  assert.equal(creates, 0);
  await db.prepare("DELETE FROM character_voices WHERE player_id=?").run("voice-owner");
  assert.equal((await request("/character/voice", {})).status, 202);
  let state;
  for (let i=0;i<50;i++) { state = await (await request("/character/voice")).json(); if (state.status === "ready" || state.status === "error") break; await new Promise(resolve=>setTimeout(resolve,5)); }
  assert.equal(state.status, "ready", JSON.stringify(state));
  assert.equal(creates, 1);
  assert.ok(Array.isArray(state.subtitles));
  assert.equal(typeof state.duration, "number");
  assert.equal(state.music.id, "clean-soul");
  assert.match(state.music.licenseUrl, /creativecommons.org/);
  assert.ok(!JSON.stringify(state.music).includes("sha256"));
  const stored = await db.prepare("SELECT * FROM character_voices WHERE player_id=?").get("voice-owner");
  assert.match(stored.audio_object_key, /^alsj\/characters\/v1\//);
  assert.ok(!("audio_data" in stored));
  assert.equal(objects.size, 1);
  assert.ok(state.script.includes("林晚"));
  assert.ok(!JSON.stringify(state).includes("task_id"));
  assert.ok(!JSON.stringify(state).includes("private-"));
  assert.equal((await request("/character/voice", {})).status, 200);
  assert.equal(creates, 1);
  const audio = await request("/character/voice/audio", undefined, "voice-owner", { Range: "bytes=0-9" });
  assert.equal(audio.status, 206);
  assert.equal((await audio.arrayBuffer()).byteLength, 10);
  assert.equal((await request("/character/voice/audio", undefined, "other-player")).status, 404);
  const unchanged = await db.prepare("SELECT name,english,profession,skill,motive,story,cosplay_character,cosplay_source FROM characters WHERE player_id=?").get("voice-owner");
  const resaved = await (await request("/character", unchanged)).json();
  assert.equal(resaved.unchanged, true);
  assert.equal(resaved.revision, 1);
  assert.equal((await request("/character/voice", {})).status, 200);
  assert.equal(creates, 1, "saving unchanged text must reuse the paid voice task");
  const cues = [{ start: 0, end: 5, text: "我是林晚，一名档案修复师。" }];
  await db.prepare("UPDATE character_voices SET subtitles=?,duration=5,subtitle_source='provider' WHERE player_id=?").run(JSON.stringify(cues), "voice-owner");
  const captioned = await (await request("/character/voice")).json();
  assert.deepEqual(captioned.subtitles, cues);
  assert.equal(captioned.subtitle_source, "provider");
  assert.equal(captioned.duration, 5);
  const bgm = await request(captioned.music.url.replace("/api", ""), undefined, "voice-owner", { Range: "bytes=0-9" });
  assert.equal(bgm.status, 206);
  assert.equal((await bgm.arrayBuffer()).byteLength, 10);
  assert.equal((await request("/character/voice/music/not-a-track")).status, 404);
  const anonymous = await fetch(`http://127.0.0.1:${server.address().port}${captioned.music.url}`);
  assert.equal(anonymous.status, 401);
  await db.prepare("UPDATE characters SET revision=2 WHERE player_id=?").run("voice-owner");
  assert.equal((await (await request("/character/voice")).json()).status, "none");
  assert.equal((await request("/character/voice/audio")).status, 404);
});
