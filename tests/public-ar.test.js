import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";

test("匿名AR只返回指定公开线索和示例模型，原玩家搜证接口仍受保护且访问不改变游戏数据", async (t) => {
  const { app, db } = await createApp({
    databaseUrl: process.env.TEST_DATABASE_URL,
    dbPath: ":memory:",
    gmPassword: "gm-public-ar-test-password",
    npcPassword: "npc-public-ar-test-password",
    llm: { baseUrl: "", apiKey: "", model: "" },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (path, expected = 200, method = "GET") => {
    const response = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify({}),
    });
    const expectedStatuses = Array.isArray(expected) ? expected : [expected];
    assert.ok(
      expectedStatuses.includes(response.status),
      await response.clone().text(),
    );
    assert.equal(response.headers.get("set-cookie"), null);
    return response;
  };
  const snapshot = async () => ({
    players: (await db.prepare("SELECT COUNT(*) n FROM players").get()).n,
    unlocks: (await db.prepare("SELECT COUNT(*) n FROM unlocks").get()).n,
    sessions: (await db.prepare("SELECT COUNT(*) n FROM sessions").get()).n,
    audits: (await db.prepare("SELECT COUNT(*) n FROM audit").get()).n,
    settings: { ...(await db.prepare("SELECT * FROM settings").get()) },
  });
  const clues = await db
    .prepare("SELECT id,title,area,category,body,detail,phase FROM clues")
    .all();
  const source = clues.find((c) => c.id === "E-01");
  const original = await snapshot();
  assert.equal(original.settings.phase, 1);

  const card = await (await request("/ar/clues/E-01")).json();
  assert.equal(card.id, "E-01");
  assert.equal(card.title, source.title);
  assert.equal(card.area, source.area);
  assert.equal(card.category, source.category);
  assert.equal(card.body, source.body);
  assert.deepEqual(
    Object.keys(card).sort(),
    [
      "id",
      "title",
      "area",
      "category",
      "body",
      "model_url",
      "model_label",
    ].sort(),
  );
  assert.ok(source.phase > original.settings.phase);
  assert.equal(card.model_url, "/api/ar/models/sealed-letter.glb");
  assert.match(card.model_label, /剧情示例/);
  for (const field of [
    "detail",
    "secret",
    "check",
    "clues",
    "players",
    "unlocks",
    "npc_id",
    "faction",
  ])
    assert.ok(!(field in card), field);
  assert.ok(!JSON.stringify(card).includes(source.detail));
  assert.ok(
    clues
      .filter((c) => c.id !== source.id)
      .every((c) => !JSON.stringify(card).includes(c.body)),
  );
  assert.deepEqual(await (await request("/ar/clues/e-01")).json(), card);
  assert.deepEqual(
    await (await request("/ar/clues/E-01?phase=4&unlock=1")).json(),
    card,
  );

  for (const filename of [
    "sealed-letter.glb",
    "echo-terminal.glb",
    "evidence-case.glb",
  ]) {
    const response = await request("/ar/models/" + filename);
    assert.equal(response.headers.get("content-type"), "model/gltf-binary");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(response.headers.get("cache-control"), /public.*max-age=3600/);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.subarray(0, 4).toString(), "glTF");
    assert.equal(bytes.readUInt32LE(4), 2);
    assert.equal(bytes.readUInt32LE(8), bytes.length);
  }

  for (const path of [
    "/clues",
    "/clues/E-01",
    "/models/sealed-letter.glb",
    "/me",
    "/staff",
  ])
    await request(path, 401);
  await request("/clues/E-01/unlock", 401, "POST");
  for (const id of [
    "E-99",
    "E-1",
    "NOT-A-CLUE",
    "E-01%00",
    "E-01%27%20OR%201%3D1--",
  ])
    await request("/ar/clues/" + id, 404);
  for (const filename of [
    "unknown.glb",
    ".env",
    "sealed-letter.glb%00",
    "sealed-letter.glb.js",
    "%2e%2e%2fserver%2fcontent.js",
  ])
    await request("/ar/models/" + filename, 404);
  for (const path of [
    "/ar/clues",
    "/ar/models",
    "/ar/models/sealed-letter.glb/unlock",
  ])
    await request(path, 404);
  await request("/ar/clues/E-01", 404, "POST");
  await request("/ar/models/sealed-letter.glb", 404, "POST");
  assert.equal(await (await request("/session")).json(), null);
  assert.deepEqual(await snapshot(), original);
});
