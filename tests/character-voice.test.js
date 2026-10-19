import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync, gzipSync } from "node:zlib";
import {
  characterVoiceConfig,
  estimateCharacterSubtitles,
  isCharacterVoiceConfigured,
  pollCharacterVoice,
  submitCharacterVoice,
} from "../server/character-voice.js";

const privateKey = "test-private-speech-key";
const textKey = "test-private-text-key";
const character = {
  name: "艾琳·温特", english: "Erin Winter", profession: "声音档案修复师",
  skill: "技术", motive: "来晚宴交流声音档案保护",
  story: "我在索恩庄园的ECHO晚宴前修复了一批旧录音，希望与宾客讨论声音档案的公开保存。",
  cosplay_character: "冬夜档案师", cosplay_source: "原创角色",
  secret: "NEVER_SEND_SECRET", contact: "NEVER_SEND_PHONE",
};
const script = "我是艾琳·温特，一名声音档案修复师。我习惯在杂音里寻找被人忽略的细节：一扇合上的门，一句没说完的告别，或者磁带尽头微弱的风声。今晚来到索恩庄园，我想听听各位愿意留下怎样的回声。如果你也珍藏着一段不愿遗忘的声音，愿意与我交换它的故事吗？";
const voices = [
  { voice_id: "Chinese_Mature_Woman", voice_name: "沉静女声", description: ["一位沉静理性的成年女性，标准普通话"] },
  { voice_id: "Chinese_Reliable_Man", voice_name: "沉稳男声", description: ["沉稳可靠的中年男性，标准普通话"] },
];
const json = (value, options) => new Response(JSON.stringify({ base_resp: { status_code: 0 }, ...value }), options);
const modelResult = (value = {}) => json({ choices: [{ finish_reason: "stop", message: {
  content: JSON.stringify({ script, voice_id: voices[0].voice_id, speed: 0.96, pitch: 0, ...value }),
} }] });
const mp3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(125)]);
const cfg = (fetch, options = {}) => characterVoiceConfig({
  baseUrl: "https://speech.example/v1", textBaseUrl: "https://text.example/v1",
  apiKey: privateKey, textApiKey: textKey, fetch, ...options,
});

