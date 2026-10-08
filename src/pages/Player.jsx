import React, { useState, useEffect, useCallback, useRef } from "react";
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
import { api } from "../api";
import { phases, factions } from "../constants";
import {
  Icon,
  Button,
  Badge,
  Empty,
  Field,
  Modal,
  QR,
  useResource,
} from "../components/ui";
import ClueScanner from "../components/ClueScanner";
import ClueReveal from "../components/ClueReveal";
import { parseClueCode } from "../clue-scan";
function Player({ pub, notify }) {
  const [data, refresh] = useResource("/me", notify),
    [tab, setTab] = useState("identity"),
    [clueData, refreshClues] = useResource("/clues", notify),
    [lots, refreshLots] = useResource("/lots", notify),
    [qr, setQr] = useState(new URLSearchParams(location.search).has("welcome")),
    [detail, setDetail] = useState(null),
    [flipped, setFlipped] = useState(false),
    [scanning, setScanning] = useState(false),
    [busy, setBusy] = useState(false);
  const handledClue = useRef(null),
    detailGeneration = useRef(0);
  const openClue = (clue) => {
    detailGeneration.current++;
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
      setDetail(clue);
      setFlipped(false);
      setTab("evidence");
    } else notify("未找到该线索卡，请扫描现场二维码或输入有效编号");
  }, [clueData, data, notify]);
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
      setDetail({ ...detail, ...d, unlocked: true });
      setFlipped(true);
    });
  const scannedClue = (raw) => {
    const id = parseClueCode(raw, location.origin);
    if (!id) throw new Error("这不是本活动的线索二维码，请扫描现场线索卡。");
    const clue = clueData?.clues.find((c) => c.id === id);
    if (!clue) throw new Error("该线索编号不存在，请向GM核对。");
    setScanning(false);
    openClue(clue);
  };
  const links = [
    ["identity", "人物档案", FileText],
    ["missions", "私人任务", Compass],
    ["evidence", "证据册", BookOpen],
    ["auction", "命运拍卖", Coins],
    ["court", "模拟庭审", Gavel],
  ];
  return (
    <main className="player-layout">
      <aside className="player-sidebar">
        <span className="eyebrow">YOUR PRIVATE DOSSIER</span>
        <div className="avatar-monogram">{c?.english?.[0] || p.name[0]}</div>
        <h2>{c?.name || p.name}</h2>
        <p>{c?.english || "身份尚待建立"}</p>
        <Badge tone={c?.status === "approved" ? "green" : "gold"}>
          {c?.status === "approved"
            ? "角色已确认"
            : c
              ? "档案待审核"
              : "等待建立角色"}
        </Badge>
        <div className="wallet">
          <Coins size={22} />
          <strong>{p.coins}</strong>
          <span>
            极光金币<small>仅限游戏使用</small>
          </span>
        </div>
        <div className="player-nav">
          {links.map(([id, title, I]) => (
            <button
              className={tab === id ? "active" : ""}
              key={id}
              onClick={() => setTab(id)}
            >
              <Icon as={I} />
              {title}
              <ChevronRight size={15} />
            </button>
          ))}
        </div>
        <Button kind="ghost full" onClick={() => setQr(true)}>
          <ScanLine size={17} /> 我的身份码
        </Button>
        <span className="sidebar-note">
          调查组 {p.group_id} · 票务{p.payment === "paid" ? "已核验" : "待核验"}
        </span>
      </aside>
      <div className="player-main">
        <div className="page-heading">
          <div>
            <span className="eyebrow">ALASKA NIGHTS / PLAYER TERMINAL</span>
            <h1>{links.find((l) => l[0] === tab)[1]}</h1>
          </div>
          <Badge tone="green">
            <span className="pulse" /> 第{pub.settings.phase}幕 ·{" "}
            {phases[pub.settings.phase - 1]}
          </Badge>
        </div>
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
            {!c || c.status !== "approved" ? (
              <CharacterForm
                character={c}
                onSubmit={(d) =>
                  action(async () => {
                    await api("/character", d);
                    notify("档案已保存，等待GM审核。当前使用受控模板生成。");
                  })
                }
                busy={busy}
              />
            ) : (
              <>
                <div className="identity-card">
                  <div className="identity-heading">
                    <span className="eyebrow">
                      OFFICIAL INVITATION / {p.id.slice(0, 8).toUpperCase()}
                    </span>
                    <Shield size={25} />
                  </div>
                  <h2>{c.name}</h2>
                  <p className="english-name">{c.english}</p>
                  <div className="identity-meta">
                    <Badge>{c.profession}</Badge>
                    <Badge>{c.skill} +2</Badge>
                    <Badge>第{p.group_id}调查组</Badge>
                  </div>
                  <p>{c.story}</p>
                  <div className="identity-bottom">
                    <span>赴宴理由</span>
                    <strong>{c.motive}</strong>
                    <span className="stamp">ADMITTED</span>
                  </div>
                </div>
                <div className="two-grid">
                  <section className="panel">
                    <span className="eyebrow">FOR YOUR EYES ONLY</span>
                    <h3>
                      <Lock size={17} /> 秘密身份
                    </h3>
                    <Badge tone="gold">{factions[c.faction]}</Badge>
                    <p>{c.secret}</p>
                  </section>
                  <section className="panel">
                    <span className="eyebrow">YOUR CONNECTION</span>
                    <h3>你的NPC联系人</h3>
                    <p className="connection-name">
                      {pub.npcs.find((n) => n.id === c.npc_id)?.name}
                    </p>
                    <p>
                      这位联系人认识你的过去。找到对方，开启今晚的第一段对话。
                    </p>
                  </section>
                </div>
              </>
            )}
            <section className="panel">
              <h3>邀请函状态</h3>
              <div className="status-track">
                <span>
                  <CheckCircle2 size={17} /> 报名完成
                </span>
                <span className={p.payment === "paid" ? "" : "muted"}>
                  <Ticket size={17} /> 票务
                  {p.payment === "paid" ? "已核验" : "待核验"}
                </span>
                <span className={p.checked_in ? "" : "muted"}>
                  <ScanLine size={17} />{" "}
                  {p.checked_in ? "已签到" : "等待现场签到"}
                </span>
              </div>
              <p className="muted">
                身份二维码指向你的档案入口，查看私人信息需要登录本人账号。现场由工作人员核对并签到。
              </p>
            </section>
          </>
        )}
        {tab === "missions" && (
          <>
            <p className="section-description">
              与NPC互动，完成委托。金币由对应NPC现场确认发放，第一幕累计奖励上限10枚（含签到）。
            </p>
            {data.missions.length ? (
              data.missions.map((m) => (
                <div className="mission-row" key={m.id}>
                  <div
                    className={
                      "mission-icon " + (m.status === "done" ? "done" : "")
                    }
                  >
                    <Icon as={m.status === "done" ? Check : Compass} />
                  </div>
                  <div>
                    <small>
                      {pub.npcs.find((n) => n.id === m.npc_id)?.name}
                    </small>
                    <h3>{m.title}</h3>
                  </div>
                  <Badge tone={m.status === "done" ? "green" : "gold"}>
                    {m.status === "done" ? "已完成" : `+${m.reward} 金币`}
                  </Badge>
                </div>
              ))
            ) : (
              <Empty
                title="私人委托尚未解锁"
                text="GM批准角色后，你的NPC联系人将为你安排委托。"
              />
            )}
            <section className="panel">
              <h3>金币流水</h3>
              {data.ledger.length ? (
                data.ledger.map((l) => (
                  <div className="ledger-row" key={l.id}>
                    <span>{l.reason}</span>
                    <strong>
                      {l.amount > 0 ? "+" : ""}
                      {l.amount}
                    </strong>
                  </div>
                ))
              ) : (
                <p className="muted">签到后获得3枚初始金币。</p>
              )}
            </section>
          </>
        )}
        {tab === "evidence" && (
          <>
            <div className="section-description evidence-toolbar">
              <p>
                基础证据不依赖运气。每组每区可进行一次主要鉴定，成功后获得进阶信息。
              </p>
              <Badge>
                {clueData?.clues.filter((c) => c.unlocked).length || 0} /{" "}
                {clueData?.clues.length || 0} 已收集
              </Badge>
            </div>
            <div className="clue-scan-entry">
              <Button
                onClick={() => setScanning(true)}
                disabled={busy || !clueData}
              >
                <ScanLine size={19} />
                扫码开启线索卡
              </Button>
              <span>相机扫码 · 图片识别 · 点击翻牌</span>
            </div>
            <form
              className="scan-form"
              onSubmit={(e) => {
                e.preventDefault();
                const id = parseClueCode(
                  new FormData(e.currentTarget).get("id"),
                  location.origin,
                );
                const clue = clueData?.clues.find((c) => c.id === id);
                if (clue) openClue(clue);
                else notify("未找到该证物编号");
              }}
            >
              <ScanLine size={19} />
              <input
                name="id"
                aria-label="证物编号"
                placeholder="扫描现场二维码，或输入编号 E-04"
                defaultValue={
                  new URLSearchParams(location.search).get("clue") || ""
                }
              />
              <Button type="submit" kind="ghost compact" disabled={busy}>
                查验证物
              </Button>
            </form>
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
        <ClueScanner
          onDetected={scannedClue}
          onClose={() => setScanning(false)}
        />
      )}
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
function CharacterForm({ character: c, onSubmit, busy }) {
  return (
    <section className="panel character-form">
      <span className="eyebrow">AURORA / CHARACTER REGISTRY</span>
      <h2>{c ? "你的档案正在等待审核" : "建立你的宴会身份"}</h2>
      <p className="muted">
        写一个虚构的你。系统将从固定世界观中分配NPC关系和任务，由GM决定最终阵营。
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(Object.fromEntries(new FormData(e.currentTarget)));
        }}
      >
        <div className="two-grid">
          <Field label="中文音译姓名">
            <input
              name="name"
              required
              maxLength={60}
              defaultValue={c?.name}
              placeholder="例如：莱恩·米勒"
            />
          </Field>
          <Field label="英文姓名">
            <input
              name="english"
              required
              maxLength={60}
              defaultValue={c?.english}
              placeholder="Ryan Miller"
            />
          </Field>
          <Field label="公开职业">
            <input
              name="profession"
              required
              maxLength={60}
              defaultValue={c?.profession}
              placeholder="调查员 / 金融家 / 技术顾问"
            />
          </Field>
          <Field label="擅长技能">
            <select name="skill" defaultValue={c?.skill || "洞察"}>
              <option>洞察</option>
              <option>技术</option>
              <option>社交</option>
            </select>
          </Field>
        </div>
        <Field label="你为什么来到这场舞会？">
          <input
            name="motive"
            required
            maxLength={100}
            defaultValue={c?.motive}
            placeholder="寻找真相，改变命运，或找回一个人"
          />
        </Field>
        <Field label="你与ECHO集团的过去">
          <textarea
            name="story"
            required
            maxLength={2000}
            rows={5}
            defaultValue={c?.story}
            placeholder="你从哪里来？你曾做过什么？你为什么会收到邀请？只填写虚构故事。"
          />
        </Field>
        <div className="notice">
          <Shield size={17} />
          <span>
            当前使用受控角色模板；主线真相不会被自动改写，隐藏同伙须由GM审核分配。
          </span>
        </div>
        <Button type="submit" disabled={busy}>
          {busy ? "保存中…" : c ? "更新档案并重新提交" : "生成档案并提交审核"}
          <ArrowUpRight size={16} />
        </Button>
      </form>
    </section>
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
