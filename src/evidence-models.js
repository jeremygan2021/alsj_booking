// Public asset names only. Actor secrets and full commissioning briefs stay server-side.
// Existing models remain usable until the commissioned GLB is installed.
const models = Object.freeze({
  "E-01": {
    filename: "sealed-letter",
    label: "封蜡信件 · 剧情示例模型",
    plannedFilename: "archive-folios",
    plannedLabel: "档案文件与双遗嘱套件",
  },
  "E-02": {
    filename: "echo-terminal",
    label: "记录终端 · 剧情示例模型",
    plannedFilename: "archive-folios",
    plannedLabel: "档案文件与双遗嘱套件",
  },
  "E-03": {
    filename: "sealed-letter",
    label: "封蜡信件 · 剧情示例模型",
    plannedFilename: "access-console",
    plannedLabel: "门禁控制台",
  },
  "E-04": {
    filename: "echo-terminal",
    label: "记录终端 · 剧情示例模型",
    plannedFilename: "access-console",
    plannedLabel: "门禁控制台",
  },
  "E-05": {
    filename: "echo-terminal",
    label: "记录终端 · 剧情示例模型",
    plannedFilename: "audio-console",
    plannedLabel: "ECHO音频播控终端",
  },
  "E-06": {
    filename: "evidence-case",
    label: "物证样本箱 · 剧情示例模型",
    plannedFilename: "aurora-trophy",
    plannedLabel: "极光之眼奖杯",
  },
  "E-07": {
    filename: "sealed-letter",
    label: "封蜡信件 · 剧情示例模型",
    plannedFilename: "memory-recorder",
    plannedLabel: "温特记忆与遗言播放装置",
  },
  "E-08": {
    filename: "echo-terminal",
    label: "记录终端 · 剧情示例模型",
    plannedFilename: "photo-frame",
    plannedLabel: "舞台与摄影记录相框",
  },
  "E-09": {
    filename: "evidence-case",
    label: "物证样本箱 · 剧情示例模型",
  },
  "E-10": {
    filename: "sealed-letter",
    label: "封蜡信件 · 剧情示例模型",
    plannedFilename: "archive-folios",
    plannedLabel: "档案文件与双遗嘱套件",
  },
  "E-11": {
    filename: "echo-terminal",
    label: "记录终端 · 剧情示例模型",
    plannedFilename: "archive-folios",
    plannedLabel: "档案文件与双遗嘱套件",
  },
  "E-12": {
    filename: "sealed-letter",
    label: "封蜡信件 · 剧情示例模型",
    plannedFilename: "archive-folios",
    plannedLabel: "档案文件与双遗嘱套件",
  },
  "E-13": {
    filename: "evidence-case",
    label: "物证样本箱 · 剧情示例模型",
    plannedFilename: "body-analysis",
    plannedLabel: "尸体位置与头部创伤分析模型",
  },
  "E-14": {
    filename: "evidence-case",
    label: "物证样本箱 · 剧情示例模型",
    plannedFilename: "body-analysis",
    plannedLabel: "尸体位置与头部创伤分析模型",
  },
  "E-15": {
    filename: "echo-terminal",
    label: "记录终端 · 剧情示例模型",
    plannedFilename: "audio-console",
    plannedLabel: "ECHO音频播控终端",
  },
  "E-16": {
    filename: "sealed-letter",
    label: "封蜡信件 · 剧情示例模型",
    plannedFilename: "archive-folios",
    plannedLabel: "档案文件与双遗嘱套件",
  },
  "E-17": {
    filename: "evidence-case",
    label: "物证样本箱 · 剧情示例模型",
    plannedFilename: "scarf-samples",
    plannedLabel: "银灰披巾与纤维样本",
  },
  "E-18": {
    filename: "echo-terminal",
    label: "记录终端 · 剧情示例模型",
    plannedFilename: "personality-terminal",
    plannedLabel: "ECHO人格实验终端",
  },
  "E-19": {
    filename: "echo-terminal",
    label: "记录终端 · 剧情示例模型",
    plannedFilename: "access-console",
    plannedLabel: "门禁控制台",
  },
  "E-20": {
    filename: "echo-terminal",
    label: "记录终端 · 剧情示例模型",
    plannedFilename: "security-camera",
    plannedLabel: "监控影像终端",
  },
  "E-21": {
    filename: "sealed-letter",
    label: "封蜡信件 · 剧情示例模型",
    plannedFilename: "archive-folios",
    plannedLabel: "档案文件与双遗嘱套件",
  },
  "E-22": {
    filename: "echo-terminal",
    label: "记录终端 · 剧情示例模型",
    plannedFilename: "audio-console",
    plannedLabel: "ECHO音频播控终端",
  },
  "E-23": {
    filename: "evidence-case",
    label: "物证样本箱 · 剧情示例模型",
    plannedFilename: "smart-watch",
    plannedLabel: "索恩佩戴设备",
  },
  "E-24": {
    filename: "echo-terminal",
    label: "记录终端 · 剧情示例模型",
    plannedFilename: "security-camera",
    plannedLabel: "监控影像终端",
  },
  "E-25": {
    filename: "echo-terminal",
    label: "记录终端 · 剧情示例模型",
    plannedFilename: "photo-frame",
    plannedLabel: "舞台与摄影记录相框",
  },
  "E-26": {
    filename: "echo-terminal",
    label: "记录终端 · 剧情示例模型",
    plannedFilename: "memory-recorder",
    plannedLabel: "温特记忆与遗言播放装置",
  },
});

export function getEvidenceModel(clueId, isAvailable = () => false) {
  if (!Object.prototype.hasOwnProperty.call(models, clueId)) return null;
  const model = models[clueId];
  if (model.plannedFilename && isAvailable(model.plannedFilename)) {
    return { filename: model.plannedFilename, label: model.plannedLabel };
  }
  return { filename: model.filename, label: model.label };
}
