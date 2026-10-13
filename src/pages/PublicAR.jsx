import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Box, RefreshCw, ScanLine } from "lucide-react";
import { api } from "../api";
import { parseClueCode } from "../clue-scan";
import { Badge, Button } from "../components/ui";
import ClueScanner from "../components/ClueScanner";
import { EvidenceModelStage } from "../components/EvidenceModelViewer";
import "./public-ar.css";

export default function PublicAR() {
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
    if (state.clue) resultHeading.current?.focus();
  }, [state.clue]);
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
      <div className="public-ar-title">
        <span className="eyebrow">阿拉斯加之夜 · 现场搜证</span>
        <h1>AR搜证</h1>
        <p>无需登录，扫一扫现场线索码即可查看。</p>
      </div>
      {state.clue ? (
        <section
          className="public-ar-result"
          aria-label="现场线索"
          data-testid="public-ar-clue"
        >
          <div className="public-ar-result-heading">
            <div>
              <Badge tone="gold">
                {state.clue.id}
                {state.clue.area ? ` · ${state.clue.area}` : ""}
              </Badge>
              <h2 tabIndex={-1} ref={resultHeading}>
                {state.clue.title}
              </h2>
            </div>
            <Button kind="ghost compact" onClick={() => setScanning(true)}>
              <ScanLine size={16} /> 继续扫描
            </Button>
          </div>
          {state.clue.model_url ? (
            <EvidenceModelStage clue={state.clue} publicView />
          ) : (
            <div className="public-ar-model-note" role="status">
              <Box size={25} />
              <div>
                <strong>这件证物暂未提供AR模型</strong>
                <p>可以继续阅读线索文字，或向现场GM询问。</p>
              </div>
            </div>
          )}
          <div className="public-ar-clue-copy">
            <span className="eyebrow">线索内容</span>
            <h3>{state.clue.title}</h3>
            <p>{state.clue.body}</p>
          </div>
          <p className="public-ar-copy-note">
            线索以文字内容为准，现场玩法与判定请听从GM指引。
          </p>
        </section>
      ) : (
        <section className="public-ar-start">
          <div className="public-ar-scan-symbol" aria-hidden="true">
            <ScanLine size={48} strokeWidth={1.3} />
          </div>
          <h2>现场证物，就在眼前</h2>
          <p>
            扫描线索卡上的二维码，打开证物模型和线索文字。支持的手机还可以把证物放进现实空间。
          </p>
          <Button
            data-testid="public-ar-scan"
            kind="full"
            onClick={() => setScanning(true)}
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
