import React from "react";
import {
  ArrowRight,
  CheckCircle2,
  Compass,
  ScanLine,
  Shield,
  Sparkles,
  Target,
} from "lucide-react";
import { factions } from "../constants";
import { Badge, Button } from "./ui";
import { CharacterAvatar } from "./CharacterProfile";
import "./player-experience.css";

export function CharacterSummary({ character, player, phase, busy, onEdit }) {
  const approved = character.status === "approved";
  return (
    <section
      className="simple-character-summary game-character"
      aria-label="我的角色档案"
    >
      <div className="game-character-top">
        <span>
          THORNE ESTATE <i>/</i> PERSONAL DOSSIER
        </span>
        <Badge tone={approved ? "green" : "gold"}>
          {approved ? "身份已确认" : "等待GM确认"}
        </Badge>
      </div>
      <div className="game-character-main">
        <div className="game-character-portrait">
          <CharacterAvatar
            src={character.avatar_url}
            name={character.name}
            large
          />
          <span>NO. {player.id?.slice(0, 6).toUpperCase() || "GUEST"}</span>
        </div>
        <div className="game-character-identity">
          <span className="eyebrow">你的庄园身份</span>
          <h2>{character.name}</h2>
          {character.english && (
            <span className="game-character-english">{character.english}</span>
          )}
          <p>
            {character.profession || character.cosplay_character || "庄园来客"}
          </p>
          <div className="game-character-tags">
            {character.faction && factions[character.faction] && (
              <span>
                <Shield size={12} />
                {factions[character.faction]}
              </span>
            )}
            <span>第{player.group_id || "—"}调查组</span>
          </div>
        </div>
      </div>
      <div className="game-character-traits">
        <div>
          <Sparkles size={15} />
          <span>
            <small>角色专长</small>
            <strong>{character.skill || "等待故事揭晓"}</strong>
          </span>
        </div>
        <div>
          <Target size={15} />
          <span>
            <small>赴约的理由</small>
            <strong>{character.motive || "在今夜寻找答案"}</strong>
          </span>
        </div>
      </div>
      <div className="simple-character-footer">
        <span>
          <i className={approved ? "ready" : ""} />
          {approved
            ? `档案已解锁 · 第${phase || 1}幕进行中`
            : "角色已保存，GM确认后即可参与现场互动"}
        </span>
        {!approved && (
          <Button
            kind="ghost compact"
            onClick={onEdit}
            disabled={busy || Boolean(character.generation_pending)}
          >
            修改故事
          </Button>
        )}
      </div>
    </section>
  );
}

export function ARSearchCard({ blocker, busy, onScan, compact = false }) {
  return (
    <section className={"ar-search-card " + (compact ? "compact" : "")}>
      <div className="ar-card-icon" aria-hidden="true">
        <ScanLine size={38} strokeWidth={1.4} />
      </div>
      <span className="eyebrow">现场搜证</span>
      <h2>扫一扫，证物就在眼前</h2>
      <p>
        开启全屏相机，对准现场二维码。证物会跟随二维码的位置、方向和大小，墙面证物贴在二维码所在墙面。
      </p>
      <Button onClick={onScan} disabled={busy}>
        <ScanLine size={21} /> 扫描线索，查看AR证物 <ArrowRight size={18} />
      </Button>
      <p className={"ar-readiness " + (!blocker ? "ready" : "")} role="status">
        {!blocker && <CheckCircle2 size={15} />}
        {blocker || "你已准备好搜证，找到现场线索码开始吧。"}
      </p>
      {!compact && (
        <div className="ar-three-steps">
          <span>
            <b>1</b>扫描现场线索码
          </span>
          <span>
            <b>2</b>保持二维码在画面内
          </span>
          <span>
            <b>3</b>保存到证据册
          </span>
        </div>
      )}
    </section>
  );
}

export function CurrentStoryStep({ relations = [], missions = [], phase }) {
  const goals = relations.flatMap((relation) => {
    const hook = relation.hooks?.find(
      (item) => Number(item.phase) === Number(phase),
    );
    const mission =
      Number(phase) === 1
        ? missions.find((item) => item.npc_id === relation.npc_id)
        : null;
    if (mission?.status === "done") return [];
    return hook || mission ? [{ relation, hook, mission }] : [];
  });
  if (!goals.length)
    return Number(phase) === 1 &&
      missions.length > 0 &&
      missions.every((mission) => mission.status === "done") ? (
      <section className="current-story-step">
        <h3>
          <CheckCircle2 size={18} /> 本幕委托已完成
        </h3>
        <p className="current-story-note">
          继续参加现场对话，等待GM推进下一幕。
        </p>
      </section>
    ) : null;
  return (
    <section className="current-story-step">
      <span className="eyebrow">第{phase}幕 · 你的下一步</span>
      <h3>
        <Compass size={18} /> 找到与你有关的人
      </h3>
      {goals.map(({ relation, hook, mission }) => (
        <div className="current-story-goal" key={relation.npc_id}>
          <strong>{relation.npc_name}</strong>
          <p>{hook?.goal || mission?.title}</p>
          {mission && (
            <small>
              {mission.status === "done"
                ? "委托已完成"
                : `现场完成委托，由NPC确认 · +${mission.reward}金币`}
            </small>
          )}
        </div>
      ))}
      <p className="current-story-note">
        对话与演绎在线下进行，拿不准下一步时可以直接找GM。
      </p>
    </section>
  );
}
