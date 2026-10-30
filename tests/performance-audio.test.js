import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  symlink,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import {
  createPerformanceAudioCatalog,
  sendPerformanceAudio,
} from "../server/audio/performance-catalog.js";

test("现场演绎只纳入16段更新成片，摘要不携带私稿和服务器路径", async () => {
  const catalog = createPerformanceAudioCatalog();
  const summary = await catalog.describe();
  assert.equal(summary.version, "2026-10-30-blackout-voice-clarity-v5");
  assert.equal(summary.provider, "MiniMax");
  assert.equal(summary.model, "speech-2.8-hd");
  assert.equal(summary.tracks.length, 16);
  assert.equal(summary.totalDuration, 1660.73);
  assert.equal(summary.voices.length, 8);
  assert.equal(summary.credits.length, 7);
  assert.deepEqual(
    summary.tracks.filter((track) => track.spoiler).map((track) => track.id),
    ["A10", "A11", "A12"],
  );
  const drama = summary.tracks.find((track) => track.id === "B06");
  assert.equal(drama.duration, 100);
  assert.equal(drama.loop, false);
  assert.equal(drama.speakers.length, 9);
  for (const role of ["西奥多", "克拉拉", "伊芙琳", "里昂", "诺拉", "FBI现场探员", "女宾客甲", "男宾客甲", "女宾客乙"]) assert.ok(drama.speakers.includes(role));
  const background = summary.tracks.find((track) => track.id === "B07");
  assert.equal(background.kind, "background");
  assert.equal(background.loop, true);
  assert.deepEqual(background.speakers, []);
  assert.deepEqual(background.events, []);
  const opening = summary.tracks.find((track) => track.id === "A02");
  assert.equal(
    opening.events.find((event) => event.cue === "money").time,
    26.388,
  );
  const entrances = summary.tracks.find((track) => track.id === "B03").events;
  assert.deepEqual(
    entrances.map((event) => event.role),
    ["西奥多", "索恩", "伊芙琳", "里昂", "克拉拉", "诺拉"],
  );
  const json = JSON.stringify(summary);
  for (const privateField of [
    "filename",
    "sha256",
    "lines",
    "file",
    "演绎制作源稿",
    "/home/ai/",
  ])
    assert.ok(
      !json.includes(`"${privateField}"`) && !json.includes("/home/ai/"),
    );
  for (const id of ["A01", "A03", "A09", "A99", "../A10", "a10", "A10.mp3"])
    assert.equal(await catalog.get(id), null);

  const manifest = JSON.parse(
    await readFile(
      new URL("../server/audio/performance-audio.json", import.meta.url),
      "utf8",
    ),
  );
  for (const track of manifest.tracks) {
    const selected = await catalog.get(track.id);
    const bytes = await readFile(selected.file);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      track.sha256,
      track.id,
    );
    assert.equal(
      selected.metadata.url,
      `/api/staff/performance-audio/${track.id}/file`,
    );
    assert.equal(selected.metadata.duration, track.duration);
    assert.equal(
      selected.metadata.music.license,
      "https://creativecommons.org/licenses/by/4.0/",
    );
  }
});

test("现场音频仅解析私有固定文件，缺失、替换路径及符号链接不可播放", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "alaska-performance-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "performance-files"));
  const bytes = Buffer.from("ID3-private-performance-fixture");
  await writeFile(path.join(root, "performance-files/a02.mp3"), bytes);
  const track = {
    id: "A02",
    title: "索恩登场与撒钱",
    filename: "a02.mp3",
    duration: 93.86,
    speakers: ["西奥多", "索恩"],
    lines: [{ text: "不能作为摘要返回的私稿" }],
    events: [
      { time: 26.388, cue: "money", instruction: "轻抛游戏券" },
      { time: 200, cue: "invalid", instruction: "超时cue" },
      null,
    ],
  };
  const manifestPath = path.join(root, "performance-audio.json");
  const writeManifest = () =>
    writeFile(manifestPath, JSON.stringify({ tracks: [track] }));
  await writeManifest();
  const catalog = createPerformanceAudioCatalog(root);
  const summary = await catalog.describe("/gm/audio");
  assert.equal(summary.tracks[0].url, "/gm/audio/A02/file");
  assert.equal(summary.tracks[0].events.length, 1);
  assert.equal(summary.tracks[0].lines, undefined);
  track.kind = "instrumental";
  track.music = {
    title: "Controlled Chaos",
    source: "https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1200059",
  };
  await writeManifest();
  const instrumental = (await catalog.describe()).tracks[0];
  assert.equal(instrumental.kind, "instrumental");
  assert.equal(instrumental.music.artist, "Kevin MacLeod");
  assert.equal(instrumental.music.license, "https://creativecommons.org/licenses/by/4.0/");
  track.music.source = "https://untrusted.example/music";
  await writeManifest();
  assert.equal((await catalog.describe()).tracks[0].music, null);
  track.filename = "../a02.mp3";
  await writeManifest();
  assert.equal(await catalog.get("A02"), null);
  track.filename = "a02.mp3";
  track.retired = true;
  await writeManifest();
  assert.equal(await catalog.get("A02"), null);
  assert.equal((await catalog.describe()).tracks.length, 0);
  track.retired = false;
  await writeManifest();
  await rm(path.join(root, "performance-files/a02.mp3"));
  assert.equal(await catalog.get("A02"), null);
  await writeFile(path.join(root, "outside.mp3"), bytes);
  await symlink(
    path.join(root, "outside.mp3"),
    path.join(root, "performance-files/a02.mp3"),
  );
  assert.equal(await catalog.get("A02"), null);
  for (const malformed of ["null", "{", '{"tracks":[null]}']) {
    await writeFile(manifestPath, malformed);
    assert.equal(await catalog.get("A02"), null);
    assert.deepEqual((await catalog.describe()).tracks, []);
  }
});

test("GM挂载现场音频支持Range和HEAD且响应禁止缓存", async (t) => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "alaska-performance-range-"),
  );
  await mkdir(path.join(root, "performance-files"));
  const bytes = Buffer.from("ID3-audio-performance-0123456789");
  await writeFile(path.join(root, "performance-files/a10.mp3"), bytes);
  await writeFile(
    path.join(root, "performance-audio.json"),
    JSON.stringify({
      tracks: [
        {
          id: "A10",
          title: "档案室最后三分钟",
          filename: "a10.mp3",
          duration: 213.13,
          speakers: ["索恩", "伊芙琳"],
          spoiler: true,
        },
      ],
    }),
  );
  const catalog = createPerformanceAudioCatalog(root);
  const app = express();
  app.get("/api/staff/performance-audio/:id/file", async (req, res) => {
    if (req.get("x-test-role") !== "gm") return res.sendStatus(403);
    const track = await catalog.get(req.params.id);
    if (!track) return res.sendStatus(404);
    return sendPerformanceAudio(res, track);
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}/api/staff/performance-audio/A10/file`;
  assert.equal((await fetch(url)).status, 403);
  assert.equal(
    (await fetch(url, { headers: { "x-test-role": "player" } })).status,
    403,
  );
  const response = await fetch(url, {
    headers: { "x-test-role": "gm", Range: "bytes=2-10" },
  });
  assert.equal(response.status, 206);
  assert.match(response.headers.get("content-range"), /^bytes 2-10\//);
  assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(
    Buffer.from(await response.arrayBuffer()),
    bytes.subarray(2, 11),
  );
  const head = await fetch(url, {
    method: "HEAD",
    headers: { "x-test-role": "gm" },
  });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get("content-length")), bytes.length);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
});
