import React from "react";
import { INVESTIGATION_GROUPS } from "../investigation-groups";
import { ArrowUpRight, Check, Lock } from "lucide-react";
import { Badge, Button, Empty, Field } from "./ui";
import { phases, factions, formatTime } from "../constants";
import { PaymentStatus } from "./PaymentImport";
import {
  CharacterAvatar,
  GenerationStatus,
  RelationCards,
} from "./CharacterProfile";
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
  const canApprove =
    c && !c.generation_pending && c.generation_status !== "error";
  return (
    <>
      <div className="review-header">
        <div>
          <h3>{p.name}</h3>
          <p className="muted">联系方式：{p.contact}</p>
        </div>
        <div className="review-player-status">
          <Badge>第{p.group_id}调查组</Badge>
          <PaymentStatus player={p} />
        </div>
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
          <span className="eyebrow">已保存的私人角色档案</span>
          <div className="review-avatar-heading">
            <CharacterAvatar src={c.avatar_url} name={c.name} large />
            <div>
              <h3>
                {c.name}
                {c.english && ` / ${c.english}`}
              </h3>
              <p>
                {c.profession} · {c.skill} +2
              </p>
              <p>
                万圣节Cos：{c.cosplay_character || "待补充"}
                {c.cosplay_source && ` · ${c.cosplay_source}`}
              </p>
            </div>
          </div>
          <span className="eyebrow">已保存的角色故事</span>
          <p className="character-original-story">{c.story}</p>
          <p>赴宴动机：{c.motive}</p>
          {c.adaptation && (
            <div className="character-adaptation">
              <h4>ECHO世界身份 · 生成改编</h4>
              <p>{c.adaptation}</p>
            </div>
          )}
          <GenerationStatus character={c} />
          <div className="relation-section-heading">
            <span className="eyebrow">BOTH SIDES OF THE STORY</span>
            <h3>NPC双向剧情关系</h3>
            <p>
              审核共同经历、分幕目标与NPC演绎说明；批准后，NPC只会收到与自己有关的玩家档案。
            </p>
          </div>
          <RelationCards
            relations={data.relations || []}
            role="gm"
            approved={c.status === "approved"}
          />
          <div className="secret-note">
            <Lock size={16} />
            <div>
              <small>角色秘密 · GM可见</small>
              <p>{c.secret || "暂无秘密设定"}</p>
            </div>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const d = Object.fromEntries(new FormData(e.currentTarget));
              if (d.status === "approved" && !canApprove) return;
              onUpdate({ ...d, group: Number(d.group) });
            }}
          >
            <div className="two-grid">
              <Field label="阵营分配">
                <p>{factions[data.faction?.assigned] || "等待GM统一抽签"}</p>
                <small>偏好：{data.faction?.preference === "any" ? "服从分配" : factions[data.faction?.preference] || "尚未选择"}。在“阵营与暗号”完成抽签后生效。</small>
                {data.faction?.code && <p>专属接头暗号：<strong>{data.faction.code}</strong></p>}
              </Field>
              <Field label="调查小组">
                <select name="group" defaultValue={p.group_id}>
                  {INVESTIGATION_GROUPS.map((n) => (
                    <option value={n} key={n}>
                      第{n}组
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="角色审核">
                <select name="status" defaultValue={c.status}>
                  <option value="pending">退回 / 等待审核</option>
                  <option value="approved" disabled={!canApprove}>
                    批准人物档案
                  </option>
                </select>
              </Field>
            </div>
            {!canApprove && (
              <p className="avatar-error" role="alert">
                {c.generation_pending
                  ? "剧情生成进行中，请完成后再审核批准。"
                  : "剧情生成失败，请玩家重试生成后再批准。"}
              </p>
            )}
            <Button type="submit" disabled={busy}>
              保存审核结果 <Check size={16} />
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
