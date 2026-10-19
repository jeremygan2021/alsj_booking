import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, copyFile, readFile, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { listCharacterMusic, selectCharacterMusic, getCharacterMusicTrack } from "../server/audio/character-music.js";

test("公开角色气质决定固定配乐，私密字段不参与选择", () => {
  for (const [character, expected] of [
    [{ profession: "声音档案修复师", story: "内敛温柔，珍惜旧时的记忆。" }, "clean-soul"],
    [{ profession: "古典舞者", story: "优雅的贵族，追求诗歌与艺术。" }, "evening-harp"],
    [{ profession: "独行侦探", story: "冷峻，善于调查神秘事件。" }, "long-note"],
    [{ profession: "魔术师", story: "开朗乐观，幽默好奇，热爱冒险。" }, "carefree"],
  ]) {
    const result = selectCharacterMusic(character);
    assert.equal(result.id, expected);
    assert.deepEqual(selectCharacterMusic(character), result);
    assert.equal(result.file, undefined);
    assert.equal(result.sha256, undefined);
    assert.equal(result.downloadSource, undefined);
    assert.ok(result.credit.includes("Kevin MacLeod"));
    assert.equal(result.license, "CC BY 4.0");
  }
  assert.equal(selectCharacterMusic({}).id, "clean-soul");
  assert.deepEqual(selectCharacterMusic({}), selectCharacterMusic({ secret: "侦探调查神秘".repeat(100), contact: "阳光旅行" }));
  assert.equal(selectCharacterMusic({}, "我是一位冷峻的侦探，调查神秘的旧案。").id, "long-note");
});

test("四首下载预设均有署名与授权来源，固定文件存在且完整", async () => {
  const tracks = listCharacterMusic();
  assert.equal(tracks.length, 4);
  let size = 0;
  for (const metadata of tracks) {
    const result = await getCharacterMusicTrack(metadata.id);
    assert.ok(result);
    assert.deepEqual(result.metadata, metadata);
    assert.equal(metadata.licenseUrl, "https://creativecommons.org/licenses/by/4.0/");
    assert.ok(metadata.source.startsWith("https://incompetech.com/music/royalty-free/index.html?isrc="));
    assert.match(metadata.changes, /截取60秒/);
    assert.ok(metadata.duration >= 60 && metadata.duration < 60.1);
    const bytes = await readFile(result.file);
    assert.equal(bytes.subarray(0, 3).toString("ascii"), "ID3");
    size += bytes.length;
  }
  assert.ok(size < 6 * 1024 * 1024);
});

test("未知配乐、路径穿越、损坏文件和符号链接不会被解析或返回", async () => {
  for (const id of [null, "", "../clean-soul", "clean-soul.mp3", "not-a-track", "constructor"])
    assert.equal(await getCharacterMusicTrack(id), null);
  const root = await mkdtemp(path.join(tmpdir(), "alsj-music-test-"));
  try {
    assert.equal(await getCharacterMusicTrack("clean-soul", root), null);
    const original = await getCharacterMusicTrack("clean-soul");
    const target = path.join(root, "clean-soul.mp3");
    await copyFile(original.file, target);
    assert.ok(await getCharacterMusicTrack("clean-soul", root));
    const corrupted = await readFile(target);
    corrupted[corrupted.length - 20] ^= 1;
    await writeFile(target, corrupted);
    assert.equal(await getCharacterMusicTrack("clean-soul", root), null);
    await rm(target);
    await symlink(original.file, target);
    assert.equal(await getCharacterMusicTrack("clean-soul", root), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});
