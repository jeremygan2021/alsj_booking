export const INVESTIGATION_GROUPS = Object.freeze([1, 2, 3, 4]);
export const INVESTIGATION_GROUP_COUNT = INVESTIGATION_GROUPS.length;

export function leastPopulatedInvestigationGroup(rows) {
  const counts = new Map(rows.map((row) => [row.group_id, Number(row.n)]));
  return INVESTIGATION_GROUPS.reduce((best, group) =>
    (counts.get(group) || 0) < (counts.get(best) || 0) ? group : best,
  );
}
