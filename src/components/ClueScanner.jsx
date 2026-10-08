import React, { useState, useRef, useEffect } from "react";
import { Camera, ImagePlus, ScanLine } from "lucide-react";
import { Button, Modal } from "./ui";
import { decodeQrPixels } from "../clue-scan";

export default function ClueScanner({ onDetected, onClose }) {
  const [phase, setPhase] = useState("idle"),
    [error, setError] = useState("");
  const video = useRef(null),
    stream = useRef(null),
    timer = useRef(null),
    generation = useRef(0),
    alive = useRef(true),
    seen = useRef("");
  const detected = useRef(onDetected);
  detected.current = onDetected;
  const stop = () => {
    generation.current++;
    clearTimeout(timer.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  };
  useEffect(() => {
    alive.current = true;
    const hide = () => {
      if (document.hidden) {
        stop();
        setPhase("idle");
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      alive.current = false;
      stop();
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  const accept = (raw) => {
    if (!raw || raw === seen.current) return false;
    seen.current = raw;
    try {
      detected.current(raw);
      stop();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  };
  const start = async () => {
    stop();
    seen.current = "";
    setError("");
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError(
        "此浏览器无法开启相机。请用系统/微信扫一扫，或从二维码图片识别。",
      );
      return;
    }
    const version = generation.current;
    setPhase("requesting");
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: false,
      });
      if (!alive.current || generation.current !== version) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      video.current.srcObject = media;
      await video.current.play();
      if (!alive.current || generation.current !== version) return;
      setPhase("scanning");
      const canvas = document.createElement("canvas"),
        context = canvas.getContext("2d", { willReadFrequently: true });
      const scan = async () => {
        if (!alive.current || generation.current !== version) return;
        try {
          const frame = video.current;
          if (frame?.readyState >= 2 && frame.videoWidth) {
            const scale = Math.min(1, 640 / frame.videoWidth);
            canvas.width = Math.round(frame.videoWidth * scale);
            canvas.height = Math.round(frame.videoHeight * scale);
            context.drawImage(frame, 0, 0, canvas.width, canvas.height);
            const code = await decodeQrPixels(
              context.getImageData(0, 0, canvas.width, canvas.height),
            );
            if (!alive.current || generation.current !== version) return;
            if (accept(code)) return;
          }
          timer.current = setTimeout(scan, 200);
        } catch {
          if (alive.current && generation.current === version) {
            stop();
            setPhase("idle");
            setError("相机识别暂时失败，请重试或选择二维码图片。");
          }
        }
      };
      scan();
    } catch (e) {
      if (!alive.current || generation.current !== version) return;
      stop();
      setPhase("idle");
      setError(
        e.name === "NotAllowedError"
          ? "相机权限未开启。请在浏览器设置中允许相机，或选择二维码图片。"
          : "未能打开相机，请关闭其他占用相机的应用后重试，或选择二维码图片。",
      );
    }
  };
  const readImage = async (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    stop();
    seen.current = "";
    setPhase("reading");
    setError("");
    const version = generation.current;
    const objectUrl = URL.createObjectURL(file);
    try {
      if (file.size > 15 * 1024 * 1024)
        throw new Error("图片过大，请选择小于15MB的二维码图片。");
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      if (!alive.current || generation.current !== version) return;
      const canvas = document.createElement("canvas"),
        context = canvas.getContext("2d", { willReadFrequently: true });
      const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const code = await decodeQrPixels(
        context.getImageData(0, 0, canvas.width, canvas.height),
      );
      if (!alive.current || generation.current !== version) return;
      if (!code)
        throw new Error("图片中未识别到二维码，请选择清晰完整的线索卡图片。");
      accept(code);
    } catch (e) {
      if (alive.current && generation.current === version)
        setError(e.message || "图片无法读取，请换一张二维码图片。");
    } finally {
      URL.revokeObjectURL(objectUrl);
      if (alive.current && generation.current === version) setPhase("idle");
    }
  };
  return (
    <Modal title="扫描线索卡" onClose={onClose}>
      <div className="clue-scanner">
        <p className="muted">对准现场线索卡上的二维码，识别后开启密封证据。</p>
        <div
          className={
            "scanner-preview " + (phase === "scanning" ? "active" : "")
          }
        >
          <video ref={video} muted playsInline aria-label="线索卡相机预览" />
          <div className="scanner-target" aria-hidden="true">
            <ScanLine size={44} />
          </div>
          <span className="scanner-status" role="status">
            {phase === "requesting"
              ? "等待相机授权…"
              : phase === "scanning"
                ? "正在识别线索二维码…"
                : phase === "reading"
                  ? "正在读取二维码图片…"
                  : "等待开启相机"}
          </span>
        </div>
        {error && (
          <p className="scanner-error" role="alert">
            {error}
          </p>
        )}
        <div className="scanner-actions">
          <Button
            onClick={start}
            disabled={phase === "requesting" || phase === "reading"}
          >
            <Camera size={18} />
            {phase === "scanning" ? "重新开启相机" : "开启后置相机"}
          </Button>
          <label className="button ghost scanner-file">
            <ImagePlus size={18} />
            从图片识别
            <input
              type="file"
              accept="image/*"
              onChange={readImage}
              disabled={phase === "requesting" || phase === "reading"}
            />
          </label>
        </div>
        <p className="scanner-privacy">
          相机画面与图片仅在本机识别，不上传。关闭窗口或切到后台会停止相机。
        </p>
        <Button kind="ghost compact" onClick={onClose}>
          返回手动输入编号
        </Button>
      </div>
    </Modal>
  );
}
