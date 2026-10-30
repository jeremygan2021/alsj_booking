import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Layers2,
  LoaderCircle,
  Printer,
  RefreshCw,
  Rotate3D,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { api } from "../api";
import { Button, Modal } from "../components/ui";
import {
  renderRoleCard,
  roleCardSheets,
  roleCardsPdf,
  saveRoleCard,
  saveRoleCardPng,
} from "../role-card-export";
import "./role-cards.css";

function consumeAccess() {
  const value = new URLSearchParams(location.hash.slice(1)).get("access");
  if (value) history.replaceState({}, "", "/role-cards");
  return value;
}
export default function RoleCards() {
  const [access, setAccess] = useState(consumeAccess);
  const [result, setResult] = useState(null),
    [rendered, setRendered] = useState([]);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(null);
  const [revision, setRevision] = useState(0),
    [resetTarget, setResetTarget] = useState(null);
  const [a4, setA4] = useState(false),
    [selected, setSelected] = useState(0),
    [face, setFace] = useState("front");
  useEffect(() => {
    const scan = () => {
      const value = consumeAccess();
      if (value) {
        setAccess(value);
        setRevision((v) => v + 1);
      }
    };
    addEventListener("hashchange", scan);
    return () => removeEventListener("hashchange", scan);
  }, []);
  useEffect(() => {
    let active = true;
    setResult(null);
    setRendered([]);
    setError("");
    (async () => {
      if (access) {
        await api("/auth/role-card", { access });
        if (active) setAccess(null);
        return;
      }
      const ids = new URLSearchParams(location.search).get("players");
      const data = await api(
        "/role-cards",
        ids ? { playerIds: ids.split(",") } : {},
      );
      if (active) {
        setResult(data);
        setA4(data.cards.length > 1);
        setSelected(0);
      }
    })().catch((e) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [access, revision]);
  useEffect(() => {
    let active = true;
    setRendered([]);
    if (result)
      (async () => {
        for (const card of result.cards) {
          const item = await renderRoleCard(card);
          if (!active) return;
          setRendered((items) => [...items, item]);
        }
      })().catch((e) => {
        if (active) setNotice(e.message);
      });
    return () => {
      active = false;
    };
  }, [result]);
  const current = result?.cards[selected];
  const artwork = rendered.find(
    (item) =>
      item.card.player.id === current?.player.id &&
      item.card.summary?.generatedAt === current?.summary?.generatedAt,
  );
  const complete = result?.cards.every((card) => Boolean(card.summary));
  const ready = complete && result.cards.length === rendered.length && !busy;
  const run = async (action) => {
    setBusy(true);
    setNotice("");
    try {
      await action();
    } catch (e) {
      setNotice(e.message || "暂时未能完成，请重试");
    } finally {
      setBusy(false);
    }
  };
  const generate = () =>
    run(async () => {
      const cards = [...result.cards];
      try {
        for (let i = 0; i < cards.length; i++) {
          setProgress({ current: i + 1, total: cards.length });
          const response = await api(
            `/role-cards/${cards[i].player.id}/generate`,
            { force: Boolean(complete) },
          );
          cards[i] = { ...cards[i], summary: response.summary };
        }
      } finally {
        setProgress(null);
        setResult({ ...result, cards });
      }
    });
  const downloadPdf = (items = rendered, fullPage = a4) =>
    run(() =>
      saveRoleCard(
        roleCardsPdf(items, fullPage),
        `阿拉斯加之夜_${fullPage ? "A4双卡" : "半A4单卡"}_正反面.pdf`,
      ),
    );
  const print = () =>
    run(async () => {
      const images = [...document.querySelectorAll(".role-card-print-artwork")];
      await Promise.all(
        images.map((image) => {
          image.loading = "eager";
          return image.decode();
        }),
      );
      window.print();
    });
  const pages = roleCardSheets(rendered, a4);
  return (
    <main className={`role-card-page ${a4 ? "print-a4" : "print-half"}`}>
      <style>{`@page { size: ${a4 ? "210mm 297mm" : "210mm 148.5mm"}; margin: 0; }`}</style>
      <div className="role-card-screen no-print">
        <header className="role-card-masthead">
          <a className="role-card-brand" href="/">
            <span className="role-card-monogram">A</span>
            <span>
              ALASKA NIGHTS<small>THE LAST TESTAMENT</small>
            </span>
          </a>
          <span className="role-card-studio-label">
            THE PRINT ATELIER <i /> VOL. 2026
          </span>
          <a
            className="role-card-return"
            href={result?.role === "gm" ? "/admin" : "/play"}
          >
            <ArrowLeft size={15} />
            {result?.role === "gm" ? "导演控制台" : "进入我的游戏"}
          </a>
        </header>
        <section className="role-card-intro">
          <div>
            <span className="role-card-kicker">
              A CHARACTER. A SECRET. A NIGHT TO REMEMBER.
            </span>
            <h1>
              今夜，带着你的故事赴约<span>。</span>
            </h1>
          </div>
          <p>
            一面是身份，一面是故事。
            <br />
            将长篇经历，凝成一张值得收藏的邀请。
          </p>
        </section>
        {error ? (
          <section className="role-card-error" role="alert">
            <h2>暂时无法打开角色卡</h2>
            <p>{error}</p>
            <a className="button" href="/play">
              手机号登录 / 我的角色 <ArrowRight size={16} />
            </a>
            <Button kind="ghost" onClick={() => setRevision((v) => v + 1)}>
              重试
            </Button>
          </section>
        ) : (
          <div className="role-card-studio">
            <aside className="role-card-tools">
              <div className="role-card-tools-title">
                <span>01</span>
                <h2>你的角色卡</h2>
                <small>
                  {String(result?.cards.length || 1).padStart(2, "0")} GUESTS
                </small>
              </div>
              <div className="role-card-guest-list" aria-label="选择预览宾客">
                {result?.cards.map((card, index) => (
                  <button
                    key={card.player.id}
                    aria-pressed={selected === index}
                    onClick={() => {
                      setSelected(index);
                      setFace("front");
                    }}
                  >
                    {card.character.avatar_url ? (
                      <img src={card.character.avatar_url} alt="" />
                    ) : (
                      <span className="role-card-guest-letter">
                        {Array.from(card.character.name || card.player.name)[0]}
                      </span>
                    )}
                    <span>
                      <strong>{card.character.name}</strong>
                      <small>
                        {card.player.name} · G
                        {String(card.player.group_id).padStart(2, "0")}
                      </small>
                    </span>
                    {card.summary ? (
                      <Check size={15} />
                    ) : (
                      <span className="role-card-pending-dot" />
                    )}
                  </button>
                ))}
              </div>
              <div className="role-card-generation">
                <Sparkles size={20} />
                <h3>故事，少而有余味。</h3>
                <p>
                  一句人物标签，三行故事，
                  <br />
                  两件今夜值得做的事。
                </p>
                <Button
                  disabled={
                    !result || busy || rendered.length !== result.cards.length
                  }
                  onClick={generate}
                >
                  {progress ? (
                    <LoaderCircle size={17} className="role-card-spin" />
                  ) : (
                    <Sparkles size={17} />
                  )}
                  {progress
                    ? `正在精炼 ${progress.current}/${progress.total}`
                    : complete
                      ? "重新生成摘要"
                      : result?.generation.configured
                        ? "AI生成角色卡"
                        : "生成简洁角色卡"}
                </Button>
                {result && !result.generation.configured && (
                  <small className="role-card-template-note">
                    AI 服务未配置，当前使用简洁摘要。
                  </small>
                )}
              </div>
              <div className="role-card-tools-title secondary">
                <span>02</span>
                <h2>带走这份邀请</h2>
              </div>
              <div
                className="role-card-format"
                role="group"
                aria-label="打印布局"
              >
                <button
                  aria-pressed={!a4}
                  className={!a4 ? "active" : ""}
                  onClick={() => setA4(false)}
                >
                  单卡 · 半 A4
                </button>
                <button
                  aria-pressed={a4}
                  className={a4 ? "active" : ""}
                  onClick={() => setA4(true)}
                >
                  双卡 · A4
                </button>
              </div>
              <Button
                kind="role-card-pdf"
                disabled={!ready}
                onClick={() => downloadPdf()}
              >
                <FileText size={17} />
                下载双面 PDF
                <ArrowRight size={16} />
              </Button>
              <div className="role-card-small-actions">
                <button
                  disabled={!artwork || !current?.summary || busy}
                  onClick={() => run(() => saveRoleCardPng(artwork, face))}
                >
                  <Download size={15} />
                  下载{face === "front" ? "正面" : "背面"} PNG
                </button>
                <button disabled={!ready} onClick={print}>
                  <Printer size={15} />
                  打印
                </button>
              </div>
              <p className="role-card-print-note">
                {a4 ? "每张 A4 两位宾客" : "210 × 148.5 mm"}
                <br />
                正反面已配对 · 双面打印选「长边翻转」
              </p>
              <div className="role-card-privacy">
                <ShieldCheck size={15} />
                <span>
                  背面二维码可直接登录，
                  <br />
                  请将卡片留给它的主人。
                </span>
              </div>
            </aside>
            <section className="role-card-workspace" aria-label="角色卡预览">
              <div className="role-card-preview-top">
                <span>
                  <i />
                  {face === "front" ? "THE IDENTITY" : "THE STORY"} /{" "}
                  {face === "front" ? "01" : "02"}
                </span>
                <div
                  className="role-card-face-switch"
                  role="group"
                  aria-label="卡片正反面"
                >
                  <button
                    className={face === "front" ? "active" : ""}
                    aria-pressed={face === "front"}
                    onClick={() => setFace("front")}
                  >
                    正面
                  </button>
                  <button
                    className={face === "back" ? "active" : ""}
                    aria-pressed={face === "back"}
                    onClick={() => setFace("back")}
                  >
                    背面
                  </button>
                </div>
              </div>
              <div className="role-card-stage-area">
                <span className="role-card-stage-star" aria-hidden="true">
                  ✦
                </span>
                {artwork ? (
                  <button
                    className={`role-card-stage ${face === "back" ? "is-back" : ""}`}
                    aria-label={`翻至${face === "front" ? "背面" : "正面"}`}
                    onClick={() => setFace(face === "front" ? "back" : "front")}
                  >
                    <span className="role-card-stage-turn">
                      <span
                        className="role-card-face front"
                        aria-hidden={face !== "front"}
                      >
                        <img
                          className="role-card-artwork"
                          src={artwork.front.png}
                          alt={`${current.character.name}的角色卡正面`}
                        />
                      </span>
                      <span
                        className="role-card-face back"
                        aria-hidden={face !== "back"}
                      >
                        <img
                          className="role-card-artwork"
                          src={artwork.back.png}
                          alt={`${current.character.name}的角色卡背面`}
                        />
                      </span>
                    </span>
                  </button>
                ) : (
                  <div className="role-card-stage-loading">
                    <LoaderCircle className="role-card-spin" />
                    <span>正在布置你的邀请…</span>
                  </div>
                )}
              </div>
              <div className="role-card-preview-bottom">
                <span>
                  <Rotate3D size={16} />
                  轻触卡片，翻阅另一面
                </span>
                <span>
                  {String(selected + 1).padStart(2, "0")} /{" "}
                  {String(result?.cards.length || 1).padStart(2, "0")}
                </span>
              </div>
              <div className="role-card-caption">
                <div>
                  <span className="role-card-kicker">
                    {current?.summary
                      ? current.summary.generator === "ai"
                        ? "AI EDITED · 已精炼"
                        : "CONCISE EDITION · 简洁摘要"
                      : "READY FOR YOUR STORY"}
                  </span>
                  <h2>
                    {current?.summary?.body.tagline ||
                      "让复杂的经历，留下清晰的回声。"}
                  </h2>
                  <p>
                    {current?.summary?.body.story ||
                      "点击生成，将角色故事提炼成完整短文。原始档案仍可随时展开阅读。"}
                  </p>
                </div>
                <div className="role-card-paging">
                  <button
                    aria-label="上一位宾客"
                    disabled={!selected}
                    onClick={() => setSelected((v) => v - 1)}
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <button
                    aria-label="下一位宾客"
                    disabled={!result || selected >= result.cards.length - 1}
                    onClick={() => setSelected((v) => v + 1)}
                  >
                    <ChevronRight size={20} />
                  </button>
                </div>
              </div>
              {notice && (
                <p className="role-card-message" role="alert">
                  {notice}
                </p>
              )}
              <p className="role-card-load-status" role="status">
                {result && rendered.length < result.cards.length
                  ? `正在绘制 ${rendered.length}/${result.cards.length} 位宾客的正反面`
                  : complete
                    ? "正反面已就绪，可下载或打印"
                    : "先生成故事摘要，再下载专属角色卡"}
              </p>
              {current && (
                <details className="role-card-reading">
                  <summary>
                    <Layers2 size={16} />
                    展开完整角色档案<span>原始故事与人物关系</span>
                  </summary>
                  <div>
                    <h3>我的故事</h3>
                    <p>{current.character.story}</p>
                    {current.character.adaptation && (
                      <>
                        <h3>庄园身份</h3>
                        <p>{current.character.adaptation}</p>
                      </>
                    )}
                    {current.relations.map((r, i) => (
                      <section key={i}>
                        <h3>
                          {r.npc_name} · {r.relation}
                        </h3>
                        <p>{r.player_brief}</p>
                      </section>
                    ))}
                  </div>
                </details>
              )}
              {result?.role === "gm" && current && (
                <button
                  className="role-card-reset"
                  disabled={busy}
                  onClick={() => setResetTarget(current)}
                >
                  <RefreshCw size={13} />
                  重置此宾客的登录二维码
                </button>
              )}
            </section>
          </div>
        )}
        <footer className="role-card-footer">
          <span>ALASKA NIGHTS</span>
          <span>EVERY GUEST LEAVES A TRACE.</span>
          <span>HALLOWEEN · 2026</span>
        </footer>
      </div>
      <div className="role-card-print-only" aria-label="双面打印排版">
        {pages.map((page, index) => (
          <section
            className="role-card-sheet"
            key={index}
            aria-label={`第${index + 1}页${page.face === "front" ? "正面" : "背面"}`}
          >
            {page.items.map((item) => (
              <img
                key={item.card.player.id}
                className="role-card-print-artwork"
                src={item[page.face].png}
                loading="lazy"
                alt={`${item.card.character.name}${page.face === "front" ? "正面" : "背面"}`}
              />
            ))}
            {a4 && page.items.length === 1 && (
              <div className="role-card-blank" />
            )}
          </section>
        ))}
      </div>
      {resetTarget && (
        <Modal
          title="重置角色卡二维码"
          onClose={() => !busy && setResetTarget(null)}
        >
          <p>
            重置「{resetTarget.character.name}
            」的二维码后，旧卡将无法再用于登录。请重新下载和发放。
          </p>
          <div className="role-card-modal-actions">
            <Button
              kind="ghost"
              disabled={busy}
              onClick={() => setResetTarget(null)}
            >
              取消
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api(`/role-cards/${resetTarget.player.id}/reset`, {});
                  setResetTarget(null);
                  setRevision((v) => v + 1);
                })
              }
            >
              重置并更新角色卡
            </Button>
          </div>
        </Modal>
      )}
    </main>
  );
}
