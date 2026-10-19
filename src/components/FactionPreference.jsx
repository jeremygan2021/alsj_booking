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
    description: "自愿加入杀手阵营；席位有限，满额时会分配到其他阵营。",
  },
  {
    value: "any",
    title: factionNames.any,
    description: "由系统按剩余席位安排，可能分到任一阵营。",
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
          <p>确认正式阵营后即可继续创建角色；之后重新生成也会保留身份。</p>
        </div>
        <Button
          kind="ghost compact"
          disabled={busy}
          onClick={() => setEditing(true)}
        >
          修改阵营偏好
        </Button>
        <Button
          disabled={busy}
          onClick={() => onSave(faction.preference)}
          aria-label="保存偏好，继续创建角色"
        >
          确认阵营，继续创建角色
        </Button>
      </section>
    );

  return (
    <section
      className="faction-preference-card"
      aria-labelledby={`${id}-heading`}
    >
      <span className="eyebrow">
        {hasCharacter ? "我的阵营" : "创建角色 · 第一步"}
      </span>
      <h2 id={`${id}-heading`}>
        <Users size={23} aria-hidden="true" /> 选择阵营，进入你的故事
      </h2>
      <p>
        确认后立即确定正式阵营，再据此生成角色和现场互动目标。身份只在你的私人档案中显示。
      </p>
      <div className="faction-lottery-notice" id={`${id}-notice`}>
        <Shield size={20} aria-hidden="true" />
        <p>
          <strong>按意向与剩余席位分配。</strong>
          杀手席位有限，另外两方保持人数平衡，因此正式阵营可能与意向不同。确定后不随重新生成角色改变，需要调整可联系GM。
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
                  {item.value === "conspirator" && <small>限量席位</small>}
                </strong>
                <span>{item.description}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="faction-preference-actions">
          <Button
            type="submit"
            disabled={busy || !choice}
            aria-label="保存偏好，继续创建角色"
          >
            {busy
              ? "正在确定阵营…"
              : hasPreference || hasCharacter
                ? "确认阵营，继续创建角色"
                : "确认阵营，开始创建角色"}
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

export function FactionAssignment({ faction = {}, compact = false }) {
  const assigned = faction.assigned;
  if (!assigned || !factionNames[assigned] || assigned === "any") return null;
  const killer = assigned === "conspirator";
  return (
    <section
      className={
        "faction-assignment " +
        (killer ? "killer " : "") +
        (compact ? "compact" : "")
      }
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
          <Lock size={12} aria-hidden="true" /> 身份已确定
        </Badge>
      </div>
      {killer && faction.code && (
        <>
          <p>
            请阅读下方私密简报，提前确认真正的凶手。请在活动开始前私下找GM核验下方暗号，再由GM安排与凶手联络。请保密你的身份与暗号。
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
