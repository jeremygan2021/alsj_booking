import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Vector3, Box3, Texture } from "three";
import { createEvidencePresentation } from "../src/features/ar/qr-evidence-presentation.js";

for (const [file, kind, part] of [
  ["sealed-letter", "letter", "Folded_Envelope_Flap"],
  ["echo-terminal", "terminal", "Record_Display"],
  ["evidence-case", "case", "Open_Lid"],
])
  test(`${kind}: opaque QR cover, articulated interaction and reversible animation`, async () => {
    const bytes = await readFile(
      new URL(`../public/models/${file}.glb`, import.meta.url),
    );
    // Geometry/rig test runs without a DOM; browser tests render the real textures.
    const loader = new GLTFLoader().register(() => ({
      name: "node-geometry-test",
      loadTexture: () => Promise.resolve(new Texture()),
    }));
    const { scene } = await loader.parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      "",
    );
    const presentation = createEvidencePresentation(scene);
    assert.equal(presentation.kind, kind);
    const cover = presentation.root.getObjectByName("QR_opaque_cover");
    const bounds = new Box3().setFromObject(cover);
    assert.ok(
      bounds.min.x <= -0.739 &&
        bounds.max.x >= 0.739 &&
        bounds.min.y <= -0.739 &&
        bounds.max.y >= 0.739,
    );
    presentation.update(0, 1);
    cover.traverse((o) => {
      if (o.material) assert.equal(o.material.opacity, 1);
    });
    const object = scene.getObjectByName(part);
    presentation.root.updateMatrixWorld(true);
    const closed = object.matrixWorld.clone();
    presentation.toggle();
    for (let t = 16; t <= 1400; t += 16) presentation.update(t, 1);
    assert.equal(presentation.root.userData.progress, 1);
    presentation.root.updateMatrixWorld(true);
    if (kind !== "terminal")
      assert.notDeepEqual(object.matrixWorld.elements, closed.elements);
    else assert.ok(object.material.emissiveIntensity > 0.5);
    // Lid and flap must lift out of the marker plane, not sink through the wall.
    if (kind === "case")
      assert.ok(object.getWorldPosition(new Vector3()).z > 0.25);
    presentation.toggle();
    for (let t = 1408; t <= 2800; t += 16) presentation.update(t, 1);
    presentation.root.updateMatrixWorld(true);
    assert.equal(presentation.root.userData.progress, 0);
    for (let i = 0; i < 16; i++)
      assert.ok(
        Math.abs(object.matrixWorld.elements[i] - closed.elements[i]) < 1e-8,
      );
  });
