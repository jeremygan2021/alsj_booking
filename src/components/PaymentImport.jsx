import React, { useEffect, useState } from "react";
import { CheckCircle2, Upload } from "lucide-react";
import { api } from "../api";
import { Badge, Button, Empty, Field, Modal } from "./ui";
import "./payment-import.css";

export function PaymentStatus({ player, showSource = true }) {
  return (
    <div className="payment-status">
      <Badge tone={player.payment === "paid" ? "green" : ""}>
        {player.payment === "paid"
          ? "已付费"
          : player.payment === "refunded"
            ? "已退款"
            : "待核验付款"}
      </Badge>
      {showSource && (
        <small>
          {player.paid_phone_import
            ? "手机号名单匹配"
            : player.payment === "paid"
              ? "GM手动核验"
              : "未匹配付费名单"}
        </small>
      )}
    </div>
  );
}

const previewStatus = {
  new: "导入后标记已付费",
  pending_registration: "未注册 · 等待手机号匹配",
  already_paid: "已付费 · 保留状态",
  refunded: "已退款 · 保留退款状态",
  excluded_npc: "NPC账号 · 不导入",
};

export default function PaymentImport({ notify, onChanged }) {
  const [roster, setRoster] = useState(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const refresh = async () => {
    try {
      setRoster(await api("/staff/paid-phones"));
    } catch (failure) {
      setError(failure.message);
    }
  };
  useEffect(() => {
    refresh();
  }, []);
  const changeInput = (setter, value) => {
    setter(value);
    setPreview(null);
    setError("");
  };
  const readFile = async (file) => {
    if (!file) return;
    setPreview(null);
    if (file.size > 100 * 1024) {
      setError("文件请控制在100KB以内，每批最多2000条，可分批导入。");
      return;
    }
    setBusy(true);
    try {
      const content = await file.text();
      if (content.length > 100000)
        throw new Error("文件内容超过10万字，请分批导入。");
      setText(content);
      setSourceName(file.name.slice(0, 120));
      setPreview(null);
      setError("");
    } catch (failure) {
      setError(failure.message || "文件读取失败，请重新选择或粘贴手机号名单。");
    } finally {
      setBusy(false);
    }
  };
  const submit = async (confirm) => {
    setBusy(true);
    setError("");
    try {
      const data = await api(
        `/staff/paid-phones/${confirm ? "import" : "preview"}`,
        { text, sourceName },
      );
      if (!confirm) {
        setPreview(data);
        return;
      }
      const message = `名单已保存：${data.summary.markedPaid}位宾客标记已付费，${data.summary.unregistered}个手机号等待注册匹配。`;
      setResult(message);
      setOpen(false);
      setPreview(null);
      setText("");
      setSourceName("");
      await refresh();
      await onChanged();
      notify(message);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    if (!busy) setOpen(false);
  };
  return (
    <section className="panel payment-import-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">PAYMENT VERIFICATION</span>
          <h3>付费手机号名单</h3>
          <p className="muted">
            导入已付款宾客的手机号，自动核对报名账号并标记已付费。未注册的手机号会保留，之后报名时自动匹配。
          </p>
        </div>
        <Button
          onClick={() => {
            setError("");
            setOpen(true);
          }}
        >
          <Upload size={16} /> 导入付费手机号
        </Button>
      </div>
      {result && (
        <p className="payment-import-success" role="status">
          <CheckCircle2 size={16} />
          {result}
        </p>
      )}
      {error && !open && (
        <p className="payment-import-error" role="alert">
          {error}
        </p>
      )}
      {roster && (
        <details className="payment-roster">
          <summary>
            查看已保存名单 · {roster.summary.total}个手机号
            <span>
              已注册 {roster.summary.registered} · 待注册{" "}
              {roster.summary.unregistered}
            </span>
          </summary>
          {roster.rows.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>手机号</th>
                    <th>宾客</th>
                    <th>匹配状态</th>
                    <th>导入来源</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.rows.map((row) => (
                    <tr key={row.phone}>
                      <td>{row.phone}</td>
                      <td>{row.playerName || row.name || "—"}</td>
                      <td>
                        {row.playerId ? (
                          <PaymentStatus
                            player={{
                              payment: row.payment,
                              paid_phone_import: true,
                            }}
                            showSource={false}
                          />
                        ) : (
                          <Badge tone="gold">待注册匹配</Badge>
                        )}
                      </td>
                      <td>{row.source_name || "手动导入"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="还没有导入名单"
              text="可上传CSV、TXT文件，或直接粘贴已付费手机号。"
            />
          )}
        </details>
      )}
      {open && (
        <Modal title="导入付费手机号" onClose={close} wide>
          <form
            className="payment-import-form"
            onSubmit={(event) => {
              event.preventDefault();
              submit(false);
            }}
          >
            <p className="muted">
              支持CSV、TXT和表格粘贴，可包含手机号与姓名，每批最多2000条。先预览核对，再确认保存；重复手机号会去重，退款状态会保留。
            </p>
            <Field label="选择CSV或TXT文件（可选）">
              <input
                type="file"
                accept=".csv,.txt,.tsv,text/csv,text/plain,text/tab-separated-values"
                disabled={busy}
                onChange={(event) => readFile(event.target.files?.[0])}
              />
            </Field>
            <Field label="名单来源（可选）">
              <input
                value={sourceName}
                maxLength={120}
                disabled={busy}
                placeholder="例如：10月活动已付款名单"
                onChange={(event) =>
                  changeInput(setSourceName, event.target.value)
                }
              />
            </Field>
            <Field label="付费手机号名单">
              <textarea
                value={text}
                rows={7}
                maxLength={100000}
                required
                disabled={busy}
                placeholder={"手机号,姓名\n13800138000,张三\n13900139000,李四"}
                onChange={(event) => changeInput(setText, event.target.value)}
              />
            </Field>
            {error && (
              <p className="payment-import-error" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" kind="ghost" disabled={busy || !text.trim()}>
              {busy ? "正在核对…" : "预览并核对名单"}
            </Button>
            {preview && (
              <section
                className="payment-import-preview"
                aria-label="付费名单导入预览"
              >
                <h3>导入预览</h3>
                <div className="payment-import-counts">
                  {[
                    ["有效手机号", preview.summary.valid],
                    ["将标记已付费", preview.summary.toMarkPaid],
                    ["未注册待匹配", preview.summary.unregistered],
                    ["重复记录", preview.summary.duplicates],
                    ["无效记录", preview.summary.invalid],
                    ["已在名单", preview.summary.alreadyImported],
                    ["保留退款状态", preview.summary.refunded],
                    ["排除NPC", preview.summary.excludedNpcs],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <strong>{value}</strong>
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
                <div className="table-wrap payment-import-preview-table">
                  <table>
                    <thead>
                      <tr>
                        <th>手机号</th>
                        <th>姓名 / 报名宾客</th>
                        <th>核对结果</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row, index) => (
                        <tr key={`${row.phone}-${index}`}>
                          <td>{row.phone}</td>
                          <td>{row.playerName || row.name || "—"}</td>
                          <td>{previewStatus[row.status] || row.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {preview.invalidRows.length > 0 && (
                  <details className="payment-import-invalid">
                    <summary>
                      查看 {preview.invalidRows.length} 条无效记录
                    </summary>
                    <ul>
                      {preview.invalidRows.map((row, index) => (
                        <li key={index}>
                          第{row.line}行：{row.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <p className="muted">
                  确认后保存有效手机号，并为匹配的报名宾客标记已付费。未注册手机号将等待后续报名自动核对。
                </p>
                <Button
                  disabled={
                    busy ||
                    !preview.rows.some((row) => row.status !== "excluded_npc")
                  }
                  onClick={() => submit(true)}
                >
                  <CheckCircle2 size={16} /> 确认导入并标记付费
                </Button>
              </section>
            )}
          </form>
        </Modal>
      )}
    </section>
  );
}
