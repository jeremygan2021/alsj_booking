import { createApp } from "./app.js";
import express from "express";
import { defaultArScenes } from "./ar/scenes.js";
import { createAliyunSmsSender } from "./auth/aliyun-sms.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = process.env.ENV_FILE || path.join(root, ".env");
if (!existsSync(envPath))
  writeFileSync(
    envPath,
    `GM_PASSWORD=${randomBytes(12).toString("base64url")}\nNPC_PASSWORD=${randomBytes(12).toString("base64url")}\n`,
    { mode: 0o600 },
  );
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const [key, ...rest] = line.split("=");
  if (key && !key.startsWith("#") && !process.env[key])
    process.env[key] = rest.join("=");
}
if (!process.env.GM_PASSWORD || !process.env.NPC_PASSWORD)
  throw new Error("请配置GM_PASSWORD和NPC_PASSWORD");
const { app } = await createApp({
  databaseUrl: process.env.DATABASE_URL,
  dbPath: process.env.DB_PATH || path.join(root, "data/alaska.sqlite"),
  gmPassword: process.env.GM_PASSWORD,
  npcPassword: process.env.NPC_PASSWORD,
  secure: process.env.COOKIE_SECURE === "true",
  trustProxy: process.env.TRUST_PROXY || "loopback",
  arScenes: process.env.AR_SCENES_FILE
    ? JSON.parse(readFileSync(process.env.AR_SCENES_FILE, "utf8"))
    : defaultArScenes,
  assetBaseUrl: process.env.AR_ASSET_BASE_URL || "/ar-assets/",
  smsSender: createAliyunSmsSender(process.env),
  smsSecret: process.env.SMS_CODE_SECRET || process.env.GM_PASSWORD,
  smsTestPhone: process.env.SMS_TEST_PHONE || "",
  smsTestCode: process.env.SMS_TEST_CODE || "",
  smsTestExpiresAt: Number(process.env.SMS_TEST_EXPIRES_AT || 0),
  smsDevLogin: process.env.SMS_DEV_LOGIN_ENABLED === "true",
});
app.get("/ar/target", (req, res) =>
  res.sendFile(
    path.join(
      root,
      process.env.NODE_ENV === "production"
        ? "dist/ar-target.html"
        : "public/ar-target.html",
    ),
  ),
);
if (process.env.NODE_ENV === "production") {
  const { default: express } = await import("express");
  app.use(express.static(path.join(root, "dist")));
  app.get("/{*path}", (r, s) => s.sendFile(path.join(root, "dist/index.html")));
} else {
  app.use("/invitation", express.static(path.join(root, "public/invitation")));
  app.use("/ar-assets", express.static(path.join(root, "public/ar-assets")));
  app.get("/favicon.svg", (req, res) =>
    res.sendFile(path.join(root, "public/favicon.svg")),
  );
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
app.listen(
  Number(process.env.PORT || 3000),
  process.env.HOST || "127.0.0.1",
  () =>
    console.log(
      "Alaska Nights: http://localhost:" + (process.env.PORT || 3000),
    ),
);
