import { pollCharacterVoice, isCharacterVoiceConfigured } from "./character-voice.js";
import { putCharacterMedia, isCharacterMediaStorageConfigured } from "./character-media-storage.js";

export const LEGACY_VOICE_TIMEOUT = "语音生成超时，请重试";

// One shared poller serves HTTP requests and the production background worker.
// It resumes provider tasks after navigation/restarts without resubmitting TTS.
export function createCharacterVoiceJobs({ one, all, run, voiceConfig, mediaConfig,
  creationTimeoutMs, intervalMs = 5000, log = console.warn }) {
  const polls = new Map();
  let timer, sweeping;
  const configured = () => isCharacterVoiceConfigured(voiceConfig) && isCharacterMediaStorageConfigured(mediaConfig);
  const pollPlayer = (playerId) => {
    if (polls.has(playerId)) return polls.get(playerId);
    const promise = (async () => {
      const row = await one("SELECT v.*,c.revision FROM character_voices v JOIN characters c ON c.player_id=v.player_id WHERE v.player_id=?", playerId);
      if (!row || row.character_revision !== row.revision) return;
      const params = [playerId, row.job_token, row.character_revision, playerId];
      const guard = " WHERE player_id=? AND job_token=? AND character_revision=? AND character_revision=(SELECT revision FROM characters WHERE player_id=?)";
      if (row.status === "creating") {
        if (Date.now() - row.created_at > creationTimeoutMs)
          await run("UPDATE character_voices SET status='error',error=?,updated_at=?" + guard + " AND status='creating' AND task_id IS NULL",
            "语音任务中断，请重试", Date.now(), ...params);
        return;
      }
      if (!configured() || !row.task_id || !(row.status === "processing" ||
          (row.status === "error" && row.error === LEGACY_VOICE_TIMEOUT))) return;
      // Recover the old ten-minute timeout before any network call, including
      // transient failures. POST must keep reusing this already-paid task.
      if (row.status === "error") {
        await run("UPDATE character_voices SET status='processing',error=NULL" + guard + " AND status='error' AND error=?", ...params, LEGACY_VOICE_TIMEOUT);
      }
      try {
        const result = await pollCharacterVoice(row, voiceConfig);
        if (result.status === "ready") {
          // Do not upload a result for a character changed while polling.
          const current = await one("SELECT v.job_token,c.revision FROM character_voices v JOIN characters c ON c.player_id=v.player_id WHERE v.player_id=?", playerId);
          if (current?.job_token !== row.job_token || current.revision !== row.character_revision) return;
          const stored = await putCharacterMedia({ playerId, kind: "intro", data: result.audioMp3, contentType: "audio/mpeg" }, mediaConfig);
          await run("UPDATE character_voices SET status='ready',file_id=?,audio_object_key=?,subtitles=?,duration=?,subtitle_source=?,error=NULL,updated_at=?" + guard + " AND status='processing'",
            result.file_id, stored.object_key, JSON.stringify(result.subtitles || []), result.duration || 0,
            result.subtitle_source || "none", Date.now(), ...params);
        } else if (["failed", "expired"].includes(result.status)) {
          await run("UPDATE character_voices SET status='error',error=?,updated_at=?" + guard + " AND status='processing'",
            "语音生成失败或任务已过期，请重试", Date.now(), ...params);
        }
      } catch (error) {
        // Keep the task recoverable on network/storage errors. Persist a safe
        // diagnostic, never provider payloads, URLs, credentials or raw errors.
        const diagnostic = error.status ? error.message : "语音任务查询暂时失败，将自动重试";
        await run("UPDATE character_voices SET error=?" + guard + " AND status='processing'", diagnostic, ...params);
        if (diagnostic !== row.error) log("character_voice_poll_retry", { code: error.code || "VOICE_POLL_RETRY" });
      }
    })().finally(() => polls.delete(playerId));
    polls.set(playerId, promise);
    return promise;
  };
  const tick = () => {
    if (sweeping) return sweeping;
    sweeping = (async () => {
      if (!configured()) return;
      const rows = await all("SELECT v.player_id FROM character_voices v JOIN characters c ON c.player_id=v.player_id WHERE v.character_revision=c.revision AND (v.status IN ('creating','processing') OR (v.status='error' AND v.task_id IS NOT NULL AND v.error=?)) ORDER BY v.updated_at LIMIT 100", LEGACY_VOICE_TIMEOUT);
      // Bound concurrent downloads/uploads on the 256 MB deployment.
      for (let i = 0; i < rows.length; i += 3)
        await Promise.all(rows.slice(i, i + 3).map(({ player_id }) => pollPlayer(player_id)));
    })().finally(() => { sweeping = null; });
    return sweeping;
  };
  const start = () => {
    if (timer || !configured()) return;
    const sweep = () => { void tick().catch(() => log("character_voice_sweep_retry", { code: "VOICE_SWEEP_RETRY" })); };
    timer = setInterval(sweep, intervalMs);
    timer.unref?.();
    sweep();
  };
  const stop = async () => {
    clearInterval(timer);
    timer = null;
    await Promise.allSettled([sweeping, ...polls.values()]);
  };
  return { pollPlayer, tick, start, stop };
}
