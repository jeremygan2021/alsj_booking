import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Camera,
  Box,
  ScanLine,
  X,
  CheckCircle2,
  FileText,
  Download,
  Lock,
} from "lucide-react";
import { api } from "../api";
import "../features/ar/ar.css";
import EvidenceViewer from "../features/ar/EvidenceViewer";

export default function ArPage({ session, onLogin }) {
  const sceneId = location.pathname.split("/")[2] || "demo";
  const demo = sceneId === "demo";
  const host = useRef(null),
    runtime = useRef(null),
    request = useRef(null),
    collecting = useRef(false),
    alive = useRef(true);
  const [manifest, setManifest] = useState(null),
    [loadError, setLoadError] = useState(""),
    [mode, setMode] = useState(null),
    [status, setStatus] = useState("idle"),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(null),
    [collected, setCollected] = useState({}),
    [busy, setBusy] = useState(false);
  const collectedRef = useRef(collected);
  collectedRef.current = collected;
  const stop = () => {
    request.current?.abort();
    request.current = null;
    runtime.current?.stop();
    runtime.current = null;
    setMode(null);
    setStatus("idle");
  };
  useEffect(() => {
    let current = true;
    if (!demo) {
      stop();
      setCollected({});
      setSelected(null);
    }
    setManifest(null);
    setLoadError("");
    if (!demo && session?.role !== "player") return;
    api(demo ? "/ar/demo" : `/ar/scenes/${encodeURIComponent(sceneId)}`)
      .then((data) => {
        if (current) setManifest(data);
      })
      .catch((failure) => {
        if (current) setLoadError(failure.message);
      });
    return () => {
      current = false;
    };
  }, [sceneId, demo, session?.role, session?.id]);
  useEffect(() => {
    alive.current = true;
    const pause = () => {
      if (document.hidden) stop();
    };
    const leave = () => stop();
    document.addEventListener("visibilitychange", pause);
    window.addEventListener("pagehide", leave);
    return () => {
      alive.current = false;
      request.current?.abort();
      runtime.current?.stop();
      document.removeEventListener("visibilitychange", pause);
      window.removeEventListener("pagehide", leave);
    };
  }, []);
  const pick = async (id, preview) => {
    if (collecting.current) return;
    if (collectedRef.current[id]) {
      setSelected(collectedRef.current[id]);
      return;
    }
    if (!demo && preview) {
      setError("正式搜证请开启摄像头，对准现场定位海报后点击热点。");
      return;
    }
    collecting.current = true;
    setBusy(true);
    setError("");
    try {
      const evidence = demo
        ? manifest.hotspots.find((item) => item.id === id)
        : await api(
            `/ar/scenes/${encodeURIComponent(sceneId)}/hotspots/${encodeURIComponent(id)}/collect`,
            {},
          );
      if (!alive.current) return;
      const opened = await runtime.current?.openEvidence(id);
      if (!alive.current || opened === false) return;
      const discovered = { ...evidence, hotspotId: id };
      setCollected((previous) => ({ ...previous, [id]: discovered }));
      setSelected(discovered);
      runtime.current?.markCollected(id);
    } catch (failure) {
      if (alive.current) setError(failure.message);
    } finally {
      collecting.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const start = async (preview) => {
    stop();
    setError("");
    setSelected(null);
    setStatus("loading");
    setMode(preview ? "preview" : "camera");
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => {
      if (request.current !== controller) return;
      stop();
      setError("加载超时，请检查网络后重试，或先查看 3D 预览。");
    }, 30000);
    try {
      const { createArRuntime } = await import("../features/ar/runtime.js");
      if (controller.signal.aborted) return;
      const instance = await createArRuntime({
        container: host.current,
        manifest,
        preview,
        signal: controller.signal,
        onTracking: (found) => {
          if (!controller.signal.aborted)
            setStatus(found ? "tracking" : "searching");
        },
        onPick: (id) => pick(id, preview),
      });
      if (controller.signal.aborted) {
        instance.stop();
        return;
      }
      runtime.current = instance;
      for (const id of Object.keys(collected)) instance.markCollected(id);
      if (!preview)
        setStatus((previous) =>
          previous === "tracking" ? previous : "searching",
        );
    } catch (failure) {
      if (controller.signal.aborted) return;
      stop();
      setError(
        failure.name === "NotAllowedError"
          ? "相机权限未开启。请在浏览器设置中允许摄像头后重试，也可先查看 3D 预览。"
          : failure.message ||
              "相机无法启动，请使用 Safari 或 Chrome 并检查权限。",
      );
    } finally {
      clearTimeout(timeout);
    }
  };
  const active = Boolean(mode);
  return (
    <main className={"ar-page " + (active ? "is-active" : "")}>
      <div
        className="ar-stage"
        ref={host}
        aria-label={mode === "preview" ? "可旋转的3D证物柜" : "AR相机画面"}
      />
      <header className="ar-header">
        <a className="ar-round" href="/play" aria-label="返回我的档案">
          <ArrowLeft size={20} />
        </a>
        <div>
          <span className="ar-kicker">ALASKA NIGHTS / FIELD INVESTIGATION</span>
          <strong>现场 3D 搜证</strong>
        </div>
        {active && (
          <button
            className="ar-round"
            onClick={stop}
            aria-label="关闭相机或预览"
          >
            <X size={20} />
          </button>
        )}
      </header>
      {!active ? (
        <section className="ar-intro">
          <span className="ar-kicker">
            {demo ? "公开体验 · 不计入剧情" : "第三幕 · 正式搜证"}
          </span>
          <h1>
            秘密，藏在
            <br />
            <em>另一层现实。</em>
          </h1>
          <p>
            对准墙面定位海报，发现立体证物柜。移动手机观察细节，触碰金色热点搜集线索。
          </p>
          <div className="ar-instructions">
            <span>
              <ScanLine size={19} /> 对准整张海报
            </span>
            <span>
              <Box size={19} /> 靠近观察证物
            </span>
            <span>
              <FileText size={19} /> 点击金色热点
            </span>
          </div>
          {!demo && session?.role !== "player" ? (
            <div className="ar-access">
              <Lock size={22} />
              <p>正式证据需要玩家登录、现场签到和角色审批。</p>
              <button className="ar-primary" onClick={onLogin}>
                登录玩家账号
              </button>
            </div>
          ) : loadError ? (
            <div className="ar-access" role="alert">
              <p>{loadError}</p>
              <a href="/play">返回档案检查资格</a>
            </div>
          ) : !manifest ? (
            <p role="status">正在准备搜证场景…</p>
          ) : (
            <div className="ar-start-actions">
              <button className="ar-primary" onClick={() => start(false)}>
                <Camera size={19} /> 开启摄像头搜证
              </button>
              <button className="ar-secondary" onClick={() => start(true)}>
                <Box size={18} /> 先查看 3D 预览
              </button>
            </div>
          )}
          <div className="ar-target-card">
            <img
              src="/ar-assets/targets/study-wall.png"
              alt="墙面搜证定位海报缩略图"
            />
            <div>
              <strong>准备你的定位海报</strong>
              <p>在另一块屏幕展示，或按整图宽 18 cm 打印并平整贴墙。</p>
              <a href="/ar/target" target="_blank" rel="noreferrer">
                <Download size={16} /> 打开打印海报
              </a>
            </div>
          </div>
          <p className="ar-limit">
            海报离开镜头后会暂停显示，重新对准即可恢复。体验证物只在本次页面中保存。
          </p>
          <a
            className="ar-mode-link"
            href={demo ? "/ar/wall-study" : "/ar/demo"}
          >
            {demo ? "已签到？进入正式搜证 →" : "先进入公开体验 →"}
          </a>
        </section>
      ) : (
        <>
          <div
            className={"ar-tracking " + (status === "tracking" ? "found" : "")}
            role="status"
          >
            <span />
            {status === "loading"
              ? "正在加载模型与定位引擎…"
              : mode === "preview"
                ? "3D 预览 · 拖动旋转，轻触热点"
                : status === "tracking"
                  ? "已定位墙面 · 点击金色热点搜证"
                  : "请对准整张定位海报"}
          </div>
          {mode === "camera" && status !== "tracking" && (
            <div className="ar-reticle">
              <i />
              <i />
              <i />
              <i />
              <span>保持海报完整、清晰、无遮挡</span>
            </div>
          )}
          <section className="ar-bottom">
            <div>
              <span className="ar-kicker">
                {demo ? "体验证物" : "私人证据册"}
              </span>
              <strong>{manifest.title}</strong>
            </div>
            <span className="ar-count">
              {Object.keys(collected).length} / {manifest.hotspots.length}
            </span>
            <p>
              {busy
                ? "正在缓缓取出证物…"
                : "轻触模型上的金色圆环。已收录热点会变为绿色。"}
            </p>
            {Object.entries(collected).length > 0 && (
              <div className="ar-collected">
                {Object.entries(collected).map(([id, evidence]) => (
                  <button key={id} onClick={() => setSelected(evidence)}>
                    <CheckCircle2 size={14} />
                    {evidence.title}
                  </button>
                ))}
              </div>
            )}
          </section>
        </>
      )}
      {error && (
        <div className="ar-error" role="alert">
          {error}
          <button onClick={() => setError("")} aria-label="关闭提示">
            <X size={16} />
          </button>
        </div>
      )}
      {selected && (
        <div className="ar-evidence-overlay">
          <section
            className="ar-evidence"
            role="dialog"
            aria-modal="true"
            aria-label="发现的证物"
          >
            <button
              className="ar-round"
              autoFocus
              onClick={() => setSelected(null)}
              aria-label="继续搜证"
            >
              <X size={20} />
            </button>
            <span className="ar-kicker">
              {demo ? "体验发现 · 不计入正式证据册" : "已保存到私人证据册"}
            </span>
            <CheckCircle2 className="ar-evidence-icon" size={34} />
            <h2>{selected.title}</h2>
            <EvidenceViewer
              url={manifest.models[0].url}
              hotspotId={selected.hotspotId}
            />
            <p>{selected.body}</p>
            {selected.detail && <p>{selected.detail}</p>}
            <button className="ar-primary" onClick={() => setSelected(null)}>
              继续探索
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
