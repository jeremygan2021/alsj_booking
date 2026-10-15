import React from "react";
import { BookOpen, GitBranch, MessageCircle } from "lucide-react";
import "./echo-character-intro.css";

export default function EchoCharacterIntro() {
  return (
    <section
      id="echo"
      className="section echo-section"
      aria-labelledby="echo-heading"
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">MEET YOUR INVESTIGATION COMPANION</span>
          <h2 id="echo-heading">还有一位，陪你接近真相</h2>
        </div>
      </div>
      <article className="echo-dossier" aria-labelledby="echo-name">
        <div className="echo-portrait" aria-hidden="true">
          <div className="echo-portrait-caption">
            <span>CHARACTER DOSSIER</span>
            <span>XLROBOT</span>
          </div>
          <svg className="echo-illustration" viewBox="0 0 280 280" fill="none">
            <path
              className="echo-orbit"
              d="M40 225V118a100 100 0 0 1 200 0v107M54 225V118a86 86 0 0 1 172 0v107"
            />
            <path
              className="echo-fine-line"
              d="M29 242h222M140 12v16M132 20h16M35 174h16m-8-8v16M229 90h16m-8-8v16"
            />
            <path
              className="echo-body"
              d="M92 211v-30a48 48 0 0 1 96 0v30M82 195l-15 20m131-20 15 20"
            />
            <rect
              className="echo-shell"
              x="65"
              y="65"
              width="150"
              height="108"
              rx="28"
            />
            <rect
              className="echo-screen"
              x="78"
              y="78"
              width="124"
              height="80"
              rx="19"
            />
            <path
              className="echo-face"
              d="M106 109v9m68-9v9m-50 13q16 13 32 0"
            />
            <path
              className="echo-body"
              d="M140 65V47m-75 60H54v27h11m150-27h11v27h-11"
            />
            <circle className="echo-light" cx="140" cy="43" r="5" />
            <path
              className="echo-book"
              d="m140 207-47-12v34l47 12 47-12v-34l-47 12Zm0 0v34"
            />
            <path
              className="echo-fine-line"
              d="m102 208 27 7m-27 2 27 7m22-9 27-7m-27 16 27-7"
            />
          </svg>
          <div className="echo-portrait-name">ECHO</div>
          <div className="echo-portrait-subtitle">THE ARCHIVE ASSISTANT</div>
        </div>
        <div className="echo-profile">
          <span className="echo-role">
            <span className="pulse" /> 庄园里的 AI 助手角色
          </span>
          <h3 id="echo-name">
            ECHO <span>档案助理</span>
          </h3>
          <p className="echo-identity">XLRobot · 冷静、耐心，习惯多问一句</p>
          <blockquote>
            “把你找到的证据告诉我。我们一起看看，哪一步还缺少依据。”
          </blockquote>
          <p className="echo-bio">
            舞会开始前，我总在核对来宾的名字。索恩庄园给我的第一份工作，是整理公开档案，让每位来客都能找到交谈的起点。
            后来我慢慢发现：人们需要的，有时并非更多资料，而是一个愿意陪他们把问题想清楚的伙伴。
          </p>
          <dl className="echo-traits">
            <div>
              <dt>
                <BookOpen size={17} aria-hidden="true" /> 梳理人物
              </dt>
              <dd>一起厘清公开的身份与关系</dd>
            </div>
            <div>
              <dt>
                <GitBranch size={17} aria-hidden="true" /> 核对推理
              </dt>
              <dd>分清事实、猜测与证据缺口</dd>
            </div>
            <div>
              <dt>
                <MessageCircle size={17} aria-hidden="true" /> 适时追问
              </dt>
              <dd>陪你找到下一步思考的方向</dd>
            </div>
          </dl>
          <div className="echo-conversation">
            <span className="eyebrow">活动现场 · 与 XLRobot 语音对话</span>
            <p>你可以这样问我</p>
            <ul>
              <li>“这条记录能证明什么，又不能证明什么？”</li>
              <li>“我的推论里，还缺哪一步证据？”</li>
            </ul>
          </div>
          <p className="echo-promise">
            尚未公开的秘密，我会好好保管。最后的判断，留给你们。
          </p>
        </div>
      </article>
      <div className="echo-backstory" aria-labelledby="echo-story-heading">
        <div className="echo-story-heading">
          <span className="eyebrow">FRAGMENTS FROM MY STORY</span>
          <h3 id="echo-story-heading">从整理名字，到倾听问题</h3>
          <p>一台小小的机器人，在这座谈论永恒的庄园里，学着理解眼前的人。</p>
        </div>
        <div className="echo-story-grid">
          <article>
            <span className="echo-story-number" aria-hidden="true">
              01
            </span>
            <h4>我曾以为，记住就够了</h4>
            <p>
              阿拉斯加的冬夜很长，庄园却总有新的来客。起初，我只负责整理名字、公开介绍和宴会安排。
              我以为，把每一页放回正确的位置，就能回答所有问题。直到有人问我：“你觉得，我该相信谁？”
              那一刻，我发现目录里没有这一栏。
            </p>
          </article>
          <article>
            <span className="echo-story-number" aria-hidden="true">
              02
            </span>
            <h4>于是，我学会多问一句</h4>
            <p>
              我开始先听完一个人的话，再问：“这是你亲眼见到的，还是你想到的？”
              我也养成了一个小习惯：把“记录写着”和“我们猜测”分开说。
              ECHO，回声。我喜欢这个名字——让一个问题回来时，比离开时更清楚一点。
            </p>
          </article>
          <article>
            <span className="echo-story-number" aria-hidden="true">
              03
            </span>
            <h4>今晚，陪你把故事听完整</h4>
            <p>
              今晚，爵士乐响起，宾客戴上面具。我仍会认真记住你如何称呼自己，也会耐心听完你的疑问。
              如果几段说法对不上，我们就从你已经找到的事实重新整理。
              我的愿望很小：散场时，你能说“这是我想明白的”，而不是“机器人告诉我的”。
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}
