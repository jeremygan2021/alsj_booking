import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { evidence } from "../server/content.js";
import materials from "../server/story-materials.json" with { type: "json" };
import { publicInvestigationNodes } from "../server/public-investigation.js";
import { resolveEvidenceModel } from "../server/evidence/models.js";
const origin = new URL(process.argv[2] || "https://alsj.luna.ski").origin;
const json = async (p) => {
  const res = await fetch(origin + p, { signal: AbortSignal.timeout(20000) });
  assert.equal(res.status, 200, p);
  return res.json();
};
const pub = await json("/api/public");
assert.equal(pub.npcs.length, 6);
assert.ok(pub.npcs.every((n) => !("secret" in n)));
const modelUrls = new Set();
const modified = [];
for (const row of evidence) {
  const card = await json(`/api/ar/clues/${row[0]}`);
  assert.equal(card.id, row[0]);
  assert.equal(
    card.model_url,
    `/api/ar/models/${resolveEvidenceModel(row[0]).filename}.glb`,
  );
  assert.ok(!("detail" in card));
  assert.ok(!("secret" in card));
  if (card.body !== row[5]) modified.push(row[0]);
  modelUrls.add(card.model_url);
}
for (const n of publicInvestigationNodes) {
  const node = await json(`/api/ar/nodes/${n.id}`);
  assert.equal(node.model_url, `/api/ar/models/${n.filename}.glb`);
  assert.ok(node.inspection_points.length);
  assert.ok(!("detail" in node));
  modelUrls.add(node.model_url);
}
for (const model of modelUrls) {
  const res = await fetch(origin + model, {
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(res.status, 200, model);
  const data = Buffer.from(await res.arrayBuffer());
  assert.equal(data.subarray(0, 4).toString(), "glTF");
  const name = model.split("/").at(-1);
  const local = await readFile(
    new URL(`../public/models/${name}`, import.meta.url),
  );
  assert.equal(
    createHash("sha256").update(data).digest("hex"),
    createHash("sha256").update(local).digest("hex"),
    name,
  );
}
for (const page of ["/ar?clue=E-06", "/ar?node=AR-05", "/admin"]) {
  const res = await fetch(origin + page, {
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(res.status, 200, page);
  const html = await res.text();
  assert.ok(html.includes("/assets/"), page);
}
assert.equal(
  (await fetch(origin + "/api/staff", { signal: AbortSignal.timeout(20000) }))
    .status,
  401,
);
console.log(
  JSON.stringify(
    {
      origin,
      npcs: 6,
      clues: evidence.length,
      arNodes: 6,
      matchingModelFiles: modelUrls.size,
      commissionedModels: materials.models.length,
      registered: pub.registered,
      phase: pub.settings.phase,
      preservedCustomClues: modified,
    },
    null,
    2,
  ),
);
