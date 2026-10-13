import React, { useState } from "react";
import { Plus, Search, Download, RefreshCw, ExternalLink } from "lucide-react";
import { api } from "../api";
import { Button, Field, Modal, Badge, Empty, useResource } from "./ui";
import { factions } from "../constants";
import "../features/admin/content.css";

const tabs = {
  players: "报名资料",
  characters: "角色卡",
  clues: "线索库",
  npcs: "NPC档案",
  missions: "私人委托",
  lots: "拍品与道具",
  events: "广播内容",
  scenes: "AR场景",
  site: "报名首页",
};
const skills = ["洞察", "技术", "社交"].map((name) => [name, name]);
const phases = [1, 2, 3, 4].map((value) => [value, `第${value}幕`]);
const field = (key, label, type = "text", options = {}) => ({
  key,
  label,
  type,
  ...options,
});
const fieldsFor = (kind, data, create) =>
  ({
    players: [
      field("name", "报名姓名", "text", { max: 40 }),
      field("contact", "手机号或邮箱", "text", { max: 100 }),
    ],
    characters: [
      field("name", "角色姓名", "text", { max: 60 }),
      field("english", "英文名", "text", { max: 60 }),
      field("profession", "职业", "text", { max: 60 }),
      field("skill", "鉴定技能", "select", { choices: skills }),
      field("npc_id", "关联NPC", "select", {
        choices: data.npcs.map((npc) => [npc.id, npc.name]),
      }),
      field("motive", "赴宴动机", "text", { max: 100 }),
      field("story", "角色背景", "textarea"),
      field("secret", "角色秘密（批准后本人可见）", "textarea"),
      field("faction", "真实阵营", "select", {
        choices: Object.entries(factions),
      }),
      field("status", "角色审核状态", "select", {
        choices: [
          ["pending", "待审核"],
          ["approved", "已批准"],
        ],
      }),
    ],
    clues: [
      ...(create
        ? [field("id", "线索编号（E-01格式）", "text", { max: 4 })]
        : []),
      field("title", "线索标题", "text", { max: 100 }),
      field("area", "调查区域", "text", { max: 60 }),
      field("category", "证据分类", "text", { max: 40 }),
      field("skill", "鉴定技能", "select", { choices: skills }),
      field("dc", "DC难度", "number", { min: 1, max: 30 }),
      field("phase", "开放幕次", "select", { choices: phases, numeric: true }),
      field("body", "基础证据", "textarea"),
      field("detail", "进阶证据", "textarea"),
    ],
    npcs: [
      ...(create
        ? [field("id", "NPC编号（小写英文）", "text", { max: 40 })]
        : []),
      field("name", "NPC姓名", "text", { max: 60 }),
      field("english", "英文名", "text", { max: 60 }),
      field("role", "NPC身份", "text", { max: 100 }),
      field("phone", "NPC登录手机号（可选，绑定后验证码登录）", "tel", {
        max: 11,
        required: false,
      }),
      field("bio", "公开人物背景", "textarea"),
      field("secret", "GM保密设定", "textarea"),
    ],
    missions: [
      field("player_id", "所属玩家", "select", {
        choices: data.players.map((player) => [
          player.id,
          `${player.name} · ${player.contact}`,
        ]),
      }),
      field("npc_id", "负责NPC", "select", {
        choices: data.npcs.map((npc) => [npc.id, npc.name]),
      }),
      field("title", "委托标题", "text", { max: 200 }),
      field("reward", "金币奖励", "number", { min: 1, max: 10 }),
    ],
    lots: [
      field("title", "拍品标题", "text", { max: 100 }),
      field("start_price", "起拍价", "number", { min: 1, max: 1000 }),
      field("description", "拍品说明", "textarea"),
      field("effect", "道具效果", "text", { max: 100 }),
    ],
    events: [
      field("title", "广播标题", "text", { max: 80 }),
      field("body", "广播正文", "textarea", { max: 1000 }),
    ],
    site: [
      field("title", "活动主标题", "text", { max: 120 }),
      field("subtitle", "活动副标题", "text", { max: 120 }),
      field("englishTitle", "英文标题", "text", { max: 120 }),
      field("badge", "活动标签", "text", { max: 120 }),
      field("schedule", "活动时间说明", "text", { max: 120 }),
      field("description", "报名首页介绍", "textarea"),
    ],
  })[kind] || [];
