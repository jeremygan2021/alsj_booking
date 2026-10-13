import express from "express";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createApp } from "../../server/app.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const { app, db } = await createApp({
  allowLegacyRegistration: true,
  smsSender: async () => {},
  smsTestPhone: "13500000001",
  smsTestCode: "188888",
  smsTestExpiresAt: Date.now() + 3600000,
  dbPath: ":memory:",
  gmPassword: "browser-gm-password",
  npcPassword: "browser-npc-password",
  llm: { baseUrl: "", apiKey: "", model: "" },
});
await db
  .prepare("INSERT INTO npc_phones(npc_id,phone) VALUES(?,?)")
  .run("detective", "13500000001");
app.use(express.static(path.join(root, "dist")));
app.get("/{*path}", (request, response) =>
  response.sendFile(path.join(root, "dist/index.html")),
);
const server = app.listen(
  Number(process.env.ALSJ_BROWSER_TEST_PORT || 3301),
  "127.0.0.1",
);
process.once("SIGTERM", () =>
  server.close(async () => {
    await db.close();
    process.exit(0);
  }),
);
