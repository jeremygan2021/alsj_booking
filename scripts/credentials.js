import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openDb } from "../server/db.js";
const env = Object.fromEntries(
  readFileSync(
    process.env.ENV_FILE || new URL("../.env", import.meta.url),
    "utf8",
  )
    .trim()
    .split("\n")
    .filter((l) => !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const [key, ...value] = l.split("=");
      return [key, value.join("=")];
    }),
);
console.log("管理员账号：admin（兼容gm）；密码：" + env.GM_PASSWORD);
const db = await openDb(
  env.DATABASE_URL ||
    process.env.DB_PATH ||
    fileURLToPath(new URL("../data/alaska.sqlite", import.meta.url)),
);
const rows = await db
  .prepare(
    "SELECT n.id,n.name,p.phone FROM npcs n LEFT JOIN npc_phones p ON p.npc_id=n.id",
  )
  .all();
for (const n of rows)
  console.log(
    `${n.name}：${n.phone ? "手机号 " + n.phone + "，请用验证码登录" : "请在内容管理中心绑定登录手机号"}`,
  );
await db.close();
