import React, { useEffect, useId, useRef, useState } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  ImagePlus,
  RefreshCw,
  Shield,
  Sparkles,
  Users,
} from "lucide-react";
import CharacterReferenceRecorder from "./CharacterReferenceRecorder";
import CharacterReferencePhoto from "./CharacterReferencePhoto";
import { api, inspireCharacter } from "../api";
import { Badge, Button, Empty, Field } from "./ui";
import { phases } from "../constants";
import "./character-profile.css";

export function CharacterAvatar({ src, name, large = false }) {
  return src ? (
    <img
      className={"character-avatar" + (large ? " large" : "")}
      src={src}
      alt={`${name || "角色"}的头像`}
    />
  ) : (
    <div
      className={"character-avatar placeholder" + (large ? " large" : "")}
      aria-hidden="true"
    >
      {name?.[0] || "?"}
    </div>
  );
}

export function GenerationStatus({
  character,
  configured,
  onRetry,
  busy,
  audience = "staff",
}) {
  if (!character) return null;
  const pending = Boolean(character.generation_pending);
  const ready = character.generation_status === "ready";
  const failed = character.generation_status === "error";
  if (audience === "player")
    return (
      <div
        className={"generation-status " + (failed ? "has-error" : "")}
        role="status"
        aria-live="polite"
      >
        <CheckCircle2 size={19} />
        <div>
          <strong>
            {pending
              ? "正在准备你的故事"
              : failed
                ? "故事已保存，关联暂未准备好"
                : character.status === "approved" ? "角色已自动审核通过" : "故事已准备，提交后自动通过审核"}
          </strong>
          <p>
            {pending
              ? "稍等片刻，准备完成后即可查看你的剧情草稿。"
              : failed
                ? "你的故事和头像已保留。可以稍后重试，或请现场GM协助。"
                : "提交并完成剧情关联后，系统自动审核通过，与你有关的NPC会收到你的故事。"}
          </p>
        </div>
        {failed && onRetry && !pending && (
          <Button
            kind="ghost compact"
            onClick={onRetry}
            disabled={busy || !configured}
          >
            <RefreshCw size={15} /> 重试准备故事
          </Button>
        )}
      </div>
    );
  return (
    <div
      className={"generation-status " + (failed ? "has-error" : "")}
      role="status"
      aria-live="polite"
    >
      <Sparkles size={19} />
      <div>
        <strong>
          {pending
            ? "正在编织你的剧情关系"
            : ready
              ? "剧情关联已生成"
              : failed
                ? "角色已保存，剧情生成暂未完成"
                : "角色已保存，等待配置剧情生成"}
        </strong>
        <p>
          {pending
            ? "你的角色故事已经保存。生成完成后将自动审核通过。"
            : ready
              ? `${character.generator === "llm" ? "大模型已将" : "剧情模板已将"}角色特征接入ECHO世界。提交后自动审核通过，关联NPC即可收到演绎档案。`
              : failed
                ? character.generation_error ||
                  "服务暂时不可用，可稍后重试；你的原始故事和头像已保留。"
                : "工作人员尚未配置大模型服务。你的故事和头像已保存，当前关系为剧情模板草稿。"}
        </p>
      </div>
      {onRetry && !pending && (
        <Button
          kind="ghost compact"
          onClick={onRetry}
          disabled={busy || !configured}
        >
          <RefreshCw size={15} />{" "}
          {failed
            ? "重试生成"
            : ready
              ? "重新生成关系"
              : configured
                ? "生成剧情关系"
                : "等待服务配置"}
        </Button>
      )}
    </div>
  );
}

