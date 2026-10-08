import React, { useState, useEffect, useCallback } from "react";
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
function App() {
  const [view, setView] = useState(
    location.pathname.startsWith("/admin")
      ? "admin"
      : location.pathname.startsWith("/play")
        ? "play"
        : "home",
  );
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
    const pop = () =>
      setView(
        location.pathname.startsWith("/admin")
          ? "admin"
          : location.pathname.startsWith("/play")
            ? "play"
            : "home",
      );
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
  const authSuccess = async (role) => {
    const welcome = authMode === "register";
    const pendingClue = new URLSearchParams(location.search).get("clue");
    setAuthMode(null);
    await load();
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
            庄园邀请
          </button>
          <button
            className={view === "play" ? "selected" : ""}
            onClick={() => navigate("play")}
          >
            我的档案
          </button>
          <button
            className={view === "admin" ? "selected" : ""}
            onClick={() => navigate("admin")}
          >
            导演控制台
          </button>
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
            text="登录你的私人档案，继续填写角色、领取身份并探索庄园。"
            onLogin={() => setAuthMode("login")}
            onRegister={() => setAuthMode("register")}
          />
        )
      ) : ["gm", "npc"].includes(session?.role) ? (
        <Admin pub={pub} session={session} notify={setToast} />
      ) : (
        <Access
          title="导演控制台"
          text="GM与NPC工作人员请使用分配的专属账号登录。"
          onLogin={() => setAuthMode("staff")}
        />
      )}
      <footer>
        <span>
          ALASKA NIGHTS <span className="muted">/ THE LAST TESTAMENT</span>
        </span>
        <span>每个人都带着面具。每个秘密都有代价。</span>
        <small>2026 · 万圣节沉浸式 TRPG</small>
      </footer>
      {authMode && (
        <Auth
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
        <Button onClick={onLogin}>
          登录专属入口 <KeyRound size={16} />
        </Button>
        {onRegister && (
          <Button kind="ghost" onClick={onRegister}>
            还未报名？接受邀请
          </Button>
        )}
      </div>
    </main>
  );
}
function Auth({ mode, setMode, onSuccess, onClose }) {
  const [busy, setBusy] = useState(false),
    [err, setErr] = useState("");
  const register = mode === "register",
    staff = mode === "staff";
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const d = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const r = await api(register ? "/register" : "/login", d);
      await onSuccess(register ? "player" : r.role);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={
        register ? "接受庄园邀请" : staff ? "工作人员登录" : "欢迎回来，宾客"
      }
      onClose={onClose}
    >
      <p className="muted">
        {register
          ? "报名后领取专属二维码，再建立你的宴会身份。"
          : staff
            ? "GM账号为 gm；NPC使用 npc:角色标识。"
            : "使用报名时的手机号或邮箱登录。"}
      </p>
      <form onSubmit={submit}>
        {register && (
          <Field label="你的称呼">
            <input
              name="name"
              required
              maxLength={40}
              placeholder="我们该如何称呼你"
              autoFocus
            />
          </Field>
        )}
        <Field label={staff ? "工作人员账号" : "手机号或邮箱"}>
          <input
            name={register ? "contact" : "account"}
            required
            placeholder={staff ? "gm / npc:host" : "手机号或邮箱"}
            autoComplete="username"
          />
        </Field>
        <Field label={register ? "设置登录密码（至少8位）" : "密码"}>
          <input
            name="password"
            type="password"
            minLength={register ? 8 : 1}
            maxLength={128}
            required
            autoComplete={register ? "new-password" : "current-password"}
          />
        </Field>
        {register && (
          <div className="notice">
            <Ticket size={17} />
            <span>
              提交后票务状态为「待核验」。请联系活动工作人员完成付款核验；网页不收取支付。
            </span>
          </div>
        )}
        {err && (
          <p className="form-error" role="alert">
            {err}
          </p>
        )}
        <Button type="submit" disabled={busy} kind="full">
          {busy ? "正在处理…" : register ? "确认报名，领取邀请函" : "登录"}
          <ArrowRight size={17} />
        </Button>
      </form>
      {!staff && (
        <button
          className="switch-auth"
          onClick={() => {
            setErr("");
            setMode(register ? "login" : "register");
          }}
        >
          {register ? "已经报名？登录私人档案" : "还没有邀请函？立即报名"}
        </button>
      )}
    </Modal>
  );
}

export default App;
