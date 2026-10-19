import { spawn } from "node:child_process";

const MAX_RECORDING_BYTES = 5 * 1024 * 1024;
const SAMPLE_RATE = 16000;
const MAX_DURATION_SECONDS = 60;
const MIME_TYPES = new Set([
  "audio/webm", "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/aac",
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave",
  "audio/ogg", "audio/opus", "audio/flac", "audio/x-flac", "audio/aiff", "audio/x-aiff",
]);

export class CharacterTranscriptionError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "CharacterTranscriptionError";
    this.status = status;
  }
}

export function characterTranscriptionConfig(options = {}) {
  return {
    baseUrl: options.baseUrl ?? process.env.MINIMAX_SPEECH_BASE_URL ??
      process.env.MINIMAX_BASE_URL ?? "https://api.minimax.cn/v1",
    apiKey: options.apiKey ?? process.env.MINIMAX_SPEECH_API_KEY ??
      process.env.MINIMAX_API_KEY ?? "",
    model: options.model ?? process.env.MINIMAX_ASR_MODEL ?? "asr-1.0",
    fetch: options.fetch ?? globalThis.fetch,
    timeoutMs: options.timeoutMs ?? 60000,
    ffmpegPath: options.ffmpegPath ?? process.env.FFMPEG_PATH ?? "ffmpeg",
    ffmpegTimeoutMs: options.ffmpegTimeoutMs ?? 15000,
  };
}

export const isCharacterTranscriptionConfigured = (config) => Boolean(
  config?.baseUrl && config.apiKey && config.model,
);

function validateInput(audio, mime) {
  if (!Buffer.isBuffer(audio) || audio.length < 32)
    throw new CharacterTranscriptionError("录音内容为空或格式无效，请重新录制", 400);
  if (audio.length > MAX_RECORDING_BYTES)
    throw new CharacterTranscriptionError("录音超过5MB，请缩短后重新录制", 413);
  const type = typeof mime === "string" ? mime.split(";", 1)[0].trim().toLowerCase() : "";
  if (!MIME_TYPES.has(type))
    throw new CharacterTranscriptionError("不支持此录音格式，请使用浏览器录音或上传音频", 400);
}

function wavFromPcm(pcm) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(pcm.length + 36, 4);
  header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24); header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return { audioWav: Buffer.concat([header, pcm]), duration: pcm.length / (SAMPLE_RATE * 2), mime: "audio/wav" };
}

function nativeWav(audio) {
  const invalid = () => {
    throw new CharacterTranscriptionError("录音WAV格式无效，请重新录制", 400);
  };
  if (audio.length < 44 || audio.toString("ascii", 0, 4) !== "RIFF" ||
      audio.toString("ascii", 8, 12) !== "WAVE" || audio.readUInt32LE(4) + 8 !== audio.length)
    invalid();
  let cursor = 12, count = 0, hasFormat = false, pcm;
  while (cursor + 8 <= audio.length) {
    if (++count > 128) invalid();
    const name = audio.toString("ascii", cursor, cursor + 4);
    const size = audio.readUInt32LE(cursor + 4), start = cursor + 8;
    if (start + size > audio.length) invalid();
    if (name === "fmt ") {
      if (hasFormat || size < 16 || audio.readUInt16LE(start) !== 1 ||
          audio.readUInt16LE(start + 2) !== 1 || audio.readUInt32LE(start + 4) !== SAMPLE_RATE ||
          audio.readUInt32LE(start + 8) !== SAMPLE_RATE * 2 || audio.readUInt16LE(start + 12) !== 2 ||
          audio.readUInt16LE(start + 14) !== 16) invalid();
      hasFormat = true;
    }
    if (name === "data") {
      if (pcm || size < SAMPLE_RATE / 5 || size % 2) invalid();
      if (size > SAMPLE_RATE * 2 * MAX_DURATION_SECONDS)
        throw new CharacterTranscriptionError("录音不能超过60秒，请缩短后重试", 400);
      pcm = audio.subarray(start, start + size);
    }
    cursor = start + size + size % 2;
  }
  if (!hasFormat || !pcm || cursor !== audio.length) invalid();
  // Strip optional WAV metadata: ASR receives only the recorded PCM samples.
  return wavFromPcm(pcm);
}

