import React, { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Handshake, Lock, RefreshCw } from "lucide-react";
import { api } from "../api";
import { factions } from "../constants";
import { Badge, Button, Field } from "./ui";
import "./faction-play.css";

const policyStatus = (policy) =>
  policy.achieved
    ? "目标达成"
    : policy.proposal?.reviewStatus === "rejected"
      ? "证据需补充"
      : policy.proposal?.reviewStatus === "approved"
        ? "证据有效，待外组支持"
        : policy.supports.length
          ? "条件齐备，待GM复核"
          : policy.proposal
            ? "待复核与外组支持"
            : "等待提交";

export default function FactionPlay({ gm = false, phase, notify }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const alive = useRef(false),
    request = useRef(0),
    submitting = useRef(false);
  const load = useCallback(async () => {
    const id = ++request.current;
    try {
      const next = await api(gm ? "/staff/faction-play" : "/faction-play");
      if (alive.current && id === request.current) {
        setData(next);
        setError("");
      }
    } catch (failure) {
      if (alive.current && id === request.current) setError(failure.message);
    }
  }, [gm]);
  useEffect(() => {
    alive.current = true;
    void load();
    const timer = setInterval(() => {
      if (!submitting.current) void load();
    }, 8000);
    return () => {
      alive.current = false;
      ++request.current;
      clearInterval(timer);
    };
  }, [load, phase]);
  const mutate = async (path, body, message) => {
    if (submitting.current) return;
    submitting.current = true;
    ++request.current;
    setBusy(true);
    setError("");
    try {
      const next = await api(
        gm ? `/staff/faction-play/${path}` : `/faction-play/${path}`,
        body,
      );
      if (alive.current) {
        setData(next);
        setConfirming(null);
        notify?.(message);
      }
    } catch (failure) {
      if (alive.current) {
        await load();
        setError(failure.message);
      }
    } finally {
      submitting.current = false;
      if (alive.current) setBusy(false);
    }
  };
  if (!data)
    return (
      <section className="panel faction-play" aria-label="阵营协商">
        <p role={error ? "alert" : "status"}>{error || "正在加载阵营任务…"}</p>
        {error && (
          <Button kind="ghost compact" onClick={load}>
            重新加载
          </Button>
        )}
      </section>
    );
  const own = data.policies.find((p) => p.id === data.faction);
  const currentPhase = data.phase;
  const canWrite = !gm && data.open && data.canParticipate;
  const settled = currentPhase >= 4;
  const visible = gm
    ? data.policies
    : data.policies.filter((p) => p.id !== data.faction);
  return (
    <section
      className="panel faction-play"
      aria-labelledby={gm ? "gm-faction-play-title" : "faction-play-title"}
    >
      <div className="faction-play-heading">
        <div>
          <span className="eyebrow">不同立场 · 协商保障</span>
          <h2 id={gm ? "gm-faction-play-title" : "faction-play-title"}>
            <Handshake size={20} />
            {gm ? "阵营协商与结算" : "我的阵营任务"}
          </h2>
        </div>
        <Badge tone={settled ? "green" : "gold"}>
          {settled
            ? "协商已结束"
            : currentPhase === 3
              ? "协商开放"
              : "第三幕开放协商"}
        </Badge>
      </div>
      <p className="faction-play-actions">
        <strong>查案</strong> 搜证与问询 <span>→</span> <strong>协商</strong>{" "}
        交换材料与承诺 <span>→</span> <strong>提交</strong> 案件判断与保障条款
      </p>
      <p className="small-text muted">
        FBI与遗产阵营追查事实，杀手阵营可辩护或影响判断。正式证据经GM复核，加一份外组支持即可达成协商目标；与案件评分、最终一人一票的价值选择分别结算。
      </p>
      {error && (
        <p role="alert" className="faction-play-error">
          {error}
        </p>
      )}
      {!gm && own && (
        <article className="faction-policy-card own">
          <div className="faction-policy-title">
            <h3>
              {own.name} · {own.title}
            </h3>
            <Badge tone={own.achieved ? "green" : ""}>
              {policyStatus(own)}
            </Badge>
          </div>
          <p>{own.clause}</p>
          <p className="small-text muted">{own.boundary}</p>
          {own.id === "conspirator" && (
            <p className="small-text muted">
              你事先知道凶手身份，并须在活动前使用本人的独立暗号接头。请查看上方“我的正式阵营”中的私有简报，不向他人展示该信息。
            </p>
          )}
          {own.proposal && (
            <div className="faction-policy-reference">
              <strong>
                {own.proposal.evidenceId} · {own.proposal.evidenceTitle}
              </strong>
              <p>{own.proposal.explanation}</p>
              <small>
                阵营代表已提交
                {own.supports.length
                  ? ` · 第${own.supports.map((s) => s.groupId).join("、")}组支持 · 已锁定`
                  : " · 待外组支持"}
              </small>
            </div>
          )}
          {own.proposal?.reviewNote && (
            <p className="faction-review-note">
              GM复核：{own.proposal.reviewNote}
            </p>
          )}
          {canWrite && !own.supports.length && (
            <details
              className="faction-proposal-form"
              key={`${own.id}-${own.proposal?.updatedAt || "new"}`}
            >
              <summary>
                {own.proposal
                  ? "修改本方证据说明"
                  : "用一条正式证据提出保障条款"}
              </summary>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void mutate(
                    "proposal",
                    {
                      evidenceId: form.get("evidenceId"),
                      explanation: form.get("explanation"),
                    },
                    "本阵营的证据说明已提交，等待外组本人签署。",
                  );
                }}
              >
                <Field label="本调查组已取得的正式证据">
                  <select
                    name="evidenceId"
                    required
                    defaultValue={own.proposal?.evidenceId || ""}
                    disabled={busy}
                  >
                    <option value="">请选择证据</option>
                    {data.evidence.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.id} · {e.title}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="说明证据如何支持条款（10—240字）">
                  <textarea
                    name="explanation"
                    required
                    minLength={10}
                    maxLength={240}
                    rows={3}
                    defaultValue={own.proposal?.explanation || ""}
                    disabled={busy}
                  />
                </Field>
                {!data.evidence.length && (
                  <p className="small-text muted">
                    请先在证据册中取得正式证据；同组已取得的证据也可使用。
                  </p>
                )}
                <Button
                  type="submit"
                  kind="compact"
                  disabled={busy || !data.evidence.length}
                >
                  {busy ? "正在提交…" : "提交本方证据说明"}
                </Button>
              </form>
            </details>
          )}
        </article>
      )}
      {!gm && !own && (
        <p className="muted">正式阵营尚未确定，请联系GM核对分配。</p>
      )}
      {currentPhase >= 3 && (
        <div className="faction-policy-list">
          {!gm && (
            <h3>{settled ? "各方结算" : "阅读外阵营条款，协商后支持一项"}</h3>
          )}
          {visible.map((policy) => {
            const signed = data.groupSupport === policy.id;
            const eligible = canWrite && policy.canSupport;
            return (
              <article className="faction-policy-card" key={policy.id}>
                <div className="faction-policy-title">
                  <h3>{policy.name}</h3>
                  <Badge tone={policy.achieved ? "green" : ""}>
                    {policyStatus(policy)}
                  </Badge>
                </div>
                <p>{policy.clause}</p>
                {policy.proposal ? (
                  <>
                    <p className="faction-policy-evidence">
                      <strong>
                        {policy.proposal.evidenceId} ·{" "}
                        {policy.proposal.evidenceTitle}
                      </strong>
                    </p>
                    <p>{policy.proposal.explanation}</p>
                    <p className="small-text muted">
                      {gm
                        ? `第${policy.proposal.groupId}组提交`
                        : "阵营代表已提交"}
                      {gm ? `（${policy.proposal.submittedBy}）` : ""}；
                      {policy.supports.length
                        ? `第${policy.supports.map((s) => s.groupId).join("、")}组支持`
                        : "尚无外组签署"}
                    </p>
                    {gm &&
                      policy.supports.map((s) => (
                        <p className="small-text muted" key={s.groupId}>
                          第{s.groupId}组签署人：{s.signedBy} ·{" "}
                          {factions[s.faction]}
                        </p>
                      ))}
                  </>
                ) : (
                  <p className="small-text muted">
                    等待该阵营引用正式证据并提交说明。
                  </p>
                )}
                {signed && (
                  <p className="faction-support-done">
                    <CheckCircle2 size={16} /> 本调查组已支持此条款
                  </p>
                )}
                {policy.proposal?.reviewNote && (
                  <p className="faction-review-note">
                    GM复核：{policy.proposal.reviewNote}
                  </p>
                )}
                {gm && currentPhase >= 3 && policy.proposal && (
                  <form
                    className="faction-review-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      void mutate(
                        "review",
                        {
                          faction: policy.id,
                          status: event.nativeEvent.submitter.value,
                          note: form.get("note"),
                          proposalUpdatedAt: policy.proposal.updatedAt,
                        },
                        "复核结果已公布；案件评分和个人价值票保持独立。",
                      );
                    }}
                  >
                    <Field label="GM复核说明（可选，最多180字）">
                      <textarea
                        name="note"
                        maxLength={180}
                        rows={2}
                        disabled={busy}
                      />
                    </Field>
                    <div>
                      <Button
                        type="submit"
                        name="review"
                        value="approved"
                        kind="compact"
                        disabled={busy}
                      >
                        证据关联有效
                      </Button>
                      <Button
                        type="submit"
                        name="review"
                        value="rejected"
                        kind="ghost compact"
                        disabled={busy}
                      >
                        需补充，撤回原支持
                      </Button>
                    </div>
                  </form>
                )}
                {eligible &&
                  (confirming === policy.id ? (
                    <div className="faction-support-confirm">
                      <p>
                        请先取得本组共识。签署后本组不能支持其他条款；签字不绑定你个人的最终价值票。
                      </p>
                      <div>
                        <Button
                          kind="compact"
                          disabled={busy}
                          onClick={() =>
                            void mutate(
                              "support",
                              {
                                faction: policy.id,
                                proposalUpdatedAt: policy.proposal.updatedAt,
                              },
                              "已代表本调查组支持该条款；最终价值票仍由每位玩家自由选择。",
                            )
                          }
                        >
                          确认代表第{data.groupId}组支持
                        </Button>
                        <Button
                          kind="ghost compact"
                          disabled={busy}
                          onClick={() => setConfirming(null)}
                        >
                          取消
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      kind="ghost compact"
                      disabled={busy}
                      onClick={() => setConfirming(policy.id)}
                    >
                      <Handshake size={16} /> 协商后代表本组支持
                    </Button>
                  ))}
              </article>
            );
          })}
        </div>
      )}
      <details className="faction-play-rules">
        <summary>协商规则与结算说明</summary>
        <ul>
          <li>
            全场设四个调查组，阵营人数由GM抽签规则决定。调查组与阵营分别分配。
          </li>
          <li>
            每阵营共用一条保障条款；引用一条本组已取得的官方证据，写明关联，经GM确认有效，再取得一个外阵营、外调查组的真实签署，即达成目标。
          </li>
          <li>
            GM要求补充时，原支持会撤回并向双方展示原因；第三幕可补写后重新征求支持。
          </li>
          <li>
            每组最多支持一项外阵营条款，组内先达成共识。只能由本组玩家本人签署，不能替对方假签。签后提案锁定。
          </li>
          <li>
            可以交易金币、承诺与标明“未核实”的材料；不能改官方证据、卖票或增加投票权。
          </li>
          <li>
            三个阵营可以同时达成目标。第三幕提交与签署，第四幕只读结算；最终价值选择保持每人一票，不按阵营加权。
          </li>
          <li>
            有效文件规定的90天冻结与独立审查先行；价值票表达审查后的建议，不直接越过合法授权。
          </li>
        </ul>
      </details>
      {!gm && currentPhase === 3 && !data.canParticipate && (
        <p className="small-text muted">
          <Lock size={14} /> 完成票务、角色审核、签到及正式阵营确认后即可协商。
        </p>
      )}
      {gm && (
        <Button kind="ghost compact" onClick={load}>
          <RefreshCw size={15} /> 刷新协商板
        </Button>
      )}
    </section>
  );
}
