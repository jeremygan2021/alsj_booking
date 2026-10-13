import React, { useEffect, useId, useRef, useState } from "react";
import { Box, Crosshair, Maximize2, RotateCcw, ScanLine } from "lucide-react";
import { Badge, Button, Modal } from "./ui";
import InvestigationAudio, {
  useInvestigationAudio,
} from "./InvestigationAudio";
import "./immersive.css";
import "./evidence-investigation.css";

const EvidenceSpatialScene = React.lazy(() => import("./EvidenceSpatialScene"));

let viewerImport;
function loadViewer() {
  if (!viewerImport) {
    viewerImport = import("@google/model-viewer").catch((error) => {
      viewerImport = undefined;
      throw error;
    });
  }
  return viewerImport;
}

export function useXrSupport(mode, enabled = true) {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setSupported(false);
      return;
    }
    let active = true;
    const check = () => {
      if (!window.isSecureContext || !navigator.xr) {
        setSupported(false);
        return;
      }
      navigator.xr.isSessionSupported(mode).then(
        (value) => active && setSupported(value),
        () => active && setSupported(false),
      );
    };
    check();
    navigator.xr?.addEventListener("devicechange", check);
    return () => {
      active = false;
      navigator.xr?.removeEventListener("devicechange", check);
    };
  }, [mode, enabled]);
  return supported;
}

