import React from "react";
import { ArrowUpRight, Check, Lock } from "lucide-react";
import { Badge, Button, Empty, Field } from "./ui";
import { phases, factions, formatTime } from "../constants";
function Audit({ rows }) {
  return rows.length ? (
    rows.map((a) => (
      <div className="audit-row" key={a.id}>
        <span className="audit-dot" />
        <div>
          <p>{a.action}</p>
          <small>
            {a.actor === "gm" ? "GM" : a.actor.slice(0, 10)} ·{" "}
            {formatTime(a.created_at)}
          </small>
        </div>
      </div>
    ))
  ) : (
    <p className="muted">暂无操作记录。</p>
  );
}
function PlayerReview({ data, busy, onUpdate }) {
  const { player: p, character: c } = data;
  return (
    <>
      <div className="review-header">
        <div>
          <h3>{p.name}</h3>
          <p className="muted">{p.contact}</p>
        </div>
        <Badge>第{p.group_id}调查组</Badge>
      </div>
      <div className="review-actions">
        <Button
          kind="ghost"
          disabled={busy || p.payment === "paid"}
          onClick={() => onUpdate({ payment: "paid" })}
        >
          核验付款
        </Button>
        <Button
          kind="ghost"
          disabled={busy || p.payment !== "paid" || !!p.checked_in}
          onClick={() => onUpdate({ checkin: true })}
        >
          {p.checked_in ? "已完成签到" : "现场签到 · +3金币"}
        </Button>
        <Button
          kind="ghost"
          disabled={busy || p.payment !== "paid"}
          onClick={() => onUpdate({ payment: "refunded" })}
        >
          标记已退款
        </Button>
      </div>
      {c ? (
        <section className="review-character">
          <span className="eyebrow">PRIVATE CHARACTER FILE</span>
          <h3>
            {c.name} / {c.english}
          </h3>
          <p>
            {c.profession} · {c.skill} +2
          </p>
          <p>{c.story}</p>
          <div className="secret-note">
            <Lock size={16} />
            <p>{c.secret}</p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const d = Object.fromEntries(new FormData(e.currentTarget));
              onUpdate({ ...d, group: Number(d.group) });
            }}
          >
            <div className="two-grid">
              <Field label="真实阵营（同伙最多3位）">
                <select name="faction" defaultValue={c.faction}>
                  {Object.entries(factions).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="调查小组">
                <select name="group" defaultValue={p.group_id}>
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option value={n} key={n}>
                      第{n}组
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="角色审核">
                <select name="status" defaultValue={c.status}>
                  <option value="pending">退回 / 等待审核</option>
                  <option value="approved">批准人物档案</option>
                </select>
              </Field>
            </div>
            <Button type="submit" disabled={busy}>
              保存并分配身份 <Check size={16} />
            </Button>
          </form>
        </section>
      ) : (
        <Empty
          title="宾客尚未建立角色"
          text="请提醒宾客登录私人档案填写虚构背景。"
        />
      )}
    </>
  );
}
function ContentEditor({ edit, busy, onSubmit }) {
  const c = edit.data;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.currentTarget));
        if (edit.type === "clue") {
          d.dc = Number(d.dc);
          d.phase = Number(d.phase);
        }
        onSubmit(d);
      }}
    >
      {edit.type === "clue" ? (
        <>
          <Field label="证据标题">
            <input
              name="title"
              defaultValue={c.title}
              required
              maxLength={100}
            />
          </Field>
          <Field label="基础证据">
            <textarea
              rows={4}
              name="body"
              defaultValue={c.body}
              required
              maxLength={2000}
            />
          </Field>
          <Field label="鉴定成功后的额外信息">
            <textarea
              rows={4}
              name="detail"
              defaultValue={c.detail}
              required
              maxLength={2000}
            />
          </Field>
          <div className="two-grid">
            <Field label="DC难度">
              <input
                name="dc"
                type="number"
                min={1}
                max={30}
                defaultValue={c.dc}
              />
            </Field>
            <Field label="开放幕次">
              <select name="phase" defaultValue={c.phase}>
                {phases.map((p, i) => (
                  <option value={i + 1} key={p}>
                    {i + 1} · {p}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </>
      ) : (
        <>
          <Field label="公开人物背景">
            <textarea
              name="bio"
              required
              maxLength={2000}
              rows={5}
              defaultValue={c.bio}
            />
          </Field>
          <Field label="GM保密设定">
            <textarea
              name="secret"
              required
              maxLength={2000}
              rows={5}
              defaultValue={c.secret}
            />
          </Field>
        </>
      )}
      <Button type="submit" disabled={busy}>
        保存内容
      </Button>
    </form>
  );
}

export { Audit, PlayerReview, ContentEditor };
