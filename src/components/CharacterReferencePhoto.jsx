import React, { useEffect, useRef, useState } from "react";
import {
  Camera,
  CheckCircle2,
  ImagePlus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { api } from "../api";
import { Button } from "./ui";
import "./character-reference-photo.css";

const MAX_JPEG_BYTES = 700 * 1024;
const nextPaint = () =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));
const asDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("照片读取失败，请重新选择。"));
    reader.readAsDataURL(blob);
  });

async function photoSource(file) {
  if (typeof createImageBitmap === "function") {
    try {
      // Bake the phone's EXIF orientation into the compressed pixels.
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* Safari and HEIC inputs can require the image decoder. */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const source = new Image();
      source.onload = () => resolve(source);
      source.onerror = () =>
        reject(
          new Error(
            "暂时无法读取这张照片，请换用JPG、PNG或从系统相册重新选择。",
          ),
        );
      source.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function compressReferencePhoto(file) {
  if (!file || file.size > 30 * 1024 * 1024)
    throw new Error("照片较大，请从相册选择一张30MB以内的照片。");
  if (file.type && !file.type.startsWith("image/"))
    throw new Error("请选择一张照片。");
  const source = await photoSource(file);
  try {
    const width = source.width || source.naturalWidth;
    const height = source.height || source.naturalHeight;
    if (!width || !height) throw new Error("照片尺寸无法读取，请重新选择。");
    const scale = Math.min(1, 1024 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("当前浏览器无法处理照片，请使用手机系统浏览器。");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    let blob;
    for (const quality of [0.86, 0.74, 0.6, 0.45]) {
      blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      );
      if (blob && blob.size <= MAX_JPEG_BYTES) return asDataUrl(blob);
    }
    throw new Error("照片暂时无法压缩，请换一张照片重试。");
  } finally {
    source.close?.();
  }
}

export default function CharacterReferencePhoto({
  disabled,
  value,
  draft,
  onChange,
  onDraftChange,
  onBusyChange,
}) {
  const camera = useRef(null),
    gallery = useRef(null),
    original = useRef(null);
  const operation = useRef(0),
    callbacks = useRef({ onChange, onDraftChange, onBusyChange });
  const localUrl = useRef("");
  const mounted = useRef(true);
  const [localPreview, setLocalPreview] = useState("");
  callbacks.current = { onChange, onDraftChange, onBusyChange };
  const stage = draft?.stage;
  const working = ["compressing", "uploading", "removing"].includes(stage);
  const preview =
    draft?.data || localPreview || value?.photo_url || value?.url || "";
  const clearLocalPreview = () => {
    if (localUrl.current) URL.revokeObjectURL(localUrl.current);
    localUrl.current = "";
    if (mounted.current) setLocalPreview("");
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearLocalPreview();
    };
  }, []);

  const upload = async (file, data) => {
    if (disabled || working) return;
    const version = ++operation.current;
    if (file) {
      original.current = file;
      clearLocalPreview();
      localUrl.current = URL.createObjectURL(file);
      setLocalPreview(localUrl.current);
    }
    callbacks.current.onBusyChange?.(true);
    callbacks.current.onDraftChange({
      stage: data ? "uploading" : "compressing",
      ...(data ? { data } : {}),
    });
    let compressed = data;
    try {
      await nextPaint();
      compressed ||= await compressReferencePhoto(file);
      if (version !== operation.current) return;
      callbacks.current.onDraftChange({ stage: "uploading", data: compressed });
      clearLocalPreview();
      const result = await api("/character/reference-photo", {
        data: compressed,
      });
      if (version !== operation.current) return;
      if (!(result.photo_url || result.url))
        throw new Error("照片未保存完成，请重试。");
      callbacks.current.onChange(result);
      callbacks.current.onDraftChange(null);
      original.current = null;
    } catch (error) {
      if (version === operation.current)
        callbacks.current.onDraftChange({
          stage: "error",
          ...(compressed ? { data: compressed } : {}),
          error: error.message || "照片上传失败，请重试。",
        });
    } finally {
      if (version === operation.current)
        callbacks.current.onBusyChange?.(false);
    }
  };
  const select = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void upload(file);
  };
  const remove = async () => {
    if (disabled || working) return;
    const version = ++operation.current;
    callbacks.current.onBusyChange?.(true);
    callbacks.current.onDraftChange({ ...draft, stage: "removing" });
    try {
      const response = await fetch("/api/character/reference-photo", {
        method: "DELETE",
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "暂时无法移除照片，请重试。");
      }
      if (version !== operation.current) return;
      clearLocalPreview();
      callbacks.current.onChange(null);
      callbacks.current.onDraftChange(null);
      original.current = null;
    } catch (error) {
      if (version === operation.current)
        callbacks.current.onDraftChange({
          ...draft,
          stage: "error",
          error: error.message,
        });
    } finally {
      if (version === operation.current)
        callbacks.current.onBusyChange?.(false);
    }
  };

  return (
    <section
      className={`character-reference-photo ${preview ? "has-photo" : ""}`}
      aria-label="Cos照片参考"
      aria-busy={working}
    >
      <input
        ref={camera}
        className="character-photo-input"
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="拍摄Cos照片"
        onChange={select}
        disabled={disabled || working}
      />
      <input
        ref={gallery}
        className="character-photo-input"
        type="file"
        accept="image/*"
        aria-label="从相册选择Cos照片"
        onChange={select}
        disabled={disabled || working}
      />
      {preview ? (
        <div className="character-photo-preview">
          <img src={preview} alt="用于生成角色的Cos参考照片" />
          <span>服装参考照</span>
        </div>
      ) : (
        <div className="character-photo-empty" aria-hidden="true">
          <Camera size={29} />
          <span>让服装、色彩和配饰成为故事灵感</span>
        </div>
      )}
      <div className="character-photo-copy">
        <div className="character-photo-actions">
          <Button
            kind={preview ? "ghost compact" : ""}
            onClick={() => camera.current?.click()}
            disabled={disabled || working}
            aria-label={preview ? "重新拍照" : "拍一张Cos照"}
          >
            <Camera size={17} />
            {preview ? "重新拍照" : "拍张Cos照"}
          </Button>
          <Button
            kind="ghost compact"
            onClick={() => gallery.current?.click()}
            disabled={disabled || working}
            aria-label="从相册选照片"
          >
            <ImagePlus size={17} />
            选照片
          </Button>
          {(preview || draft) && (
            <Button
              kind="ghost compact photo-remove"
              onClick={remove}
              disabled={disabled || working}
              aria-label="移除Cos参考照片"
            >
              <Trash2 size={16} />
              移除
            </Button>
          )}
        </div>
        {working ? (
          <p className="character-photo-status" role="status">
            <RefreshCw size={15} className="inspiration-spinner" />
            {stage === "compressing"
              ? "已选中照片，正在整理清晰度…"
              : stage === "removing"
                ? "正在移除参考照片…"
                : "照片已整理，正在保存…"}
          </p>
        ) : draft?.error ? (
          <div className="character-photo-error" role="alert">
            <p>
              {draft.error} {preview && "照片已保留。"}重试或移除后即可继续。
            </p>
            {(draft.data || original.current) && (
              <Button
                kind="ghost compact"
                onClick={() => upload(original.current, draft.data)}
                disabled={disabled}
              >
                <RefreshCw size={15} />
                重试上传照片
              </Button>
            )}
          </div>
        ) : value ? (
          <p className="character-photo-status saved">
            <CheckCircle2 size={15} />
            照片已准备好，下次生成角色时生效。
          </p>
        ) : (
          <p className="character-photo-note">
            可跳过。照片只作为造型参考，生成后仍能单独更换头像。
          </p>
        )}
      </div>
    </section>
  );
}
