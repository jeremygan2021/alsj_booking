import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";
import { avatarData, cosplay } from "./profile-fixture.js";
import {
  createAssetResolver,
  createSceneCatalog,
} from "../server/ar/catalog.js";

const scene = {
  id: "wall-study",
  title: "书房墙面搜证",
  mode: "wall",
  phase: 3,
  tracking: {
    kind: "image",
    targetKey: "targets/wall-v1.mind",
    targetIndex: 0,
    physicalWidthMeters: 0.3,
  },
  models: [
    {
      id: "cabinet",
      assetKey: "models/cabinet-v1.glb",
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
  ],
  hotspots: [
    { id: "drawer", clueId: "E-01", position: [0, 0, 0.1], radius: 0.1 },
  ],
};

test("AR 资源可切换同源/CDN，拒绝越界路径及无效场景", () => {
  assert.equal(
    createAssetResolver()("models/a.glb"),
    "/ar-assets/models/a.glb",
  );
  assert.equal(
    createAssetResolver("https://assets.example.com/ar")("a.glb"),
    "https://assets.example.com/ar/a.glb",
  );
  for (const key of [
    "../a.glb",
    "a/../b.glb",
    "https://evil.example/a.glb",
    "/a.glb",
    "%2e%2e/a.glb",
    "a\\b.glb",
  ])
    assert.throws(() => createAssetResolver()(key));
  assert.throws(() => createAssetResolver("http://assets.example.com"));
  assert.throws(() => createSceneCatalog([scene, scene]));
  assert.throws(() =>
    createSceneCatalog([
      { ...scene, tracking: { ...scene.tracking, physicalWidthMeters: 0 } },
    ]),
  );
  const catalog = createSceneCatalog([scene]);
  const copy = catalog.get(scene.id);
  copy.hotspots[0].clueId = "E-02";
  assert.equal(catalog.get(scene.id).hotspots[0].clueId, "E-01");
});

test("AR 场景及点击沿用资格/幕数权限，不泄露证据且重复点击不重复入册", async (t) => {
  const { app, db } = await createApp({
    allowLegacyRegistration: true,
    dbPath: ":memory:",
    gmPassword: "gm-test",
    npcPassword: "npc-test",
    arScenes: [scene],
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    server.close();
    await db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const client = () => {
    let cookie = "";
    return async (path, body, status = 200) => {
      const res = await fetch(base + path, {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.headers.get("set-cookie"))
        cookie = res.headers.get("set-cookie").split(";")[0];
      assert.equal(res.status, status, await res.clone().text());
      assert.equal(res.headers.get("cache-control"), "no-store");
      return res.json();
    };
  };
  const anonymous = client(),
    gm = client(),
    player = client(),
    other = client();
  const path = `/ar/scenes/${scene.id}`;
  await anonymous(path, undefined, 401);
  await gm("/login", { account: "gm", password: "gm-test" });
  await gm(path, undefined, 401);
  const registered = await player("/register", {
    name: "AR玩家",
    contact: "ar@example.com",
    password: "ar-test-123",
  });
  await player(path, undefined, 403);
  await player("/avatar", { data: avatarData });
  await player("/character", {
    ...cosplay,
    name: "调查员",
    english: "AR",
    profession: "研究员",
    story:
      "我是一位独立调查员，曾调查过庄园档案，今晚希望核对墙面上的线索并寻找事件真相。",
    motive: "寻找真相",
    skill: "洞察",
  });
  await gm(`/staff/players/${registered.id}`, {
    payment: "paid",
    checkin: true,
    status: "approved",
    faction: "fbi",
  });
  await player(path, undefined, 403);
  await gm("/staff/phase", { phase: 3 });
  const manifest = await player(path);
  assert.equal(manifest.mode, "wall");
  assert.equal(manifest.tracking.targetUrl, "/ar-assets/targets/wall-v1.mind");
  assert.deepEqual(Object.keys(manifest.hotspots[0]).sort(), [
    "id",
    "position",
    "radius",
  ]);
  await player("/clues/E-01", undefined, 403);
  await player(path + "/hotspots/unknown/collect", {}, 404);
  const collect = path + "/hotspots/drawer/collect";
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      player(collect, { clueId: "E-02", coins: 999 }),
    ),
  );
  assert.ok(results.every((result) => result.id === "E-01" && result.body));
  assert.equal(
    (
      await db
        .prepare(
          "SELECT COUNT(*) n FROM unlocks WHERE player_id=? AND clue_id=?",
        )
        .get(registered.id, "E-01")
    ).n,
    1,
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT COUNT(*) n FROM unlocks WHERE player_id=? AND clue_id=?",
        )
        .get(registered.id, "E-02")
    ).n,
    0,
  );
  await other("/register", {
    name: "其他AR玩家",
    contact: "ar-other@example.com",
    password: "ar-test-123",
  });
  await other("/clues/E-01", undefined, 403);
  await player("/ar/scenes/missing", undefined, 404);
  await gm(`/staff/players/${registered.id}`, { payment: "refunded" });
  await player(collect, {}, 403);
});
