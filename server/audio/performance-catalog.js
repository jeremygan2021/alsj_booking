import { sendStoredAsset } from "../asset-storage.js";
import { readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = fileURLToPath(new URL("./", import.meta.url));
const trackId = /^[AB]\d{2}$/;
const sourceIds = new Set([
  "USUAN1100418",
  "USUAN1100546",
  "USUAN1100574",
  "USUAN1100748",
  "USUAN1100783",
  "USUAN1200059",
  "USUAN1400039",
]);

function musicCredit(music) {
  const source = String(music?.source || "");
  const isrc = source.match(
    /^https:\/\/incompetech\.com\/music\/royalty-free\/index\.html\?isrc=(USUAN\d+)$/,
  )?.[1];
  if (!sourceIds.has(isrc) || typeof music?.title !== "string") return null;
  return {
    title: music.title,
    artist: "Kevin MacLeod",
    source,
    license: "https://creativecommons.org/licenses/by/4.0/",
    changes: "截取、循环、交叉淡化、对白闪避及音效混音",
  };
}

// Only mount this catalog behind the GM session middleware. No file, manifest,
// transcript or spoiler is exposed through the public static directory.
export function createPerformanceAudioCatalog(audioRoot = defaultRoot) {
  const root = path.resolve(audioRoot);

  async function readManifest() {
    try {
      const manifest = JSON.parse(
        await readFile(path.join(root, "performance-audio.json"), "utf8"),
      );
      return Array.isArray(manifest?.tracks) ? manifest : null;
    } catch (error) {
      if (
        error instanceof SyntaxError ||
        ["ENOENT", "ENOTDIR"].includes(error.code)
      )
        return null;
      throw error;
    }
  }

  async function resolveTrack(track, baseUrl) {
    if (
      !track ||
      typeof track.id !== "string" ||
      !trackId.test(track.id) ||
      track.filename !== `${track.id.toLowerCase()}.mp3` ||
      !Number.isFinite(track.duration) ||
      track.duration <= 0 ||
      !Array.isArray(track.speakers) ||
      !track.speakers.every((role) => typeof role === "string") ||
      typeof track.title !== "string"
    )
      return null;
    const file = path.join(root, "performance-files", track.filename);
    try {
      const stat = await lstat(file);
      // Reject symlinks as well as directories: the manifest only selects one
      // fixed basename in the private audio directory.
      if (!stat.isFile() || !stat.size) return null;
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes(error.code)) return null;
      throw error;
    }
    const events = Array.isArray(track.events)
      ? track.events
          .filter(
            (event) =>
              event &&
              Number.isFinite(event.time) &&
              event.time >= 0 &&
              event.time < track.duration &&
              typeof event.cue === "string" &&
              typeof event.instruction === "string",
          )
          .map((event) => ({
            time: event.time,
            cue: event.cue,
            instruction: event.instruction,
            ...(typeof event.role === "string" ? { role: event.role } : {}),
          }))
      : [];
    return {
      file,
      metadata: {
        id: track.id,
        title: track.title,
        stage: typeof track.stage === "string" ? track.stage : "",
        trigger: typeof track.trigger === "string" ? track.trigger : "",
        notes: typeof track.notes === "string" ? track.notes : "",
        spoiler: Boolean(track.spoiler),
        evidence: typeof track.evidence === "string" ? track.evidence : null,
        duration: track.duration,
        speakers: [...track.speakers],
        ...(["instrumental", "drama", "background"].includes(track.kind)
          ? { kind: track.kind, loop: track.kind === "background" && track.loop === true }
          : {}),
        events,
        music: musicCredit(track.music),
        ...(Array.isArray(track.additionalMusic)
          ? { additionalMusic: track.additionalMusic.map(musicCredit).filter(Boolean) }
          : {}),
        url: `${baseUrl}/${track.id}/file`,
      },
    };
  }

  return {
    async get(id, baseUrl = "/api/staff/performance-audio") {
      if (typeof id !== "string" || !trackId.test(id)) return null;
      const manifest = await readManifest();
      return resolveTrack(
        manifest?.tracks.find((track) => track?.id === id && !track.retired),
        baseUrl,
      );
    },

    async describe(baseUrl = "/api/staff/performance-audio") {
      const manifest = await readManifest();
      const resolved = await Promise.all(
        (manifest?.tracks || [])
          .filter((track) => track && !track.retired)
          .map((track) => resolveTrack(track, baseUrl)),
      );
      const tracks = resolved.filter(Boolean).map((track) => track.metadata);
      const voices = (Array.isArray(manifest?.voices) ? manifest.voices : [])
        .filter(
          (voice) =>
            voice &&
            ["role", "voiceId", "label", "direction"].every(
              (key) => typeof voice[key] === "string",
            ) &&
            Number.isFinite(voice.speed) &&
            Number.isFinite(voice.pitch),
        )
        .map(({ role, voiceId, label, direction, speed, pitch }) => ({
          role,
          voiceId,
          label,
          direction,
          speed,
          pitch,
        }));
      const credits = Array.from(
        new Map(
          tracks
            .flatMap((track) => [track.music, ...(track.additionalMusic || [])])
            .filter(Boolean)
            .map((music) => [music.source, music]),
        ).values(),
      );
      return {
        version:
          typeof manifest?.version === "string" ? manifest.version : null,
        provider: "MiniMax",
        model: typeof manifest?.model === "string" ? manifest.model : null,
        notice: typeof manifest?.notice === "string" ? manifest.notice : "",
        totalDuration:
          Math.round(
            tracks.reduce((sum, track) => sum + track.duration, 0) * 1000,
          ) / 1000,
        voices,
        credits,
        soundEffects: {
          artist: "Kenney",
          source: "https://kenney.nl/assets",
          license: "https://creativecommons.org/publicdomain/zero/1.0/",
          changes: "裁切、叠加及音量调整",
        },
        tracks,
      };
    },
  };
}

export function sendPerformanceAudio(res, track) {
  res.set({
    "Content-Type": "audio/mpeg",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `inline; filename="${track.metadata.id.toLowerCase()}.mp3"`,
  });
  // Express sendFile handles Range/If-Range, seeking and HEAD requests.
  return sendStoredAsset(res, track.file);
}
