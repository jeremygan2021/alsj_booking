import React, { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Smartphone } from "lucide-react";
import { api } from "../api";
import { Modal, Field, Button } from "./ui";
export default function SmsAuth({
  onSuccess,
  onClose,
  enabled = true,
}) {
  const [phone, setPhone] = useState(""),
    [code, setCode] = useState(""),
    [name, setName] = useState(""),
    [sending, setSending] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [retryAt, setRetryAt] = useState(0),
    [seconds, setSeconds] = useState(0);
  const alive = useRef(true);
  const codeId = useId();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const update = () =>
      setSeconds(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);
  const send = async () => {
    if (sending || busy || seconds > 0 || !/^1\d{10}$/.test(phone)) return;
    setError("");
    setNotice("");
    setSending(true);
    try {
      const result = await api("/auth/sms/send", { phone });
      if (!alive.current) return;
      setRetryAt(Date.now() + result.retryAfter * 1000);
      setNotice("验证码已提交发送，15分钟内有效。请留意短信。");
    } catch (failure) {
      if (alive.current) setError(failure.message);
    } finally {
      if (alive.current) setSending(false);
    }
  };
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await api("/auth/sms/login", {
        phone,
        code,
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      if (alive.current) await onSuccess(result.role, result.registered);
    } catch (failure) {
      if (alive.current) setError(failure.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return (
    <Modal title="手机号注册 / 登录" onClose={onClose}>
      <div className="sms-auth-body">
        <div className="sms-auth-invitation">
          <span>THE THORNE ESTATE · PRIVATE INVITATION</span>
          <h3>欢迎赴约</h3>
          <p>一封邀请，一段尚未揭晓的故事。</p>
          <small>2026.10.31 · 阿拉斯加之夜</small>
        </div>
        <p className="muted">
          首次验证手机号后自动报名，已有账号直接登录，无需设置密码。
        </p>
        <form onSubmit={submit}>
          <Field label="手机号">
            <input
              name="phone"
              type="tel"
              autoFocus
              required
              inputMode="tel"
              autoComplete="tel-national"
              pattern="1[0-9]{10}"
              maxLength={11}
              placeholder="请输入11位手机号"
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value.replace(/\D/g, "").slice(0, 11));
                setCode("");
                setNotice("");
              }}
            />
          </Field>
          <div className="field sms-code-field">
            <label htmlFor={codeId}>短信验证码</label>
            <div className="sms-code-row">
              <input
                id={codeId}
                name="code"
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="6位数字"
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
              />
              <Button
                kind="ghost compact"
                disabled={
                  sending ||
                  busy ||
                  seconds > 0 ||
                  !enabled ||
                  !/^1\d{10}$/.test(phone)
                }
                onClick={send}
              >
                {sending
                  ? "正在发送…"
                  : seconds > 0
                    ? `${seconds}秒后重发`
                    : "获取验证码"}
              </Button>
            </div>
          </div>
          <Field label="你的称呼（首次报名可选）">
            <input
              maxLength={40}
              placeholder="不填写则自动生成称呼"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          {notice && (
            <p className="muted" role="status">
              {notice}
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="notice">
            <Smartphone size={17} />
            <span>
              新用户验证后自动注册，票务仍需工作人员核验，签到和角色审批通过后才能正式搜证。
            </span>
          </div>
          <Button kind="full" type="submit" disabled={busy || sending}>
            {busy ? "正在验证…" : "验证并进入"}
            <ArrowRight size={17} />
          </Button>
        </form>
        {!enabled && (
          <p role="alert" className="form-error">
            短信登录暂未配置，请联系管理员。
          </p>
        )}
      </div>
    </Modal>
  );
}
