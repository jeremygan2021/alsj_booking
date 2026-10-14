import { createSceneCatalog } from "../ar/catalog.js";
export const defaultSite = {
  title: "阿拉斯加之夜",
  subtitle: "最后的遗嘱",
  englishTitle: "THE LAST TESTAMENT",
  badge: "2026 万圣节特别企划",
  schedule: "10月31日 · 19:00—24:00",
  description:
    "黄金时代的最后一场舞会。\n一封邀请，一场盛宴，\n和一个不该被说出的秘密。",
};
export function createContentStore({
  one,
  all,
  run,
  baseScenes,
  assetBaseUrl,
}) {
  const listScenes = async () => {
    const map = new Map(
      baseScenes.map((scene) => [scene.id, structuredClone(scene)]),
    );
    for (const row of await all(
      "SELECT id,body FROM managed_content WHERE kind='ar'",
    ))
      map.set(row.id, JSON.parse(row.body));
    return [...map.values()];
  };
  return {
    listScenes,
    async getScene(id) {
      return createSceneCatalog(await listScenes(), assetBaseUrl).get(id);
    },
    async getSite() {
      const saved = await one(
        "SELECT body FROM managed_content WHERE kind='site' AND id='landing'",
      );
      return saved
        ? { ...defaultSite, ...JSON.parse(saved.body) }
        : { ...defaultSite };
    },
    save(kind, id, content) {
      return run(
        "INSERT INTO managed_content(kind,id,body) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body",
        kind,
        id,
        JSON.stringify(content),
      );
    },
  };
}
