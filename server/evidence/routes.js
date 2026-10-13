export function mountEvidenceRoutes(app, { auth, player, playable, evidence }) {
  app.get("/api/clues", auth("player"), async (req, res) => {
    res.json(await evidence.list(await player(req)));
  });
  app.get("/api/clues/:id", auth("player"), async (req, res) => {
    const { p } = await playable(req);
    res.json(await evidence.read(p, req.params.id));
  });
  app.post("/api/clues/:id/unlock", auth("player"), async (req, res) => {
    const { p } = await playable(req);
    res.json(await evidence.unlock(p, req.params.id));
  });
  app.post("/api/check", auth("player"), async (req, res) => {
    const { p, c } = await playable(req);
    res.json(await evidence.check(p, c, req.body.clueId));
  });
}
