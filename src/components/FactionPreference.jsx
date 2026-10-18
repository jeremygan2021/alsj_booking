import React, { useEffect, useId, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  KeyRound,
  Lock,
  Shield,
  Users,
} from "lucide-react";
import { Badge, Button } from "./ui";
import { factions } from "../constants";
import "./faction-preference.css";

export const factionNames = {
  ...factions,
  any: "服从安排",
};

const choices = [
  {
    value: "fbi",
    title: factionNames.fbi,
    description: "从调查者的立场追查线索，揭开庄园的秘密。",
  },
  {
    value: "croft",
    title: factionNames.croft,
    description: "站在庄园主一方，参与围绕家族与利益的故事。",
  },
  {
    value: "conspirator",
    title: factionNames.conspirator,
    description: "报名参加杀手抽签；名额有限，选择后不保证入选。",
  },
  {
    value: "any",
    title: factionNames.any,
    description: "没有特别偏好，由GM统一抽签分配。",
  },
];

export function FactionPreference({
  faction = {},
  hasCharacter = false,
  busy,
  onSave,
}) {
  const id = useId();
  const [choice, setChoice] = useState(faction.preference || "");
  const [editing, setEditing] = useState(false);
  const hasPreference = choices.some(
    (item) => item.value === faction.preference,
  );
  const locked = Boolean(faction.preferenceLocked || faction.assigned);
  useEffect(() => {
    setChoice(faction.preference || "");
    setEditing(false);
  }, [faction.preference, locked]);

  if (locked) return null;
  if (hasPreference && !editing)
    return (
      <section className="faction-preference-saved" aria-label="我的阵营偏好">
        <CheckCircle2 size={19} aria-hidden="true" />
        <div>
          <strong>阵营偏好已保存 · {factionNames[faction.preference]}</strong>
          <p>正式阵营等待GM抽签；抽签前可以修改偏好。</p>
        </div>
        <Button
          kind="ghost compact"
          disabled={busy}
          onClick={() => setEditing(true)}
        >
          修改阵营偏好
        </Button>
      </section>
    );

  return (
    <section
      className="faction-preference-card"
      aria-labelledby={`${id}-heading`}
    >
      <span className="eyebrow">
        {hasCharacter ? "我的阵营意向" : "创建角色之前 · 阵营意向"}
      </span>
      <h2 id={`${id}-heading`}>
        <Users size={23} aria-hidden="true" /> 先选择你的阵营偏好
      </h2>
      <p>
        今晚共有三个阵营。偏好会作为GM分配的参考，正式身份将在统一抽签后公布给你。
      </p>
      <div className="faction-lottery-notice" id={`${id}-notice`}>
        <Shield size={20} aria-hidden="true" />
        <p>
          <strong>杀手阵营需要抽签。</strong>
          根据活动总人数设置2–5个名额；选择杀手只代表报名，不保证入选。其余玩家会尽量平均分到另外两个阵营。
        </p>
      </div>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!choice || busy) return;
          if (await onSave(choice)) setEditing(false);
        }}
      >
        <fieldset
          className="faction-choice-list"
          disabled={busy}
          aria-describedby={`${id}-notice`}
        >
          <legend>你的阵营偏好</legend>
          {choices.map((item) => (
            <label
              className={
                "faction-choice " + (choice === item.value ? "selected" : "")
              }
              key={item.value}
            >
              <input
                type="radio"
                name="faction_preference"
                value={item.value}
                checked={choice === item.value}
                onChange={() => setChoice(item.value)}
                required
              />
              <span>
                <strong>
                  {item.title}
                  {item.value === "conspirator" && <small>需抽签</small>}
                </strong>
                <span>{item.description}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="faction-preference-actions">
          <Button type="submit" disabled={busy || !choice}>
            {busy
              ? "正在保存…"
              : hasPreference || hasCharacter
                ? "保存阵营偏好"
                : "保存偏好，继续创建角色"}
            <ArrowRight size={17} aria-hidden="true" />
          </Button>
          {hasPreference && (
            <Button
              kind="ghost compact"
              disabled={busy}
              onClick={() => {
                setChoice(faction.preference);
                setEditing(false);
              }}
            >
              取消修改
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}

export function FactionAssignment({ faction = {} }) {
  const assigned = faction.assigned;
  if (!assigned || !factionNames[assigned] || assigned === "any") return null;
  const killer = assigned === "conspirator";
  return (
    <section
      className={"faction-assignment " + (killer ? "killer" : "")}
      aria-label="我的正式阵营"
    >
      <div className="faction-assignment-heading">
        <div>
          <span className="eyebrow">只有你可见 · 正式身份</span>
          <h2>
            {killer ? "你是杀手阵营的一员" : `你属于${factionNames[assigned]}`}
          </h2>
        </div>
        <Badge tone={killer ? "gold" : "green"}>
          <Lock size={12} aria-hidden="true" /> 已抽签锁定
        </Badge>
      </div>
      {killer && (
        <>
          <p>
            请阅读下方私密简报，提前确认真正的凶手。请在活动开始前找到凶手，说出下方属于你的接头暗号，完成接头。请保密你的身份与暗号。
          </p>
          <div className="faction-contact-code">
            <KeyRound size={21} aria-hidden="true" />
            <div>
              <small>你的专属接头暗号</small>
              <strong>{faction.code || "暗号正在准备，请联系GM"}</strong>
            </div>
          </div>
        </>
      )}
      {faction.briefing && (
        <p className="faction-private-briefing">{faction.briefing}</p>
      )}
      {!killer && !faction.briefing && (
        <p>你的阵营已确定。结合自己的角色故事与NPC关系参与今晚的活动。</p>
      )}
    </section>
  );
}
