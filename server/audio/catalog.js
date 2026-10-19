import { sendStoredAsset } from "../asset-storage.js";
import { createHash } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = fileURLToPath(new URL("./", import.meta.url));
const credits = [
  ["Long note One", "USUAN1100418"],
  ["Darkest Child", "USUAN1100783"],
  ["At Rest", "USUAN1100748"],
].map(([title, isrc]) => ({
  title,
  artist: "Kevin MacLeod",
  source: `https://incompetech.com/music/royalty-free/index.html?isrc=${isrc}`,
  license: "https://creativecommons.org/licenses/by/4.0/",
  changes: "截取、循环、淡化、音量调整及人声混音",
}));

// Audio is never served from a static folder: every lookup binds a fixed file
// to the currently visible evidence text and its permission-specific endpoint.
export function createClueAudioCatalog(audioRoot = defaultRoot) {
  const root = path.resolve(audioRoot);
  const get = async (source, part, url) => {
    if (
      !/^(?:E|AR)-\d{2}$/.test(source.id) ||
      !["body", "detail"].includes(part)
    )
      return null;
    if (typeof source[part] !== "string" || !source[part]) return null;
    try {
      const manifest = JSON.parse(
        await readFile(path.join(root, "clue-audio.json"), "utf8"),
      );
      if (!Array.isArray(manifest?.tracks)) return null;
      const filename = `${source.id.toLowerCase()}-${part}.mp3`;
      const sourceHash = createHash("sha256")
        .update(source[part], "utf8")
        .digest("hex");
      const track = manifest.tracks.find(
        (item) => item?.id === source.id && item.part === part,
      );
      if (
        !track ||
        track.filename !== filename ||
        track.sourceHash !== sourceHash ||
        !Number.isFinite(track.duration) ||
        track.duration <= 0 ||
        !Array.isArray(track.speakers) ||
        !track.speakers.every((name) => typeof name === "string")
      )
        return null;
      const file = path.join(root, "files", filename);
      const stat = await lstat(file);
      if (!stat.isFile() || !stat.size) return null;
      const selectedCredit = credits.find(
        (item) =>
          item.title.toLowerCase() ===
          String(track.music?.title || "").toLowerCase(),
      );
      return {
        file,
        metadata: {
          url,
          duration: track.duration,
          speakers: track.speakers,
          credits: selectedCredit ? [selectedCredit] : credits,
        },
      };
    } catch (error) {
      if (
        error instanceof SyntaxError ||
        ["ENOENT", "ENOTDIR"].includes(error.code)
      )
        return null;
      throw error;
    }
  };
  return {
    get,
    async describe(source, urls) {
      const audio = {};
      for (const [part, url] of Object.entries(urls)) {
        const track = await get(source, part, url);
        if (track) audio[part] = track.metadata;
      }
      return Object.keys(audio).length ? { audio } : {};
    },
  };
}

export function sendClueAudio(res, track, { privateAudio = false } = {}) {
  res.set({
    "Content-Type": "audio/mpeg",
    "Cache-Control": privateAudio ? "private, no-store" : "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  return sendStoredAsset(res, track.file);
}
