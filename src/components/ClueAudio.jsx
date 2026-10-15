import React, { useEffect, useRef, useState } from "react";
import { Headphones, Pause, Play, RotateCcw } from "lucide-react";
import { claimClueAudio, releaseClueAudio } from "../audio/clue-audio";
import "./clue-audio.css";

const time = (seconds) => {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
};

function Credit({ credit }) {
  if (typeof credit !== "object" || !credit)
    return <span>{String(credit)}</span>;
  return (
    <span>
      {credit.title}
      {credit.artist ? ` · ${credit.artist}` : ""}{" "}
      {credit.source && /^https?:\/\//.test(credit.source) && (
        <a href={credit.source} target="_blank" rel="noreferrer">
          来源
        </a>
      )}{" "}
      {credit.license &&
        (/^https?:\/\//.test(credit.license) ? (
          <a href={credit.license} target="_blank" rel="noreferrer">
            CC BY 4.0 授权
          </a>
        ) : (
          <span>{credit.license}</span>
        ))}
      {credit.changes && <span> · {credit.changes}</span>}
    </span>
  );
}

export default function ClueAudio({
  track,
  label = "线索演绎",
  compact = false,
  available = true,
}) {
  if (!track?.url) return null;
  // A different URL remounts the recording, releasing its media immediately.
  return (
    <Recording
      key={track.url}
      track={track}
      label={label}
      compact={compact}
      available={available}
    />
  );
}

function Recording({ track, label, compact, available }) {
  const media = useRef(null);
  const owner = useRef(null);
  const attempt = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(Number(track.duration) || 0);
  const [ended, setEnded] = useState(false);
  const stop = () => {
    attempt.current++;
    media.current?.pause();
    setPlaying(false);
    setLoading(false);
    releaseClueAudio(owner.current);
  };
  owner.current ||= { pause: () => stop() };
  useEffect(() => {
    const element = media.current;
    const token = owner.current;
    const pageExited = () => token.pause();
    window.addEventListener("pagehide", pageExited);
    return () => {
      attempt.current++;
      element.pause();
      element.removeAttribute("src");
      element.load();
      releaseClueAudio(token);
      window.removeEventListener("pagehide", pageExited);
    };
  }, []);
  const fail = () => {
    stop();
    setError("音频暂时无法播放，请检查网络后重试。文字线索仍可查看。");
  };
  const play = async (restart = false) => {
    if (!available) return;
    const element = media.current;
    const version = ++attempt.current;
    setError("");
    setLoading(true);
    claimClueAudio(owner.current);
    if (!element.getAttribute("src") || element.error) {
      element.src = track.url;
      element.load();
    }
    if (restart || ended) {
      element.currentTime = 0;
      setPosition(0);
      setEnded(false);
    }
    try {
      await element.play();
      if (attempt.current !== version) return;
      setPlaying(true);
      setLoading(false);
    } catch (failure) {
      if (attempt.current !== version || failure.name === "AbortError") return;
      fail();
    }
  };
  const action = error
    ? "重试聆听"
    : loading
      ? "取消加载"
      : playing
        ? "暂停聆听"
        : ended
          ? "重新播放"
          : position > 0
            ? "继续聆听"
            : "点击聆听";
  const credits = Array.isArray(track.credits)
    ? track.credits
    : track.credits
      ? [track.credits]
      : [];
  return (
    <section
      className={`clue-audio${compact ? " clue-audio-compact" : ""}`}
      aria-label={label}
      data-testid="clue-audio"
      data-playing={playing ? "true" : "false"}
      data-available={available ? "true" : "false"}
    >
      <audio
        ref={media}
        preload="none"
        playsInline
        onTimeUpdate={() => setPosition(media.current.currentTime)}
        onDurationChange={() => {
          if (Number.isFinite(media.current.duration))
            setDuration(media.current.duration);
        }}
        onEnded={() => {
          stop();
          setEnded(true);
        }}
        onError={fail}
      />
      {!compact && (
        <div className="clue-audio-heading">
          <Headphones size={15} />
          <strong>{label}</strong>
          <span>含背景配乐</span>
        </div>
      )}
      <div className="clue-audio-controls">
        <button
          type="button"
          onClick={() => (playing || loading ? stop() : void play())}
          disabled={!available && !playing && !loading}
        >
          {playing || loading ? <Pause size={16} /> : <Play size={16} />}{" "}
          {action}
        </button>
        <span className="clue-audio-time" aria-label="播放时间">
          {time(position)} / {time(duration)}
        </span>
        {position > 0 && !ended && (
          <button
            type="button"
            className="clue-audio-restart"
            aria-label="从头播放"
            disabled={!available}
            onClick={() => void play(true)}
          >
            <RotateCcw size={15} />
          </button>
        )}
      </div>
      <progress value={position} max={duration || 1} aria-label="聆听进度" />
      {error && (
        <p className="clue-audio-error" role="status">
          {error}
        </p>
      )}
      {!compact && (
        <small className="clue-audio-note">
          AI演绎 · 含配乐；配音不构成额外证言，以文字记录为准。
        </small>
      )}
      {!available && !playing && !loading && (
        <small className="clue-audio-unavailable">
          对准二维码显示模型后，可点击聆听
        </small>
      )}
      {(credits.length > 0 || track.speakers?.length > 0) && (
        <details className="clue-audio-credits">
          <summary>配乐与音色署名</summary>
          {compact && (
            <small className="clue-audio-note">
              AI演绎 · 含配乐；配音不构成额外证言，以文字记录为准。
            </small>
          )}
          {track.speakers?.length > 0 && (
            <p>
              角色音色：
              {track.speakers
                .map((speaker) =>
                  typeof speaker === "string"
                    ? speaker
                    : speaker.name || speaker.role || speaker.voice_id,
                )
                .join("、")}
            </p>
          )}
          {credits.map((credit, index) => (
            <p key={index}>
              <Credit credit={credit} />
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
