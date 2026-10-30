import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import materials from "../server/story-materials.json" with { type: "json" };
import { staffStoryMaterials } from "../server/story-materials.js";

test("六NPC现场执行统一交GM核验，复杂供认清单只在GM资料中出现", () => {
  for (const npc of materials.npcs) {
    const execution = npc.sections.find((section) => section.title === "演员现场照读与GM交接");
    assert.ok(execution, npc.id);
    assert.match(execution.text, /30–60秒/);
    assert.match(execution.text, /GM/);
    assert.ok(npc.sourceText.includes(execution.text), npc.id);
    assert.match(npc.secret, /GM/);
    const actor = staffStoryMaterials("npc", npc.id);
    assert.equal(actor.npcs.length, 1);
    assert.ok(!("notes" in actor));
    assert.doesNotMatch(JSON.stringify(actor), /GM供认核对清单|E-23结合E-13\/E-14/);
  }
  const gm = staffStoryMaterials("gm");
  assert.ok(gm.notes.some((note) => note.includes("GM供认核对清单") && note.includes("可以供认")));
  const host = materials.npcs.find((npc) => npc.id === "host");
  assert.ok(host.sections.some((section) => /退场后.*不接受问询|退场后.*不问询/.test(section.text)));
  assert.match(materials.truth, /伊芙琳是唯一实施致命袭击者.*约20:58以奖杯击打/);
  assert.match(materials.truth, /两人未参与谋杀，诺拉和克拉拉也未参与/);
});

test("NPC与GM速览取消演员八分评分，GM按当前多数与三项证明核对主案", async () => {
  const npc = await readFile(new URL("../server/reading/brief-npc.html", import.meta.url), "utf8");
  const gm = await readFile(new URL("../server/reading/brief-gm.html", import.meta.url), "utf8");
  const run = (html) => /<section id="run">([\s\S]*?)<\/section>/.exec(html)?.[1] || "";
  for (const html of [npc, gm]) {
    const section = run(html);
    assert.match(section, /GM核对.*GM给阶段口令.*演员照读/);
    assert.match(section, /30–60秒/);
    assert.doesNotMatch(section, /总分\s*8\s*分|凶手2、时间与死法1/);
    for (const id of ["B01", "B02", "B03", "B04", "A02", "A04", "A05", "B05"])
      assert.ok(section.includes(id), id);
  }
  assert.match(run(npc), /GM统一核对动机、手段和机会三项证明/);
  assert.match(run(npc), /终局.*由GM宣布/);
  assert.doesNotMatch(npc, /唯一凶手|20:58|E-26|莉娅/);
  assert.match(run(gm), /五问只帮助复盘/);
  assert.match(run(gm), /多数正确指认且三项成立，调查方赢得主案/);
  assert.match(run(gm), /不自动替代GM的证据审核/);
  for (const id of ["A10", "A11", "A12"]) assert.ok(run(gm).includes(id), id);
});
