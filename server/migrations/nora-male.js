import materials from "../story-materials.json" with { type: "json" };

export function maleNoraReferences(text) {
  return String(text || "")
    .replaceAll("声称她删过记录", "声称他删过记录")
    .replaceAll("先去查她，别来查我的后台", "先去查他，别来查我的后台")
    .replaceAll("里德女士", "里德先生")
    .replaceAll("请教她自己平常", "请教他自己平常")
    .replaceAll("回到她的巡查路线", "回到他的巡查路线")
    .replaceAll("肯定她对宾客边界的维护", "肯定他对宾客边界的维护")
    .replaceAll("不追问她私人敏感原因", "不追问他私人敏感原因");
}

// Apply the requested casting correction to existing databases as well as seeds.
// Historical migration snapshots stay immutable so old databases still upgrade.
export async function applyMaleNora(db) {
  const id = "nora-male-fbi-20261031";
  if (await db.prepare("SELECT id FROM content_migrations WHERE id=?").get(id))
    return;
  const canonical = materials.npcs.find((npc) => npc.id === "detective");
  const nora = await db.prepare("SELECT * FROM npcs WHERE id='detective'").get();
  if (nora) {
    const bio = nora.bio?.startsWith("诺拉是一名受ADS聘请的外部安全顾问")
      ? canonical.publicBio
      : String(nora.bio || canonical.publicBio).replaceAll("她", "他");
    const secret = String(nora.secret || canonical.secret)
      .replaceAll("她", "他")
      .replaceAll("发现尸体后公开身份并主动说明审批", "登场时公开FBI身份，发现尸体后主动说明审批")
      .replaceAll("隐藏身份为FBI特别探员", "FBI特别探员，身份在登场时公开");
    await db.prepare("UPDATE npcs SET role=?,bio=?,secret=? WHERE id='detective'")
      .run(canonical.role, bio, secret);
  }
  for (const row of await db.prepare("SELECT id,bio,secret FROM npcs WHERE id!='detective'").all()) {
    const bio = maleNoraReferences(row.bio), secret = maleNoraReferences(row.secret);
    if (bio !== row.bio || secret !== row.secret)
      await db.prepare("UPDATE npcs SET bio=?,secret=? WHERE id=?").run(bio, secret, row.id);
  }
  // Exact phrases distinguish the agent from a female player's own pronouns.
  for (const row of await db.prepare("SELECT player_id,npc_id,relation,player_brief,npc_brief,hooks,mission FROM character_relations").all()) {
    for (const field of ["relation", "player_brief", "npc_brief", "hooks", "mission"]) {
      const revised = maleNoraReferences(row[field]);
      if (revised !== row[field])
        await db.prepare(`UPDATE character_relations SET ${field}=? WHERE player_id=? AND npc_id=?`)
          .run(revised, row.player_id, row.npc_id);
    }
  }
  for (const row of await db.prepare("SELECT player_id,story,secret,adaptation FROM characters").all()) {
    for (const field of ["story", "secret", "adaptation"]) {
      if (row[field] == null) continue;
      const revised = maleNoraReferences(row[field]);
      if (revised !== row[field])
        await db.prepare(`UPDATE characters SET ${field}=? WHERE player_id=?`).run(revised, row.player_id);
    }
  }
  for (const row of await db.prepare("SELECT player_id,data FROM character_inspirations").all()) {
    const revised = maleNoraReferences(row.data);
    if (revised !== row.data)
      await db.prepare("UPDATE character_inspirations SET data=? WHERE player_id=?").run(revised, row.player_id);
  }
  for (const row of await db.prepare("SELECT player_id,subtitles FROM character_voices").all()) {
    if (row.subtitles == null) continue;
    const revised = maleNoraReferences(row.subtitles);
    if (revised !== row.subtitles)
      await db.prepare("UPDATE character_voices SET subtitles=? WHERE player_id=?").run(revised, row.player_id);
  }
  await db.prepare("INSERT INTO content_migrations(id) VALUES(?)").run(id);
}
