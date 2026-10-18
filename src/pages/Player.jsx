import React, { useState, useEffect, useRef } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  FileText,
  KeyRound,
  Coins,
  ScanLine,
  BookOpen,
  Radio,
  Gavel,
  Lock,
  CheckCircle2,
  RefreshCw,
  Box,
} from "lucide-react";
import { api } from "../api";
import { phases, factions } from "../constants";
import { Button, Badge, Field, Modal, QR, useResource } from "../components/ui";
import ClueImageReader from "../components/ClueImageReader";
import QrTrackingScene, {
  requestQrFullscreen,
} from "../features/ar/QrTrackingScene";
import ClueReveal from "../components/ClueReveal";
import CharacterForm, {
  CharacterAvatar,
  GenerationStatus,
  RelationCards,
} from "../components/CharacterProfile";
import EvidenceModelViewer from "../components/EvidenceModelViewer";
import ImmersiveGallery from "../components/ImmersiveGallery";
import { parseClueCode } from "../clue-scan";
import {
  ARSearchCard,
  CharacterSummary,
  CurrentStoryStep,
} from "../components/PlayerExperience";
function Player({ pub, notify }) {
  const [data, refresh] = useResource("/me", notify),
    [tab, setTab] = useState("identity"),
    [clueData, refreshClues] = useResource("/clues", notify),
    [lots, refreshLots] = useResource("/lots", notify),
    [qr, setQr] = useState(false),
    [detail, setDetail] = useState(null),
    [flipped, setFlipped] = useState(false),
    [scanning, setScanning] = useState(false),
    [scanClueId, setScanClueId] = useState(undefined),
    [model, setModel] = useState(null),
    [gallery, setGallery] = useState(null),
    [characterFormState, setCharacterFormState] = useState(null),
    [editingCharacter, setEditingCharacter] = useState(false),
    [busy, setBusy] = useState(false);
  const handledClue = useRef(null),
    detailGeneration = useRef(0),
    galleryGeneration = useRef(0),
    showModelOnUnlock = useRef(false),
    trackedClues = useRef(new Set()),
    characterApproved = useRef(false);
  characterApproved.current = data?.character?.status === "approved";
  const updateCharacterFormState = (updater) => {
    if (!characterApproved.current) setCharacterFormState(updater);
  };
  const openClue = (clue, ar = false) => {
    detailGeneration.current++;
    showModelOnUnlock.current = ar;
    setModel(null);
    setDetail(clue);
    setFlipped(false);
    setTab("evidence");
  };
  const action = async (fn) => {
    setBusy(true);
    try {
      await fn();
      await Promise.all([refresh(), refreshClues(), refreshLots()]);
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  };
  const readEvidence = (clue) => {
    openClue(clue);
    const player = data?.player,
      character = data?.character;
    if (
      player?.payment !== "paid" ||
      !player.checked_in ||
      character?.status !== "approved" ||
      (!clue.unlocked && pub.settings.phase < clue.phase)
    )
      return;
    const generation = detailGeneration.current;
    action(async () => {
      const result = clue.unlocked
        ? await api(`/clues/${clue.id}`)
        : await api(`/clues/${clue.id}/unlock`, {});
      if (generation !== detailGeneration.current) return;
      const unlocked = { ...clue, ...result, unlocked: true };
      showModelOnUnlock.current = false;
      setFlipped(true);
      setDetail(unlocked);
    });
  };
  const startScanning = () => {
    requestQrFullscreen();
    setScanClueId(
      parseClueCode(
        new URLSearchParams(location.search).get("clue"),
        location.origin,
      ) || undefined,
    );
    setScanning(true);
  };
  const saveTrackedClue = async (id) => {
    const clue = clueData?.clues.find((item) => item.id === id);
    if (
      !clue ||
      clue.unlocked ||
      trackedClues.current.has(id) ||
      data?.player?.payment !== "paid" ||
      !data.player.checked_in ||
      data?.character?.status !== "approved" ||
      pub.settings.phase < clue.phase
    )
      return;
    trackedClues.current.add(id);
    try {
      await api(`/clues/${id}/unlock`, {});
      await Promise.all([refresh(), refreshClues()]);
    } catch (error) {
      trackedClues.current.delete(id);
      notify(error.message);
    }
  };
  const openGallery = async () => {
    const generation = ++galleryGeneration.current;
    setGallery({ loading: true, clues: [], error: "" });
    const unlocked = clueData?.clues.filter((clue) => clue.unlocked) || [];
    const results = await Promise.allSettled(
      unlocked.map((clue) =>
        api(`/clues/${clue.id}`).then((detail) => ({
          ...clue,
          ...detail,
          unlocked: true,
        })),
      ),
    );
    if (generation !== galleryGeneration.current) return;
    const errors = results.filter((result) => result.status === "rejected");
    setGallery({
      loading: false,
      clues: results
        .filter((result) => result.status === "fulfilled")
        .map((result) => result.value),
      error: errors.length
        ? `${errors.length}件证物加载失败：${errors[0].reason.message}。请关闭后重试。`
        : "",
    });
  };
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get("clue");
    if (id) setTab("evidence");
    if (params.has("welcome")) {
      params.delete("welcome");
      history.replaceState(
        {},
        "",
        location.pathname + (params.size ? "?" + params : ""),
      );
    }
  }, []);
  useEffect(() => {
    const raw = new URLSearchParams(location.search).get("clue");
    if (!raw || !clueData || !data || handledClue.current === raw) return;
    handledClue.current = raw;
    const id = parseClueCode(raw, location.origin);
    const clue = clueData.clues.find((c) => c.id === id);
    if (clue) {
      readEvidence(clue);
    } else notify("未找到该线索卡，请扫描现场二维码或输入有效编号");
  }, [clueData, data, notify]);
  useEffect(() => {
    if (data?.character?.status === "approved") {
      setCharacterFormState(null);
      setEditingCharacter(false);
    }
  }, [data]);
  if (!data) return <div className="boot">正在调取私人档案…</div>;
  const { player: p, character: c } = data;
  const identity = new URLSearchParams(location.search).get("identity");
  if (identity && identity !== p.id)
    return (
      <main className="access">
        <Lock size={30} />
        <h1>这封邀请函属于另一位宾客</h1>
        <p>
          请退出当前账号，使用邀请函主人的账号登录。你的私人档案不会向其他宾客开放。
        </p>
        <a className="text-link" href="/play">
          打开我的档案 <ArrowRight size={16} />
        </a>
      </main>
    );
  const blocker = !detail
    ? ""
    : p.payment !== "paid" || !p.checked_in
      ? "请先核验票务并完成现场签到"
      : c?.status !== "approved"
        ? "人物档案等待GM审核"
        : !detail.unlocked && pub.settings.phase < detail.phase
          ? `该线索卡将在第${detail.phase}幕开放`
          : "";
  const flipClue = () =>
    action(async () => {
      const generation = detailGeneration.current;
      const d = detail.unlocked
        ? await api(`/clues/${detail.id}`)
        : await api(`/clues/${detail.id}/unlock`, {});
      if (generation !== detailGeneration.current) return;
      const unlocked = { ...detail, ...d, unlocked: true };
      if (showModelOnUnlock.current) {
        showModelOnUnlock.current = false;
        setDetail(null);
        setModel({ clue: unlocked, mode: "ar" });
      } else setDetail(unlocked);
      setFlipped(true);
    });
  const scannedClue = (raw) => {
    const id = parseClueCode(raw, location.origin);
    if (!id) throw new Error("这不是本活动的线索二维码，请扫描现场线索卡。");
    const clue = clueData?.clues.find((c) => c.id === id);
    if (!clue) throw new Error("该线索编号不存在，请向GM核对。");
    readEvidence(clue);
  };
  const links = [
    ["identity", "我的角色", FileText],
    ["ar", "AR搜证", ScanLine],
    ["evidence", "证据册", BookOpen],
  ];
  const arBlocker = !c
    ? "先建立你的角色。GM确认、现场签到后，第三幕可解锁证物。"
    : c.status !== "approved"
      ? "角色正在等待GM确认。确认并现场签到后，第三幕可解锁证物。"
      : p.payment !== "paid" || !p.checked_in
        ? "请先到现场核验票务，并出示身份码完成签到。"
        : pub.settings.phase < 3
          ? "搜证将在第三幕开始；现在可以先熟悉扫码入口。"
          : "";
  const title =
    links.find((link) => link[0] === tab)?.[1] ||
    (tab === "auction" ? "现场拍卖" : "最终庭审");
  return (
    <main className="player-layout player-simple">
      <header className="player-mini-header">
        <CharacterAvatar
          src={c?.avatar_url || characterFormState?.preview}
          name={c?.name || p.name}
        />
        <div className="player-mini-identity">
          <strong>{c?.name || p.name}</strong>
          <small>
            {c?.status === "approved"
              ? p.checked_in
                ? `已签到 · 第${p.group_id}调查组`
                : "角色已确认 · 等待现场签到"
              : c
                ? "角色已提交 · 等GM确认"
                : "欢迎来到阿拉斯加之夜"}
          </small>
        </div>
        {c?.status === "approved" && <Badge tone="green">已确认</Badge>}
      </header>
      <nav className="player-simple-nav" aria-label="玩家入口">
        {links.map(([id, label, I]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
            aria-current={tab === id ? "page" : undefined}
          >
            <I size={18} />
            {label}
          </button>
        ))}
      </nav>
      <div className="player-main">
        <div className="page-heading">
          <h1>{title}</h1>
          <Badge tone="green">
            第{pub.settings.phase}幕 · {phases[pub.settings.phase - 1]}
          </Badge>
        </div>
        {(tab === "auction" || tab === "court") && (
          <Button
            kind="ghost compact player-back-button"
            onClick={() => setTab("identity")}
          >
            <ArrowRight size={15} /> 回到我的角色
          </Button>
        )}
        {pub.events[0] && (
          <div className="event-banner">
            <Radio size={19} />
            <div>
              <strong>{pub.events[0].title}</strong>
              <p>{pub.events[0].body}</p>
            </div>
          </div>
        )}
        {tab === "identity" && (
          <>
            {!c || (editingCharacter && c.status !== "approved") ? (
              <>
                <CharacterForm
                  character={c}
                  playerName={p.name}
                  formState={characterFormState}
                  onFormStateChange={updateCharacterFormState}
                  busy={busy}
                  onSubmit={(draft) =>
                    action(async () => {
                      const result = await api("/character", draft);
                      setEditingCharacter(false);
                      notify(
                        result.stale
                          ? "故事已在另一处更新，请查看当前故事。"
                          : result.generation_status === "error"
                            ? "故事已保存，可稍后重试或请GM协助。"
                            : "角色已提交，等GM确认。",
                      );
                    })
                  }
                />
                {c && (
                  <Button
                    kind="ghost compact"
                    disabled={busy}
                    onClick={() => setEditingCharacter(false)}
                  >
                    返回已提交的故事
                  </Button>
                )}
              </>
            ) : (
              <>
                {c.status === "approved" &&
                  p.payment === "paid" &&
                  Boolean(p.checked_in) &&
                  pub.settings.phase >= 3 && (
                    <ARSearchCard
                      compact
                      blocker={arBlocker}
                      busy={busy || !clueData}
                      onScan={() => {
                        setTab("ar");
                        startScanning();
                      }}
                    />
                  )}
                <CharacterSummary
                  character={c}
                  player={p}
                  busy={busy}
                  onEdit={() => setEditingCharacter(true)}
                />
                {c.status !== "approved" && (
                  <GenerationStatus
                    character={c}
                    audience="player"
                    configured={pub.generation?.configured}
                    busy={busy}
                    onRetry={() =>
                      action(async () => {
                        const result = await api("/character/generate", {});
                        notify(
                          result.stale
                            ? "故事已在另一处更新，请查看当前故事。"
                            : result.generation_status === "error"
                              ? "故事已保存，暂时未准备好，请稍后重试或找GM。"
                              : "故事草稿已准备，等GM确认。",
                        );
                      })
                    }
                  />
                )}
                {c.status === "approved" &&
                  (p.payment !== "paid" || !p.checked_in) && (
                    <section className="player-next-step">
                      <span className="eyebrow">下一步 · 现场签到</span>
                      <h3>到现场，把身份码出示给GM</h3>
                      <p>
                        {p.payment !== "paid"
                          ? "工作人员会核验票务并为你签到。签到后，找到与你有关的NPC开始对话。"
                          : "你的票务已核验，出示身份码完成签到，就能开始今晚的故事。"}
                      </p>
                      <Button onClick={() => setQr(true)}>
                        <ScanLine size={18} /> 出示签到身份码
                      </Button>
                    </section>
                  )}
                {c.status === "approved" &&
                  p.payment === "paid" &&
                  Boolean(p.checked_in) && (
                    <>
                      <CurrentStoryStep
                        relations={data.relations || []}
                        missions={data.missions || []}
                        phase={pub.settings.phase}
                      />
                    </>
                  )}
                <details className="player-fold">
                  <summary>
                    {c.status === "approved"
                      ? "我的故事与人物关系"
                      : "查看我的故事草稿"}
                  </summary>
                  <div className="player-fold-content">
                    <h3>我的原始故事</h3>
                    <p className="character-original-story">{c.story}</p>
                    {c.adaptation && (
                      <div className="character-adaptation">
                        <h4>我在ECHO世界的身份</h4>
                        <p>{c.adaptation}</p>
                      </div>
                    )}
                    {c.status === "approved" && (
                      <>
                        <h3>只有你知道的身份</h3>
                        <Badge tone="gold">{factions[c.faction]}</Badge>
                        <p>{c.secret}</p>
                      </>
                    )}
                    <h3>与你有关的人</h3>
                    {c.status !== "approved" && (
                      <p>
                        这是你的个人草稿，GM确认后，对应NPC才会看到与你有关的故事。
                      </p>
                    )}
                    <RelationCards
                      relations={data.relations || []}
                      approved={c.status === "approved"}
                      phase={pub.settings.phase}
                    />
                  </div>
                </details>
                {c.status === "approved" && (
                  <details className="player-fold">
                    <summary>现场玩法 · 第{pub.settings.phase}幕</summary>
                    <div className="player-fold-content">
                      <div className="player-play-balance">
                        <Coins size={17} /> {p.coins} 极光金币{" "}
                        <small>仅限游戏使用</small>
                      </div>
                      {pub.settings.phase === 2 ? (
                        <>
                          <p>跟随GM参加现场拍卖，使用金币竞拍道具。</p>
                          <Button
                            kind="ghost"
                            onClick={() => setTab("auction")}
                          >
                            进入拍卖 <Gavel size={16} />
                          </Button>
                        </>
                      ) : pub.settings.phase === 4 ? (
                        <>
                          <p>
                            与组员整理证据，听取现场质询。GM开放投票后，提交最终指控。
                          </p>
                          <Button kind="ghost" onClick={() => setTab("court")}>
                            进入最终庭审 <Gavel size={16} />
                          </Button>
                        </>
                      ) : (
                        <p>
                          {pub.settings.phase === 1
                            ? "现场完成NPC委托，由NPC确认奖励。第一幕累计奖励上限10枚，包含签到金币。"
                            : "每组每区可进行一次主要鉴定。先和组员商量，再派代表掷D20。"}
                        </p>
                      )}
                      {data.missions.length > 0 && (
                        <>
                          <h3>NPC委托</h3>
                          {data.missions.map((mission) => (
                            <div className="ledger-row" key={mission.id}>
                              <span>{mission.title}</span>
                              <Badge
                                tone={
                                  mission.status === "done" ? "green" : "gold"
                                }
                              >
                                {mission.status === "done"
                                  ? "已完成"
                                  : `+${mission.reward}`}
                              </Badge>
                            </div>
                          ))}
                        </>
                      )}
                      {data.ledger.length > 0 && (
                        <>
                          <h3>金币记录</h3>
                          {data.ledger.map((row) => (
                            <div className="ledger-row" key={row.id}>
                              <span>{row.reason}</span>
                              <strong>
                                {row.amount > 0 ? "+" : ""}
                                {row.amount}
                              </strong>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  </details>
                )}
              </>
            )}
          </>
        )}
        {tab === "ar" && (
          <>
            <ARSearchCard
              blocker={arBlocker}
              busy={busy || !clueData}
              onScan={startScanning}
            />
            <details className="player-fold">
              <summary>无法开启相机？从图片或编号阅读线索</summary>
              <div className="player-fold-content">
                <form
                  className="scan-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const id = parseClueCode(
                      new FormData(event.currentTarget).get("id"),
                      location.origin,
                    );
                    const clue = clueData?.clues.find((item) => item.id === id);
                    if (clue) readEvidence(clue);
                    else notify("未找到该证物编号");
                  }}
                >
                  <ScanLine size={18} />
                  <input
                    name="id"
                    aria-label="证物编号"
                    placeholder="例如：E-04"
                    defaultValue={
                      new URLSearchParams(location.search).get("clue") || ""
                    }
                  />
                  <Button
                    type="submit"
                    kind="ghost compact"
                    disabled={busy || !clueData}
                  >
                    阅读线索
                  </Button>
                </form>
                <ClueImageReader
                  onDetected={scannedClue}
                  disabled={busy || !clueData}
                />
              </div>
            </details>
            <details className="player-fold">
              <summary>搜证规则</summary>
              <div className="player-fold-content">
                <p>
                  GM确认人物档案、核验票务并现场签到后，可在第三幕开始解锁现场证物。提前扫码可以查看开放提示。
                </p>
                <p>
                  相机中会显示公开的基础证物。满足开放条件后，扫码会将线索保存到你的证据册；私人内容和鉴定仍按剧情进度开放。
                </p>
                <p>
                  相机画面在你的手机上识别。保持现场二维码在镜头内，证物会跟随二维码；墙面证物贴在二维码所在墙面。
                </p>
              </div>
            </details>
          </>
        )}
        {tab === "evidence" && (
          <>
            <div className="notice">
              <Box size={18} />
              <span>
                墙面 3D 搜证已开放：对准现场定位海报，点击模型热点。
                <a className="text-link" href="/ar/wall-study">
                  进入正式搜证 →
                </a>
                　
                <a className="text-link" href="/ar/demo">
                  先体验 3D →
                </a>
              </span>
            </div>
            <div className="section-description evidence-toolbar">
              <p>你收集到的证据会保存在这里，点击卡片重新查看。</p>
              <Badge>
                {clueData?.clues.filter((c) => c.unlocked).length || 0} /{" "}
                {clueData?.clues.length || 0} 已收集
              </Badge>
              <Button
                kind="ghost compact"
                disabled={busy || !clueData}
                onClick={openGallery}
              >
                <Box size={16} /> 360°查看证物
              </Button>
            </div>
            <div className="evidence-grid">
              {clueData?.clues.map((clue) => (
                <button
                  className={
                    "evidence-card " + (clue.unlocked ? "collected" : "")
                  }
                  key={clue.id}
                  onClick={() => openClue(clue)}
                  disabled={busy}
                >
                  <div className="evidence-card-top">
                    <span>{clue.id}</span>
                    {clue.unlocked ? (
                      <CheckCircle2 size={16} />
                    ) : pub.settings.phase < clue.phase ? (
                      <Lock size={16} />
                    ) : (
                      <ArrowUpRight size={16} />
                    )}
                  </div>
                  <div className="evidence-glyph">
                    <FileText size={34} strokeWidth={1} />
                  </div>
                  <small>
                    {clue.area} / {clue.category}
                  </small>
                  <h3>{clue.title}</h3>
                  <div className="evidence-bottom">
                    <span>
                      {clue.skill} DC {clue.dc}
                    </span>
                    <span>
                      {clue.unlocked
                        ? "已收集 · 查看"
                        : pub.settings.phase < clue.phase
                          ? `第${clue.phase}幕开放`
                          : "点击翻牌"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
        {tab === "auction" && (
          <>
            <div className="notice">
              <Coins size={18} />
              <span>
                使用极光金币竞拍。领先出价会预留余额，GM落槌后扣款。道具将在庭审时生效；可联系GM进行现场联盟集资。
              </span>
            </div>
            <div className="two-grid">
              {lots?.map((l) => (
                <AuctionLot
                  key={l.id}
                  lot={l}
                  player={p}
                  busy={busy}
                  onBid={(amount) =>
                    action(async () => {
                      await api(`/lots/${l.id}/bid`, { amount });
                      notify("出价已登记");
                    })
                  }
                />
              ))}
            </div>
            <section className="panel">
              <h3>我的道具背包</h3>
              {data.inventory.length ? (
                data.inventory.map((i) => (
                  <div className="inventory-row" key={i.id}>
                    <div>
                      <strong>{i.title}</strong>
                      <p>{i.description}</p>
                    </div>
                    <Badge>{i.used ? "已使用" : "持有中"}</Badge>
                  </div>
                ))
              ) : (
                <p className="muted">竞拍成交后，道具将在这里出现。</p>
              )}
            </section>
          </>
        )}
        {tab === "court" && (
          <Court
            pub={pub}
            data={data}
            clues={clueData?.clues || []}
            busy={busy}
            onVote={(v) =>
              action(async () => {
                await api("/vote", v);
                notify("最终指控已保存");
              })
            }
            onUse={(id) =>
              action(async () => {
                await api(`/inventory/${id}/use`, {});
                notify("使用已登记，请向GM提出现场申请");
              })
            }
          />
        )}
      </div>
      {qr && (
        <Modal title="你的私人邀请函" onClose={() => setQr(false)}>
          <div className="qr-content">
            <QR value={`${location.origin}/play?identity=${p.id}`} />
            <h3>{c?.name || p.name}</h3>
            <p>
              {p.id.slice(0, 8).toUpperCase()} · 第{p.group_id}调查组
            </p>
            <Badge>{p.checked_in ? "已签到" : "等待现场签到"}</Badge>
            <p className="muted">
              二维码仅用于定位身份，私人档案需登录本人账号。
            </p>
          </div>
        </Modal>
      )}
      {scanning && (
        <QrTrackingScene
          initialClueId={scanClueId}
          onClue={saveTrackedClue}
          onClose={() => setScanning(false)}
        />
      )}
      {model && (
        <EvidenceModelViewer
          clue={model.clue}
          mode={model.mode}
          onClose={() => {
            setModel(null);
            setDetail(model.clue);
            setFlipped(true);
            showModelOnUnlock.current = false;
          }}
        />
      )}
      {gallery &&
        (gallery.loading || gallery.error ? (
          <Modal
            title="360°查看证物"
            wide
            onClose={() => {
              galleryGeneration.current++;
              setGallery(null);
            }}
          >
            <div className="gallery-progress" role="status">
              {gallery.loading ? (
                "正在读取你的已收集证物…"
              ) : (
                <>
                  <p className="gallery-error" role="alert">
                    {gallery.error}
                  </p>
                  {gallery.clues.length > 0 && (
                    <Button
                      onClick={() => setGallery({ ...gallery, error: "" })}
                    >
                      查看已加载的{gallery.clues.length}件证物
                    </Button>
                  )}
                  <Button kind="ghost" onClick={openGallery}>
                    重新加载 <RefreshCw size={15} />
                  </Button>
                </>
              )}
            </div>
          </Modal>
        ) : (
          <ImmersiveGallery
            clues={gallery.clues}
            onClose={() => {
              galleryGeneration.current++;
              setGallery(null);
            }}
          />
        ))}
      {detail && (
        <ClueReveal
          clue={detail}
          flipped={flipped}
          busy={busy}
          blocker={blocker}
          phase={pub.settings.phase}
          onClose={() => {
            detailGeneration.current++;
            setDetail(null);
          }}
          onFlip={flipClue}
          onModel={
            flipped && detail.model_url
              ? () => {
                  setModel({ clue: detail, mode: "ar" });
                  detailGeneration.current++;
                  setDetail(null);
                }
              : undefined
          }
          onCheck={() =>
            action(async () => {
              const generation = detailGeneration.current;
              const check = await api("/check", { clueId: detail.id });
              const d = await api("/clues/" + detail.id);
              if (generation === detailGeneration.current)
                setDetail({ ...detail, ...d, check });
            })
          }
        />
      )}
    </main>
  );
}
function AuctionLot({ lot: l, player: p, onBid, busy }) {
  const [amount, setAmount] = useState(Math.max(l.start_price, l.bid + 1));
  useEffect(
    () => setAmount(Math.max(l.start_price, l.bid + 1)),
    [l.bid, l.start_price],
  );
  return (
    <section className="panel lot-card">
      <div className="lot-heading">
        <span className="eyebrow">LOT / {String(l.id).padStart(2, "0")}</span>
        <Badge tone={l.status === "open" ? "green" : ""}>
          {l.status === "open"
            ? "竞拍中"
            : l.status === "sold"
              ? "已落槌"
              : "等待开拍"}
        </Badge>
      </div>
      <h3>{l.title}</h3>
      <p>{l.description}</p>
      <div className="lot-price">
        <strong>{l.bid || l.start_price}</strong>
        <span>金币 · {l.bid ? "当前出价" : "起拍价"}</span>
        {l.bidder === p.id && <Badge tone="gold">你暂时领先</Badge>}
      </div>
      <form
        className="bid-form"
        onSubmit={(e) => {
          e.preventDefault();
          onBid(Number(amount));
        }}
      >
        <input
          aria-label={l.title + "出价"}
          type="number"
          min={Math.max(l.start_price, l.bid + 1)}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          disabled={l.status !== "open"}
        />
        <Button
          type="submit"
          kind="ghost"
          disabled={busy || l.status !== "open"}
        >
          出价 <ArrowUpRight size={15} />
        </Button>
      </form>
    </section>
  );
}
function Court({ pub, data, clues, onVote, onUse, busy }) {
  const unlocked = clues.filter((c) => c.unlocked),
    v = data.vote;
  return (
    <>
      <div className="notice">
        <Gavel size={20} />
        <span>
          指认嫌疑人，并以三张已收集的证据分别支持动机、手段和机会。GM开放投票后可提交，关闭前可更新。
        </span>
      </div>
      <section className="panel">
        <span className="eyebrow">MOTIVE / MEANS / OPPORTUNITY</span>
        <h2>提交你的最终指控</h2>
        {v && <Badge tone="green">已提交 · 可在投票关闭前更新</Badge>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onVote(Object.fromEntries(new FormData(e.currentTarget)));
          }}
        >
          <Field label="你认为谁是真凶？">
            <select name="suspect" defaultValue={v?.suspect} required>
              <option value="">请选择嫌疑人</option>
              {pub.npcs.map((n) => (
                <option value={n.id} key={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="three-grid">
            {[
              ["motive", "作案动机"],
              ["means", "作案手段"],
              ["opportunity", "作案机会"],
            ].map(([key, label]) => (
              <Field label={label} key={key}>
                <select name={key} defaultValue={v?.[key]} required>
                  <option value="">选择支持证据</option>
                  {unlocked.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.id} · {c.title}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
          <Field label="你希望如何处理集团秘密？">
            <select name="decision" defaultValue={v?.decision || "publish"}>
              <option value="publish">公开真相</option>
              <option value="protect">保全家族的合法利益</option>
              <option value="destroy">销毁普罗米修斯系统</option>
            </select>
          </Field>
          <Button type="submit" disabled={busy || !pub.settings.voting}>
            {pub.settings.voting ? "提交最终指控" : "等待GM开启投票"}
            <Gavel size={16} />
          </Button>
        </form>
      </section>
      <section className="panel">
        <h3>庭审道具</h3>
        {data.inventory.length ? (
          data.inventory.map((i) => (
            <div className="inventory-row" key={i.id}>
              <div>
                <strong>{i.title}</strong>
                <p>{i.description}</p>
              </div>
              <Button
                kind="ghost compact"
                onClick={() => onUse(i.id)}
                disabled={busy || !!i.used || pub.settings.phase !== 4}
              >
                {i.used ? "已登记使用" : "申请使用"}
              </Button>
            </div>
          ))
        ) : (
          <p className="muted">你尚未持有庭审道具。</p>
        )}
      </section>
    </>
  );
}

export default Player;