function zipAudio(audio, { size = audio.length, method = 8 } = {}) {
  const filename = Buffer.from("result/intro.mp3");
  const packed = method === 8 ? deflateRawSync(audio) : audio;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(size, 22);
  local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(size, 24);
  central.writeUInt16LE(filename.length, 28);
  const content = Buffer.concat([local, filename, packed]);
  const directory = Buffer.concat([central, filename]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(content.length, 16);
  return Buffer.concat([content, directory, end]);
}

function tarFile(filename, audio) {
  const header = Buffer.alloc(512);
  header.write(filename, 0);
  header.write("0000644\0", 100);
  header.write(`${audio.length.toString(8).padStart(11, "0")}\0`, 124);
  header.fill(32, 148, 156);
  header[156] = 48;
  header.write("ustar\0", 257);
  const sum = header.reduce((total, value) => total + value, 0);
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return Buffer.concat([header, audio, Buffer.alloc((512 - audio.length % 512) % 512)]);
}
const tarAudio = (audio) => Buffer.concat([tarFile("content-123.mp3", audio), Buffer.alloc(1024)]);

test("确认角色后生成独特介绍，从实时系统音色选择并提交异步语音", async () => {
  const requests = [];
  const config = cfg(async (url, req) => {
    requests.push({ url, req, body: req.body ? JSON.parse(req.body) : undefined });
    if (url.endsWith("/get_voice")) return json({ system_voice: voices });
    if (url.endsWith("/chat/completions")) return modelResult();
    if (url.endsWith("/t2a_async_v2")) return json({ task_id: 1234, file_id: 5678, task_token: "NEVER_RETURN_PROVIDER_TOKEN" });
    throw new Error("Unexpected request");
  });
  assert.equal(isCharacterVoiceConfigured(config), true);
  const result = await submitCharacterVoice(character, config);
  assert.deepEqual(result, {
    script, voice_id: voices[0].voice_id, voice_name: voices[0].voice_name, task_id: "1234", file_id: "5678",
  });
  assert.deepEqual(requests[0].body, { voice_type: "system" });
  assert.equal(requests[0].req.headers.authorization, `Bearer ${privateKey}`);
  assert.equal(requests[1].req.headers.authorization, `Bearer ${textKey}`);
  assert.equal(requests[1].url, "https://text.example/v1/chat/completions");
  const prompt = JSON.stringify(requests[1].body);
  assert.ok(prompt.includes(voices[0].voice_id));
  assert.ok(!prompt.includes("NEVER_SEND"));
  assert.ok(!prompt.includes(privateKey));
  assert.ok(!prompt.includes(textKey));
  assert.deepEqual(requests[2].body, {
    model: "speech-2.8-hd", text: script, language_boost: "Chinese",
    voice_setting: { voice_id: voices[0].voice_id, speed: 0.96, vol: 1, pitch: 0 },
    audio_setting: { audio_sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 },
  });
  assert.ok(!JSON.stringify(result).includes("NEVER_RETURN"));
  assert.ok(requests.every(({ req }) => req.redirect === "error"));
  await submitCharacterVoice(character, config);
  assert.equal(requests.filter(({ url }) => url.endsWith("/get_voice")).length, 1);
});

test("未配置、未确定的角色和包含剧情禁区的内容不触发付费调用", async () => {
  let called = 0;
  const fetch = async () => { called++; throw new Error(); };
  await assert.rejects(submitCharacterVoice(character, cfg(fetch, { apiKey: "" })), /尚未配置/);
  for (const input of [null, [], {}, { ...character, story: "真正凶手是维拉" }])
    await assert.rejects(submitCharacterVoice(input, cfg(fetch)), /角色|校验/);
  assert.equal(called, 0);
});

test("付费语音提交前等待任务校验，已取消的任务不发送TTS请求", async () => {
  const requests = [];
  const cancelled = new Error("角色或语音任务已更新，请刷新后重试");
  const config = cfg(async (url) => {
    requests.push(url);
    if (url.endsWith("/get_voice")) return json({ system_voice: voices });
    if (url.endsWith("/chat/completions")) return modelResult();
    if (url.endsWith("/t2a_async_v2")) return json({ task_id: 1234, file_id: 5678 });
    throw new Error("Unexpected request");
  });
  let checked = false;
  await assert.rejects(submitCharacterVoice(character, config, {
    beforeSubmit: async () => {
      assert.equal(requests.length, 2);
      await new Promise((resolve) => setImmediate(resolve));
      checked = true;
      throw cancelled;
    },
  }), (error) => error === cancelled);
  assert.equal(checked, true);
  assert.deepEqual(requests, [
    "https://speech.example/v1/get_voice",
    "https://text.example/v1/chat/completions",
  ]);
});

test("介绍不完整、越界、泄露密钥或虚构音色时不提交语音", async () => {
  for (const value of [
    { script: "太短" }, { script: script + "真正凶手是维拉" },
    { script: script + " sk-dont-ever-speak-api-key" },
    { voice_id: "not_in_catalog" }, { speed: 5 }, { pitch: 9 },
  ]) {
    let submitted = false;
    const config = cfg(async (url) => {
      if (url.endsWith("/get_voice")) return json({ system_voice: voices });
      if (url.endsWith("/chat/completions")) return modelResult(value);
      submitted = true;
    });
    await assert.rejects(submitCharacterVoice(character, config), /校验/);
    assert.equal(submitted, false);
  }
});

test("轮询处理中和失败任务，成功后从固定MiniMax端点下载MP3", async () => {
  const requests = [];
  const config = cfg(async (url, req) => {
    requests.push({ url, req });
    if (url.includes("/query/")) return json({ status: "Success", file_id: 5678 });
    return new Response(mp3, { headers: { "content-type": "audio/mpeg" } });
  });
  const result = await pollCharacterVoice({ task_id: "1234" }, config);
  assert.equal(result.status, "ready");
  assert.equal(result.file_id, "5678");
  assert.deepEqual(result.audioMp3, mp3);
  assert.deepEqual(requests.map(({ url }) => url), [
    "https://speech.example/v1/query/t2a_async_query_v2?task_id=1234",
    "https://speech.example/v1/files/retrieve_content?file_id=5678",
  ]);
  assert.equal(requests[1].req.redirect, "error");
  assert.equal(requests[1].req.headers.authorization, `Bearer ${privateKey}`);
  for (const status of ["Processing", "Failed", "Expired"]) {
    let count = 0;
    const state = await pollCharacterVoice({ task_id: "1234" }, cfg(async () => {
      count++; return json({ status });
    }));
    assert.deepEqual(state, { status: status.toLowerCase() });
    assert.equal(count, 1);
  }
});

test("MiniMax 64位任务和文件ID保持精度", async () => {
  const calls = [];
  const config = cfg(async (url) => {
    calls.push(url);
    if (url.endsWith("/get_voice")) return json({ system_voice: voices });
    if (url.endsWith("/chat/completions")) return modelResult();
    if (url.endsWith("/t2a_async_v2")) return new Response('{"task_id":1234567890123456789,"file_id":1234567890123456790}');
    if (url.includes("/query/")) return new Response('{"status":"Success","file_id":1234567890123456790}');
    return new Response(mp3);
  });
  const task = await submitCharacterVoice(character, config);
  assert.equal(task.task_id, "1234567890123456789");
  assert.equal(task.file_id, "1234567890123456790");
  const result = await pollCharacterVoice(task, config);
  assert.equal(result.file_id, "1234567890123456790");
  assert.ok(calls.some((url) => url.endsWith("?task_id=1234567890123456789")));
});

test("异步语音ZIP仅解压一个有界MP3，不落盘", async () => {
  for (const method of [0, 8]) {
    const config = cfg(async (url) => url.includes("/query/")
      ? json({ status: "success", file_id: "2" }) : new Response(zipAudio(mp3, { method })));
    const result = await pollCharacterVoice({ task_id: "1" }, config);
    assert.deepEqual(result.audioMp3, mp3);
  }
  const config = cfg(async (url) => url.includes("/query/")
    ? json({ status: "success", file_id: "2" }) : new Response(zipAudio(mp3, { size: 6 * 1024 * 1024 })));
  await assert.rejects(pollCharacterVoice({ task_id: "1" }, config), /压缩文件/);
});

test("真实MiniMax异步返回的TAR包及gzip包提取MP3并校验长度与校验和", async () => {
  for (const archive of [tarAudio(mp3), gzipSync(tarAudio(mp3))]) {
    const config = cfg(async (url) => url.includes("/query/")
      ? json({ status: "success", file_id: "2" }) : new Response(archive));
    const result = await pollCharacterVoice({ task_id: "1" }, config);
    assert.deepEqual(result.audioMp3, mp3);
  }
  const corrupted = tarAudio(mp3);
  corrupted[0] ^= 1;
  const config = cfg(async (url) => url.includes("/query/")
    ? json({ status: "success", file_id: "2" }) : new Response(corrupted));
  await assert.rejects(pollCharacterVoice({ task_id: "1" }, config), /压缩文件/);
});

test("MiniMax titles和extra保留供应商毫秒时间戳，返回秒和音频时长", async () => {
  const titles = [{ text: "我是艾琳·温特。", time_begin: 0, time_end: 2400 },
    { text: "我修复旧时的声音。", time_begin: 2600, time_end: 5200 }];
  const archive = Buffer.concat([
    tarFile("content-123.mp3", mp3), tarFile("content-123.titles", Buffer.from(JSON.stringify(titles))),
    tarFile("content-123.extra", Buffer.from(JSON.stringify({ audio_length: 5360, trace_id: "NEVER_RETURN_METADATA" }))),
    Buffer.alloc(1024),
  ]);
  const config = cfg(async (url) => url.includes("/query/")
    ? json({ status: "success", file_id: "2" }) : new Response(archive));
  const result = await pollCharacterVoice({ task_id: "1", script }, config);
  assert.equal(result.duration, 5.36);
  assert.equal(result.subtitle_source, "provider");
  assert.deepEqual(result.subtitles, [{ start: 0, end: 2.4, text: titles[0].text },
    { start: 2.6, end: 5.2, text: titles[1].text }]);
  assert.ok(!JSON.stringify(result).includes("NEVER_RETURN"));
});

test("无效字幕不影响已付费音频，依据实际音频时长估算并明确标记", async () => {
  const archive = Buffer.concat([
    tarFile("content-123.mp3", mp3),
    tarFile("content-123.titles", Buffer.from(JSON.stringify([{ text: "invalid", time_begin: 5000, time_end: 1000 }]))),
    tarFile("content-123.extra", Buffer.from('{"audio_length":36360}')), Buffer.alloc(1024),
  ]);
  const config = cfg(async (url) => url.includes("/query/")
    ? json({ status: "success", file_id: "2" }) : new Response(archive));
  const result = await pollCharacterVoice({ task_id: "1", script }, config);
  assert.deepEqual(result.audioMp3, mp3);
  assert.equal(result.subtitle_source, "estimated");
  assert.equal(result.subtitles[0].start, 0);
  assert.equal(result.subtitles.at(-1).end, 36.36);
  assert.equal(result.subtitles.map((cue) => cue.text).join(""), script);
  assert.ok(result.subtitles.every((cue) => cue.text.length <= 32 && cue.start < cue.end));
  assert.deepEqual(estimateCharacterSubtitles(script, null), []);
});

test("直接MP3通过实际帧长度计算时长，为无字幕的旧输出提供标明估算的字幕", async () => {
  // MPEG-1 Layer III, 128 kbps, 32 kHz: 576 bytes / 1152 samples per frame.
  const frame = Buffer.alloc(576);
  Buffer.from([0xff, 0xfb, 0x98, 0x00]).copy(frame);
  const audio = Buffer.concat([frame, frame, frame]);
  const config = cfg(async (url) => url.includes("/query/")
    ? json({ status: "success", file_id: "2" }) : new Response(audio));
  const result = await pollCharacterVoice({ task_id: "1", script }, config);
  assert.equal(result.duration, 0.108);
  assert.equal(result.subtitle_source, "estimated");
  assert.equal(result.subtitles.at(-1).end, 0.108);
  assert.deepEqual(result.audioMp3, audio);
});

test("拒绝超大响应、非音频、无效任务和下载重定向", async () => {
  const cases = [
    () => new Response(mp3, { headers: { "content-length": String(6 * 1024 * 1024) } }),
    () => new Response(Buffer.alloc(5 * 1024 * 1024 + 1)),
    () => new Response("<html>not audio</html>"),
    () => new Response("", { status: 302, headers: { location: "https://evil.example/private" } }),
  ];
  for (const binary of cases) {
    const urls = [];
    const config = cfg(async (url) => {
      urls.push(url);
      return url.includes("/query/") ? json({ status: "success", file_id: "2" }) : binary();
    });
    await assert.rejects(pollCharacterVoice({ task_id: "1" }, config), /过大|MP3|服务请求失败/);
    assert.equal(urls.length, 2);
    assert.ok(urls.every((url) => url.startsWith("https://speech.example/v1/")));
  }
  let called = false;
  await assert.rejects(pollCharacterVoice({ task_id: "../../secrets" }, cfg(async () => { called = true; })), /任务信息/);
  assert.equal(called, false);
});

test("供应商失败、网络异常和非法配置不把密钥暴露给客户端", async () => {
  for (const fetch of [
    async () => { throw new Error(`connection ${privateKey}`); },
    async () => json({ base_resp: { status_code: 1004, status_msg: privateKey } }),
    async () => new Response(privateKey, { status: 401 }),
    async () => new Response(`invalid ${privateKey}`),
  ]) {
    await assert.rejects(submitCharacterVoice(character, cfg(fetch)), (error) => {
      assert.ok(!error.message.includes(privateKey));
      assert.equal(error.status, 502);
      return true;
    });
  }
  for (const baseUrl of ["http://localhost/v1", `https://${privateKey}@speech.example/v1`])
    await assert.rejects(submitCharacterVoice(character, cfg(async () => {}, { baseUrl })), /配置无效/);
});
