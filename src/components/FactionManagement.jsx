import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Dices,
  KeyRound,
  Lock,
  RefreshCw,
  Search,
  Shield,
  Users,
} from "lucide-react";
import { api } from "../api";
import { factions as factionLabels } from "../constants";
import { Badge, Button, Empty } from "./ui";
import "./faction-management.css";

const preferenceLabel = (value) =>
  factionLabels[value] || (value === "any" ? "服从分配" : "尚未选择");

export default function FactionManagement({ notify, onChanged }) {
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const mounted = useRef(false);
  const drawing = useRef(false);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const data = await api("/staff/factions");
      if (mounted.current && id === requestId.current) {
        setCatalog(data);
        setError("");
      }
      return data;
    } catch (failure) {
      if (mounted.current && id === requestId.current)
        setError(failure.message || "阵营名单加载失败，请重试。");
      return null;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    const timer = setInterval(() => {
      if (!drawing.current) void load();
    }, 8000);
    return () => {
      mounted.current = false;
      ++requestId.current;
      clearInterval(timer);
    };
  }, [load]);

  const draw = async () => {
    if (drawing.current || catalog?.drawn) return;
    drawing.current = true;
    ++requestId.current;
    setSaving(true);
    setError("");
    try {
      const result = await api("/staff/factions/draw", {});
      if (!mounted.current) return;
      setCatalog((previous) =>
        result?.players ? result : { ...previous, drawn: true },
      );
      setConfirming(false);
      await load();
      await onChanged?.();
      notify?.("阵营抽签已完成并锁定，杀手本人现可查看身份与个人接头暗号。");
    } catch (failure) {
      if (mounted.current) {
        await load();
        setError(failure.message || "抽签失败，请重试。");
      }
    } finally {
      drawing.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      notify?.("接头暗号已复制，请仅向对应玩家或凶手本人交接。");
    } catch {
      notify?.("复制失败，可选中暗号文字手动复制。");
    }
  };

  if (!catalog)
    return (
      <section
        className="panel faction-management-loading"
        role={error ? "alert" : "status"}
      >
        <p>{error || "正在加载阵营与接头暗号…"}</p>
        {error && (
          <Button kind="ghost compact" onClick={load}>
            重新加载
          </Button>
        )}
      </section>
    );

  const players = catalog.players || [];
  const killers = players.filter((player) => player.assigned === "conspirator");
  const visible = players.filter(
    (player) =>
      (filter === "all" ||
        (filter === "unassigned" && !player.assigned) ||
        (filter === "candidates" && player.preference === "conspirator") ||
        player.assigned === filter) &&
      `${player.name || ""} ${player.character || ""}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const canDraw =
    Number(catalog.quota) > 0 &&
    Number(catalog.eligibleCount) >= 4 &&
    Number(catalog.eligibleCount) >= Number(catalog.quota);

  return (
    <section className="faction-management">
      <div className="panel faction-control">
        <div className="faction-control-heading">
          <div>
            <span className="eyebrow">
              <Shield size={16} /> PRIVATE FACTION DRAW
            </span>
            <h2>三大阵营 · 接头暗号</h2>
            <p className="muted">
              玩家先选偏好，GM在活动开始前统一抽签。本场最多50人，已付费、角色已批准且已选择偏好的玩家参与分配。每名杀手会提前获知真凶身份，并获得独立随机暗号，在活动开始前与凶手接头。
            </p>
          </div>
          <Badge tone={catalog.drawn ? "green" : "gold"}>
            {catalog.drawn ? <Lock size={13} /> : <Dices size={13} />}
            {catalog.drawn ? "已抽签 · 阵营已锁定" : "待GM抽签"}
          </Badge>
        </div>
        <div className="faction-draw-stats">
          <div>
            <Users size={18} />
            <strong>{catalog.eligibleCount}</strong>
            <span>参与分配玩家</span>
          </div>
          <div>
            <Dices size={18} />
            <strong>{catalog.quota}</strong>
            <span>本场杀手席位</span>
          </div>
          <div>
            <KeyRound size={18} />
            <strong>{catalog.candidateCount}</strong>
            <span>自愿杀手候选</span>
          </div>
        </div>
        <p className="faction-draw-rule">
          {typeof catalog.rule === "string"
            ? catalog.rule
            : "活动上限50人。杀手席位随参与人数调整，为2–5人，40人时为3人，50人时为4人。杀手偏好参与抽签，其余玩家平均分到另外两个阵营，并尽量兼顾偏好。"}
        </p>
        {catalog.drawn ? (
          <div className="notice faction-draw-notice">
            <Lock size={18} />
            <span>
              抽签结果已锁定，不能重新抽签。杀手本人可查看自己的身份与暗号；完整名单和所有暗号仅GM可见。
            </span>
          </div>
        ) : (
          <div className="faction-draw-actions">
            <p className="muted">
              请先核对名单。抽签后将提前告知每名杀手真凶身份，要求其在活动开始前找到凶手，并说出自己的接头暗号。
            </p>
            {catalog.missingPreferenceCount > 0 && (
              <p className="faction-missing-preference">
                另有{catalog.missingPreferenceCount}
                名已付费、角色已批准的玩家尚未选择阵营偏好，不会参加本次抽签。
              </p>
            )}
            {!confirming ? (
              <Button
                disabled={saving || !canDraw}
                onClick={() => setConfirming(true)}
              >
                <Dices size={17} /> 开始阵营抽签
              </Button>
            ) : (
              <div
                className="faction-draw-confirm"
                role="region"
                aria-label="确认阵营抽签"
              >
                <strong>
                  为当前{catalog.eligibleCount}名玩家抽签，分配{catalog.quota}
                  个杀手席位？
                </strong>
                <p>
                  确认后立即生成每名杀手的独立暗号并锁定结果，玩家将看到各自的最终阵营。
                </p>
                <div>
                  <Button disabled={saving} onClick={draw}>
                    <Lock size={16} />
                    {saving ? "正在抽签并锁定…" : "确认抽签并锁定阵营"}
                  </Button>
                  <Button
                    kind="ghost"
                    disabled={saving}
                    onClick={() => setConfirming(false)}
                  >
                    返回核对名单
                  </Button>
                </div>
              </div>
            )}
            {!canDraw && (
              <p className="small-text muted">
                至少需要4名已付费、角色已批准且已选择阵营偏好的玩家，才能进行抽签。
              </p>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="notice" role="alert">
          {error}
          <Button kind="ghost compact" disabled={saving} onClick={load}>
            刷新名单
          </Button>
        </div>
      )}

      {catalog.drawn && (
        <div className="faction-counts" aria-label="最终阵营人数">
          {Object.entries(factionLabels).map(([id, label]) => (
            <div className={"panel faction-count " + id} key={id}>
              <span>{label}</span>
              <strong>
                {catalog.counts?.[id] ??
                  players.filter((player) => player.assigned === id).length}
                人
              </strong>
            </div>
          ))}
        </div>
      )}

      <section className="panel faction-player-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">GM ONLY</span>
            <h3>阵营名单与个人暗号</h3>
          </div>
          <div className="faction-table-actions">
            {catalog.drawn && killers.length > 0 && (
              <Button
                kind="ghost compact"
                onClick={() =>
                  copy(
                    killers
                      .map(
                        (player) =>
                          `${player.name}（${player.character || "未创建角色"}）：${player.code || "未生成"}`,
                      )
                      .join("\n"),
                  )
                }
              >
                <Copy size={15} />
                复制杀手暗号名单
              </Button>
            )}
            <Button
              kind="ghost compact"
              aria-label="刷新阵营名单"
              disabled={saving}
              onClick={load}
            >
              <RefreshCw size={15} />
              刷新
            </Button>
          </div>
        </div>
        <div className="table-toolbar">
          <div className="search">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索宾客或角色姓名"
              aria-label="搜索阵营名单"
            />
          </div>
          <label className="faction-filter">
            筛选阵营名单
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="all">全部玩家</option>
              <option value="conspirator">仅杀手阵营</option>
              <option value="fbi">FBI调查阵营</option>
              <option value="croft">索恩遗产阵营</option>
              <option value="candidates">偏好杀手的候选人</option>
              <option value="unassigned">尚未分配</option>
            </select>
          </label>
        </div>
        {visible.length ? (
          <div className="table-wrap">
            <table
              className="faction-player-table"
              data-testid="faction-player-table"
            >
              <thead>
                <tr>
                  <th>宾客 / 角色</th>
                  <th>阵营偏好</th>
                  <th>最终阵营</th>
                  <th>个人接头暗号</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((player) => (
                  <tr key={player.id}>
                    <td data-label="宾客 / 角色">
                      <strong>{player.name}</strong>
                      <small>{player.character || "尚未创建角色"}</small>
                    </td>
                    <td data-label="阵营偏好">
                      {preferenceLabel(player.preference)}
                      {player.preference === "conspirator" &&
                        !catalog.drawn && (
                          <small className="muted">参与抽签，名额有限</small>
                        )}
                    </td>
                    <td data-label="最终阵营">
                      {player.assigned ? (
                        <Badge
                          tone={player.assigned === "conspirator" ? "gold" : ""}
                        >
                          {factionLabels[player.assigned] || player.assigned}
                        </Badge>
                      ) : (
                        <span className="muted">等待抽签</span>
                      )}
                    </td>
                    <td data-label="个人接头暗号">
                      {player.assigned === "conspirator" && player.code ? (
                        <div className="faction-code">
                          <code>{player.code}</code>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`复制${player.name}的接头暗号`}
                            onClick={() => copy(player.code)}
                          >
                            <Copy size={15} />
                          </button>
                        </div>
                      ) : (
                        <span className="muted">
                          {player.assigned === "conspirator" ? "待生成" : "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="暂无匹配玩家"
            text={
              players.length
                ? "尝试调整筛选条件或搜索姓名。"
                : "玩家选择阵营偏好后，会出现在这里。"
            }
          />
        )}
        <p className="small-text muted faction-private-note">
          <Check size={14} />
          最终阵营以统一抽签为准；个人接头暗号仅用于现场核对，请勿公开广播。
        </p>
      </section>
    </section>
  );
}
