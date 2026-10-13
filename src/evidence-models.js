// Only return model metadata for a clue the server has already authorized.
// Clients receive an authenticated /api/models URL from the clue detail API.
const letter = Object.freeze({
  filename: "sealed-letter",
  label: "封蜡信件 · 剧情示例模型",
});
const terminal = Object.freeze({
  filename: "echo-terminal",
  label: "记录终端 · 剧情示例模型",
});
const evidenceCase = Object.freeze({
  filename: "evidence-case",
  label: "物证样本箱 · 剧情示例模型",
});
const models = Object.freeze({
  "E-01": letter,
  "E-02": terminal,
  "E-03": letter,
  "E-04": terminal,
  "E-05": terminal,
  "E-06": evidenceCase,
  "E-07": letter,
  "E-08": terminal,
  "E-09": evidenceCase,
  "E-10": letter,
  "E-11": terminal,
  "E-12": letter,
});

export function getEvidenceModel(clueId) {
  return Object.prototype.hasOwnProperty.call(models, clueId)
    ? models[clueId]
    : null;
}
