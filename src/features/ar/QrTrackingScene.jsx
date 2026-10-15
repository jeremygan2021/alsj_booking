import { useEffect, useRef, useState } from "react";
import {
  X,
  Camera,
  ChevronDown,
  ScanLine,
  RotateCcw,
  View,
  Plus,
  Minus,
  Footprints,
  Sparkles,
} from "lucide-react";
import { createQrSceneRuntime } from "./qr-scene-runtime.js";
import "./qr-tracking.css";
import ClueAudio from "../../components/ClueAudio";
import { createCastleAudio } from "../../audio/castle-audio.js";

// Call synchronously in the entry button's click handler, before mounting the scene.
// iPhone and browsers without physical fullscreen still use the full-screen CSS scene.
export function requestQrFullscreen() {
  const root = document.documentElement;
  if (!document.fullscreenElement && root.requestFullscreen) {
    try {
      return Promise.resolve(root.requestFullscreen()).then(
        () => true,
        () => false,
      );
    } catch {
      return Promise.resolve(false);
    }
  }
  return Promise.resolve(Boolean(document.fullscreenElement));
}

const messages = {
  requesting: "正在打开摄像头…",
  searching: "对准现场二维码",
  loading: "已识别，正在呈现证物…",
  located: "证物已浮现 · 轻触查看",
  lost: "二维码离开画面 · 重新对准",
  unknown: "这不是现场证物二维码",
  error: "摄像头暂时不可用",
  paused: "摄像头已暂停",
};

