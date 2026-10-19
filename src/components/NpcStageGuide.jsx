import React from "react";
import {
  ArrowRight,
  BookOpen,
  Compass,
  MessageCircle,
  Users,
} from "lucide-react";
import { phases } from "../constants";
import { Badge, Button } from "./ui";
import NpcPortrait from "./NpcPortrait";
import "./npc-stage-guide.css";

const phasePrompts = {
  1: {
    purpose: "先让玩家开口，不用背完整剧本。",
    question: "对你来说，保留一段记忆最重要的是什么？",
  },
  2: {
    purpose: "听一个公开想法，流程跟随现场主持。",
    question: "如果只能留下一件有意义的东西，你会选择什么？",
  },
  3: {
    purpose: "听已经公开的信息，复杂案情请GM协助。",
    question: "在你已经公开核对的信息里，哪一点最让你在意？",
  },
  4: {
    purpose: "听清观点和依据，让GM组织最后的讨论。",
    question: "你愿意先说说自己的观点，再指出它的依据吗？",
  },
};

const fixedReplies = [
  {
    question: "玩家问：我现在该做什么？",
    answer:
      "先告诉我你今晚扮演谁，再说一个你想聊的问题。下一步的安排，我们一起看玩家页面。",
  },
  {
    question: "玩家追问：你知道真相吗？",
    answer:
      "请先说说你已经公开核对到的信息。拿不准的部分，我请现场GM来一起确认。",
  },
  {
    question: "玩家问：我的委托完成了吗？",
    answer: "我先核对页面上这项委托的完成条件，确认后按现场记录处理。",
  },
];

export default function NpcStageGuide({
  npc,
  dossier,
  phase = 1,
  missions = [],
  relations = [],
  onOpenMissions,
  onOpenRelations,
  onOpenScript,
}) {
  const currentPhase = Math.min(4, Math.max(1, Number(phase) || 1));
  const prompt = phasePrompts[currentPhase];
  const identity = {
    ...dossier,
    ...npc,
    name: npc?.name || dossier?.name || "本场NPC",
    english: npc?.english || dossier?.english || "NPC",
  };
  const myMissions = missions.filter(
    (mission) => mission.npc_id === identity.id,
  );
  const pending = myMissions.filter((mission) => mission.status !== "done");
  const playerCount = new Set(
    relations
      .filter((relation) => relation.npc_id === identity.id)
      .map((relation) => relation.player_id),
  ).size;
  const lines = [
    {
      title: "打个招呼",
      hint: "GM示意你可以互动后，再开始。",
      text: `晚上好，我是${identity.name}。你今晚扮演谁？`,
    },
    {
      title: "听一个公开想法",
      hint: "问完听对方说，接一句“我明白你的想法了”就够了。",
      text: prompt.question,
    },
    {
      title: "核对已有委托，再结束对话",
      hint: "有对应委托就打开原页面核对；没有就正常结束，不临时加任务。",
      text: pending.length
        ? "谢谢你的分享。我先看看我们之间有没有一项要确认的委托。"
        : "谢谢你的分享。接下来的安排，请跟随现场GM。",
    },
  ];

  return (
    <section className="npc-stage-guide" aria-label="NPC现场提词">
      <header className="panel npc-stage-heading">
        {identity.id && <NpcPortrait npc={identity} />}
        <div>
          <span className="eyebrow">演员随身卡 · 本幕只看这一页</span>
          <h2>{identity.name}</h2>
          {identity.role && <p>{identity.role}</p>}
        </div>
        <Badge tone="gold">
          第{currentPhase}幕 · {phases[currentPhase - 1]}
        </Badge>
      </header>

      <div className="npc-stage-body">
        <section className="panel npc-stage-lines" aria-label="本幕三句台词">
          <div className="npc-stage-section-title">
            <MessageCircle size={22} aria-hidden="true" />
            <div>
              <h3>照着说，完成一轮对话</h3>
              <p>{prompt.purpose}</p>
            </div>
          </div>
          <ol>
            {lines.map((line, index) => (
              <li key={line.title}>
                <span className="npc-stage-number" aria-hidden="true">
                  {index + 1}
                </span>
                <div>
                  <h4>{line.title}</h4>
                  <blockquote>{line.text}</blockquote>
                  <p>{line.hint}</p>
                </div>
              </li>
            ))}
          </ol>
          <Button onClick={onOpenMissions}>
            <Compass size={18} aria-hidden="true" /> 去核对已有委托
            {pending.length > 0 && (
              <span className="npc-stage-count">{pending.length}</span>
            )}
            <ArrowRight size={17} aria-hidden="true" />
          </Button>
        </section>

        <aside className="npc-stage-support">
          <section className="panel npc-stage-handoff" aria-label="GM协助">
            <span className="eyebrow">这一轮结束后</span>
            <h3>做完后交给GM</h3>
            <p>遇到争议、幕次切换，或追问超出本幕台词的案情，直接说：</p>
            <blockquote>“我请现场GM来一起确认一下。”</blockquote>
            <p>不用当场判断完整案情，也不用自己改流程。</p>
          </section>

          <details className="panel npc-stage-replies">
            <summary>被追问时，看这三句固定回答</summary>
            <dl>
              {fixedReplies.map((reply) => (
                <div key={reply.question}>
                  <dt>{reply.question}</dt>
                  <dd>{reply.answer}</dd>
                </div>
              ))}
            </dl>
          </details>

          <div className="npc-stage-links">
            <Button kind="ghost" onClick={onOpenRelations}>
              <Users size={17} aria-hidden="true" /> 查看关联玩家
              <span>{playerCount}位</span>
            </Button>
            <Button kind="ghost" onClick={onOpenScript}>
              <BookOpen size={17} aria-hidden="true" /> 按需核对完整NPC剧本
            </Button>
            <p>具体证言和释放条件，以本人保密剧本与GM指示为准。</p>
          </div>
        </aside>
      </div>
    </section>
  );
}
