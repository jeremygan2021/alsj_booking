import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = fileURLToPath(new URL("./character-music/", import.meta.url));
const manifest = JSON.parse(readFileSync(new URL("./character-music.json", import.meta.url), "utf8"));
const patterns = {
  "clean-soul": /沉静|温柔|回忆|修复|档案|技术|科学|医生|疗愈|理性|内敛|声音|怀旧|记忆|calm|gentle|scientist|archive/gi,
  "evening-harp": /浪漫|优雅|贵族|古典|诗人|诗歌|艺术|舞者|公爵|仪式|典雅|精灵|礼仪|浪漫|elegant|noble|poet|artist/gi,
  "long-note": /侦探|调查|神秘|悬疑|暗影|冷峻|阴影|危险|独行|严肃|黑夜|法医|审判|detective|mysterious|shadow/gi,
  carefree: /冒险|开朗|活泼|乐观|幽默|阳光|旅行|热情|社交|魔术师|好奇|欢快|adventure|cheerful|curious|playful/gi,
};

function metadata(track) {
  return {
    id: track.id, title: track.title, mood: track.mood, credit: track.credit,
    source: track.source, license: track.license, licenseUrl: track.licenseUrl,
    changes: track.changes, duration: track.duration,
  };
}

export function listCharacterMusic() {
  return manifest.tracks.map(metadata);
}

// Match only public persona fields, never private NPC briefs or player identity.
// Weighted profession and personality descriptions keep the choice stable.
export function selectCharacterMusic(character = {}, script = "") {
  const sources = [
    [character?.profession, 3], [character?.skill, 2],
    ...["name", "motive", "story", "cosplay_character", "cosplay_source"].map((key) => [character?.[key], 1]),
    [script, 1],
  ].filter(([text]) => typeof text === "string").map(([text, weight]) => [text.slice(0, 2000), weight]);
  let chosen = manifest.tracks[0], best = -1;
  for (const track of manifest.tracks) {
    const score = sources.reduce((sum, [text, weight]) => sum + [...text.matchAll(patterns[track.id])].length * weight, 0);
    if (score > best) { chosen = track; best = score; }
  }
  return metadata(chosen);
}

// This resolves only fixed, checksum-verified presets. The caller must apply
// its player authentication before serving the returned private file path.
export async function getCharacterMusicTrack(id, root = defaultRoot) {
  if (typeof id !== "string" || !/^[a-z]+(?:-[a-z]+)*$/.test(id)) return null;
  const track = manifest.tracks.find((candidate) => candidate.id === id);
  if (!track) return null;
  const file = path.join(path.resolve(root), `${track.id}.mp3`);
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.size !== track.size || stat.size > 1500000) return null;
    const bytes = await readFile(file);
    if (createHash("sha256").update(bytes).digest("hex") !== track.sha256) return null;
    return { file, metadata: metadata(track) };
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "ELOOP"].includes(error.code)) return null;
    throw error;
  }
}