// Both entry dialogs use the same viewer without nesting dialogs in the gallery.
export function EvidenceModelStage({
  clue,
  mode = "ar",
  publicView = false,
  sceneHeadingRef,
  onInvestigate,
  sceneAudioControls,
}) {
  const viewer = useRef(null);
  const stage = useRef(null);
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [arError, setArError] = useState("");
  const [arActive, setArActive] = useState(false);
  const [arReady, setArReady] = useState(false);
  const [spatialOpen, setSpatialOpen] = useState(false);
  const [scanSerial, setScanSerial] = useState(0);
  const [examining, setExamining] = useState(false);
  const [retry, setRetry] = useState(0);
  const [autoRotate, setAutoRotate] = useState(false);
  const [zoom, setZoom] = useState(30);
  const xrSupported = useXrSupport(
    "immersive-ar",
    mode === "ar" && !publicView,
  );
  const hintId = useId();
  const source = clue?.model_url;

  useEffect(() => {
    let active = true;
    setReady(false);
    setLoaded(false);
    setError("");
    setArError("");
    setArActive(false);
    setArReady(false);
    setSpatialOpen(false);
    setExamining(false);
    setAutoRotate(false);
    setZoom(30);
    loadViewer().then(
      () => active && setReady(true),
      () => active && setError("3D 查看器加载失败，请检查网络后重试。"),
    );
    return () => {
      active = false;
    };
  }, [source, retry, publicView, mode]);

  useEffect(() => {
    const element = viewer.current;
    if (!ready || !element || !source) return;
    const onLoad = () => {
      setLoaded(true);
      setError("");
      setArReady(element.canActivateAR);
    };
    const onError = () => {
      setLoaded(false);
      setError(
        publicView
          ? "证物模型暂时无法打开，请检查网络后重试。下方的线索文字仍可查看。"
          : "模型暂时无法打开。请确认仍已登录、这条线索已解锁，然后重试。您仍可阅读证据文字。 ",
      );
    };
    const onArStatus = (event) => {
      const status = event.detail?.status;
      setArActive(status === "session-started" || status === "object-placed");
      if (status === "failed") {
        setArError("暂时无法放置证物，请允许相机访问，也可继续拖动查看。");
      }
    };
    element.addEventListener("load", onLoad);
    element.addEventListener("error", onError);
    element.addEventListener("ar-status", onArStatus);
    if (element.loaded) onLoad();
    return () => {
      element.removeEventListener("load", onLoad);
      element.removeEventListener("error", onError);
      element.removeEventListener("ar-status", onArStatus);
    };
  }, [ready, source, retry, publicView]);

  useEffect(() => {
    if (!loaded || mode !== "ar" || (!publicView && !xrSupported)) return;
    // canActivateAR covers the library's selected WebXR or native AR mode.
    // Native viewers do not depend on navigator.xr. Keep checking on return
    // from a native app because the library may have changed its fallback mode.
    let active = true;
    let timer;
    const check = () => {
      if (!active) return;
      setArReady(Boolean(viewer.current?.canActivateAR));
      if (!document.hidden) timer = setTimeout(check, 500);
    };
    const refresh = () => {
      clearTimeout(timer);
      check();
    };
    check();
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("pageshow", refresh);
    navigator.xr?.addEventListener("devicechange", refresh);
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("pageshow", refresh);
      navigator.xr?.removeEventListener("devicechange", refresh);
    };
  }, [loaded, xrSupported, publicView, mode, source, retry]);

  async function activateAr() {
    onInvestigate?.();
    const element = viewer.current;
    if (!element?.canActivateAR || (!publicView && !xrSupported)) {
      setArReady(false);
      return;
    }
    setArError("");
    try {
      // Call before any await: native AR viewers require the click gesture.
      await element.activateAR();
    } catch {
      if (viewer.current === element)
        setArError("暂时无法放置证物，请允许相机访问，也可在上方拖动查看。");
    }
  }
  useEffect(() => {
    if (!examining) return;
    const timeout = setTimeout(() => setExamining(false), 1800);
    return () => clearTimeout(timeout);
  }, [examining, scanSerial]);
  function examine() {
    onInvestigate?.();
    setScanSerial((value) => value + 1);
    setExamining(true);
  }
  function reset() {
    if (!viewer.current) return;
    viewer.current.cameraOrbit = "0deg 65deg auto";
    viewer.current.cameraTarget = "auto auto auto";
    viewer.current.fieldOfView = "30deg";
    viewer.current.resetTurntableRotation();
    viewer.current.jumpCameraToGoal();
    setZoom(30);
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stage.current?.requestFullscreen();
    } catch {
      setArError("此浏览器暂不支持全屏；仍可直接缩放与旋转模型。");
    }
  }
  const canAr =
    mode === "ar" && (publicView || xrSupported) && arReady && loaded && !error;

  return (
    <section
      className={`evidence-model${mode === "ar" ? " evidence-investigation" : ""}`}
      aria-label="证物 360 度查看器"
      data-testid="evidence-model-stage"
    >
      <div className="evidence-model-meta">
        <Badge tone="gold">
          <Box size={14} /> {clue?.model_label?.split(" · ")[0] || "证物"}
        </Badge>
        <span>360°查看</span>
      </div>
      <div
        className="evidence-model-canvas"
        ref={stage}
        data-loaded={loaded ? "true" : "false"}
        data-examining={examining ? "true" : "false"}
      >
        {mode === "ar" && (
          <>
            <div className="evidence-scene-grid" aria-hidden="true" />
            <div className="evidence-scene-heading">
              <span className="evidence-scene-kicker">
                EVIDENCE / {clue?.id}
              </span>
              <h2 tabIndex={-1} ref={sceneHeadingRef}>
                {clue?.title}
              </h2>
              <span className="evidence-scene-subtitle">
                环绕证物，寻找细节
              </span>
            </div>
            <div className="evidence-scene-orbit" aria-hidden="true">
              <span />
              <span />
            </div>
            <div className="evidence-scene-corners" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="evidence-scene-trace" aria-hidden="true">
              <span />
              {clue?.model_label?.split(" · ")[0] || "现场证物"}
            </div>
            {examining && (
              <div
                key={scanSerial}
                className="evidence-scan-beam"
                aria-hidden="true"
              />
            )}
            {loaded && (
              <span className="evidence-scene-marker" aria-hidden="true">
                <Crosshair size={16} /> {clue?.id}
              </span>
            )}
          </>
        )}
        {source && ready && (
          <model-viewer
            key={`${source}:${retry}:${publicView ? "public" : "private"}:${mode}`}
            ref={viewer}
            src={source}
            alt={`${clue?.title || "物证"}的剧情示例模型。拖动旋转，双指或滚轮缩放。`}
            camera-controls=""
            touch-action="pan-y"
            camera-orbit={
              mode === "ar" ? "-20deg 60deg auto" : "0deg 65deg auto"
            }
            field-of-view={`${zoom}deg`}
            min-field-of-view="15deg"
            max-field-of-view="60deg"
            auto-rotate={autoRotate ? "" : undefined}
            rotation-per-second="18deg"
            shadow-intensity="0.7"
            exposure="1"
            environment-image="neutral"
            with-credentials={publicView ? undefined : ""}
            loading="eager"
            reveal="auto"
            ar={mode === "ar"}
            ar-modes={publicView ? "webxr scene-viewer quick-look" : "webxr"}
            ar-placement="floor"
            ar-scale="auto"
            interaction-prompt="none"
            aria-describedby={hintId}
            data-testid="evidence-model"
          >
            {/* An empty custom slot suppresses the library's automatic AR button. */}
            <span slot="ar-button" hidden />
          </model-viewer>
        )}
        {!source ? (
          <div className="evidence-model-message">
            <Box size={32} />
            <p>这条证据暂未配置模型。</p>
          </div>
        ) : error ? (
          <div className="evidence-model-message" role="alert">
            <p>{error}</p>
            <Button onClick={() => setRetry((value) => value + 1)}>
              重新加载模型
            </Button>
          </div>
        ) : !loaded ? (
          <div
            className="evidence-model-message"
            role="status"
            aria-live="polite"
          >
            <span className="model-loading-ring" />
            <p>正在打开物证模型…</p>
          </div>
        ) : (
          <span
            className="model-loaded-status"
            role="status"
            data-testid="model-loaded"
          >
            模型已加载 · 可旋转查看
          </span>
        )}
      </div>
      <div className="evidence-model-primary">
        {mode === "ar" && (
          <Button
            disabled={!loaded || Boolean(error)}
            data-testid="enter-spatial-scene"
            onClick={() => {
              onInvestigate?.();
              setSpatialOpen(true);
            }}
          >
            <Crosshair size={18} /> 沉浸搜证
          </Button>
        )}
        {mode === "ar" && (
          <Button disabled={!canAr || arActive} onClick={activateAr}>
            <ScanLine size={18} />
            {arActive ? "正在现实中查看" : "放到现实中"}
          </Button>
        )}
        <Button
          kind="ghost"
          disabled={!loaded || Boolean(error)}
          onClick={reset}
        >
          重置
        </Button>
      </div>
      {mode === "ar" && (
        <p className="evidence-model-hint">
          沉浸搜证可查看空间文字与扫描特效；支持AR的手机可将证物放进现实。
        </p>
      )}
      <details className="model-options" data-testid="model-detail-options">
        <summary>查看细节</summary>
        {mode === "ar" && (
          <Button
            kind="ghost"
            disabled={!loaded || Boolean(error) || examining}
            onClick={examine}
            data-testid="evidence-scan"
          >
            <Crosshair size={16} />
            {examining ? "正在扫描观察…" : "扫描观察"}
          </Button>
        )}
        <p className="evidence-model-hint" id={hintId}>
          拖动环绕观察，双指或滚轮缩放；键盘聚焦后可用方向键旋转。
        </p>
        <div className="evidence-model-controls">
          <Button
            kind="ghost"
            disabled={!loaded || Boolean(error)}
            aria-pressed={autoRotate}
            onClick={() => setAutoRotate(!autoRotate)}
          >
            <RotateCcw size={16} />
            {autoRotate ? "暂停旋转" : "自动旋转"}
          </Button>
          {typeof document !== "undefined" && document.fullscreenEnabled && (
            <Button kind="ghost" onClick={fullscreen}>
              <Maximize2 size={16} />
              全屏
            </Button>
          )}
          <label className="model-zoom">
            缩放
            <input
              type="range"
              aria-label="模型缩放（左侧放大）"
              min="15"
              max="60"
              value={zoom}
              disabled={!loaded || Boolean(error)}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
          </label>
        </div>
        <small className="model-example-note">
          模型用于观察物件，线索内容以证据文字为准。
        </small>
      </details>
      {arError && (
        <p role="alert" className="model-error">
          {arError}
        </p>
      )}
      {spatialOpen && (
        <React.Suspense
          fallback={
            <div className="spatial-scene-loading" role="status">
              正在开启搜证场景…
              <Button kind="ghost" onClick={() => setSpatialOpen(false)}>
                返回
              </Button>
            </div>
          }
        >
          <EvidenceSpatialScene
            clue={clue}
            onClose={() => setSpatialOpen(false)}
            preferAR
            audioControls={sceneAudioControls}
          />
        </React.Suspense>
      )}
    </section>
  );
}

export default function EvidenceModelViewer({ clue, onClose, mode = "ar" }) {
  const audio = useInvestigationAudio();
  return (
    <Modal
      title={`${mode === "ar" ? "AR 搜证" : "360°物证"} · ${clue?.id || ""}`}
      onClose={onClose}
      wide
    >
      {mode === "ar" && (
        <div className="evidence-music-toolbar">
          <InvestigationAudio audio={audio} />
        </div>
      )}
      <EvidenceModelStage
        clue={clue}
        mode={mode}
        onInvestigate={mode === "ar" ? audio.playFromGesture : undefined}
        sceneAudioControls={
          mode === "ar" ? <InvestigationAudio audio={audio} /> : undefined
        }
      />
      <div className="model-evidence-copy">
        <h3>{mode === "ar" ? "现场记录" : clue?.title}</h3>
        <p>{clue?.body}</p>
        {clue?.detail && (
          <div className="advanced">
            <p>{clue.detail}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
