export function mountArRoutes(
  app,
  { auth, playable, evidence, fail, catalog, setting },
) {
  const available = async (id) => {
    const scene = await catalog.get(id);
    if (!scene || scene.enabled === false)
      fail("该 AR 场景尚未配置或已停用", 404);
    if ((await setting()).phase < scene.phase)
      fail(`该场景将在第${scene.phase}幕开放`, 403);
    // A published scene must not expose model spoilers for later-stage clues.
    for (const hotspot of scene.hotspots)
      await evidence.assertAvailable(hotspot.clueId);
    return scene;
  };
  app.get("/api/ar/scenes/:id", auth("player"), async (req, res) => {
    await playable(req);
    res.json(catalog.manifest(await available(req.params.id)));
  });
  app.post(
    "/api/ar/scenes/:id/hotspots/:hotspotId/collect",
    auth("player"),
    async (req, res) => {
      const { p } = await playable(req);
      const scene = await available(req.params.id);
      const hotspot = scene.hotspots.find(
        (item) => item.id === req.params.hotspotId,
      );
      if (!hotspot) fail("该场景中不存在此搜证热点", 404);
      // Ignore client-supplied clue IDs and awards; repeat clicks remain idempotent.
      res.json(await evidence.unlock(p, hotspot.clueId));
    },
  );
}
