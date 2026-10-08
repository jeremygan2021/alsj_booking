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
import { api } from "../api";
import { phases, factions, formatTime } from "../constants";
import { Audit, PlayerReview, ContentEditor } from "../components/StaffForms";
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
function Admin({ pub, session, notify }) {
  const [data, refresh] = useResource("/staff", notify),
    [tab, setTab] = useState(session.role === "npc" ? "missions" : "overview"),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [detail, setDetail] = useState(null),
    [qr, setQr] = useState(null),
    [edit, setEdit] = useState(null),
    [busy, setBusy] = useState(false);
  const gm = session.role === "gm";
  const action = async (fn) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  };
  const inspect = (id) =>
    action(async () => setDetail(await api("/staff/players/" + id)));
  if (!data) return <div className="boot">正在连接导演控制台…</div>;
  const links = gm
    ? [
        ["overview", "总览", LayoutDashboard],
        ["players", "宾客与角色", Users],
        ["npcs", "NPC档案", Briefcase],
        ["evidence", "证据与二维码", ScanLine],
        ["missions", "任务与金币", Coins],
        ["auction", "拍卖管理", Gavel],
        ["events", "全场广播", Radio],
        ["court", "庭审与投票", Shield],
        ["settings", "活动设置", Layers],
      ]
    : [
        ["missions", "我的NPC委托", Compass],
        ["players", "现场宾客", Users],
      ];
  const awaiting = data.players.filter((p) => p.status === "pending"),
    checked = data.players.filter((p) => p.checked_in);
  const filtered = data.players.filter(
    (p) =>
      `${p.name} ${p.character || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "all" ||
        (filter === "pending" && p.status === "pending") ||
        (filter === "paid" && p.payment === "paid") ||
        (filter === "checkin" && p.checked_in)),
  );
  const playerTable = (
    <>
      <div className="table-toolbar">
        <div className="search">
          <Search size={17} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索宾客或角色姓名"
            aria-label="搜索宾客"
          />
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="筛选宾客"
        >
          <option value="all">全部宾客</option>
          <option value="pending">待审核角色</option>
          <option value="paid">已核验票务</option>
          <option value="checkin">已签到</option>
        </select>
      </div>
      {filtered.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>宾客 / 角色</th>
                <th>调查组</th>
                <th>票务</th>
                <th>角色状态</th>
                {gm && <th>真实阵营</th>}
                <th>金币</th>
                <th>签到</th>
                {gm && <th>操作</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.name}</strong>
                    <small>{p.character || "未填写角色"}</small>
                  </td>
                  <td>G{p.group_id}</td>
                  <td>
                    <Badge tone={p.payment === "paid" ? "green" : ""}>
                      {p.payment === "paid"
                        ? "已核验"
                        : p.payment === "refunded"
                          ? "已退款"
                          : "待核验"}
                    </Badge>
                  </td>
                  <td>
                    <Badge tone={p.status === "approved" ? "green" : "gold"}>
                      {p.status === "approved"
                        ? "已批准"
                        : p.status === "pending"
                          ? "待审核"
                          : "未建立"}
                    </Badge>
                  </td>
                  {gm && (
                    <td className="muted">{factions[p.faction] || "—"}</td>
                  )}
                  <td>{p.coins}</td>
                  <td>
                    {p.checked_in ? (
                      <Check size={17} />
                    ) : (
                      <span className="muted">未签到</span>
                    )}
                  </td>
                  {gm && (
                    <td>
                      <button
                        className="text-button"
                        onClick={() => inspect(p.id)}
                      >
                        管理 <ArrowUpRight size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title="暂无匹配宾客"
          text="报名后，宾客数据和待审核角色会显示在这里。"
        />
      )}
    </>
  );
  const missionList = (
    <>
      {data.missions.length ? (
        data.missions.map((m) => (
          <div className="mission-row" key={m.id}>
            <div
              className={"mission-icon " + (m.status === "done" ? "done" : "")}
            >
              <Icon as={m.status === "done" ? Check : Compass} />
            </div>
            <div>
              <small>
                {data.players.find((p) => p.id === m.player_id)?.name} ·{" "}
                {data.npcs.find((n) => n.id === m.npc_id)?.name}
              </small>
              <h3>{m.title}</h3>
            </div>
            <Badge>+{m.reward}</Badge>
            <Button
              disabled={busy || m.status === "done"}
              kind="ghost compact"
              onClick={() =>
                action(async () => {
                  await api(`/staff/missions/${m.id}/complete`, {});
                  notify("任务已确认，奖励已入账");
                })
              }
            >
              {m.status === "done" ? "已完成" : "确认完成"}
            </Button>
          </div>
        ))
      ) : (
        <Empty
          title="暂无待确认委托"
          text="玩家提交角色后，NPC的破冰委托会在这里出现。"
        />
      )}
    </>
  );
  return (
    <main className="admin-layout">
      <aside className="admin-sidebar">
        <div className="console-brand">
          <Shield size={23} />
          <div>
            AURORA<small>{gm ? "GAME MASTER" : "NPC OPERATIONS"}</small>
          </div>
        </div>
        <div className="workspace-tag">
          <span className="pulse" /> 万圣节 · 2026场
        </div>
        <nav>
          {links.map(([id, label, I]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              <Icon as={I} />
              {label}
              {id === "players" && !!awaiting.length && (
                <span className="nav-count">{awaiting.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-bottom">
          <span className="eyebrow">DIRECTOR ACCESS</span>
          <p>
            {gm
              ? "GM · 导演账号"
              : data.npcs.find((n) => n.id === session.id)?.name}
          </p>
          <small>
            当前内容{gm ? "包含保密剧本" : "仅限现场任务"}
            <br />
            请勿向宾客公开工作人员账号
          </small>
        </div>
      </aside>
      <div className="admin-main">
        <div className="admin-breadcrumb">
          工作空间 <ChevronRight size={13} /> 阿拉斯加之夜{" "}
          <ChevronRight size={13} />{" "}
          <span>{links.find((l) => l[0] === tab)?.[1]}</span>
          <button aria-label="刷新数据" onClick={refresh}>
            <RefreshCw size={15} />
          </button>
        </div>
        <div className="page-heading">
          <div>
            <span className="eyebrow">
              ALASKA NIGHTS / {gm ? "DIRECTOR CONSOLE" : "NPC TERMINAL"}
            </span>
            <h1>
              {tab === "overview"
                ? "今晚，一切尽在掌握"
                : links.find((l) => l[0] === tab)?.[1]}
            </h1>
            <p className="muted">
              {tab === "overview"
                ? "管理宾客、推进故事，导演属于所有人的最后一夜。"
                : "现场状态每8秒更新，操作与资源变化自动记录。"}
            </p>
          </div>
          <Badge tone="green">
            <span className="pulse" /> 系统在线
          </Badge>
        </div>
        {tab === "overview" && (
          <>
            <div className="stats-grid">
              {[
                [
                  data.players.length,
                  "已报名宾客",
                  `容量 ${data.settings.capacity} 位`,
                  Users,
                ],
                [
                  checked.length,
                  "现场已签到",
                  `${data.players.filter((p) => p.payment === "paid").length} 位票务已核验`,
                  Ticket,
                ],
                [awaiting.length, "待审核档案", "为每位宾客安排命运", FileText],
                [
                  data.stats.unlocks,
                  "证据解锁次数",
                  `${data.stats.votes} 份终局投票`,
                  BookOpen,
                ],
              ].map(([n, title, note, I]) => (
                <section className="stat-card" key={title}>
                  <div>
                    <span>{title}</span>
                    <Icon as={I} />
                  </div>
                  <strong>{String(n).padStart(2, "0")}</strong>
                  <small>{note}</small>
                </section>
              ))}
            </div>
            <div className="dashboard-columns">
              <section className="panel phase-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">STORY CONTROL</span>
                    <h3>四幕剧情控制</h3>
                  </div>
                  <Badge tone="gold">第{data.settings.phase}幕进行中</Badge>
                </div>
                <div className="phase-list">
                  {phases.map((name, i) => (
                    <div
                      className={
                        "phase-row " +
                        (data.settings.phase === i + 1 ? "current" : "")
                      }
                      key={name}
                    >
                      <span className="phase-dot">
                        {i + 1 < data.settings.phase ? (
                          <Check size={14} />
                        ) : (
                          String(i + 1).padStart(2, "0")
                        )}
                      </span>
                      <div>
                        <strong>{name}</strong>
                        <small>
                          {
                            [
                              "19:00—20:15 · 破冰与金币",
                              "20:15—20:45 · 竞拍与交易",
                              "20:45—21:50 · 扫码与D20搜证",
                              "21:50—23:00 · 质询与最终判决",
                            ][i]
                          }
                        </small>
                      </div>
                      <Button
                        kind="ghost compact"
                        disabled={busy || data.settings.phase === i + 1}
                        onClick={() =>
                          action(async () => {
                            await api("/staff/phase", { phase: i + 1 });
                            notify(`已开启第${i + 1}幕，全场通知已发布`);
                          })
                        }
                      >
                        {data.settings.phase === i + 1
                          ? "进行中"
                          : "切换到此幕"}
                      </Button>
                    </div>
                  ))}
                </div>
                <p className="muted small-text">
                  切幕后将自动广播；第二幕开放竞拍，第三幕开放证据和小组鉴定，第四幕开放道具使用。
                </p>
              </section>
              <section className="panel quick-panel">
                <span className="eyebrow">TONIGHT'S PRIORITIES</span>
                <h3>现场待办</h3>
                <button onClick={() => setTab("players")}>
                  <span>
                    <FileText size={19} />
                    <strong>审核宾客角色</strong>
                  </span>
                  <Badge tone="gold">{awaiting.length} 位</Badge>
                </button>
                <button onClick={() => setTab("players")}>
                  <span>
                    <Ticket size={19} />
                    <strong>核验报名票务</strong>
                  </span>
                  <Badge>
                    {data.players.filter((p) => p.payment === "pending").length}{" "}
                    位
                  </Badge>
                </button>
                <button onClick={() => setTab("events")}>
                  <span>
                    <Radio size={19} />
                    <strong>发布全场事件</strong>
                  </span>
                  <ArrowUpRight size={17} />
                </button>
                <div className="gm-note">
                  <span>导演提醒</span>
                  <p>
                    同伙保持隐藏，关键证据始终保留。让人物自由扮演，让真相保持一致。
                  </p>
                </div>
              </section>
            </div>
            <section className="panel">
              <div className="panel-heading">
                <h3>宾客档案</h3>
                <button
                  className="text-button"
                  onClick={() => setTab("players")}
                >
                  查看全部 <ArrowRight size={15} />
                </button>
              </div>
              {playerTable}
            </section>
            <section className="panel">
              <span className="eyebrow">LIVE ACTIVITY</span>
              <h3>操作记录</h3>
              <Audit rows={data.audit} />
            </section>
          </>
        )}
        {tab === "players" && (
          <section className="panel">{playerTable}</section>
        )}
        {tab === "npcs" && (
          <div className="two-grid">
            {data.npcs.map((n) => (
              <section className="panel staff-npc" key={n.id}>
                <div className="panel-heading">
                  <Badge>{n.role}</Badge>
                  <Button
                    kind="ghost compact"
                    onClick={() => setEdit({ type: "npc", data: n })}
                  >
                    编辑
                  </Button>
                </div>
                <h3>{n.name}</h3>
                <span className="eyebrow">{n.english}</span>
                <p>{n.bio}</p>
                <div className="secret-note">
                  <Lock size={14} />
                  <div>
                    <small>GM专属秘密</small>
                    <p>{n.secret}</p>
                  </div>
                </div>
              </section>
            ))}
          </div>
        )}
        {tab === "evidence" && (
          <>
            <div className="notice">
              <Lock size={19} />
              <span>
                此页包含全部证据背面，只有GM可见。打印现场二维码时请使用部署后的真实域名，当前二维码使用本机地址。
              </span>
            </div>
            <div className="evidence-grid">
              {data.clues.map((c) => (
                <section className="panel staff-clue" key={c.id}>
                  <div className="panel-heading">
                    <Badge tone="gold">
                      {c.id} · {c.area}
                    </Badge>
                    <span className="muted">DC {c.dc}</span>
                  </div>
                  <h3>{c.title}</h3>
                  <p>{c.body}</p>
                  <details>
                    <summary>查看进阶信息</summary>
                    <p>{c.detail}</p>
                  </details>
                  <div className="staff-clue-actions">
                    <Button kind="ghost compact" onClick={() => setQr(c)}>
                      <ScanLine size={15} /> 二维码
                    </Button>
                    <Button
                      kind="ghost compact"
                      onClick={() => setEdit({ type: "clue", data: c })}
                    >
                      编辑证据
                    </Button>
                  </div>
                </section>
              ))}
            </div>
          </>
        )}
        {tab === "missions" && (
          <>
            <section className="panel">
              <h3>{gm ? "NPC任务确认" : "我的现场委托"}</h3>
              {missionList}
            </section>
            {gm && (
              <section className="panel">
                <h3>金币调整与应急放行</h3>
                <p className="muted">
                  联盟集资可通过扣除各成员金币、给代表增加金币完成，填写调整原因便于对账。
                </p>
                <form
                  className="two-grid"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const d = Object.fromEntries(new FormData(e.currentTarget));
                    action(async () => {
                      await api("/staff/coins", {
                        ...d,
                        amount: Number(d.amount),
                      });
                      notify("金币调整已记录");
                    });
                  }}
                >
                  <Field label="选择宾客">
                    <select required name="playerId">
                      <option value="">选择宾客</option>
                      {data.players.map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.name} · {p.coins}金币
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="金币变化（正数增加、负数扣除）">
                    <input
                      name="amount"
                      type="number"
                      required
                      min={-1000}
                      max={1000}
                      placeholder="例如 5 或 -5"
                    />
                  </Field>
                  <Field label="调整原因">
                    <input
                      name="reason"
                      required
                      placeholder="现场集资 / 奖励 / 纠错"
                      maxLength={120}
                    />
                  </Field>
                  <div className="form-end">
                    <Button type="submit" disabled={busy}>
                      记录金币调整
                    </Button>
                  </div>
                </form>
                <hr />
                <form
                  className="two-grid"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const d = Object.fromEntries(new FormData(e.currentTarget));
                    action(async () => {
                      await api("/staff/unlock", d);
                      notify("基础证据已放行，玩家可在证据册查看");
                    });
                  }}
                >
                  <Field label="应急放行 · 选择宾客">
                    <select name="playerId" required>
                      <option value="">选择宾客</option>
                      {data.players.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="选择证据">
                    <select name="clueId">
                      {data.clues.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.id} · {c.title}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Button type="submit" disabled={busy} kind="ghost">
                    放行基础证据
                  </Button>
                </form>
              </section>
            )}
          </>
        )}
        {tab === "auction" && (
          <div className="two-grid">
            {data.lots.map((l) => (
              <section className="panel" key={l.id}>
                <div className="panel-heading">
                  <span className="eyebrow">
                    LOT / {String(l.id).padStart(2, "0")}
                  </span>
                  <Badge tone={l.status === "open" ? "green" : ""}>
                    {l.status === "sold"
                      ? "已成交"
                      : l.status === "open"
                        ? "竞拍中"
                        : "待开放"}
                  </Badge>
                </div>
                <h3>{l.title}</h3>
                <p>{l.description}</p>
                <div className="lot-price">
                  <strong>{l.bid || l.start_price}</strong>
                  <span>金币</span>
                </div>
                <p className="muted">
                  领先宾客：
                  {data.players.find((p) => p.id === l.bidder)?.name ||
                    "暂无出价"}
                </p>
                <Button
                  kind="ghost"
                  disabled={
                    busy ||
                    l.status === "sold" ||
                    (l.status === "open" && !l.bidder)
                  }
                  onClick={() =>
                    action(async () => {
                      await api("/staff/lots/" + l.id, {
                        action: l.status === "waiting" ? "open" : "settle",
                      });
                      notify(
                        l.status === "waiting"
                          ? "拍品已开放"
                          : "已落槌，金币扣除并发放道具",
                      );
                    })
                  }
                >
                  {l.status === "waiting"
                    ? "开放竞拍"
                    : l.status === "sold"
                      ? "已完成成交"
                      : "落槌成交"}
                  <Gavel size={16} />
                </Button>
              </section>
            ))}
          </div>
        )}
        {tab === "events" && (
          <div className="dashboard-columns">
            <section className="panel">
              <span className="eyebrow">BROADCAST TO ALL GUESTS</span>
              <h2>让整个庄园听到你的声音</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = e.currentTarget,
                    d = Object.fromEntries(new FormData(f));
                  action(async () => {
                    await api("/staff/events", d);
                    notify("广播已发布，在线玩家将在12秒内收到");
                    f.reset();
                  });
                }}
              >
                <Field label="事件标题">
                  <input
                    name="title"
                    required
                    maxLength={80}
                    placeholder="普罗米修斯系统警报"
                  />
                </Field>
                <Field label="全场消息">
                  <textarea
                    name="body"
                    rows={6}
                    required
                    maxLength={1000}
                    placeholder="所有宾客请前往庄园大厅，新的剧情即将开始。"
                  />
                </Field>
                <Button type="submit" disabled={busy}>
                  <Radio size={17} /> 发布全场广播
                </Button>
              </form>
            </section>
            <section className="panel">
              <h3>已发布事件</h3>
              {data.events.length ? (
                data.events.map((e) => (
                  <div className="broadcast-row" key={e.id}>
                    <small>{formatTime(e.created_at)}</small>
                    <h4>{e.title}</h4>
                    <p>{e.body}</p>
                  </div>
                ))
              ) : (
                <Empty
                  title="庄园暂时安静"
                  text="广播与切幕通知会显示在这里。"
                />
              )}
            </section>
          </div>
        )}
        {tab === "court" && (
          <>
            <div className="stats-grid">
              <section className="stat-card">
                <span>有效投票</span>
                <strong>{data.stats.votes}</strong>
                <small>每位玩家保留最后一次提交</small>
              </section>
              <section className="stat-card">
                <span>现场已签到</span>
                <strong>{checked.length}</strong>
                <small>陪审团人数参考</small>
              </section>
              <section className="stat-card">
                <span>投票状态</span>
                <strong className="word-stat">
                  {data.settings.voting ? "开放中" : "未开放"}
                </strong>
                <small>仅第四幕可开启</small>
              </section>
            </div>
            <section className="panel">
              <div className="panel-heading">
                <h3>最终判决管理</h3>
                <Button
                  disabled={busy || data.settings.phase !== 4}
                  onClick={() =>
                    action(async () => {
                      await api("/staff/voting", {
                        open: !data.settings.voting,
                      });
                      notify(
                        data.settings.voting ? "投票已关闭" : "投票已开启",
                      );
                    })
                  }
                >
                  {data.settings.voting ? "关闭投票" : "开放最终投票"}
                  <Gavel size={16} />
                </Button>
              </div>
              <p className="muted">
                GM现场核对动机、手段和机会三项证明。多数正确指认且三项成立，调查方赢得主案；此页展示投票汇总，不自动替代证据审核。
              </p>
              {data.votes.length ? (
                data.votes.map((v) => (
                  <div className="vote-row" key={v.suspect}>
                    <strong>
                      {data.npcs.find((n) => n.id === v.suspect)?.name}
                    </strong>
                    <div className="vote-bar">
                      <span
                        style={{
                          width:
                            (v.n / Math.max(data.stats.votes, 1)) * 100 + "%",
                        }}
                      />
                    </div>
                    <span>{v.n} 票</span>
                  </div>
                ))
              ) : (
                <Empty
                  title="还没有终局指控"
                  text="开启投票后，宾客的最终指控会在这里汇总。"
                />
              )}
            </section>
            <section className="panel">
              <h3>庭审道具使用记录</h3>
              <Audit
                rows={data.audit.filter((a) => a.action.includes("庭审"))}
              />
            </section>
          </>
        )}
        {tab === "settings" && (
          <>
            <section className="panel">
              <h3>活动基本设置</h3>
              <form
                className="two-grid"
                onSubmit={(e) => {
                  e.preventDefault();
                  const d = Object.fromEntries(new FormData(e.currentTarget));
                  action(async () => {
                    await api("/staff/settings", {
                      capacity: Number(d.capacity),
                      price: Number(d.price),
                    });
                    notify("活动设置已保存");
                  });
                }}
              >
                <Field label="报名名额（最多100人）">
                  <input
                    name="capacity"
                    type="number"
                    min={data.players.length || 1}
                    max={100}
                    defaultValue={data.settings.capacity}
                    required
                  />
                </Field>
                <Field label="门票参考价格（元）">
                  <input
                    name="price"
                    type="number"
                    min={0}
                    max={10000}
                    defaultValue={data.settings.price}
                    required
                  />
                </Field>
                <Button type="submit" disabled={busy}>
                  保存活动设置
                </Button>
              </form>
            </section>
            <section className="panel">
              <h3>首版运营说明</h3>
              <p>
                本场为2026年10月31日的万圣节活动。地点以线下正式通知为准。当前角色采用受控模板，票务采用人工核验；角色立绘、最终主持台本及完整证据链应在活动前由策划确认。
              </p>
              <p>
                数据库使用本地SQLite。正式部署时配置真实域名与HTTPS，修改工作人员密码，并定期备份数据库。NPC账号有各自的登录口令，GM与NPC权限分开。
              </p>
              <a
                className="text-link"
                href="/"
                target="_blank"
                rel="noreferrer"
              >
                打开公开报名页 <ArrowUpRight size={15} />
              </a>
            </section>
            <section className="panel">
              <h3>报名入口二维码</h3>
              <QR value={location.origin} />
              <p className="muted">
                当前地址：{location.origin}
                。本机地址无法供其他手机直接访问，部署后再打印。
              </p>
            </section>
          </>
        )}
      </div>
      {detail && (
        <Modal title="宾客档案管理" wide onClose={() => setDetail(null)}>
          <PlayerReview
            data={detail}
            busy={busy}
            onUpdate={(d) =>
              action(async () => {
                await api("/staff/players/" + detail.player.id, d);
                setDetail(await api("/staff/players/" + detail.player.id));
                notify("宾客档案已更新");
              })
            }
          />
        </Modal>
      )}
      {qr && (
        <Modal title={qr.id + " · " + qr.title} onClose={() => setQr(null)}>
          <div className="qr-content">
            <QR value={`${location.origin}/play?clue=${qr.id}`} />
            <p>场景线索码 · {qr.area}</p>
            <a
              className="text-link"
              href={"/play?clue=" + qr.id}
              target="_blank"
              rel="noreferrer"
            >
              打开线索入口 <ArrowUpRight size={15} />
            </a>
            <small className="muted">
              二维码定位证物，服务端验证剧情阶段与玩家身份。
            </small>
          </div>
        </Modal>
      )}
      {edit && (
        <Modal
          title={edit.type === "clue" ? "编辑证据卡" : "编辑NPC档案"}
          onClose={() => setEdit(null)}
        >
          <ContentEditor
            edit={edit}
            busy={busy}
            onSubmit={(d) =>
              action(async () => {
                await api(
                  "/staff/" +
                    (edit.type === "clue" ? "clues/" : "npcs/") +
                    edit.data.id,
                  d,
                );
                setEdit(null);
                notify("内容已保存");
              })
            }
          />
        </Modal>
      )}
    </main>
  );
}
export default Admin;
