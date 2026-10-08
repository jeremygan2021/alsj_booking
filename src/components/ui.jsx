import React, { useState, useEffect, useCallback } from "react";
import { FileText, X } from "lucide-react";
import QRCode from "qrcode";
import { api } from "../api";
function Icon({ as: As, ...props }) {
  return <As size={18} strokeWidth={1.5} {...props} />;
}
function Button({
  children,
  onClick,
  kind = "",
  disabled = false,
  type = "button",
  ...props
}) {
  return (
    <button
      type={type}
      className={"button " + kind}
      onClick={onClick}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
function Badge({ children, tone = "" }) {
  return <span className={"badge " + tone}>{children}</span>;
}
function Empty({
  title = "这里还没有档案",
  text = "完成前一步，新的故事就会出现。",
}) {
  return (
    <div className="empty">
      <Icon as={FileText} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Modal({ title, children, onClose, wide = false }) {
  useEffect(() => {
    const fn = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", fn);
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", fn);
      document.body.style.overflow = old;
    };
  }, [onClose]);
  return (
    <div
      className="overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={"modal " + (wide ? "wide" : "")}
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">AURORA · PRIVATE ACCESS</span>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <X />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function QR({ value }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(value, {
      margin: 2,
      width: 220,
      color: { dark: "#18201c", light: "#f4efe5" },
    }).then(setSrc);
  }, [value]);
  return src ? (
    <img className="qr" src={src} alt="入口二维码" />
  ) : (
    <span>正在生成二维码…</span>
  );
}
function useResource(url, notify) {
  const [data, setData] = useState(null);
  const refresh = useCallback(async () => {
    try {
      setData(await api(url));
    } catch (e) {
      notify(e.message);
    }
  }, [url, notify]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh]);
  return [data, refresh];
}

export { Icon, Button, Badge, Empty, Field, Modal, QR, useResource };
