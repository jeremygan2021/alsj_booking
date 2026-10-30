import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";

test("/reading sends distinct GM and NPC documents without exposing spoilers", async (t) => {
  const { app, db } = await createApp({
    dbPath: ":memory:",
    gmPassword: "reading-gm-password",
    npcPassword: "reading-npc-password",
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    server.close();
    await db.close();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const now = Date.now() + 60_000;
  for (const [token, role] of [
    ["reading-gm", "gm"],
    ["reading-npc", "npc"],
    ["reading-player", "player"],
  ])
    await db
      .prepare("INSERT INTO sessions(token,role,user_id,expires) VALUES(?,?,?,?)")
      .run(token, role, role, now);

  const get = (path, token) =>
    fetch(origin + path, {
      redirect: "manual",
      headers: token ? { Cookie: `alaska_session=${token}` } : {},
    });
  for (const token of [null, "reading-player"]) {
    const response = await get("/reading", token);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/admin?next=%2Freading");
  }
  const gm = await get("/reading", "reading-gm");
  assert.equal(gm.status, 200);
  assert.match(gm.headers.get("cache-control"), /no-store/);
  const gmHtml = await gm.text();
  assert.match(gmHtml, /唯一凶手/);
  assert.match(gmHtml, /E-26/);
  assert.match(gmHtml, /https:\/\/alsj\.luna\.ski\/ar\?clue=E-05/);

  const npc = await get("/reading", "reading-npc");
  assert.equal(npc.status, 200);
  const npcHtml = await npc.text();
  assert.match(npcHtml, /六位 NPC/);
  assert.doesNotMatch(npcHtml, /唯一凶手|20:58|E-26|莉娅/);

  assert.equal((await get("/reading/hero.webp")).status, 401);
  const hero = await get("/reading/hero.webp", "reading-npc");
  assert.equal(hero.status, 200);
  assert.match(hero.headers.get("content-type"), /image\/webp/);
});
