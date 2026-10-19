import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Headphones,
  Music2,
  Pause,
  Play,
  RotateCcw,
  Volume2,
} from "lucide-react";
import { api } from "../api";
import { Button } from "./ui";
import { CharacterAvatar } from "./CharacterProfile";
import "./character-voice.css";

const clock = (value) => {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};
function estimatedCaptions(script, duration) {
  if (!script || !duration) return [];
  const lines = (script.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [script])
    .flatMap((line) => line.trim().match(/.{1,65}/gu) || [])
    .filter(Boolean);
  const length = lines.reduce((sum, line) => sum + line.length, 0);
  let elapsed = 0;
  return lines.map((text) => {
    const start = elapsed;
    elapsed += (text.length / length) * duration;
    return { text, start, end: elapsed };
  });
}

export default function CharacterVoice({
  character = {},
  revision,
  initial,
  onChange,
}) {
  const [voice, setVoice] = useState(initial || { status: "loading" });
  const [requesting, setRequesting] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [loadedDuration, setLoadedDuration] = useState(0);
  const [musicOn, setMusicOn] = useState(true);
  const [audioError, setAudioError] = useState("");
  const [musicError, setMusicError] = useState("");
  const [buffering, setBuffering] = useState(false);
  const audio = useRef(null),
    music = useRef(null),
    mixer = useRef(null),
    change = useRef(onChange);
  change.current = onChange;
  useEffect(() => {
    mixer.current?.context.close().catch(() => {});
    mixer.current = null;
    setVoice(initial || { status: "loading" });
    setPlaying(false);
    setTime(0);
    setLoadedDuration(0);
    setAudioError("");
    audio.current?.pause();
    music.current?.pause();
  }, [revision]);
  const pending = ["creating", "processing"].includes(voice.status);
  useEffect(() => {
    let active = true,
      timer;
    const poll = async () => {
      try {
        const result = await api("/character/voice");
        if (!active) return;
        setVoice(result);
        if (["creating", "processing"].includes(result.status))
          timer = setTimeout(poll, 3000);
      } catch {
        if (active) timer = setTimeout(poll, 5000);
      }
    };
    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [revision, pending]);
  useEffect(
    () => () => {
      audio.current?.pause();
      music.current?.pause();
      mixer.current?.context.close().catch(() => {});
      mixer.current = null;
    },
    [],
  );
  const update = (value) => {
    setVoice(value);
    change.current?.(value);
  };
  const generate = async () => {
    if (requesting) return;
    setRequesting(true);
    try {
      update(await api("/character/voice", {}));
    } catch (error) {
      update({ ...voice, status: "error", error: error.message });
    } finally {
      setRequesting(false);
    }
  };
  // A gain node also lowers the music on mobile Safari, where media.volume
  // alone is controlled by the device. The context starts only from a tap.
  const prepareMusic = () => {
    if (!music.current) return;
    if (mixer.current && mixer.current.element !== music.current) {
      mixer.current.context.close().catch(() => {});
      mixer.current = null;
    }
    music.current.volume = mixer.current ? 1 : 0.14;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!mixer.current && Context) {
      try {
        const context = new Context(),
          source = context.createMediaElementSource(music.current),
          gain = context.createGain();
        gain.gain.value = 0.14;
        music.current.volume = 1;
        source.connect(gain);
        gain.connect(context.destination);
        mixer.current = { context, source, gain, element: music.current };
      } catch {
        /* Browser without a mixer keeps the quiet media-volume fallback. */
      }
    }
    if (mixer.current?.context.state === "suspended")
      void mixer.current.context.resume().catch(() => {});
  };
  const syncMusic = (position) => {
    const element = music.current;
    if (!element) return;
    const desired =
      element.duration > 0 ? position % element.duration : position;
    if (Math.abs(element.currentTime - desired) > 0.45) {
      try {
        element.currentTime = desired;
      } catch {
        /* Metadata may still be loading. */
      }
    }
  };
  const startMusic = () => {
    if (!musicOn || !voice.music?.url || !music.current) return;
    prepareMusic();
    syncMusic(audio.current?.currentTime || 0);
    void music.current
      .play()
      .then(() => setMusicError(""))
      .catch(() => setMusicError("配乐暂时无法播放，可继续收听人声。"));
  };
  const togglePlay = () => {
    const element = audio.current;
    if (!element) return;
    if (!element.paused) {
      element.pause();
      music.current?.pause();
      return;
    }
    setAudioError("");
    if (element.ended) {
      element.currentTime = 0;
      setTime(0);
    }
    startMusic();
    void element.play().catch(() => {
      music.current?.pause();
      setPlaying(false);
      setBuffering(false);
      setAudioError("音频暂时无法播放，请再次点击播放。");
    });
  };
  const toggleMusic = () => {
    if (musicOn) music.current?.pause();
    else if (audio.current && !audio.current.paused) {
      prepareMusic();
      syncMusic(audio.current.currentTime);
      void music.current
        ?.play()
        .catch(() => setMusicError("配乐暂时无法播放，可继续收听人声。"));
    }
    setMusicOn(!musicOn);
  };
  const duration = loadedDuration || Number(voice.duration) || 0;
  const providerCues = Array.isArray(voice.subtitles)
    ? voice.subtitles.filter(
        (cue) =>
          cue.text &&
          Number.isFinite(cue.start) &&
          Number.isFinite(cue.end) &&
          cue.end > cue.start,
      )
    : [];
  const cues = useMemo(
    () =>
      providerCues.length
        ? providerCues
        : estimatedCaptions(voice.script, duration),
    [voice.subtitles, voice.script, duration],
  );
  const cueIndex = Math.max(
    0,
    cues.findLastIndex((cue) => time >= cue.start),
  );
  const caption =
    cues[cueIndex]?.text ||
    (voice.script ? "点击播放，听听今晚的我。" : "你的声音，正在抵达庄园。");
  const generating =
    requesting || ["creating", "processing"].includes(voice.status);
  const ready = voice.status === "ready" && voice.audio_url;
  return (
    <section
      className={`character-voice ${playing ? "is-playing" : ""}`}
      aria-label="角色语音自我介绍"
    >
      <div className="voice-topline">
        <span>
          <Headphones size={15} /> CHARACTER VOICE
        </span>
        <span>{ready ? "专属声纹 · 已就绪" : "专属声纹"}</span>
      </div>
      <div className="voice-identity">
        <div className="voice-portrait">
          <CharacterAvatar
            src={character.avatar_url}
            name={character.name}
            large
          />
          <span className="voice-portrait-mark">
            <Volume2 size={16} />
          </span>
        </div>
        <div className="voice-identity-copy">
          <span className="eyebrow">来自索恩庄园的一段声音</span>
          <h3>
            {character.name || "你的角色"}
            <span>的独白</span>
          </h3>
          <p>
            {voice.voice_name || "专属音色"}
            <i> / </i> AI 合成声音
          </p>
        </div>
        <div className="voice-wave" aria-hidden="true">
          {Array.from({ length: 12 }, (_, i) => (
            <i
              key={i}
              style={{
                "--bar": `${[8, 17, 26, 13, 32, 22, 36, 19, 29, 12, 22, 8][i]}px`,
                "--delay": `${i * 70}ms`,
              }}
            />
          ))}
        </div>
      </div>
      {generating || voice.status === "loading" ? (
        <div className="voice-preparing" role="status">
          <span className="voice-status-dot" />
          {voice.status === "processing"
            ? "正在为角色合成声音，稍后回来即可试听。"
            : voice.status === "loading"
              ? "正在读取你的声音档案…"
              : "正在创作自我介绍，并匹配角色音色…"}
        </div>
      ) : null}
      {(ready || voice.script) && (
        <div className="voice-caption" role="region" aria-label="语音字幕">
          <div className="voice-caption-label">
            <span>“</span>
            <small>{playing ? "正在讲述" : "角色自述"}</small>
            <small>
              {cues.length
                ? `${cueIndex + 1} / ${cues.length}`
                : "INTRODUCTION"}
            </small>
          </div>
          <p aria-current="true">{caption}</p>
          {ready && (
            <small className="voice-caption-source">
              {voice.subtitle_source === "provider" && providerCues.length
                ? "字幕随语音播放"
                : "字幕时间为估算"}
            </small>
          )}
        </div>
      )}
      {ready && (
        <>
          <audio
            ref={audio}
            preload="metadata"
            src={voice.audio_url}
            aria-label="播放角色自我介绍"
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              if (Number.isFinite(d)) setLoadedDuration(d);
            }}
            onTimeUpdate={(e) => {
              setTime(e.currentTarget.currentTime);
              if (!e.currentTarget.paused && musicOn)
                syncMusic(e.currentTarget.currentTime);
            }}
            onPlay={() => setPlaying(true)}
            onPlaying={() => setBuffering(false)}
            onWaiting={() => setBuffering(true)}
            onPause={() => {
              setPlaying(false);
              setBuffering(false);
              music.current?.pause();
            }}
            onEnded={() => {
              setPlaying(false);
              music.current?.pause();
              if (music.current) music.current.currentTime = 0;
            }}
            onError={() => {
              setPlaying(false);
              music.current?.pause();
              setAudioError("音频加载失败，请重新加载后播放。");
            }}
          />
          {voice.music?.url && (
            <audio
              ref={music}
              key={`${revision}:${voice.music.url}`}
              preload="none"
              loop
              src={voice.music.url}
              aria-label="背景音乐音轨"
              onError={() =>
                setMusicError("配乐暂时无法播放，可继续收听人声。")
              }
            />
          )}
          <div className="voice-controls">
            <button
              className="voice-play"
              onClick={togglePlay}
              aria-label={playing ? "暂停自我介绍" : "播放自我介绍"}
            >
              {playing ? (
                <Pause size={23} fill="currentColor" />
              ) : (
                <Play size={23} fill="currentColor" />
              )}
            </button>
            <div className="voice-timeline">
              <div>
                <span>
                  {buffering
                    ? "正在缓冲…"
                    : playing
                      ? "正在播放"
                      : time
                        ? "继续聆听"
                        : "听见你的角色"}
                </span>
                <span>
                  {clock(time)} <i>/</i> {clock(duration)}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max={duration || 1}
                step="0.05"
                value={Math.min(time, duration || 1)}
                disabled={!duration}
                aria-label="语音播放进度"
                style={{
                  "--progress": `${duration ? (time / duration) * 100 : 0}%`,
                }}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  if (audio.current) audio.current.currentTime = next;
                  setTime(next);
                  syncMusic(next);
                }}
              />
            </div>
            {voice.music?.url && (
              <button
                className={`voice-music-toggle ${musicOn ? "active" : ""}`}
                role="switch"
                aria-label="背景音乐"
                aria-checked={musicOn}
                onClick={toggleMusic}
              >
                <Music2 size={18} />
                <span>配乐{musicOn ? "开" : "关"}</span>
              </button>
            )}
          </div>
          {voice.music && (
            <div className="voice-music-credit">
              <Music2 size={13} />
              <span>
                {voice.music.mood} · {voice.music.title}
              </span>
            </div>
          )}
        </>
      )}
      {audioError && (
        <div className="voice-error" role="alert">
          {audioError}
          <button
            onClick={() => {
              audio.current?.load();
              setAudioError("");
            }}
          >
            重新加载音频
          </button>
        </div>
      )}
      {musicError && musicOn && (
        <p className="voice-error" role="status">
          {musicError}
        </p>
      )}
      {voice.error && (
        <p className="form-error" role="alert">
          {voice.error}
        </p>
      )}
      {!generating && ["none", "error"].includes(voice.status) && (
        <Button onClick={generate}>
          <RotateCcw size={16} />
          {voice.status === "error" ? "重试生成语音介绍" : "生成语音自我介绍"}
        </Button>
      )}
      {voice.script && (
        <details className="voice-transcript">
          <summary>完整自我介绍{ready ? "与配乐署名" : ""}</summary>
          <p>{voice.script}</p>
          {voice.music && (
            <div className="voice-license">
              <a href={voice.music.source} target="_blank" rel="noreferrer">
                {voice.music.title} — Kevin MacLeod / incompetech.com
              </a>
              <a href={voice.music.licenseUrl} target="_blank" rel="noreferrer">
                {voice.music.license}
              </a>
              <span>{voice.music.changes}</span>
            </div>
          )}
        </details>
      )}
    </section>
  );
}
