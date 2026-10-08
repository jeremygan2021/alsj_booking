import React, { useEffect, useRef } from "react";
import { FileText, Lock, CheckCircle2, RotateCcw, Dices } from "lucide-react";
import { Badge, Button, Modal } from "./ui";

export default function ClueReveal({
  clue,
  flipped,
  busy,
  blocker,
  phase,
  onFlip,
  onCheck,
  onClose,
}) {
  const revealed = useRef(null);
  useEffect(() => {
    if (!flipped) return;
    const timer = setTimeout(() => revealed.current?.focus(), 750);
    return () => clearTimeout(timer);
  }, [flipped]);
  return (
    <Modal title={clue.id + " · " + clue.title} onClose={onClose}>
      <div className={"clue-flip-scene " + (flipped ? "is-flipped" : "")}>
        <div className="clue-flip-inner">
          <div className="clue-flip-front" aria-hidden={flipped}>
            <span className="eyebrow">SEALED EVIDENCE / ALASKA NIGHTS</span>
            <div className="clue-seal">
              <FileText size={38} strokeWidth={1} />
            </div>
            <span className="clue-number">{clue.id}</span>
            <h3>{clue.title}</h3>
            <p>
              {clue.area} · {clue.category}
            </p>
            <Badge tone={clue.unlocked ? "green" : "gold"}>
              {clue.unlocked ? "已收入私人证据册" : "密封线索卡"}
            </Badge>
            <p className="clue-flip-hint">
              {blocker || "触碰封印，翻开这张线索卡。"}
            </p>
            <Button
              autoFocus
              onClick={onFlip}
              disabled={busy || Boolean(blocker) || flipped}
              tabIndex={flipped ? -1 : 0}
            >
              {blocker ? <Lock size={18} /> : <RotateCcw size={18} />}{" "}
              {busy ? "正在查验证据…" : blocker ? "暂未开放" : "翻开线索卡"}
            </Button>
          </div>
          <div className="clue-flip-back" aria-hidden={!flipped}>
            {flipped && (
              <div className="clue-reveal">
                <div className="clue-reveal-heading">
                  <Badge tone="gold">
                    {clue.id} · {clue.area}
                  </Badge>
                  <span>
                    <CheckCircle2 size={15} />
                    已保存到证据册
                  </span>
                </div>
                <h3 ref={revealed} tabIndex={-1}>
                  基础证据
                </h3>
                <p>{clue.body}</p>
                {clue.detail ? (
                  <div className="advanced">
                    <span className="eyebrow">ADVANCED ANALYSIS</span>
                    <p>{clue.detail}</p>
                  </div>
                ) : (
                  <div className="notice">
                    <Dices size={18} />
                    <span>
                      额外细节需要{clue.skill}鉴定达到 DC {clue.dc}
                      。基础证据已永久保存。
                    </span>
                  </div>
                )}
                <div className="dice-result">
                  {clue.check ? (
                    <>
                      <strong>{clue.check.roll}</strong>
                      <span>
                        D20 + {clue.check.bonus}
                        <br />
                        本调查组该区域已完成鉴定
                      </span>
                    </>
                  ) : (
                    <Button disabled={busy || phase !== 3} onClick={onCheck}>
                      <Dices size={19} />
                      掷D20 · 小组主要鉴定
                    </Button>
                  )}
                </div>
                <small className="muted">
                  每个调查组在每个区域仅有一次主要鉴定，请与组员确认代表。
                </small>
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
