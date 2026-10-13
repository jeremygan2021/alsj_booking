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
import { parseClueCode } from "../clue-scan";
import { Button } from "../components/ui";
import ClueScanner from "../components/ClueScanner";
import { EvidenceModelStage } from "../components/EvidenceModelViewer";
import InvestigationAudio, {
  useInvestigationAudio,
} from "../components/InvestigationAudio";
import "./public-ar.css";

export default function PublicAR() {
  const audio = useInvestigationAudio();
  const discoveryAudio = useRef(audio.playDiscovery);
  discoveryAudio.current = audio.playDiscovery;
  const [scanning, setScanning] = useState(false);
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
    setState({ clue: null, busy: true, error: "", id });
    const params = new URLSearchParams(location.search);
    params.set("clue", id);
    history.replaceState({}, "", `/ar?${params}`);
    try {
      const clue = await api(`/ar/clues/${encodeURIComponent(id)}`);
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
      const raw = new URLSearchParams(location.search).get("clue");
      if (!raw) {
        requestVersion.current++;
        setState({ clue: null, busy: false, error: "", id: "" });
        return;
      }
      const id = parseClueCode(raw, location.origin);
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
      resultHeading.current?.focus({ preventScroll: true });
      discoveryAudio.current?.();
    }
  }, [state.clue]);
  const startScanning = () => {
    audio.playFromGesture();
    setScanning(true);
  };
  const detected = (raw) => {
    const id = parseClueCode(raw, location.origin);
    if (!id) throw new Error("这不是本活动的线索码，请扫描现场二维码。");
    setScanning(false);
    loadClue(id);
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
            <Button kind="ghost compact" onClick={startScanning}>
              <ScanLine size={16} /> 继续扫描
            </Button>
          </div>
          {state.clue.model_url ? (
            <EvidenceModelStage
              clue={state.clue}
              publicView
              sceneHeadingRef={resultHeading}
              onInvestigate={audio.playFromGesture}
              sceneAudioControls={<InvestigationAudio audio={audio} />}
            />
          ) : (
            <div className="public-ar-model-note" role="status">
              <Box size={25} />
              <div>
                <h2 tabIndex={-1} ref={resultHeading}>
                  {state.clue.title}
                </h2>
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
          </article>
          <p className="public-ar-copy-note">
            线索以文字内容为准，现场玩法与判定请听从GM指引。
          </p>
        </section>
      ) : (
        <section className="public-ar-start" aria-label="开始现场搜证">
          <div className="public-ar-start-grid" aria-hidden="true" />
          <span className="public-ar-scene-coordinate" aria-hidden="true">
            AN / 31.10
            <br />
            EVIDENCE ARCHIVE
          </span>
          <div className="public-ar-scan-symbol" aria-hidden="true">
            <span className="public-ar-orbit public-ar-orbit-one" />
            <span className="public-ar-orbit public-ar-orbit-two" />
            <span className="public-ar-target-mark">
              <Crosshair size={54} strokeWidth={1} />
            </span>
            <span className="public-ar-symbol-beam" />
          </div>
          <span className="public-ar-scene-kicker">让证物浮现，让秘密显形</span>
          <h2>
            真相<span>，就在眼前。</span>
          </h2>
          <p>
            对准现场线索码，唤出证物。环绕观察每一处细节，再将证物与标题一起放进现实空间。
          </p>
          <Button
            data-testid="public-ar-scan"
            kind="full"
            onClick={startScanning}
            disabled={state.busy}
          >
            <ScanLine size={21} /> 扫描现场线索码 <ArrowRight size={18} />
          </Button>
          {state.busy && (
            <div className="public-ar-status" role="status">
              <p>正在查找{state.id}的证物…</p>
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
          <small>相机画面在你的设备上识别，不上传。</small>
          <div className="public-ar-investigation-steps" aria-label="搜证步骤">
            <span>
              <b>01</b> 扫描线索
            </span>
            <span>
              <b>02</b> 空间观察
            </span>
            <span>
              <b>03</b> 阅读记录
            </span>
          </div>
        </section>
      )}
      <details className="public-ar-manual">
        <summary>没有相机？输入线索编号</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const id = parseClueCode(
              new FormData(event.currentTarget).get("clue"),
              location.origin,
            );
            if (!id) {
              setState((old) => ({
                ...old,
                error: "请输入如E-01的线索编号，或本活动的线索链接。",
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
              placeholder="例如：E-01"
              required
              maxLength={2048}
              disabled={state.busy}
            />
          </label>
          <Button type="submit" kind="ghost" disabled={state.busy}>
            查看线索
          </Button>
        </form>
      </details>
      {state.clue && state.error && (
        <p className="public-ar-error" role="alert">
          {state.error}
        </p>
      )}
      {scanning && (
        <ClueScanner
          publicView
          onDetected={detected}
          onClose={() => setScanning(false)}
        />
      )}
    </main>
  );
}