export default function QrTrackingScene({
  onClose,
  initialClueId,
  onClue,
  onInvitationUnlocked,
}) {
  const acceptInvitation = () => {
    window.location.assign("/play?invite=AR-INV&auth=invite");
  };
  const container = useRef(null);
  const video = useRef(null);
  const polygon = useRef(null);
  const runtime = useRef(null);
  const initialHint = useRef(initialClueId);
  const callbacks = useRef({ onClose, onClue, onInvitationUnlocked });
  callbacks.current = { onClose, onClue, onInvitationUnlocked };
  const [attempt, setAttempt] = useState(0);
  const [visible, setVisible] = useState(document.visibilityState !== "hidden");
  const [view, setView] = useState({ status: "requesting", error: null });
  const [clue, setClue] = useState(null);
  const [drawer, setDrawer] = useState(false);
  const [interaction, setInteraction] = useState(null);
  const [game, setGame] = useState(null);
  const [manualControls, setManualControls] = useState(false);
  useEffect(() => {
    if (game?.phase !== "castle" || game?.autoEntering)
      setManualControls(false);
  }, [game?.phase, game?.autoEntering]);
  const sound = useRef(null);
  const [soundState, setSoundState] = useState({
    enabled: true,
    unlocked: false,
  });
  const soundGesture = () => {
    if (
      initialHint.current === "AR-INV" ||
      clue?.presentation === "invitation"
    ) {
      sound.current ||= createCastleAudio(setSoundState);
      sound.current.gesture();
    }
  };
  callbacks.current.soundGesture = soundGesture;
  useEffect(
    () => () => {
      sound.current?.dispose();
      sound.current = null;
    },
    [],
  );
  useEffect(() => {
    if (game?.phase !== "castle") return;
    const vectors = {
      ArrowUp: { x: 0, y: 1 },
      w: { x: 0, y: 1 },
      ArrowDown: { x: 0, y: -1 },
      s: { x: 0, y: -1 },
      ArrowLeft: { x: -1, y: 0 },
      a: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      d: { x: 1, y: 0 },
    };
    const down = (event) => {
      if (event.code === "Space" && event.target.closest("button")) return;
      if (
        view.status === "located" &&
        (vectors[event.key] || event.code === "Space") &&
        !event.target.closest("input,textarea")
      ) {
        event.preventDefault();
        soundGesture();
        if (event.code === "Space") {
          if (!event.repeat) runtime.current?.jump();
        } else runtime.current?.move(vectors[event.key]);
      }
    };
    const stop = () => runtime.current?.move({ x: 0, y: 0 });
    const up = (event) => {
      if (vectors[event.key]) stop();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", stop);
    return () => {
      stop();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", stop);
    };
  }, [game?.phase, view.status]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const previousFocus = document.activeElement;
    container.current?.querySelector("button")?.focus();
    let hadFullscreen = Boolean(document.fullscreenElement);
    const fullscreen = () => {
      if (document.fullscreenElement) hadFullscreen = true;
      else if (hadFullscreen) callbacks.current.onClose?.();
    };
    const visibility = () => setVisible(document.visibilityState !== "hidden");
    const keydown = (event) => {
      if (event.key === "Escape" && !document.fullscreenElement)
        callbacks.current.onClose?.();
      if (event.key !== "Tab") return;
      const buttons = [
        ...container.current.querySelectorAll("button, [tabindex='0']"),
      ].filter(
        (element) => !element.disabled && element.getClientRects().length,
      );
      const first = buttons[0],
        last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("fullscreenchange", fullscreen);
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("fullscreenchange", fullscreen);
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = previousOverflow;
      if (
        hadFullscreen &&
        document.fullscreenElement === document.documentElement
      )
        document.exitFullscreen?.().catch(() => {});
      if (previousFocus?.isConnected) previousFocus.focus?.();
    };
  }, []);

  useEffect(() => {
    if (!visible) {
      setView({ status: "paused", error: null });
      return;
    }
    const controller = new AbortController();
    setView({ status: "requesting", error: null });
    setGame(null);
    runtime.current = createQrSceneRuntime({
      container: container.current,
      video: video.current,
      polygon: polygon.current,
      signal: controller.signal,
      initialClueId: initialHint.current,
      onClue: (id) => callbacks.current.onClue?.(id),
      onInteraction: setInteraction,
      onAcceptInvitation: acceptInvitation,
      onUserGesture: () => callbacks.current.soundGesture?.(),
      onSound: (event) => sound.current?.play(event),
      onExperienceState: (next) => {
        setGame(next);
        if (next?.unlocked) callbacks.current.onInvitationUnlocked?.();
      },
      onState: ({ status, error, clue: nextClue }) => {
        setView({ status, error: error || null });
        if (nextClue !== undefined) setClue(nextClue);
      },
    });
    return () => {
      controller.abort();
      runtime.current = null;
    };
  }, [attempt, visible]);

  const retry = () => {
    void requestQrFullscreen();
    setAttempt((number) => number + 1);
  };
  const identified = view.status === "located";

  return (
    <section
      ref={container}
      className="qr-tracking-scene"
      role="dialog"
      aria-modal="true"
      aria-label="现场扫码搜证"
      data-testid="qr-tracking-scene"
      data-model-visible="false"
    >
      <video
        ref={video}
        className="qr-tracking-video"
        autoPlay
        muted
        playsInline
        aria-hidden="true"
        data-testid="qr-tracking-video"
      />
      <svg className="qr-tracking-marker" aria-hidden="true">
        <polygon ref={polygon} />
      </svg>
      <header className="qr-tracking-topbar">
        <span className="qr-tracking-title">
          <ScanLine size={17} aria-hidden="true" />
          {game ? "庄园之邀" : "现场搜证"}
        </span>
        {(initialHint.current === "AR-INV" || game) && (
          <button
            className="castle-sound-toggle"
            type="button"
            aria-label={
              soundState.enabled && soundState.unlocked
                ? "关闭音乐与音效"
                : "开启音乐与音效"
            }
            aria-pressed={soundState.enabled && soundState.unlocked}
            onClick={() => {
              if (!sound.current || !soundState.unlocked) {
                soundGesture();
              } else sound.current.toggle();
            }}
          >
            {soundState.enabled && soundState.unlocked
              ? "♪ 音乐／音效已开启"
              : "♪ 开启音乐／音效"}
          </button>
        )}
        <button
          type="button"
          className="qr-tracking-close"
          onClick={onClose}
          aria-label="关闭摄像头"
        >
          <X size={22} />
        </button>
      </header>
      <div
        className={`qr-tracking-status ${identified ? "is-located" : ""}`}
        role="status"
        data-testid="qr-tracking-status"
      >
        <span className="qr-tracking-dot" aria-hidden="true" />
        {game && identified
          ? game.unlocked
            ? "3D邀请函已解锁 · 移动镜头观察"
            : "庄园已定位 · 一键即可入场"
          : messages[view.status]}
      </div>
      {!clue && !["error", "requesting", "paused"].includes(view.status) && (
        <div className="qr-tracking-guide" aria-hidden="true">
          <span />
          <p>将二维码完整放入画面</p>
        </div>
      )}
      {view.error && (
        <div className="qr-tracking-error" role="alert">
          <Camera size={30} aria-hidden="true" />
          <p>{view.error}</p>
          <button type="button" onClick={retry}>
            <RotateCcw size={16} aria-hidden="true" />
            重试
          </button>
        </div>
      )}
      {game && (
        <>
          <div className="castle-view-controls" aria-label="3D模型视角与缩放">
            <button
              className="castle-view-toggle"
              type="button"
              data-testid="castle-view-toggle"
              disabled={!identified}
              aria-label={`切换视角，当前${game.view.label}，下一个${game.nextView.label}`}
              onClick={() => runtime.current?.cycleView()}
            >
              <View size={18} aria-hidden="true" />
              <span>
                <small>切换视角</small>
                <strong>{game.view.label}</strong>
              </span>
              <RotateCcw size={14} aria-hidden="true" />
            </button>
            <div className="castle-zoom-controls" aria-label="缩放模型">
              <button
                type="button"
                aria-label="缩小模型"
                disabled={!identified || game.zoom <= 0.65}
                onClick={() => runtime.current?.changeZoom(-0.15)}
              >
                <Minus size={17} aria-hidden="true" />
              </button>
              <output aria-live="polite" aria-label="模型缩放比例">
                {Math.round(game.zoom * 100)}%
              </output>
              <button
                type="button"
                aria-label="放大模型"
                disabled={!identified || game.zoom >= 1.6}
                onClick={() => runtime.current?.changeZoom(0.15)}
              >
                <Plus size={17} aria-hidden="true" />
              </button>
            </div>
            <span className="castle-view-note" aria-live="polite">
              {game.view.label} · 移动手机仍可环绕观察
            </span>
          </div>
          <div className="castle-game-hud">
            <div className="castle-game-caption">
              {!game.unlocked && (
                <div className="castle-game-stats">
                  <span>
                    <Sparkles size={13} aria-hidden="true" />
                    星光 {game.adventure.collected}/{game.adventure.total}
                  </span>
                </div>
              )}
              <span role="status">
                {game.unlocked
                  ? `邀请已解锁 · 收集星光 ${game.adventure.collected}/${game.adventure.total}`
                  : game.adventure.feedback || game.instruction}
              </span>
              {!game.unlocked && <small>冰刺自动跳过 · 星光自动拾取</small>}
              {game.phase === "castle" && !game.autoEntering && (
                <button
                  className="castle-manual-toggle"
                  type="button"
                  aria-expanded={manualControls}
                  aria-controls="castle-manual-controls"
                  disabled={!identified}
                  onClick={() => setManualControls((open) => !open)}
                >
                  {manualControls ? "收起操作" : "自己逛逛"}
                </button>
              )}
            </div>
            {game.unlocked ? (
              <button
                type="button"
                onClick={() => runtime.current?.restartGame()}
              >
                再逛一次城堡
              </button>
            ) : (
              game.phase === "castle" &&
              manualControls && (
                <div
                  className="castle-game-actions"
                  id="castle-manual-controls"
                >
                  <button
                    className="castle-jump-button"
                    type="button"
                    aria-label="跳跃躲避陷阱"
                    disabled={!identified || !game.adventure.jumpReady}
                    onClick={() => runtime.current?.jump()}
                  >
                    <Footprints size={16} aria-hidden="true" />
                    跳跃
                  </button>
                  <div className="castle-game-pad" aria-label="控制小人移动">
                    {[
                      { label: "向前走", text: "↑", x: 0, y: 1 },
                      { label: "向左走", text: "←", x: -1, y: 0 },
                      { label: "向后走", text: "↓", x: 0, y: -1 },
                      { label: "向右走", text: "→", x: 1, y: 0 },
                    ].map(({ label, text, x, y }) => (
                      <button
                        key={label}
                        type="button"
                        aria-label={label}
                        disabled={!identified}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          soundGesture();
                          event.currentTarget.setPointerCapture(
                            event.pointerId,
                          );
                          runtime.current?.move({ x, y });
                        }}
                        onPointerUp={() =>
                          runtime.current?.move({ x: 0, y: 0 })
                        }
                        onPointerCancel={() =>
                          runtime.current?.move({ x: 0, y: 0 })
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            soundGesture();
                            runtime.current?.move({ x, y });
                          }
                        }}
                        onKeyUp={() => runtime.current?.move({ x: 0, y: 0 })}
                      >
                        {text}
                      </button>
                    ))}
                  </div>
                </div>
              )
            )}
          </div>
        </>
      )}
      {clue && (
        <aside
          className={`qr-tracking-evidence ${drawer ? "is-open" : ""}`}
          data-testid="qr-tracking-evidence"
        >
          {interaction && (
            <div className="qr-tracking-interaction">
              <span aria-live="polite">
                {identified ? interaction.message : "重新对准二维码，继续查看"}
              </span>
              <button
                type="button"
                data-testid="qr-evidence-interact"
                disabled={
                  !identified ||
                  game?.autoEntering ||
                  game?.phase === "entering"
                }
                onClick={() => {
                  if (game && !game.unlocked) setManualControls(false);
                  runtime.current?.interact();
                }}
              >
                {interaction.label}
              </button>
            </div>
          )}
          <button
            type="button"
            className="qr-tracking-evidence-toggle"
            aria-expanded={drawer}
            aria-controls="qr-evidence-body"
            onClick={() => setDrawer((open) => !open)}
          >
            <span>
              <small>
                {clue.id} · {clue.area}
              </small>
              <strong>
                {game && !game.unlocked
                  ? "索恩庄园 · 城堡入场之旅"
                  : clue.title || clue.model_label}
              </strong>
            </span>
            <ChevronDown size={19} aria-hidden="true" />
          </button>
          {clue.presentation !== "invitation" && clue.model_url && (
            <ClueAudio
              key={clue.id}
              track={clue.audio?.body}
              label="现场线索演绎"
              compact
              available={identified}
            />
          )}
          {drawer && (
            <div id="qr-evidence-body" className="qr-tracking-evidence-body">
              <p>
                {game && !game.unlocked
                  ? "点“一键入场”，小人会自动走进城门，几秒后展开邀请函。保持二维码在镜头内即可，冰刺会自动跳过，附近星光自动拾取。想自由探索可点“自己逛逛”，使用方向按钮或WASD移动、空格跳跃；碰到冰刺也不会扣血或重来。点击视角切换观察角度，用＋／－放大缩小。"
                  : clue.body}
              </p>
              {clue.presentation === "invitation" && game?.unlocked && (
                <>
                  <strong className="invitation-valid">
                    {clue.invitation_valid
                      ? "邀请有效 · 2026.10.31"
                      : "活动邀请已结束"}
                  </strong>
                  <img
                    className="invitation-poster"
                    src={clue.poster_url}
                    alt="阿拉斯加之夜活动海报"
                  />
                  <button
                    className="invitation-accept-accessible"
                    type="button"
                    disabled={!clue.invitation_valid}
                    onClick={acceptInvitation}
                  >
                    接受邀请，注册／登录
                  </button>
                </>
              )}
              <small>移动手机，从不同角度观察；保持二维码在画面内。</small>
            </div>
          )}
        </aside>
      )}
    </section>
  );
}
