import React from "react";
import NpcPortrait from "./NpcPortrait";
import "./npc-materials.css";

export function NpcDossier({ dossier }) {
  if (!dossier) return null;
  const supplement = dossier.sections.filter(
    (s) => !["公开人物小传", "第一人称故事卡"].includes(s.title),
  );
  return (
    <article className="npc-materials">
      <header className="npc-materials-heading">
        <NpcPortrait npc={dossier} dossier />
        <div>
          <span className="eyebrow">{dossier.npcId} · 演员保密剧本</span>
          <h3>{dossier.name}</h3>
          <p>
            {dossier.english} · {dossier.age}岁
          </p>
          <p>{dossier.role}</p>
          <small>供本人演员与GM阅读；证言按触发条件释放。</small>
        </div>
      </header>
      <details open>
        <summary>我的故事</summary>
        <p className="npc-materials-prose">{dossier.story}</p>
      </details>
      <details open>
        <summary>我知道的事实</summary>
        <ul>
          {dossier.knowledge.map((text, i) => (
            <li key={i}>{text}</li>
          ))}
        </ul>
      </details>
      <details open>
        <summary>我不知道与不能说的内容</summary>
        <ul>
          {dossier.unknown.map((text, i) => (
            <li key={i}>{text}</li>
          ))}
        </ul>
      </details>
      <details open>
        <summary>我的时间线与演出走位</summary>
        <div className="npc-materials-table">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>事件</th>
              </tr>
            </thead>
            <tbody>
              {dossier.timeline.map((item, i) => (
                <tr key={i}>
                  <td>{item.time}</td>
                  <td>{item.event}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <details>
        <summary>我关联的线索与代码编号</summary>
        <div className="npc-materials-table">
          <table>
            <thead>
              <tr>
                <th>原稿</th>
                <th>玩家线索编号</th>
                <th>名称</th>
              </tr>
            </thead>
            <tbody>
              {dossier.evidenceLinks?.map((item) => (
                <tr key={item.sourceId}>
                  <td>{item.sourceId}</td>
                  <td>{item.clueId}</td>
                  <td>{item.title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {supplement.map((s, i) => (
        <details key={i}>
          <summary>{s.title}</summary>
          <p className="npc-materials-prose">{s.text}</p>
        </details>
      ))}
    </article>
  );
}

export function ModelBriefs({ materials }) {
  if (!materials?.models) return null;
  return (
    <section className="panel npc-materials">
      <h3>线索3D物料 · {materials.models.length}类调查模型</h3>
      <p>
        正式GLB已接入证物查看器，支持旋转、缩放和观察点定位。现有三类示例模型保留为资源缺失时的回退。
      </p>
      {materials.models.map((model) => (
        <details key={model.id}>
          <summary>
            {model.name} · {model.status}
          </summary>
          <p>
            文件：{model.filename} · 场景：{model.scene}
          </p>
          <p>
            关联证据：{model.evidenceIds.join("、") || "排除性调查节点"}；代码：
            {model.clueIds.join("、") || "尚无独立证据ID"}
          </p>
          <p>{model.geometry}</p>
          <p>观察热点：{model.hotspots.join("、")}</p>
          <p>{model.interaction}</p>
          <p>{model.limits}</p>
          <p>{model.format}</p>
          <p className="npc-materials-prose">制作提示词：{model.prompt}</p>
        </details>
      ))}
      <details>
        <summary>原稿与代码证据编号对照</summary>
        <div className="npc-materials-table">
          <table>
            <thead>
              <tr>
                <th>原稿</th>
                <th>代码</th>
                <th>证据</th>
              </tr>
            </thead>
            <tbody>
              {materials.evidence.map((e) => (
                <tr key={e.id}>
                  <td>{e.id}</td>
                  <td>{e.clueId}</td>
                  <td>{e.title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