// Browser WebM and MP4 are not documented ASR inputs. Decode just the audio
// track to bounded mono PCM, then wrap a correctly sized WAV for the provider.
// The fixed protocol whitelist prevents uploaded playlists from fetching URLs.
export async function normalizeCharacterRecording(audio, mime, config = characterTranscriptionConfig()) {
  validateInput(audio, mime);
  if (["audio/wav", "audio/x-wav", "audio/wave"].includes(mime.split(";", 1)[0].trim().toLowerCase()))
    return nativeWav(audio);
  const maxPcmBytes = SAMPLE_RATE * 2 * MAX_DURATION_SECONDS;
  const pcm = await new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(config.ffmpegPath, [
        "-nostdin", "-hide_banner", "-loglevel", "error", "-threads", "1",
        "-protocol_whitelist", "pipe", "-i", "pipe:0",
        "-map", "0:a:0", "-vn", "-sn", "-dn", "-t", "60.1",
        "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "s16le", "pipe:1",
      ], { stdio: ["pipe", "pipe", "ignore"] });
    } catch {
      reject(new CharacterTranscriptionError("录音处理服务暂不可用，请稍后重试", 503));
      return;
    }
    let complete = false, size = 0;
    const chunks = [];
    const finish = (error, value) => {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      if (error) { child.kill("SIGKILL"); reject(error); }
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new CharacterTranscriptionError("录音处理超时，请重新录制", 400)), config.ffmpegTimeoutMs);
    child.on("error", () => finish(new CharacterTranscriptionError("录音处理服务暂不可用，请稍后重试", 503)));
    child.stdin.on("error", () => {}); // Decoder rejection can close stdin early.
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxPcmBytes)
        finish(new CharacterTranscriptionError("录音不能超过60秒，请缩短后重试", 400));
      else chunks.push(chunk);
    });
    child.on("close", (code) => {
      if (code !== 0 || size < SAMPLE_RATE / 5)
        finish(new CharacterTranscriptionError("录音无法读取或时间太短，请重新录制", 400));
      else finish(null, Buffer.concat(chunks, size));
    });
    child.stdin.end(audio);
  });
  return wavFromPcm(pcm);
}

async function responseJson(response) {
  const maxBytes = 100000;
  if (Number(response.headers?.get("content-length")) > maxBytes)
    throw new CharacterTranscriptionError("语音识别响应过大，请重新录制");
  let bytes = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > maxBytes)
      throw new CharacterTranscriptionError("语音识别响应过大，请重新录制");
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8")); }
  catch { throw new CharacterTranscriptionError("MiniMax返回无效的语音识别结果，请重试"); }
}

// Return only transcription text. No recording URL, user profile, provider
// identifiers or API credentials are included in the request or result.
export async function transcribeCharacterAudio(input, config = characterTranscriptionConfig()) {
  const audio = input?.data, mime = input?.mimeType;
  validateInput(audio, mime);
  if (!isCharacterTranscriptionConfigured(config))
    throw new CharacterTranscriptionError("语音识别尚未配置，请联系GM", 503);
  let url;
  try {
    url = new URL(config.baseUrl.replace(/\/+$/, "") + "/speech_to_text");
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
      throw new Error();
  } catch {
    throw new CharacterTranscriptionError("语音识别接口配置无效，请联系GM", 503);
  }
  const { audioWav, duration } = await normalizeCharacterRecording(audio, mime, config);
  const form = new FormData();
  form.set("model", config.model);
  form.set("response_format", "json");
  form.set("stream", "false");
  form.set("file", new Blob([audioWav], { type: "audio/wav" }), "character-reference.wav");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await config.fetch(url.toString(), {
      method: "POST", redirect: "error",
      headers: { authorization: `Bearer ${config.apiKey}` },
      body: form, signal: controller.signal,
    });
    if (!response.ok) {
      const message = {
        400: "未能识别这段录音，请重新录制",
        401: "语音识别服务认证失败，请联系GM",
        402: "语音识别服务额度不足，请联系GM",
        413: "录音文件过大，请缩短后重新录制",
        422: "这段录音无法处理，请重新录制",
        429: "语音识别繁忙，请稍后重试",
      }[response.status] || "MiniMax语音识别服务暂不可用，请稍后重试";
      const status = [400, 413, 422, 429].includes(response.status) ? response.status : 502;
      throw new CharacterTranscriptionError(message, status);
    }
    const data = await responseJson(response);
    if (!data || data.error || data.base_resp?.status_code)
      throw new CharacterTranscriptionError("MiniMax语音识别失败，请稍后重试");
    const text = typeof data.text === "string" ? data.text.trim() : "";
    if (!text) throw new CharacterTranscriptionError("未识别到清晰语音，请重新录制", 400);
    if (text.length > 2000 || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(text) || text.includes(config.apiKey))
      throw new CharacterTranscriptionError("语音识别结果无效或过长，请缩短后重试");
    return { text, duration };
  } catch (error) {
    if (controller.signal.aborted)
      throw new CharacterTranscriptionError("语音识别超时，请稍后重试");
    if (error instanceof CharacterTranscriptionError) throw error;
    // Never surface network error strings, raw provider bodies or headers.
    throw new CharacterTranscriptionError("MiniMax语音识别连接失败，请稍后重试");
  } finally {
    clearTimeout(timer);
  }
}

export async function transcribeCharacterReference(audio, mime, config = characterTranscriptionConfig()) {
  return (await transcribeCharacterAudio({ data: audio, mimeType: mime }, config)).text;
}
