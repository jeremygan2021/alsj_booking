import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Music2, Pause, Play, Volume2 } from "lucide-react";
import {
  createInvestigationAudio,
  readInvestigationAudioPreference,
} from "../audio/investigation-audio";
import "./investigation-audio.css";

export function useInvestigationAudio() {
  const controllerRef = useRef(null);
  const [state, setState] = useState(() => ({
    ...readInvestigationAudioPreference(),
    playing: false,
    error: "",
  }));
  const controller = useCallback(() => {
    if (!controllerRef.current) {
      controllerRef.current = createInvestigationAudio({ onChange: setState });
    }
    return controllerRef.current;
  }, []);
  useEffect(() => {
    const audio = controller();
    setState(audio.getSnapshot());
    return () => {
      audio.dispose();
      if (controllerRef.current === audio) controllerRef.current = null;
    };
  }, [controller]);
  const playFromGesture = useCallback(
    () => controller().playFromGesture(),
    [controller],
  );
  const toggle = useCallback(() => controller().toggle(), [controller]);
  const setVolume = useCallback(
    (value) => controller().setVolume(value),
    [controller],
  );
  const playDiscovery = useCallback(
    () => controller().playDiscovery(),
    [controller],
  );
  const pause = useCallback(() => controller().pause(), [controller]);
  return { ...state, playFromGesture, toggle, setVolume, playDiscovery, pause };
}

export default function InvestigationAudio({ audio, className = "" }) {
  const [expanded, setExpanded] = useState(false);
  const volumeId = useId();
  const statusId = useId();
  return (
    <div
      className={`investigation-audio ${audio.playing ? "is-playing" : ""} ${className}`.trim()}
      data-testid="investigation-music"
      data-playing={audio.playing ? "true" : "false"}
    >
      <button
        className="investigation-audio-toggle"
        type="button"
        onClick={audio.toggle}
        aria-label={audio.playing ? "暂停氛围音乐" : "播放氛围音乐"}
        aria-pressed={audio.playing}
        aria-describedby={audio.error ? statusId : undefined}
      >
        <span className="investigation-audio-symbol" aria-hidden="true">
          {audio.playing ? (
            <span className="investigation-audio-equalizer">
              <i />
              <i />
              <i />
              <i />
            </span>
          ) : (
            <Music2 size={15} strokeWidth={1.6} />
          )}
        </span>
        <span className="investigation-audio-label">庄园留声</span>
        <span className="investigation-audio-action" aria-hidden="true">
          {audio.playing ? (
            <Pause size={12} fill="currentColor" />
          ) : (
            <Play size={12} fill="currentColor" />
          )}
        </span>
      </button>
      <button
        className="investigation-audio-expand"
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-label={expanded ? "收起音乐音量" : "调整音乐音量"}
        aria-expanded={expanded}
        aria-controls={volumeId}
      >
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      <div
        className="investigation-audio-volume"
        id={volumeId}
        hidden={!expanded}
      >
        <Volume2 size={15} aria-hidden="true" />
        <label>
          <span className="investigation-audio-sr-only">氛围音乐音量</span>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={Math.round(audio.volume * 100)}
            onChange={(event) =>
              audio.setVolume(Number(event.target.value) / 100)
            }
            aria-label="氛围音乐音量"
            aria-valuetext={`${Math.round(audio.volume * 100)}%`}
          />
        </label>
        <span className="investigation-audio-percentage">
          {Math.round(audio.volume * 100)}%
        </span>
      </div>
      {audio.error && (
        <span className="investigation-audio-error" id={statusId} role="status">
          {audio.error}
        </span>
      )}
    </div>
  );
}
