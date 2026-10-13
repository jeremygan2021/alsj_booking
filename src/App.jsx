import React, { useState, useEffect, useCallback, lazy, Suspense } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Menu,
  X,
  Compass,
  Users,
  Ticket,
  Clock,
  Shield,
  FileText,
  KeyRound,
  Coins,
  ScanLine,
  BookOpen,
  LayoutDashboard,
  Layers,
  Radio,
  Gavel,
  Dices,
  Check,
  LogOut,
  ChevronRight,
  Search,
  Lock,
  MapPin,
  CheckCircle2,
  Briefcase,
  Wallet,
  Activity,
  Plus,
  RefreshCw,
} from "lucide-react";
import { api } from "./api";
import { Icon, Button, Badge, Empty, Field, Modal } from "./components/ui";
import Landing from "./pages/Landing";
import Player from "./pages/Player";
import Admin from "./pages/Admin";
import SmsAuth from "./components/SmsAuth";
const ArPage = lazy(() => import("./pages/ArPage"));
const currentView = () =>
  location.pathname.startsWith("/ar")
    ? "ar"
    : location.pathname.startsWith("/admin")
      ? "admin"
      : location.pathname.startsWith("/play")
        ? "play"
        : "home";
function App() {
  const [view, setView] = useState(currentView);
  const [session, setSession] = useState(null),
    [pub, setPub] = useState(null),
    [authMode, setAuthMode] = useState(null),
    [toast, setToast] = useState(""),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([api("/session"), api("/public")]);
      setSession(a);
      setPub(b);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    load();
    const timer = setInterval(load, 12000);
    const pop = () => setView(currentView());
    addEventListener("popstate", pop);
    return () => {
      clearInterval(timer);
      removeEventListener("popstate", pop);
    };
  }, [load]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  const navigate = (v) => {
    history.pushState(
      {},
      "",
      v === "home" ? "/" : v === "play" ? "/play" : "/admin",
    );
    setView(v);
    window.scrollTo({ top: 0 });
  };
  const act = async (fn) => {
    try {
      await fn();
      await load();
    } catch (e) {
      setToast(e.message);
    }
  };
  const authSuccess = async (role, registered) => {
    const pendingAr = view === "ar" ? location.pathname : null;
    const welcome = registered ?? authMode === "register";
    const pendingClue = new URLSearchParams(location.search).get("clue");
    setAuthMode(null);
    await load();
    if (pendingAr && role === "player") {
      history.replaceState({}, "", pendingAr);
      setView("ar");
      return;
    }
    navigate(role === "player" ? "play" : "admin");
    if (role === "player") {
      const params = new URLSearchParams();
      if (pendingClue) params.set("clue", pendingClue);
      else if (welcome) params.set("welcome", "1");
      if (params.size) history.replaceState({}, "", "/play?" + params);
    }
  };
  if (error && !pub)
    return (
      <div className="boot">
        <h1>连接庄园失败</h1>
        <p>{error}</p>
        <Button onClick={load}>重新连接</Button>
      </div>
    );
  if (!pub)
    return (
      <div className="boot">
        <span className="seal small">A</span>
        <p>正在开启庄园大门…</p>
      </div>
    );
  if (view === "ar")
    return (
      <>
        <Suspense fallback={<div className="boot">正在准备 3D 搜证…</div>}>
          <ArPage session={session} onLogin={() => setAuthMode("login")} />
        </Suspense>
        {authMode && (
          <Auth
            smsEnabled={Boolean(pub.auth?.sms)}
            mode={authMode}
            setMode={setAuthMode}
            onSuccess={authSuccess}
            onClose={() => setAuthMode(null)}
          />
        )}
      </>
    );
  return (
    <>
      <header className="topbar">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("home");
          }}
        >
          <span className="brand-mark">
            A<span>✦</span>N
          </span>
          <span>
            ALASKA NIGHTS<small>阿拉斯加之夜</small>
          </span>
        </a>
        <nav>
          <button
            className={view === "home" ? "selected" : ""}
            onClick={() => navigate("home")}
          >
            活动介绍
          </button>
          <button
            className={view === "play" ? "selected" : ""}
            onClick={() => navigate("play")}
          >
            进入游戏
          </button>
          {(["gm", "npc"].includes(session?.role) || view === "admin") && (
            <button
              className={view === "admin" ? "selected" : ""}
              onClick={() => navigate("admin")}
            >
              管理后台
            </button>
          )}
        </nav>
        <div className="header-actions">
          <span className="header-date">31 OCT · 2026</span>
          {session ? (
            <button
              className="icon-button"
              aria-label="退出登录"
              onClick={() =>
                act(async () => {
                  await api("/logout", {});
                  navigate("home");
                })
              }
            >
              <LogOut size={17} />
            </button>
          ) : (
            <Button kind="ghost compact" onClick={() => setAuthMode("login")}>
              宾客登录 <ArrowUpRight size={14} />
            </Button>
          )}
        </div>
      </header>
      {view === "home" ? (
        <Landing
          pub={pub}
          onRegister={() =>
            session?.role === "player"
              ? navigate("play")
              : setAuthMode("register")
          }
          onPlay={() => navigate("play")}
        />
      ) : view === "play" ? (
        session?.role === "player" ? (
          <Player pub={pub} notify={setToast} />
        ) : (
          <Access
            title="你的故事，从一封邀请开始"
            text="报名后上传头像、写下你的Cos角色故事。现场听从GM指引，扫码寻找线索。"
            onLogin={() => setAuthMode("login")}
            onRegister={() => setAuthMode("register")}
          />
        )
      ) : ["gm", "npc"].includes(session?.role) ? (
        <Admin pub={pub} session={session} notify={setToast} />
      ) : (
        <Access
          title="管理后台"
          text="管理员使用密码登录；NPC使用后台绑定的手机号验证码登录。"
          onLogin={() => setAuthMode("staff")}
        />
      )}
      <footer>
        <span>
          ALASKA NIGHTS <span className="muted">/ THE LAST TESTAMENT</span>
        </span>
        <span>每个人都带着面具。每个秘密都有代价。</span>
        <small>
          2026 · 万圣节沉浸式 TRPG ·{" "}
          <a
            href="/admin"
            onClick={(event) => {
              event.preventDefault();
              navigate("admin");
            }}
          >
            工作人员入口
          </a>
        </small>
      </footer>
      {authMode && (
        <Auth
          smsEnabled={Boolean(pub.auth?.sms)}
          mode={authMode}
          setMode={setAuthMode}
          onSuccess={authSuccess}
          onClose={() => setAuthMode(null)}
        />
      )}{" "}
      {toast && (
        <div className="toast" role="status">
          <Activity size={17} />
          {toast}
          <button onClick={() => setToast("")} aria-label="关闭消息">
            <X size={15} />
          </button>
        </div>
      )}
    </>
  );
}
function Access({ title, text, onLogin, onRegister }) {
  return (
    <main className="access">
      <div className="seal small">A</div>
      <span className="eyebrow">PRIVATE ACCESS</span>
      <h1>{title}</h1>
      <p>{text}</p>
      <div className="hero-buttons">
        {onRegister && (
          <Button onClick={onRegister}>
            第一次来，报名参加 <ArrowRight size={16} />
          </Button>
        )}
        <Button kind={onRegister ? "ghost" : ""} onClick={onLogin}>
          {onRegister ? "已经报名，登录" : "工作人员登录"}{" "}
          <KeyRound size={16} />
        </Button>
      </div>
    </main>
  );
}
function Auth({ mode, setMode, onSuccess, onClose, smsEnabled }) {
  if (mode !== "staff")
    return (
      <SmsAuth enabled={smsEnabled} onSuccess={onSuccess} onClose={onClose} />
    );
  return (
    <AdminAuth
      onSuccess={onSuccess}
      onClose={onClose}
      onPhone={() => setMode("login")}
    />
  );
}
function AdminAuth({ onSuccess, onClose, onPhone }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = Object.fromEntries(new FormData(event.currentTarget));
      const result = await api("/login", data);
      await onSuccess(result.role, false);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="管理员登录" onClose={onClose}>
      <p className="muted">
        仅管理员 admin（兼容 gm）可以密码登录。NPC请使用后台绑定的手机号验证。
      </p>
      <form onSubmit={submit}>
        <Field label="工作人员账号">
          <input
            required
            name="account"
            autoComplete="username"
            defaultValue="admin"
            placeholder="admin / gm"
          />
        </Field>
        <Field label="密码">
          <input
            required
            name="password"
            type="password"
            maxLength={128}
            autoComplete="current-password"
          />
        </Field>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <Button kind="full" type="submit" disabled={busy}>
          {busy ? "正在处理…" : "登录"}
          <ArrowRight size={17} />
        </Button>
      </form>
      <button className="switch-auth" onClick={onPhone}>
        NPC手机号登录
      </button>
    </Modal>
  );
}

export default App;
