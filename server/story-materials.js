import materials from "./story-materials.json" with { type: "json" };

// Keep actor-only prose on the server, never in a public or client-side manifest.
export const npcMaterialSeeds = materials.npcs.map((n) => [
  n.id,
  n.name,
  n.english,
  n.role,
  n.publicBio,
  n.secret,
]);
export const evidenceMaterialSeeds = materials.evidence.map((e) => [
  e.clueId,
  e.title,
  e.area,
  e.skill,
  e.dc,
  e.body,
  e.detail,
  e.category,
]);
export const evidencePhases = new Map(
  materials.evidence.map((e) => [e.clueId, e.phase]),
);

export function staffStoryMaterials(role, npcId) {
  if (role === "gm") return materials;
  if (role === "npc")
    return {
      version: materials.version,
      npcs: materials.npcs.filter((n) => n.id === npcId),
    };
  return null;
}