const csvCell = (value) => {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
};

export default function ContentManager({ notify, onChanged, onInspect }) {
  const [data, refresh] = useResource("/staff/manage", notify),
    [kind, setKind] = useState("players"),
    [query, setQuery] = useState(""),
    [edit, setEdit] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (!data) return <div className="panel">正在加载管理内容…</div>;
  const rows =
    kind === "characters"
      ? data.players.map((player) => ({
          ...data.characters.find((card) => card.player_id === player.id),
          player_id: player.id,
          playerName: player.name,
          id: player.id,
        }))
      : kind === "site"
        ? [data.site]
        : data[kind];
  const filtered = rows.filter((row) =>
    [row.id, row.name, row.title, row.contact, row.playerName]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const open = (row, create = false) => {
    setError("");
    setEdit({
      kind,
      create,
      data: {
        phase: 3,
        dc: 10,
        skill: "洞察",
        category: "线索",
        area: "书房",
        reward: 2,
        start_price: 10,
        faction: "croft",
        status: "pending",
        npc_id: data.npcs[0]?.id || "",
        player_id: data.players[0]?.id || "",
        ...row,
      },
    });
  };
  const submit = async (body) => {
    setBusy(true);
    setError("");
    try {
      const path =
        edit.kind === "site"
          ? "/staff/manage/site"
          : edit.kind === "scenes"
            ? `/staff/manage/scenes/${encodeURIComponent(body.id)}`
            : edit.kind === "characters"
              ? `/staff/manage/characters/${edit.data.player_id}`
              : edit.kind === "events" && edit.create
                ? "/staff/events"
                : `/staff/manage/${edit.kind}${edit.create ? "" : "/" + encodeURIComponent(edit.data.id)}`;
      await api(path, body);
      await Promise.all([refresh(), onChanged()]);
      setEdit(null);
      notify("内容已保存，玩家页面刷新后生效");
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };
  const exportPlayers = () => {
    const keys = [
      "name",
      "contact",
      "payment",
      "checked_in",
      "group_id",
      "coins",
      "created_at",
    ];
    const csv = [
      ["报名姓名", "联系方式", "票务", "签到", "调查组", "金币", "报名时间"],
      ...filtered.map((player) => keys.map((key) => player[key])),
    ]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "报名名单.csv";
    link.click();
    URL.revokeObjectURL(url);
  };
  const canCreate = [
    "clues",
    "npcs",
    "missions",
    "lots",
    "events",
    "scenes",
  ].includes(kind);
  return (
    <section className="content-workspace">
      <nav className="content-tabs" aria-label="内容分类">
        {Object.entries(tabs).map(([key, name]) => (
          <button
            key={key}
            className={kind === key ? "active" : ""}
            onClick={() => {
              setKind(key);
              setQuery("");
            }}
          >
            {name}
            <span>
              {key === "site"
                ? ""
                : key === "characters"
                  ? data.characters.length
                  : data[key].length}
            </span>
          </button>
        ))}
      </nav>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">CONTENT ADMINISTRATION</span>
            <h3>{tabs[kind]}管理</h3>
          </div>
          <div className="content-toolbar">
            {kind === "players" && (
              <Button kind="ghost compact" onClick={exportPlayers}>
                <Download size={15} /> 导出名单
              </Button>
            )}
            {canCreate && (
              <Button kind="compact" onClick={() => open({}, true)}>
                <Plus size={16} /> 新增{tabs[kind]}
              </Button>
            )}
            <button
              className="icon-button"
              aria-label="刷新管理内容"
              onClick={refresh}
            >
              <RefreshCw size={17} />
            </button>
          </div>
        </div>
        <p className="muted">
          {kind === "players"
            ? "编辑报名资料，或进入档案核验票务、签到和分组。"
            : kind === "scenes"
              ? "配置模型与定位文件、坐标及热点证据映射；保存后即时生效，无需重启。资源文件须先上传或随版本发布。"
              : kind === "characters"
                ? "完整编辑玩家角色卡。已完成的任务与金币账目不会因角色编辑而被重置。"
                : "新增和编辑活动内容。已结算委托、已开放拍品保留原始记录；原有内容不做批量删除。"}
        </p>
        {kind !== "site" && (
          <div className="search content-search">
            <Search size={17} />
            <input
              aria-label="搜索管理内容"
              placeholder="搜索编号、姓名或标题"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        )}
        {filtered.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>档案 / 标题</th>
                  <th>{kind === "players" ? "联系方式" : "内容摘要"}</th>
                  <th>状态 / 编号</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, index) => (
                  <tr key={row.id || row.player_id || index}>
                    <td>
                      <strong>
                        {row.name ||
                          row.title ||
                          row.playerName ||
                          "未建立角色"}
                      </strong>
                      <small>{row.playerName}</small>
                    </td>
                    <td className="content-summary">
                      {kind === "players"
                        ? row.contact
                        : kind === "characters"
                          ? row.profession || "点击编辑建立角色卡"
                          : kind === "scenes"
                            ? `${row.models.length} 个模型 · ${row.hotspots.length} 个热点`
                            : row.body ||
                              row.bio ||
                              row.description ||
                              row.title}
                    </td>
                    <td>
                      <Badge>
                        {kind === "players"
                          ? row.payment === "paid"
                            ? "已核验"
                            : row.payment === "refunded"
                              ? "已退款"
                              : "待核验"
                          : row.status === "done"
                            ? "已结算"
                            : row.status === "approved"
                              ? "已批准"
                              : row.status === "sold"
                                ? "已成交"
                                : row.status === "open"
                                  ? "竞拍中"
                                  : row.id?.startsWith("E-")
                                    ? row.id
                                    : row.phase
                                      ? `第${row.phase}幕`
                                      : row.status || "可编辑"}
                      </Badge>
                    </td>
                    <td>
                      <div className="content-toolbar">
                        <Button
                          kind="ghost compact"
                          disabled={
                            (kind === "missions" && row.status === "done") ||
                            (kind === "lots" && row.status !== "waiting")
                          }
                          onClick={() => open(row)}
                        >
                          编辑
                        </Button>
                        {kind === "players" && (
                          <button
                            className="text-button"
                            onClick={() => onInspect(row.id)}
                          >
                            核验 / 签到
                          </button>
                        )}
                        {kind === "scenes" && (
                          <a
                            className="text-link"
                            href={`/ar/${row.id}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <ExternalLink size={15} />
                            查看
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="暂无匹配内容"
            text="使用新增按钮创建内容，或更换搜索条件。"
          />
        )}
      </section>
      {edit && (
        <Modal
          wide
          title={`${edit.create ? "新增" : "编辑"}${tabs[edit.kind]}`}
          onClose={() => {
            if (!busy) setEdit(null);
          }}
        >
          {edit.kind === "scenes" ? (
            <SceneEditor
              data={edit.data}
              create={edit.create}
              clues={data.clues}
              busy={busy}
              onSubmit={submit}
            />
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const body = Object.fromEntries(
                  new FormData(event.currentTarget),
                );
                for (const item of fieldsFor(edit.kind, data, edit.create))
                  if (item.type === "number" || item.numeric)
                    body[item.key] = Number(body[item.key]);
                submit(body);
              }}
            >
              <div className="two-grid">
                {fieldsFor(edit.kind, data, edit.create).map((item) => (
                  <Field key={item.key} label={item.label}>
                    {item.type === "textarea" ? (
                      <textarea
                        name={item.key}
                        rows={4}
                        required={item.required !== false}
                        maxLength={item.max || 2000}
                        defaultValue={edit.data[item.key] || ""}
                      />
                    ) : item.type === "select" ? (
                      <select
                        required
                        name={item.key}
                        defaultValue={
                          edit.data[item.key] || item.choices[0]?.[0]
                        }
                      >
                        {item.choices.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        required={item.required !== false}
                        name={item.key}
                        type={item.type}
                        min={item.min}
                        max={item.type === "number" ? item.max : undefined}
                        maxLength={
                          item.type === "text" ? item.max || 100 : undefined
                        }
                        defaultValue={edit.data[item.key] ?? ""}
                      />
                    )}
                  </Field>
                ))}
              </div>
              <Button type="submit" disabled={busy}>
                {busy ? "正在保存…" : "保存内容"}
              </Button>
            </form>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
    </section>
  );
}

function SceneEditor({ data, create, clues, busy, onSubmit }) {
  const [scene, setScene] = useState(() =>
    data.models
      ? { ...structuredClone(data), enabled: data.enabled !== false }
      : {
          id: "",
          enabled: true,
          title: "",
          mode: "wall",
          phase: 3,
          tracking: {
            kind: "image",
            targetKey: "targets/study-wall.mind",
            targetIndex: 0,
            physicalWidthMeters: 0.18,
          },
          models: [
            {
              id: "model-1",
              assetKey: "models/study-cabinet.glb",
              position: [0, 0, 0.08],
              rotation: [0, 0, 0],
              scale: [0.65, 0.65, 0.65],
            },
          ],
          hotspots: [
            {
              id: "hotspot-1",
              clueId: clues[0]?.id || "",
              position: [0, 0, 0.4],
              radius: 0.09,
            },
          ],
        },
  );
  const [formError, setFormError] = useState("");
  const change = (key, value) =>
    setScene((previous) => ({ ...previous, [key]: value }));
  const tracking = (key, value) =>
    change("tracking", { ...scene.tracking, [key]: value });
  const listChange = (key, index, property, value) =>
    change(
      key,
      scene[key].map((item, n) =>
        n === index ? { ...item, [property]: value } : item,
      ),
    );
  const vector = (key, index, property) => (
    <div className="scene-vector">
      {["X", "Y", "Z"].map((axis, n) => (
        <Field
          key={axis}
          label={`${property === "position" ? "位置" : property === "rotation" ? "旋转" : "比例"} ${axis}`}
        >
          <input
            aria-label={`${key}-${index}-${property}-${axis}`}
            type="number"
            step="any"
            required
            value={scene[key][index][property][n]}
            onChange={(event) =>
              listChange(
                key,
                index,
                property,
                scene[key][index][property].map((value, v) =>
                  v === n ? Number(event.target.value) : value,
                ),
              )
            }
          />
        </Field>
      ))}
    </div>
  );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setFormError("");
        if (!scene.models.length || !scene.hotspots.length) {
          setFormError("至少需要一个模型和一个搜证热点");
          return;
        }
        onSubmit(scene);
      }}
    >
      <div className="notice">
        <span>
          坐标以整张识别图宽度为1，X向右、Y向上、Z向外；旋转为弧度，模型单位为米。修改定位尺寸或坐标后须重新现场标定。
        </span>
      </div>
      <div className="two-grid">
        <Field label="场景编号">
          <input
            value={scene.id}
            disabled={!create}
            required
            pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}"
            onChange={(event) => change("id", event.target.value)}
          />
        </Field>
        <Field label="场景名称">
          <input
            value={scene.title}
            required
            onChange={(event) => change("title", event.target.value)}
          />
        </Field>
        <Field label="场景用途">
          <select
            value={scene.mode}
            onChange={(event) => change("mode", event.target.value)}
          >
            <option value="wall">墙面锚定</option>
            <option value="page">纸质页面</option>
            <option value="zone">区域搜证</option>
          </select>
        </Field>
        <Field label="场景状态">
          <select
            value={String(scene.enabled)}
            onChange={(event) =>
              change("enabled", event.target.value === "true")
            }
          >
            <option value="true">启用 · 按幕次开放</option>
            <option value="false">停用 · 玩家不可进入</option>
          </select>
        </Field>
        <Field label="开放幕次">
          <select
            value={scene.phase}
            onChange={(event) => change("phase", Number(event.target.value))}
          >
            {phases.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="定位文件对象键">
          <input
            required
            value={scene.tracking.targetKey}
            onChange={(event) => tracking("targetKey", event.target.value)}
          />
        </Field>
        <Field label="识别图实际宽度（米）">
          <input
            required
            type="number"
            min="0.01"
            step="any"
            value={scene.tracking.physicalWidthMeters}
            onChange={(event) =>
              tracking("physicalWidthMeters", Number(event.target.value))
            }
          />
        </Field>
        <Field label="目标序号（从0开始）">
          <input
            required
            type="number"
            min="0"
            value={scene.tracking.targetIndex}
            onChange={(event) =>
              tracking("targetIndex", Number(event.target.value))
            }
          />
        </Field>
      </div>
      <h3>3D模型</h3>
      {scene.models.map((model, index) => (
        <section className="scene-edit-card" key={index}>
          <div className="two-grid">
            <Field label="模型编号">
              <input
                required
                value={model.id}
                onChange={(event) =>
                  listChange("models", index, "id", event.target.value)
                }
              />
            </Field>
            <Field label="GLB对象键">
              <input
                required
                value={model.assetKey}
                onChange={(event) =>
                  listChange("models", index, "assetKey", event.target.value)
                }
              />
            </Field>
          </div>
          {vector("models", index, "position")}
          {vector("models", index, "rotation")}
          {vector("models", index, "scale")}
          <button
            type="button"
            className="text-button"
            disabled={busy || scene.models.length === 1}
            onClick={() =>
              change(
                "models",
                scene.models.filter((_, n) => n !== index),
              )
            }
          >
            移除此模型配置
          </button>
        </section>
      ))}
      <Button
        kind="ghost compact"
        onClick={() =>
          change("models", [
            ...scene.models,
            {
              id: `model-${Date.now()}`,
              assetKey: "models/study-cabinet.glb",
              position: [0, 0, 0],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
            },
          ])
        }
      >
        增加模型
      </Button>
      <h3>搜证热点</h3>
      {scene.hotspots.map((hotspot, index) => (
        <section className="scene-edit-card" key={index}>
          <div className="two-grid">
            <Field label="热点编号">
              <input
                required
                value={hotspot.id}
                onChange={(event) =>
                  listChange("hotspots", index, "id", event.target.value)
                }
              />
            </Field>
            <Field label="关联证据">
              <select
                required
                value={hotspot.clueId}
                onChange={(event) =>
                  listChange("hotspots", index, "clueId", event.target.value)
                }
              >
                {clues.map((clue) => (
                  <option key={clue.id} value={clue.id}>
                    {clue.id} · {clue.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="点击半径">
              <input
                required
                type="number"
                min="0.001"
                step="any"
                value={hotspot.radius}
                onChange={(event) =>
                  listChange(
                    "hotspots",
                    index,
                    "radius",
                    Number(event.target.value),
                  )
                }
              />
            </Field>
          </div>
          {vector("hotspots", index, "position")}
          <button
            type="button"
            className="text-button"
            disabled={busy || scene.hotspots.length === 1}
            onClick={() =>
              change(
                "hotspots",
                scene.hotspots.filter((_, n) => n !== index),
              )
            }
          >
            移除此热点配置
          </button>
        </section>
      ))}
      <Button
        kind="ghost compact"
        onClick={() =>
          change("hotspots", [
            ...scene.hotspots,
            {
              id: `hotspot-${Date.now()}`,
              clueId: clues[0]?.id || "",
              position: [0, 0, 0.4],
              radius: 0.09,
            },
          ])
        }
      >
        增加热点
      </Button>
      <hr />
      <Button type="submit" disabled={busy}>
        {busy ? "正在发布…" : "保存并发布场景"}
      </Button>
      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
    </form>
  );
}
