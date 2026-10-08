import { readFileSync } from "node:fs";
import { npcCredential } from "../server/app.js";
import { npcs } from "../server/content.js";
const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .trim()
    .split("\n")
    .map((l) => l.split("=")),
);
console.log("GM账号：gm；密码：" + env.GM_PASSWORD);
for (const n of npcs)
  console.log(
    `${n[1]}：npc:${n[0]} / ${npcCredential(env.NPC_PASSWORD, n[0])}`,
  );
