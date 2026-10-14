import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Box,
  Crosshair,
  MapPin,
  RefreshCw,
  ScanLine,
} from "lucide-react";
import { api } from "../api";
import { parseClueCode, parseInvestigationNode } from "../clue-scan";
import { Button } from "../components/ui";
import ClueImageReader from "../components/ClueImageReader";
import QrTrackingScene, {
  requestQrFullscreen,
} from "../features/ar/QrTrackingScene";
import { EvidenceModelStage } from "../components/EvidenceModelViewer";
import InvestigationAudio, {
  useInvestigationAudio,
} from "../components/InvestigationAudio";
import "./public-ar.css";

export default function PublicAR() {
  const audio = useInvestigationAudio();
  const discoveryAudio = useRef(audio.playDiscovery);
  discoveryAudio.current = audio.playDiscovery;
  const [scanning, setScanning] = useState(
    () =>
      new URLSearchParams(location.search).get("node") === "AR-INV" &&
      new URLSearchParams(location.search).get("camera") === "1",
  );
  const [scanClueId, setScanClueId] = useState(() =>
    new URLSearchParams(location.search).get("node") === "AR-INV"
      ? "AR-INV"
      : undefined,
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const [state, setState] = useState({
    clue: null,
    busy: false,
    error: "",
    id: "",
  });
  const requestVersion = useRef(0);
  const resultHeading = useRef(null);
  const manualInput = useRef(null);
  const loadClue = useCallback(async (id) => {
    const version = ++requestVersion.current;
    setPreviewOpen(false);
    setState({ clue: null, busy: true, error: "", id });
    const params = new URLSearchParams(location.search);
    const node = /^AR-/.test(id);
    params.delete(node ? "clue" : "node");
    params.set(node ? "node" : "clue", id);
    history.replaceState({}, "", `/ar?${params}`);
    try {
      const clue = await api(
        `/ar/${node ? "nodes" : "clues"}/${encodeURIComponent(id)}`,
      );
      if (version !== requestVersion.current) return;
      setState({ clue, busy: false, error: "", id });
    } catch (error) {
      if (version !== requestVersion.current) return;
      setState({
        clue: null,
        busy: false,
        error: error.message || "暂时无法查看线索，请重试。",
        id,
      });
    }
  }, []);
  useEffect(() => {
    const readLink = () => {
      if (!["/ar", "/ar/"].includes(location.pathname)) {
        requestVersion.current++;
        return;
      }
      const query = new URLSearchParams(location.search);
      const raw = query.get("node") || query.get("clue");
      if (!raw) {
        requestVersion.current++;
        setState({ clue: null, busy: false, error: "", id: "" });
        return;
      }
      const id =
        parseInvestigationNode(raw, location.origin) ||
        parseClueCode(raw, location.origin);
      if (!id) {
        requestVersion.current++;
        setState({
          clue: null,
          busy: false,
          error: "线索编号无效，请扫描现场二维码，或输入如E-01的编号。",
          id: "",
        });
        return;
      }
      loadClue(id);
    };
    readLink();
    window.addEventListener("popstate", readLink);
    return () => {
      requestVersion.current++;
      window.removeEventListener("popstate", readLink);
    };
  }, [loadClue]);
  useEffect(() => {
    if (state.clue) {
      if (!scanning) resultHeading.current?.focus({ preventScroll: true });
      discoveryAudio.current?.();
    }
  }, [state.clue]);
  const startScanning = () => {
    requestQrFullscreen();
    audio.playFromGesture();
    setPreviewOpen(false);
    setScanClueId(state.clue?.id);
    setScanning(true);
  };
  const detected = (raw) => {
    const id =
      parseInvestigationNode(raw, location.origin) ||
      parseClueCode(raw, location.origin);
    if (!id) throw new Error("这不是本活动的线索码，请扫描现场二维码。");
    audio.playFromGesture();
    return loadClue(id);
  };
  const cancel = () => {
    requestVersion.current++;
    setState({ clue: null, busy: false, error: "", id: "" });
    history.replaceState({}, "", "/ar");
  };
  return (
    <main className="public-ar-page">
      <header className="public-ar-title">
        <div>
          <span className="eyebrow">ALASKA NIGHTS / FIELD INVESTIGATION</span>
          <div className="public-ar-mission-name">
            <h1>AR搜证</h1>
            <span>追踪被藏起的真相</span>
          </div>
        </div>
        <InvestigationAudio audio={audio} />
      </header>
      <section
        className={`public-ar-start${state.clue ? " public-ar-start-ready" : ""}`}
        aria-label="开始现场搜证"
      >
        <div className="public-ar-start-grid" aria-hidden="true" />
        {!state.clue && (
          <div className="public-ar-scan-symbol" aria-hidden="true">
            <span className="public-ar-orbit public-ar-orbit-one" />
            <span className="public-ar-orbit public-ar-orbit-two" />
            <span className="public-ar-target-mark">
              <Crosshair size={54} strokeWidth={1} />
            </span>
            <span className="public-ar-symbol-beam" />
          </div>
        )}
        <span className="public-ar-scene-kicker">把镜头对准现场二维码</span>
        <h2>{state.clue ? "回到现场，继续搜证" : "证物，就在眼前。"}</h2>
        <p>
          开启全屏相机，证物会跟随二维码的位置、方向和大小。
          墙面证物贴在二维码所在墙面，保持二维码在画面内即可观察。
        </p>
        <Button
          data-testid="public-ar-scan"
          kind="full"
          onClick={startScanning}
        >
          <ScanLine size={21} /> 开启相机搜证 <ArrowRight size={18} />
        </Button>
        <small>无需登录。相机画面在你的设备上识别，不上传。</small>
        {!state.clue && (
          <div className="public-ar-investigation-steps" aria-label="搜证步骤">
            <span>
              <b>01</b> 开启相机
            </span>
            <span>
              <b>02</b> 对准二维码
            </span>
            <span>
              <b>03</b> 观察证物
            </span>
          </div>
        )}
      </section>
      {state.busy && (
        <div className="public-ar-status" role="status">
          <p>正在查找{state.id}的线索…</p>
          <Button kind="ghost compact" onClick={cancel}>
            取消查看
          </Button>
        </div>
      )}
      {state.error && (
        <div className="public-ar-error" role="alert">
          <p>{state.error}</p>
          {state.id && (
            <Button kind="ghost compact" onClick={() => loadClue(state.id)}>
              <RefreshCw size={16} /> 重新查看
            </Button>
          )}
        </div>
      )}
      {state.clue ? (
        <section
          className="public-ar-result"
          aria-label="现场线索"
          data-testid="public-ar-clue"
        >
          <div className="public-ar-result-heading">
            <span className="public-ar-location">
              <MapPin size={14} />
              {state.clue.area || "庄园现场"}
              <span> / {state.clue.id}</span>
            </span>
            <span className="public-ar-access">现场记录</span>
          </div>
          <h2
            className="public-ar-clue-title"
            tabIndex={-1}
            ref={resultHeading}
          >
            {state.clue.title}
          </h2>
          {!state.clue.model_url && (
            <div className="public-ar-model-note" role="status">
              <Box size={25} />
              <div>
                <strong>这件证物暂未提供AR模型</strong>
                <p>可以继续阅读线索文字，或向现场GM询问。</p>
              </div>
            </div>
          )}
          <article className="public-ar-clue-copy">
            <div className="public-ar-copy-label">
              <span className="public-ar-evidence-number">{state.clue.id}</span>
              <h3>现场记录</h3>
              <span>线索内容</span>
            </div>
            <p>{state.clue.body}</p>
            {state.clue.presentation === "invitation" && (
              <>
                <strong>
                  {state.clue.invitation_valid ? "邀请有效" : "活动邀请已结束"}
                </strong>
                <img
                  src={state.clue.poster_url}
                  alt="阿拉斯加之夜：最后的遗嘱活动海报"
                  style={{
                    display: "block",
                    width: "100%",
                    maxWidth: 480,
                    margin: "20px auto",
                    borderRadius: 12,
                  }}
                />
              </>
            )}
          </article>
          <p className="public-ar-copy-note">
            线索以文字内容为准，现场玩法与判定请听从GM指引。
          </p>
          {state.clue.presentation === "invitation" && (
            <Button
              kind="full"
              disabled={!state.clue.invitation_valid}
              onClick={() => location.assign("/play?invite=AR-INV&auth=invite")}
            >
              接受邀请 · 注册／登录 <ArrowRight size={18} />
            </Button>
          )}
          {state.clue.model_url && state.clue.presentation !== "invitation" && (
            <details
              className="public-ar-manual public-ar-preview"
              data-testid="public-ar-preview"
              open={previewOpen}
              onToggle={(event) => setPreviewOpen(event.currentTarget.open)}
            >
              <summary>360°预览与沉浸观察</summary>
              {previewOpen && (
                <EvidenceModelStage
                  key={state.clue.id}
                  clue={state.clue}
                  publicView
                  onInvestigate={audio.playFromGesture}
                  sceneAudioControls={<InvestigationAudio audio={audio} />}
                />
              )}
            </details>
          )}
        </section>
      ) : null}
      <details className="public-ar-manual">
        <summary>无法开启相机？从图片或编号阅读线索</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const raw = new FormData(event.currentTarget).get("clue");
            const id =
              parseInvestigationNode(raw, location.origin) ||
              parseClueCode(raw, location.origin);
            if (!id) {
              setState((old) => ({
                ...old,
                error: "请输入如E-01、AR-01的编号，或本活动的现场链接。",
              }));
              manualInput.current?.focus();
              return;
            }
            audio.playFromGesture();
            loadClue(id);
          }}
        >
          <label>
            <span>线索编号或现场链接</span>
            <input
              ref={manualInput}
              name="clue"
              aria-label="线索编号或现场链接"
              placeholder="例如：E-01 或 AR-01"
              required
              maxLength={2048}
              disabled={state.busy}
            />
          </label>
          <Button type="submit" kind="ghost" disabled={state.busy}>
            查看线索
          </Button>
        </form>
        <ClueImageReader onDetected={detected} disabled={state.busy} />
      </details>
      {scanning && (
        <QrTrackingScene
          initialClueId={scanClueId}
          onClue={loadClue}
          onClose={() => setScanning(false)}
        />
      )}
    </main>
  );
}
