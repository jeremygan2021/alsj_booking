import React, { useEffect, useRef, useState } from "react";
import { Headphones, Square, Download, RefreshCw } from "lucide-react";
import { api } from "../api";
import "./performance-audio.css";

const clock = (value) => {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export default function PerformanceAudio() {
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState("");
  const [filter, setFilter] = useState("all");
  const media = useRef(new Map());
  const load = async () => {
    setError("");
    try {
      setCatalog(await api("/staff/performance-audio"));
    } catch (failure) {
      setError(failure.message || "播放清单加载失败");
    }
  };
  const stop = () => {
    media.current.forEach((audio) => audio.pause());
    setActive("");
  };
  useEffect(() => {
    void load();
    const elements = media.current;
    const pause = () => elements.forEach((audio) => audio.pause());
    window.addEventListener("pagehide", pause);
    return () => {
      window.removeEventListener("pagehide", pause);
      elements.forEach((audio) => {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      });
      elements.clear();
    };
  }, []);
  if (!catalog)
    return (
      <section className="panel" role="status">
        {error || "正在加载现场演绎音频…"}
        {error && <button type="button" onClick={load}>重试加载</button>}
      </section>
    );
  const stages = [...new Set(catalog.tracks.map((track) => track.stage))];
  const visible = catalog.tracks.filter((track) => filter === "all" || track.stage === filter);
  const card = (track) => (
    <article className="panel performance-track" key={track.id}>
      <div className="performance-title">
        <span className="eyebrow">{track.id} · {track.stage}</span>
        <span>{clock(track.duration)}</span>
      </div>
      <h3>{track.title}</h3>
      <p><strong>播放时机：</strong>{track.trigger}</p>
      {track.notes && <p className="muted">{Array.isArray(track.notes) ? track.notes.join("；") : track.notes}</p>}
      <audio
        controls
        preload="none"
        src={track.url}
        aria-label={`${track.id} ${track.title}`}
        ref={(audio) => { if (audio) media.current.set(track.id, audio); }}
        onPlay={() => {
          media.current.forEach((audio, id) => { if (id !== track.id) audio.pause(); });
          setActive(track.id);
        }}
        onPause={() => setActive((id) => id === track.id ? "" : id)}
        onError={() => setError(`${track.id} 音频加载失败，请检查网络后重试。`)}
      />
      <div className="performance-links">
        <span>MiniMax 固定角色音色 · 已混配乐</span>
        <a href={track.url} download={`${track.id}.mp3`}><Download size={14} /> 下载 MP3</a>
      </div>
      {track.events?.length > 0 && (
        <details>
          <summary>舞台动作与声音提示</summary>
          <ol className="performance-cues">
            {track.events.map((cue, index) => (
              <li key={index}><span>{clock(cue.time)}</span> <strong>{cue.role || ({ spotlight: "追光", entrance: "登场", cash: "撒钱", money: "撒钱", sound: "音效", blackout: "熄灯" }[cue.cue]) || cue.cue}</strong> · {cue.instruction}</li>
            ))}
          </ol>
        </details>
      )}
    </article>
  );
  const ordinary = visible.filter((track) => !track.spoiler);
  const ending = visible.filter((track) => track.spoiler);
  return (
    <section className="performance-audio">
      <div className="panel performance-toolbar">
        <div>
          <span className="eyebrow"><Headphones size={16} /> LIVE PERFORMANCE</span>
          <h2>现场演绎播放台</h2>
          <p>{catalog.tracks.length}段 · 共{clock(catalog.totalDuration)} · 更新交付包 {catalog.version}</p>
          <p className="muted">先连接现场音响，使用各段播放器开始播放。播放新段落会暂停上一段；每段已包含背景音乐与音效。</p>
        </div>
        <button type="button" className="btn ghost" onClick={stop}><Square size={15} /> 全部暂停</button>
        <label>筛选环节
          <select value={filter} onChange={(event) => { stop(); setFilter(event.target.value); }}>
            <option value="all">全部环节</option>
            {stages.map((stage) => <option key={stage}>{stage}</option>)}
          </select>
        </label>
        <div role="status">{active ? `正在播放 ${active}` : "待播放"}</div>
      </div>
      {error && <p className="notice" role="alert">{error} <button type="button" onClick={() => { media.current.forEach((audio) => audio.load()); setError(""); }}><RefreshCw size={14} /> 重试音频</button></p>}
      <div className="performance-grid">{ordinary.map(card)}</div>
      {ending.length > 0 && (
        <details className="panel performance-spoilers" onToggle={(event) => { if (!event.currentTarget.open) stop(); }}>
          <summary>终局剧透音频 · 行凶重建、遗言与结尾（{ending.length}段）</summary>
          <p className="notice">仅在终局揭晓或工作人员排练时播放。21:07 的声音与真实行凶时刻不同，请按照播放时机执行。</p>
          <div className="performance-grid">{ending.map(card)}</div>
        </details>
      )}
      <details className="panel performance-credits">
        <summary>固定角色音色与配乐授权</summary>
        <p>AI 演绎 · {catalog.provider} {catalog.model}。同一人物在真人台词、ECHO 演示与遗言中使用同一音色。</p>
        <ul>{catalog.voices.map((voice) => <li key={voice.role}><strong>{voice.role}</strong> · {voice.label} <small>{voice.voiceId}</small><p>{voice.direction}</p></li>)}</ul>
        {(catalog.credits || []).map((credit, index) => <p key={index}>{credit.title} · {credit.artist} <a href={credit.source} target="_blank" rel="noreferrer">来源</a> · <a href={credit.license} target="_blank" rel="noreferrer">CC BY 4.0</a> {credit.changes}</p>)}
        {catalog.soundEffects && <p>音效：{catalog.soundEffects.artist} · <a href={catalog.soundEffects.source} target="_blank" rel="noreferrer">来源</a> · <a href={catalog.soundEffects.license} target="_blank" rel="noreferrer">CC0</a></p>}
      </details>
    </section>
  );
}
