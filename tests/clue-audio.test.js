import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app.js";
import { findPublicInvestigationNode } from "../server/public-investigation.js";

test("线索音频只发布匹配正文的基础录音，私人鉴定沿用搜证权限且支持Range", async (t) => {
  const audioRoot = await mkdtemp(path.join(os.tmpdir(), "alaska-audio-"));
  await mkdir(path.join(audioRoot, "files"));
  const { app, db } = await createApp({
    dbPath: ":memory:",
    gmPassword: "audio-test",
    npcPassword: "audio-test",
    audioRoot,
  });
  const clue = await db.prepare("SELECT * FROM clues WHERE id=?").get("E-01");
  const node = findPublicInvestigationNode("AR-01");
  const bytes = Buffer.from("ID3-audio-fixture-0123456789");
  const tracks = [];
  for (const [source, part] of [
    [clue, "body"],
    [clue, "detail"],
    [node, "body"],
  ]) {
    const filename = `${source.id.toLowerCase()}-${part}.mp3`;
    tracks.push({
      id: source.id,
      part,
      filename,
      sourceHash: createHash("sha256").update(source[part]).digest("hex"),
      duration: 32.2,
      speakers: ["旁白", "索恩"],
      music: { title: "Long Note One" },
    });
    await writeFile(path.join(audioRoot, "files", filename), bytes);
  }
  const manifest = () =>
    writeFile(
      path.join(audioRoot, "clue-audio.json"),
      JSON.stringify({ version: 1, model: "speech-2.8-hd", tracks }),
    );
  await manifest();
  await db
    .prepare(
      "INSERT INTO players(id,name,contact,password,payment,checked_in,group_id) VALUES(?,?,?,?,?,?,?)",
    )
    .run("audio-player", "音频玩家", "audio-test", "unused", "paid", 1, 1);
  await db
    .prepare("INSERT INTO characters(player_id,status) VALUES(?,?)")
    .run("audio-player", "approved");
  await db
    .prepare("INSERT INTO sessions VALUES(?,?,?,?)")
    .run("audio-session", "player", "audio-player", Date.now() + 60000);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await db.close();
    await rm(audioRoot, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (url, status = 200, headers = {}) => {
    const response = await fetch(base + url, { headers });
    assert.equal(response.status, status, await response.clone().text());
    return response;
  };
  const player = (url, status = 200, headers = {}) =>
    request(url, status, {
      cookie: "alaska_session=audio-session",
      ...headers,
    });
  const snapshot = async () => ({
    unlocks: await db.prepare("SELECT * FROM unlocks").all(),
    checks: await db.prepare("SELECT * FROM checks").all(),
    sessions: await db.prepare("SELECT * FROM sessions").all(),
    audit: await db.prepare("SELECT * FROM audit").all(),
    players: await db.prepare("SELECT * FROM players").all(),
  });
  const original = await snapshot();
  const card = await (await request("/api/ar/clues/E-01")).json();
  assert.equal(card.audio.body.url, "/api/ar/clues/E-01/audio");
  assert.equal(card.audio.body.duration, 32.2);
  assert.deepEqual(card.audio.body.speakers, ["旁白", "索恩"]);
  assert.equal(card.audio.body.credits.length, 1);
  assert.match(card.audio.body.credits[0].source, /USUAN1100418$/);
  assert.equal(card.audio.body.credits[0].artist, "Kevin MacLeod");
  assert.equal(card.audio.detail, undefined);
  assert.ok(!JSON.stringify(card).includes("sourceHash"));
  const ranged = await request(card.audio.body.url, 206, {
    Range: "bytes=0-8",
  });
  assert.equal(ranged.headers.get("content-type"), "audio/mpeg");
  assert.equal(ranged.headers.get("x-content-type-options"), "nosniff");
  assert.match(ranged.headers.get("content-range"), /^bytes 0-8\//);
  assert.deepEqual(
    Buffer.from(await ranged.arrayBuffer()),
    bytes.subarray(0, 9),
  );
  const nodeCard = await (await request("/api/ar/nodes/AR-01")).json();
  assert.equal(nodeCard.audio.body.url, "/api/ar/nodes/AR-01/audio");
  await request(nodeCard.audio.body.url);
  assert.equal(
    (await (await request("/api/ar/nodes/AR-INV")).json()).audio,
    undefined,
  );
  for (const url of [
    "/api/ar/clues/E-01/audio?part=detail",
    "/api/ar/clues/E-01/audio?detail=1",
    "/api/ar/nodes/AR-01/audio?part=detail",
    "/api/ar/clues/E-01/audio/detail",
    "/api/ar/nodes/AR-INV/audio",
    "/api/ar/clues/E-99/audio",
    "/api/ar/clues/E-01/audio/e-01-detail.mp3",
    "/api/audio/clue-audio.json",
    "/api/audio/files/e-01-detail.mp3",
  ])
    await request(url, url.includes("?") ? 400 : 404);
  await request("/api/clues/E-01/audio/body", 401);
  await player("/api/clues/E-01/audio/body", 403);
  await player("/api/clues/E-01/audio/detail", 403);
  assert.deepEqual(await snapshot(), original);
  await db
    .prepare("INSERT INTO unlocks(player_id,clue_id) VALUES(?,?)")
    .run("audio-player", "E-01");
  const collected = await (await player("/api/clues/E-01")).json();
  assert.equal(collected.audio.body.url, "/api/clues/E-01/audio/body");
  assert.equal(collected.audio.detail, undefined);
  assert.match(
    (await player(collected.audio.body.url)).headers.get("cache-control"),
    /private.*no-store/,
  );
  await player("/api/clues/E-01/audio/detail", 403);
  await player("/api/clues/E-01/audio/invalid", 404);
  await db
    .prepare("INSERT INTO checks(group_id,area,roll,bonus) VALUES(?,?,?,?)")
    .run(1, clue.area, 1, 0);
  await player("/api/clues/E-01/audio/detail", 403);
  assert.equal(
    (await (await player("/api/clues/E-01")).json()).audio.detail,
    undefined,
  );
  await db
    .prepare("UPDATE checks SET roll=20 WHERE group_id=? AND area=?")
    .run(1, clue.area);
  const passed = await (await player("/api/clues/E-01")).json();
  assert.equal(passed.audio.detail.url, "/api/clues/E-01/audio/detail");
  await player(passed.audio.detail.url, 206, { Range: "bytes=2-10" });
  const authorized = await snapshot();
  await player(passed.audio.detail.url);
  assert.deepEqual(await snapshot(), authorized);
  await db
    .prepare("UPDATE players SET checked_in=0 WHERE id=?")
    .run("audio-player");
  await player(passed.audio.detail.url, 403);
  await db
    .prepare("UPDATE players SET checked_in=1 WHERE id=?")
    .run("audio-player");
  await db
    .prepare("UPDATE clues SET body=?,detail=? WHERE id=?")
    .run(clue.body + "修订", clue.detail + "修订", "E-01");
  assert.equal(
    (await (await request("/api/ar/clues/E-01")).json()).audio,
    undefined,
  );
  assert.equal(
    (await (await player("/api/clues/E-01")).json()).audio,
    undefined,
  );
  await request("/api/ar/clues/E-01/audio", 404);
  await player("/api/clues/E-01/audio/detail", 404);
  await db
    .prepare("UPDATE clues SET body=?,detail=? WHERE id=?")
    .run(clue.body, clue.detail, "E-01");
  tracks[0].filename = "../e-01-body.mp3";
  await manifest();
  await request("/api/ar/clues/E-01/audio", 404);
  tracks[0].filename = "e-01-body.mp3";
  await manifest();
  await rm(path.join(audioRoot, "files", "e-01-body.mp3"));
  assert.equal(
    (await (await request("/api/ar/clues/E-01")).json()).audio,
    undefined,
  );
  await request("/api/ar/clues/E-01/audio", 404);
  for (const content of ["null", '{"tracks":[null]}', "{"]) {
    await writeFile(path.join(audioRoot, "clue-audio.json"), content);
    assert.equal(
      (await (await request("/api/ar/nodes/AR-01")).json()).audio,
      undefined,
    );
    await request("/api/ar/nodes/AR-01/audio", 404);
  }
});
