import React, { useEffect, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { decodeQrPixels } from "../clue-scan";
import "./clue-image-reader.css";

export default function ClueImageReader({ onDetected, disabled = false }) {
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const version = useRef(0);
  useEffect(
    () => () => {
      version.current++;
    },
    [],
  );
  const readImage = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const current = ++version.current;
    setReading(true);
    setError("");
    let objectUrl;
    try {
      if (file.size > 15 * 1024 * 1024)
        throw new Error("请选择小于15MB的二维码图片。");
      objectUrl = URL.createObjectURL(file);
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      if (version.current !== current) return;
      const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("当前浏览器无法读取图片，请输入线索编号。");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const code = await decodeQrPixels(
        context.getImageData(0, 0, canvas.width, canvas.height),
      );
      if (version.current !== current) return;
      if (!code)
        throw new Error("未识别到二维码，请选择清晰完整的线索码图片。");
      await onDetected(code);
    } catch (reason) {
      if (version.current === current)
        setError(reason.message || "图片无法读取，请换一张二维码图片。");
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (version.current === current) setReading(false);
    }
  };
  return (
    <div className="clue-image-reader">
      <label className="button ghost clue-image-picker">
        <ImagePlus size={17} />
        {reading ? "正在读取图片…" : "从二维码图片读取线索"}
        <input
          data-testid="clue-image-input"
          type="file"
          accept="image/*"
          aria-label="二维码图片"
          disabled={disabled || reading}
          onChange={readImage}
        />
      </label>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
