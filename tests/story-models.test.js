import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createApp } from "../server/app.js";
import { publicInvestigationNodes } from "../server/public-investigation.js";
import { parseInvestigationNode } from "../src/clue-scan.js";
import materials from "../server/story-materials.json" with { type: "json" };

test("正式GLB完整、移动端预算合格且没有把私密证据正文烘焙进资源", () => {
  for (const model of materials.models) {
    const data = readFileSync(
      new URL(`../public/models/${model.filename}`, import.meta.url),
    );
    assert.equal(data.subarray(0, 4).toString(), "glTF");
    assert.equal(data.readUInt32LE(8), data.length);
    assert.ok(data.length < 5 * 1024 * 1024, model.id);
    const gltf = JSON.parse(
      data.subarray(20, 20 + data.readUInt32LE(12)).toString(),
    );
    let tris = 0;
    for (const mesh of gltf.meshes)
      for (const primitive of mesh.primitives)
        tris += gltf.accessors[primitive.indices].count / 3;
    assert.ok(tris < 50000, model.id);
    assert.ok(!JSON.stringify(gltf).includes("伊芙琳"));
    assert.ok(!JSON.stringify(gltf).includes("20:58"));
  }
});

test("六个验尸节点可扫码打开正式模型，不返回鉴定秘密或演员资料", async (t) => {
  const { app, db } = await createApp({
    dbPath: ":memory:",
    gmPassword: "model-test-gm",
    npcPassword: "model-test-npc",
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const node of publicInvestigationNodes) {
    const res = await fetch(`${base}/api/ar/nodes/${node.id}`);
    assert.equal(res.status, 200);
    const card = await res.json();
    assert.equal(card.model_url, `/api/ar/models/${node.filename}.glb`);
    assert.ok(card.inspection_points.length > 0);
    assert.ok(!("secret" in card));
    assert.ok(!("detail" in card));
    assert.ok(!("npcs" in card));
    const model = await fetch(base + card.model_url);
    assert.equal(model.status, 200);
    assert.equal(
      Buffer.from(await model.arrayBuffer())
        .subarray(0, 4)
        .toString(),
      "glTF",
    );
  }
  assert.equal((await fetch(`${base}/api/ar/nodes/AR-99`)).status, 404);
});

test("验尸节点码拒绝站外URL和非法编号，保留独立编号命名空间", () => {
  const origin = "https://alsj.luna.ski";
  assert.equal(parseInvestigationNode("AR-06", origin), "AR-06");
  assert.equal(
    parseInvestigationNode(origin + "/ar?node=AR-04", origin),
    "AR-04",
  );
  assert.equal(
    parseInvestigationNode("https://example.com/ar?node=AR-01", origin),
    null,
  );
  assert.equal(parseInvestigationNode("AR-07", origin), null);
  assert.equal(
    parseInvestigationNode(origin + "/admin?node=AR-01", origin),
    null,
  );
});

// Formal props use the same QR cover/tracking presentation as the pulled AR version.
test("13类新模型在二维码呈现层正确分类并支持可逆观察动作", async () => {
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const { Texture } = await import("three");
  const { createEvidencePresentation } =
    await import("../src/features/ar/qr-evidence-presentation.js");
  const terminal = new Set([
    "audio-console",
    "access-console",
    "personality-terminal",
    "security-camera",
    "memory-recorder",
  ]);
  for (const model of materials.models) {
    const loader = new GLTFLoader().register(() => ({
      name: "node-texture-stub",
      loadTexture: () => Promise.resolve(new Texture()),
    }));
    const data = readFileSync(
      new URL(`../public/models/${model.filename}`, import.meta.url),
    );
    const { scene } = await loader.parseAsync(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      "",
    );
    const p = createEvidencePresentation(scene);
    assert.equal(
      p.kind,
      terminal.has(model.id)
        ? "terminal"
        : model.id === "archive-folios"
          ? "archive"
          : "prop",
      model.id,
    );
    assert.ok(p.root.getObjectByName("QR_opaque_cover"));
    p.toggle();
    for (let t = 16; t < 1500; t += 16) p.update(t, 1);
    assert.equal(p.root.userData.progress, 1);
    p.toggle();
    for (let t = 1512; t < 3000; t += 16) p.update(t, 1);
    assert.equal(p.root.userData.progress, 0);
  }
});
