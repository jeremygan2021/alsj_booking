import materials from "../story-materials.json" with { type: "json" };

export function femaleTheodoreReferences(value) {
  return String(value || "")
    .replaceAll("西奥多·布莱克先生", "西奥多·布莱克女士")
    .replaceAll("西奥多先生", "西奥多女士")
    .replaceAll("布莱克先生", "布莱克女士")
    .replaceAll("他以善于掌握谈话气氛著称", "她以善于掌握谈话气氛著称")
    .replaceAll("她希望他同样尊重", "她希望她同样尊重")
    .replaceAll("尝试让他把拍卖讲解", "尝试让她把拍卖讲解")
    .replaceAll("把他当作“能把声音讲成收藏品”的同行", "把她当作“能把声音讲成收藏品”的同行")
    .replaceAll("拍卖台前与他最有共同语言", "拍卖台前与她最有共同语言");
}

export async function applyFemaleTheodore(db) {
  const id = "theodore-female-20261031";
  if (await db.prepare("SELECT id FROM content_migrations WHERE id=?").get(id)) return;
  const canonical = materials.npcs.find((npc) => npc.id === "scientist");
  const current = await db.prepare("SELECT * FROM npcs WHERE id='scientist'").get();
  if (current) {
    const bio = current.bio?.startsWith("西奥多是阿拉斯加之夜最受欢迎的人物之一")
      ? canonical.publicBio : String(current.bio || canonical.publicBio).replace(/(?<!其)他(?!人)/g, "她");
    await db.prepare("UPDATE npcs SET bio=? WHERE id='scientist'").run(bio);
  }
  for (const row of await db.prepare("SELECT player_id,npc_id,relation,player_brief,npc_brief,hooks,mission FROM character_relations WHERE npc_id='scientist'").all()) {
    for (const field of ["relation","player_brief","npc_brief","hooks","mission"]) {
      if (row[field] == null) continue;
      let revised = femaleTheodoreReferences(row[field]);
      if (field === "player_brief") revised = revised.replaceAll("听完他的回答", "听完她的回答").replaceAll("复述他自愿公开的观点", "复述她自愿公开的观点");
      if (revised !== row[field]) await db.prepare(`UPDATE character_relations SET ${field}=? WHERE player_id=? AND npc_id=?`).run(revised,row.player_id,row.npc_id);
    }
  }
  for (const row of await db.prepare("SELECT player_id,story,secret,adaptation FROM characters").all()) {
    for (const field of ["story","secret","adaptation"]) {
      if (row[field] == null) continue;
      const revised = femaleTheodoreReferences(row[field]);
      if (revised !== row[field]) await db.prepare(`UPDATE characters SET ${field}=? WHERE player_id=?`).run(revised,row.player_id);
    }
  }
  for (const [table,field] of [["character_inspirations","data"],["character_voices","subtitles"]]) {
    for (const row of await db.prepare(`SELECT player_id,${field} FROM ${table}`).all()) {
      if (row[field] == null) continue;
      const revised = femaleTheodoreReferences(row[field]);
      if (revised !== row[field]) await db.prepare(`UPDATE ${table} SET ${field}=? WHERE player_id=?`).run(revised,row.player_id);
    }
  }
  await db.prepare("INSERT INTO content_migrations(id) VALUES(?)").run(id);
}
