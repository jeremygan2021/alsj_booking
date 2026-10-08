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
function Landing({ pub, onRegister, onPlay }) {
  const [npc, setNpc] = useState(null);
  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <div className="edition">
            <span className="tiny-star">✦</span> A PRIVATE INVITATION{" "}
            <span className="line" />
          </div>
          <Badge tone="gold">2026 万圣节特别企划</Badge>
          <h1>
            阿拉斯加之夜<span>最后的遗嘱</span>
          </h1>
          <p className="english-title">THE LAST TESTAMENT</p>
          <p className="hero-description">
            黄金时代的最后一场舞会。
            <br />
            一封邀请，一场盛宴，
            <br />
            和一个不该被说出的秘密。
          </p>
          <div className="hero-buttons">
            <Button onClick={onRegister}>
              领取你的邀请函 <ArrowUpRight size={18} />
            </Button>
            <a className="text-link" href="#story">
              走进这个故事 <ArrowRight size={16} />
            </a>
          </div>
          <div className="hero-foot">
            <span>
              <Clock size={14} /> 10月31日 · 19:00—23:00
            </span>
            <span>
              <Users size={14} /> 限定 {pub.settings.capacity} 位宾客
            </span>
          </div>
        </div>
        <div className="invitation-art" aria-label="庄园邀请函装饰">
          <div className="art-grid" />
          <div className="arch arch-one" />
          <div className="arch arch-two" />
          <div className="art-corner top-left" />
          <div className="art-corner bottom-right" />
          <div className="art-top">
            THE CROFT ESTATE <span>EST. 1926</span>
          </div>
          <div className="orbital">
            <span>✦</span>
          </div>
          <div className="invite-center">
            <span className="eyebrow">YOU ARE CORDIALLY INVITED</span>
            <div className="seal">
              A<span>N</span>
            </div>
            <span className="art-caption">
              THE GOLDEN AGE
              <br />
              ENDS TONIGHT.
            </span>
            <div className="ornament">◇ ───── ✦ ───── ◇</div>
            <p>财富 · 欲望 · 谎言 · 真相</p>
          </div>
          <div className="art-bottom">
            <span>
              ALASKA
              <br />
              PRIVATE MASQUERADE
            </span>
            <span className="art-date">
              31<small>OCTOBER / 2026</small>
            </span>
          </div>
          <div className="invitation-tag">
            <span className="pulse" /> INVITATION ONLY
          </div>
        </div>
      </section>
      <div className="facts">
        <div>
          <span>01 / THE NIGHT</span>
          <strong>一夜，四幕故事</strong>
          <small>从舞会到最终庭审</small>
        </div>
        <div>
          <span>02 / THE PEOPLE</span>
          <strong>六位关键人物</strong>
          <small>每个人都藏着另一面</small>
        </div>
        <div>
          <span>03 / THE TICKET</span>
          <strong>
            ¥{pub.settings.price}
            <em> / 位</em>
          </strong>
          <small>
            当前已报名 {pub.registered} / {pub.settings.capacity}
          </small>
        </div>
        <div>
          <span>04 / YOUR ROLE</span>
          <strong>你也是故事的一部分</strong>
          <small>专属角色 · 自由扮演</small>
        </div>
      </div>
      <section id="story" className="story-section">
        <div>
          <span className="eyebrow">WELCOME TO THE CROFT ESTATE</span>
          <h2>
            你收到了一封
            <br />
            不该存在的邀请函。
          </h2>
        </div>
        <div>
          <p>
            2026年，人工智能创造了新的黄金时代。在阿拉斯加的私人庄园，超级富豪盖茨比邀请你参加一场奢华的万圣节假面舞会。
          </p>
          <p>
            爵士乐、香槟、神秘拍卖与一套能够预测命运的AI。每位宾客都有赴宴的理由，也有不可告人的过去。午夜之前，你必须决定：真相和你拥有的一切，哪一个更重要？
          </p>
          <span className="story-note">
            活动为虚构剧情角色扮演 · 无需跑团经验
          </span>
        </div>
      </section>
      <section className="section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">FOUR ACTS. ONE UNFORGETTABLE NIGHT.</span>
            <h2>今晚，命运如何展开</h2>
          </div>
          <span className="muted">19:00 — 23:00</span>
        </div>
        <div className="acts-grid">
          {[
            [
              "I",
              "19:00",
              "黄金舞会",
              "与NPC结识、解谜、表演，赚取属于你的极光金币。",
              Compass,
            ],
            [
              "II",
              "20:15",
              "命运拍卖会",
              "竞拍证人承诺与神秘道具。你的每次出价，都可能改变结局。",
              Coins,
            ],
            [
              "III",
              "20:45",
              "午夜命案",
              "扫描证物，翻开证据，以D20鉴定还原被隐藏的时间线。",
              Dices,
            ],
            [
              "IV",
              "21:50",
              "最后的庭审",
              "用动机、手段和机会构建指控，让真相接受最终审判。",
              Gavel,
            ],
          ].map(([num, time, title, text, I]) => (
            <article key={num} className="act-card">
              <div className="act-top">
                <span>ACT {num}</span>
                <Icon as={I} />
              </div>
              <div className="act-number">{num}</div>
              <small>{time}</small>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="section npc-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">SIX FACES. COUNTLESS SECRETS.</span>
            <h2>庄园里的六张面孔</h2>
          </div>
          <Badge>公开人物档案</Badge>
        </div>
        <div className="npc-grid">
          {pub.npcs.map((n, i) => (
            <button className="npc-card" key={n.id} onClick={() => setNpc(n)}>
              <div className={"npc-portrait portrait-" + i}>
                <span className="portrait-number">0{i + 1}</span>
                <span className="portrait-monogram">
                  {n.english
                    .split(" ")
                    .map((s) => s[0])
                    .join("")}
                </span>
                <span className="portrait-label">CHARACTER DOSSIER</span>
              </div>
              <div className="npc-name">
                <small>{n.role}</small>
                <h3>{n.name}</h3>
                <p>{n.english}</p>
                <ArrowUpRight size={16} />
              </div>
            </button>
          ))}
        </div>
      </section>
      <section className="final-invite">
        <span className="eyebrow">YOUR NAME IS ON THE GUEST LIST</span>
        <h2>
          面具之下，
          <br />
          你会成为谁？
        </h2>
        <p>先报名，再写下你的虚构故事。你的专属身份，正在等待揭晓。</p>
        <Button onClick={onRegister}>
          接受邀请 · ¥{pub.settings.price} <ArrowRight size={17} />
        </Button>
        <small>票务由工作人员核验 · 地点以活动方正式通知为准</small>
      </section>
      {npc && (
        <Modal title={npc.name} onClose={() => setNpc(null)}>
          <p className="eyebrow">{npc.english}</p>
          <Badge>{npc.role}</Badge>
          <p className="large-paragraph">{npc.bio}</p>
          <p className="muted">更多故事将在现场逐步解锁。</p>
        </Modal>
      )}
    </main>
  );
}

export default Landing;