export function RelationCards({
  relations = [],
  role = "player",
  approved = false,
  onInspect,
  phase,
}) {
  if (!relations.length)
    return (
      <Empty
        title={role === "npc" ? "还没有与你关联的玩家" : "剧情关系等待建立"}
        text={
          role === "npc"
            ? "玩家提交并通过自动审核后，你的专属演绎提示和分幕目标会出现在这里。"
            : "填写Cos角色、角色故事与头像，系统会为你生成NPC关系草稿。"
        }
      />
    );
  return (
    <div className="relation-grid">
      {relations.map((r, i) => {
        const confirmed = r.status ? r.status === "approved" : approved;
        return (
          <article
            className="relation-card"
            key={`${r.player_id || "self"}-${r.npc_id}-${i}`}
          >
            <div className="relation-heading">
              {role !== "player" && (
                <CharacterAvatar
                  src={r.avatar_url}
                  name={r.character_name || r.player_name}
                />
              )}
              <div>
                <span className="eyebrow">
                  {role === "player"
                    ? "YOUR NPC CONNECTION"
                    : "PLAYER CONNECTION"}
                </span>
                <h3>
                  {role === "player"
                    ? r.npc_name
                    : r.character_name || r.player_name}
                </h3>
                {role !== "player" && (
                  <p>
                    {r.player_name} · {r.cosplay_character || "待补充Cos角色"}
                    {r.cosplay_source ? ` / ${r.cosplay_source}` : ""}
                  </p>
                )}
              </div>
              <Badge tone={confirmed ? "green" : "gold"}>
                {confirmed ? "已批准" : "待审核草稿"}
              </Badge>
            </div>
            {role === "gm" && (
              <p className="relation-target">
                <Users size={15} /> 关联NPC：{r.npc_name}
              </p>
            )}
            <h4>{r.relation}</h4>
            {(role === "player" || role === "gm") && (
              <div className="relation-brief">
                <small>玩家视角 · 你认识怎样的过去</small>
                <p>{r.player_brief}</p>
              </div>
            )}
            {(role === "npc" || role === "gm") && (
              <div className="relation-brief npc">
                <small>NPC演绎提示 · 如何与这位玩家互动</small>
                <p>{r.npc_brief}</p>
              </div>
            )}
            {Array.isArray(r.hooks) && r.hooks.length > 0 && (
              <ol className="relation-hooks">
                {r.hooks.map((h, j) => (
                  <li
                    key={`${h.phase}-${j}`}
                    className={
                      Number(h.phase) === Number(phase) ? "current" : ""
                    }
                  >
                    <span>
                      第{h.phase}幕 <small>{phases[Number(h.phase) - 1]}</small>
                    </span>
                    <p>{h.goal}</p>
                  </li>
                ))}
              </ol>
            )}
            {r.mission && (
              <div className="relation-mission">
                <CheckCircle2 size={16} />
                <p>
                  <small>破冰委托</small>
                  {typeof r.mission === "string" ? r.mission : r.mission.title}
                </p>
              </div>
            )}
            {!confirmed && role === "player" && (
              <p className="relation-draft-note">
                这是你自己的关系预览。提交并通过自动审核后，关联NPC即可看到档案。
              </p>
            )}
            {onInspect && (
              <Button
                kind="ghost compact"
                onClick={() => onInspect(r.player_id)}
              >
                审核完整人物档案 <ArrowUpRight size={15} />
              </Button>
            )}
          </article>
        );
      })}
    </div>
  );
}

