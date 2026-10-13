import { randomInt } from "node:crypto";
import { getEvidenceModel } from "../../src/evidence-models.js";

// Transport and AR engines never decide whether evidence may be awarded.
export function createEvidenceService({ one, all, run, tx, fail, setting }) {
  const find = async (id) => {
    const clue = await one("SELECT * FROM clues WHERE id=?", id);
    if (!clue) fail("证物不存在", 404);
    return clue;
  };
  const result = async (p, clue) => {
    const model = getEvidenceModel(clue.id);
    const check = await one(
      "SELECT * FROM checks WHERE group_id=? AND area=?",
      p.group_id,
      clue.area,
    );
    return {
      id: clue.id,
      title: clue.title,
      body: clue.body,
      detail:
        check && (check.roll === 20 || check.roll + check.bonus >= clue.dc)
          ? clue.detail
          : null,
      check,
      ...(model
        ? {
            model_url: `/api/models/${model.filename}.glb`,
            model_label: model.label,
          }
        : {}),
    };
  };
  const collected = async (p, id) =>
    Boolean(
      await one(
        "SELECT 1 FROM unlocks WHERE player_id=? AND clue_id=?",
        p.id,
        id,
      ),
    );
  return {
    async list(p) {
      return {
        clues: await all(
          "SELECT c.id,c.title,c.area,c.skill,c.dc,c.phase,c.category,u.created_at unlocked FROM clues c LEFT JOIN unlocks u ON u.clue_id=c.id AND u.player_id=?",
          p.id,
        ),
        checks: await all("SELECT * FROM checks WHERE group_id=?", p.group_id),
      };
    },
    async read(p, id) {
      const clue = await find(id);
      if (!(await collected(p, id))) fail("请先翻开证物", 403);
      return result(p, clue);
    },
    async assertAvailable(id) {
      const clue = await find(id);
      if ((await setting()).phase < clue.phase)
        fail(`该证物将在第${clue.phase}幕开放`, 403);
      return clue;
    },
    async unlock(p, id) {
      const clue = await this.assertAvailable(id);
      await run(
        "INSERT OR IGNORE INTO unlocks(player_id,clue_id) VALUES(?,?)",
        p.id,
        id,
      );
      return result(p, clue);
    },
    async check(p, character, id) {
      const clue = await one("SELECT * FROM clues WHERE id=?", id);
      if (!clue || (await setting()).phase !== 3)
        fail("请在第三幕选择有效调查区");
      if (!(await collected(p, id))) fail("请先取得基础证据");
      return tx(async () => {
        const old = await one(
          "SELECT * FROM checks WHERE group_id=? AND area=?",
          p.group_id,
          clue.area,
        );
        if (old) return old;
        await run(
          "INSERT INTO checks(group_id,area,roll,bonus) VALUES(?,?,?,?)",
          p.group_id,
          clue.area,
          randomInt(1, 21),
          character.skill === clue.skill ? 2 : 0,
        );
        return one(
          "SELECT * FROM checks WHERE group_id=? AND area=?",
          p.group_id,
          clue.area,
        );
      });
    },
  };
}