export default function CharacterForm({
  character: c,
  formState,
  onFormStateChange,
  playerName,
  onSubmit,
  busy,
}) {
  // Player owns the draft and upload state so tab changes and scanner navigation
  // preserve edits, including uploads that complete while this form is hidden.
  const initialState = () => ({
    draft: {
      name: c?.name || "",
      english: c?.english || "",
      profession: c?.profession || "",
      skill: c?.skill || "洞察",
      motive: c?.motive || "",
      story: c?.story || "",
      cosplay_character: c?.cosplay_character || "",
      cosplay_source: c?.cosplay_source || "",
      avatar_url: c?.avatar_url || "",
    },
    uploading: false,
    uploadError: "",
    preview: c?.avatar_url || "",
    inspirationIdea: "",
    inspiring: false,
    inspirationError: "",
    inspirationReady: false,
  });
  const {
    draft,
    uploading,
    uploadError,
    preview,
    inspirationIdea = "",
    inspiring = false,
    inspirationError = "",
    inspirationReady = false,
    generationPreview = {},
    generationMessage = "",
    avatarGenerationError = "",
    retryingAvatar = false,
    generationAppearance = "",
  } = formState || initialState();
  const updateState = (updater) =>
    onFormStateChange((old) => updater(old || initialState()));
  const uploadVersion = useRef(0);
  const inspirationRequest = useRef(false);
  const avatarInput = useRef(null);
  const avatarErrorId = useId();
  const inspirationStatusId = useId();
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!inspiring) return;
    const tick = () =>
      setElapsed(
        Math.floor(
          (Date.now() - (formState?.generationStarted || Date.now())) / 1000,
        ),
      );
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [inspiring, formState?.generationStarted]);
  const locked = c?.status === "approved";
  const referenceBlocked = Boolean(
    formState?.referenceBusy ||
    formState?.referencePhotoBusy ||
    formState?.referencePhotoDraft,
  );
  const setField = (event) => {
    const { name, value } = event.target;
    updateState((old) => ({
      ...old,
      draft: { ...old.draft, [name]: value },
      draftEditedAt: Date.now(),
    }));
  };
  const inspire = async () => {
    if (
      locked ||
      busy ||
      uploading ||
      inspiring ||
      retryingAvatar ||
      referenceBlocked ||
      inspirationRequest.current
    )
      return;
    inspirationRequest.current = true;
    updateState((old) => ({
      ...old,
      inspiring: true,
      inspirationError: "",
      inspirationReady: false,
      draftEditedAt: 0,
      generationPreview: old.inspirationReady
        ? { ...old.draft }
        : old.generationPreview || {},
      avatarGenerationError: "",
      generationAppearance: "",
      generationMessage: "正在连接角色创作服务…",
      generationStarted: Date.now(),
    }));
    try {
      const result = await inspireCharacter(
        {
          cosplay_character: draft.cosplay_character.trim(),
          cosplay_source: draft.cosplay_source.trim(),
          idea: inspirationIdea.trim() || draft.story.trim(),
        },
        (event) => {
          if (event.type === "heartbeat") return;
          updateState((old) => ({
            ...old,
            ...(event.type === "stage"
              ? { generationMessage: event.message }
              : {}),
            ...(event.type === "appearance_ready"
              ? {
                  generationAppearance: event.summary || "",
                  generationMessage: "装扮已识别，正在构思故事…",
                }
              : {}),
            ...(["text", "text_ready"].includes(event.type)
              ? {
                  generationPreview: {
                    ...old.generationPreview,
                    ...event.character,
                  },
                  generationMessage: "正在书写你的身份与故事…",
                }
              : {}),
            ...(event.type === "avatar_error"
              ? { avatarGenerationError: event.message }
              : {}),
            ...(event.type === "avatar"
              ? {
                  generationPreview: {
                    ...old.generationPreview,
                    avatar_url: event.preview,
                  },
                  generationMessage: "头像已完成，正在保存草稿…",
                }
              : {}),
          }));
        },
      );
      const generated = {};
      for (const field of [
        "name",
        "english",
        "profession",
        "skill",
        "motive",
        "story",
        "cosplay_character",
        "cosplay_source",
        "avatar_url",
      ]) {
        if (typeof result[field] === "string")
          generated[field] = result[field].trim();
      }
      if (
        !generated.name ||
        !generated.cosplay_character ||
        !generated.cosplay_source ||
        (!generated.avatar_url && !result.avatar_error) ||
        generated.story?.length < 20 ||
        !generated.story
      )
        throw new Error("生成的角色档案还不完整，请重试。原有内容已保留。");
      if (!["洞察", "技术", "社交"].includes(generated.skill))
        generated.skill = "洞察";
      updateState((old) => ({
        ...old,
        draft: { ...old.draft, ...generated },
        preview: generated.avatar_url,
        uploadError: "",
        inspirationReady: true,
        restoredAt: Date.now(),
        generationPreview: { ...generated },
        avatarGenerationError: result.avatar_error || "",
      }));
    } catch (error) {
      updateState((old) => ({
        ...old,
        inspirationError: error.message || "暂时无法生成，请稍后重试。",
      }));
    } finally {
      inspirationRequest.current = false;
      updateState((old) => ({ ...old, inspiring: false }));
    }
  };
  const retryAvatar = async () => {
    if (
      retryingAvatar ||
      inspiring ||
      locked ||
      busy ||
      uploading ||
      referenceBlocked
    )
      return;
    updateState((old) => ({
      ...old,
      retryingAvatar: true,
      avatarGenerationError: "",
    }));
    try {
      const result = await api("/character/inspiration/avatar", {});
      if (!result.character?.avatar_url)
        throw new Error("头像尚未完成，请重试");
      updateState((old) => ({
        ...old,
        draft: { ...old.draft, avatar_url: result.character.avatar_url },
        preview: result.character.avatar_url,
        generationPreview: {
          ...old.generationPreview,
          avatar_url: result.character.avatar_url,
        },
        avatarGenerationError: "",
        restoredAt: Date.now(),
        draftEditedAt: Date.now(),
      }));
    } catch (error) {
      updateState((old) => ({ ...old, avatarGenerationError: error.message }));
    } finally {
      updateState((old) => ({ ...old, retryingAvatar: false }));
    }
  };
  const upload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    updateState((old) => ({ ...old, uploadError: "" }));
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      updateState((old) => ({
        ...old,
        uploadError: "请上传JPG、PNG或WebP格式的头像。",
      }));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      updateState((old) => ({
        ...old,
        uploadError: "头像不能超过2MB，请压缩图片后重新上传。",
      }));
      return;
    }
    const version = ++uploadVersion.current;
    updateState((old) => ({ ...old, uploading: true }));
    const previous = draft.avatar_url;
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () =>
          reject(new Error("图片读取失败，请重新选择头像。"));
        reader.readAsDataURL(file);
      });
      if (version !== uploadVersion.current) return;
      updateState((old) => ({ ...old, preview: data }));
      const result = await api("/avatar", { data });
      if (version !== uploadVersion.current) return;
      updateState((old) => ({
        ...old,
        draft: { ...old.draft, avatar_url: result.avatar_url },
        preview: result.avatar_url,
      }));
    } catch (error) {
      if (version === uploadVersion.current) {
        updateState((old) => ({
          ...old,
          uploadError: error.message || "上传失败，请重试。",
          preview: previous,
        }));
      }
    } finally {
      if (version === uploadVersion.current)
        updateState((old) => ({ ...old, uploading: false }));
    }
  };
  return (
    <section className="panel character-form cosplay-form">
      <span className="eyebrow">万圣节 · 角色报名</span>
      <h2>{c ? "修改你的角色故事" : "今晚，你要扮演谁？"}</h2>
      <p className="muted">
        拍下你的Cos装扮，说一句想法，生成头像和故事。照片与灵感都可以跳过。
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (
            locked ||
            inspiring ||
            uploading ||
            busy ||
            retryingAvatar ||
            referenceBlocked
          )
            return;
          if (!draft.avatar_url) {
            updateState((old) => ({
              ...old,
              uploadError: "请先上传一张角色头像，再提交人物档案。",
            }));
            avatarInput.current?.focus();
            return;
          }
          onSubmit({
            ...draft,
            name:
              draft.name.trim() ||
              draft.cosplay_character.trim().slice(0, 60) ||
              playerName?.slice(0, 60) ||
              "受邀宾客",
            english: draft.english.trim() || "Guest",
            profession: draft.profession.trim() || "受邀宾客",
            motive: draft.motive.trim() || "随邀请赴宴，寻找自己的故事",
            skill: draft.skill || "洞察",
          });
        }}
      >
        <section
          className="character-inspiration"
          aria-label="MiniMax角色生成"
          aria-busy={inspiring}
        >
          <div className="character-inspiration-heading">
            <Sparkles size={23} aria-hidden="true" />
            <div>
              <h3>把你的装扮，变成今晚的角色</h3>
              <p>三件小事，一份专属身份。生成后可以换方案，也可以只换头像。</p>
            </div>
          </div>
          <div className="character-create-step">
            <div className="character-create-step-title">
              <span>1</span>
              <h4>拍张Cos照</h4>
              <small>可跳过</small>
            </div>
            <CharacterReferencePhoto
              disabled={
                inspiring ||
                uploading ||
                busy ||
                locked ||
                retryingAvatar ||
                Boolean(formState?.referenceBusy)
              }
              value={formState?.referencePhoto}
              draft={formState?.referencePhotoDraft}
              onBusyChange={(active) =>
                updateState((old) => ({ ...old, referencePhotoBusy: active }))
              }
              onChange={(photo) =>
                updateState((old) => ({
                  ...old,
                  referencePhoto: photo,
                  referencePhotoEditedAt: Date.now(),
                }))
              }
              onDraftChange={(photoDraft) =>
                updateState((old) => ({
                  ...old,
                  referencePhotoDraft: photoDraft,
                  referencePhotoEditedAt: Date.now(),
                }))
              }
            />
          </div>
          <div className="character-create-step character-idea-input">
            <div className="character-create-step-title">
              <span>2</span>
              <h4>加一句想法</h4>
              <small>可跳过，也可以录音</small>
            </div>
            <Field label="给故事一点灵感（可选）">
              <textarea
                name="inspiration_idea"
                value={inspirationIdea}
                onChange={(event) =>
                  updateState((old) => ({
                    ...old,
                    inspirationIdea: event.target.value,
                  }))
                }
                maxLength={2000}
                rows={2}
                placeholder="例如：穿黑色礼服的神秘记者，想寻找一段旧日回忆。留空也能生成。"
                disabled={inspiring || busy || locked}
              />
            </Field>
            <CharacterReferenceRecorder
              disabled={
                inspiring ||
                uploading ||
                busy ||
                locked ||
                retryingAvatar ||
                Boolean(formState?.referencePhotoBusy)
              }
              value={formState?.referenceRecording}
              onBusyChange={(active) =>
                updateState((old) => ({ ...old, referenceBusy: active }))
              }
              onChange={(recording) =>
                updateState((old) => ({
                  ...old,
                  referenceRecording: recording,
                }))
              }
              onTranscript={(text) =>
                updateState((old) => ({
                  ...old,
                  inspirationIdea: old.inspirationIdea?.includes(text)
                    ? old.inspirationIdea
                    : [old.inspirationIdea?.trim(), text]
                        .filter(Boolean)
                        .join("\n")
                        .slice(0, 2000),
                  lastTranscribedRecordingId: old.referenceRecording?.id,
                }))
              }
            />
          </div>
          <div className="character-create-step character-generate-step">
            <div className="character-create-step-title">
              <span>3</span>
              <h4>生成并预览</h4>
              <small>满意后再确认</small>
            </div>
            <Button
              kind="character-inspiration-button"
              onClick={inspire}
              disabled={
                inspiring ||
                referenceBlocked ||
                retryingAvatar ||
                uploading ||
                busy ||
                locked ||
                Boolean(c?.generation_pending)
              }
              aria-describedby={inspirationStatusId}
              aria-label={
                inspiring
                  ? "正在生成头像和故事…"
                  : inspirationError
                    ? "重试生成角色"
                    : inspirationReady
                      ? "换一个角色方案"
                      : "MiniMax生成头像、姓名与故事"
              }
            >
              {inspiring ? (
                <RefreshCw
                  size={17}
                  className="inspiration-spinner"
                  aria-hidden="true"
                />
              ) : (
                <Sparkles size={17} aria-hidden="true" />
              )}
              {inspiring
                ? "正在生成头像和故事…"
                : formState?.referencePhotoBusy
                  ? "正在准备照片…"
                  : formState?.referenceBusy
                    ? "正在整理语音灵感…"
                    : inspirationError
                      ? "重试生成角色"
                      : inspirationReady
                        ? "换一个角色方案"
                        : "生成我的角色"}
            </Button>
            <div id={inspirationStatusId} aria-live="polite" role="status">
              {inspiring ? (
                <p className="character-inspiration-note">
                  {generationMessage} · 已用 {elapsed} 秒
                  {elapsed >= 20 &&
                    !generationPreview.story &&
                    " · 模型仍在创作，文字返回后会逐字显示。"}
                </p>
              ) : inspirationError ? (
                <p className="character-inspiration-error" role="alert">
                  {inspirationError} 你的填写内容和头像已保留，可直接重试。
                </p>
              ) : inspirationReady ? (
                <p className="character-inspiration-success">
                  <CheckCircle2 size={16} aria-hidden="true" />
                  <span>
                    {draft.name} ·
                    草稿已填入下方。可继续修改，检查后提交，自动审核通过。
                  </span>
                </p>
              ) : (
                <p className="character-inspiration-note">
                  生成结果会填入下方草稿，提交后自动审核通过。
                </p>
              )}
            </div>
            {generationAppearance && (
              <p className="character-appearance-note">
                装扮参考：{generationAppearance}
              </p>
            )}
            {(inspiring ||
              inspirationReady ||
              generationPreview.story ||
              generationPreview.name) && (
              <article
                className="character-live-preview"
                aria-label="角色实时预览"
              >
                <div className="character-live-heading">
                  {generationPreview.avatar_url || inspirationReady ? (
                    <CharacterAvatar
                      src={
                        inspirationReady
                          ? preview
                          : generationPreview.avatar_url
                      }
                      name={generationPreview.name || draft.name}
                      large
                    />
                  ) : (
                    <div className="character-avatar large generation-image-placeholder">
                      <Sparkles size={26} />
                      <span>
                        {inspiring || retryingAvatar
                          ? "头像绘制中"
                          : "待生成头像"}
                      </span>
                    </div>
                  )}
                  <div>
                    <span className="eyebrow">
                      {inspiring ? "正在创作 · 实时预览" : "你的角色草稿"}
                    </span>
                    <h3>
                      {(inspirationReady
                        ? draft.name
                        : generationPreview.name) || "身份正在浮现…"}
                    </h3>
                    <p>
                      {inspirationReady
                        ? draft.profession
                        : generationPreview.profession}
                    </p>
                  </div>
                </div>
                <p
                  className={
                    "character-live-story" + (inspiring ? " is-streaming" : "")
                  }
                >
                  {(inspirationReady ? draft.story : generationPreview.story) ||
                    "故事将在这里逐字展开…"}
                </p>
                {inspirationError && (
                  <p className="muted">
                    已显示的内容已保留。此方案尚未完成，可以重试生成。
                  </p>
                )}
                {avatarGenerationError && (
                  <p className="form-error" role="alert">
                    故事已保留，头像暂未完成：{avatarGenerationError}
                  </p>
                )}
                {(inspirationReady ||
                  avatarGenerationError ||
                  retryingAvatar) && (
                  <Button
                    kind="ghost compact"
                    onClick={retryAvatar}
                    disabled={
                      retryingAvatar ||
                      inspiring ||
                      referenceBlocked ||
                      busy ||
                      uploading
                    }
                  >
                    {retryingAvatar
                      ? "正在重新绘制头像…"
                      : avatarGenerationError
                        ? "重试生成头像"
                        : "重新生成头像"}
                  </Button>
                )}
              </article>
            )}
          </div>
        </section>
        <details
          className="character-edit-details"
          key={inspirationReady ? "generated" : "manual"}
          open={c && !inspirationReady ? true : undefined}
        >
          <summary>
            {inspirationReady
              ? "修改头像与角色设定（可选）"
              : "手动填写 / 指定Cos角色"}
          </summary>
          <fieldset
            className="character-profile-fields"
            disabled={inspiring || busy || locked}
          >
            <div className="avatar-upload">
              <CharacterAvatar src={preview} name={draft.name} large />
              <div>
                <strong>
                  角色头像 <span className="required-mark">必填</span>
                </strong>
                <p>
                  通常由系统生成。想手动指定头像时，可上传JPG / PNG /
                  WebP，最大2MB。
                </p>
                <label
                  className={
                    "button ghost compact avatar-file " +
                    (uploading ? "is-uploading" : "")
                  }
                >
                  <ImagePlus size={16} />
                  {uploading
                    ? "正在上传…"
                    : preview
                      ? "更换头像"
                      : "上传角色头像"}
                  <input
                    ref={avatarInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    aria-label="上传角色头像"
                    aria-required={!draft.avatar_url}
                    aria-describedby={uploadError ? avatarErrorId : undefined}
                    disabled={uploading || busy}
                    onChange={upload}
                  />
                </label>
                {uploadError && (
                  <p id={avatarErrorId} className="avatar-error" role="alert">
                    {uploadError}
                  </p>
                )}
              </div>
            </div>
            <div className="two-grid">
              <Field label="你将在万圣节Cos哪个角色？">
                <input
                  name="cosplay_character"
                  value={draft.cosplay_character}
                  onChange={setField}
                  required
                  maxLength={100}
                  placeholder="例如：蝙蝠侠、艾莎、原创吸血鬼"
                />
              </Field>
              <Field label="角色来自哪部作品 / 原创设定？">
                <input
                  name="cosplay_source"
                  value={draft.cosplay_source}
                  onChange={setField}
                  required
                  maxLength={100}
                  placeholder="例如：DC、冰雪奇缘、原创"
                />
              </Field>
            </div>
            <Field label="你的角色故事 · 保留你的人物设定">
              <textarea
                name="story"
                value={draft.story}
                onChange={setField}
                required
                minLength={20}
                maxLength={2000}
                rows={6}
                placeholder="你要扮演谁？经历过什么？珍视谁、害怕什么？你可以保留原作品设定，或写自己的改编故事（至少20字）。请只填写虚构人物故事。"
              />
            </Field>
            <div className="story-length">{draft.story.length} / 2000</div>
            <details className="character-optional">
              <summary>补充设定（可选）</summary>
              <div className="character-optional-content">
                <p>
                  不用填写也能参加。想为现场角色增加细节时，再补充这些设定。
                </p>
                <div className="two-grid">
                  <Field label="宴会角色姓名">
                    <input
                      name="name"
                      value={draft.name}
                      onChange={setField}
                      maxLength={60}
                      placeholder="默认使用你的Cos角色名"
                    />
                  </Field>
                  <Field label="英文姓名">
                    <input
                      name="english"
                      value={draft.english}
                      onChange={setField}
                      maxLength={60}
                      placeholder="可留空"
                    />
                  </Field>
                  <Field label="公开职业">
                    <input
                      name="profession"
                      value={draft.profession}
                      onChange={setField}
                      maxLength={60}
                      placeholder="默认：受邀宾客"
                    />
                  </Field>
                  <Field label="擅长技能">
                    <select
                      name="skill"
                      value={draft.skill}
                      onChange={setField}
                    >
                      <option>洞察</option>
                      <option>技术</option>
                      <option>社交</option>
                    </select>
                  </Field>
                </div>
                <Field label="你为什么来到这场舞会？">
                  <input
                    name="motive"
                    value={draft.motive}
                    onChange={setField}
                    maxLength={100}
                    placeholder="默认：随邀请赴宴，寻找自己的故事"
                  />
                </Field>
              </div>
            </details>
          </fieldset>
        </details>
        <div className="notice">
          <Shield size={17} />
          <span>
            提交即确认此角色，并为你生成专属语音自我介绍。角色提交后自动审核通过，现场签到后开始游戏。
          </span>
        </div>
        <Button
          type="submit"
          disabled={
            !draft.avatar_url ||
            !draft.cosplay_character.trim() ||
            !draft.cosplay_source.trim() ||
            draft.story.trim().length < 20 ||
            busy ||
            uploading ||
            retryingAvatar ||
            referenceBlocked ||
            inspiring ||
            locked ||
            Boolean(c?.generation_pending)
          }
        >
          {busy
            ? "正在提交你的故事…"
            : c
              ? "保存故事，自动审核通过"
              : "提交角色，自动审核通过"}
          <ArrowUpRight size={16} />
        </Button>
      </form>
    </section>
  );
}
