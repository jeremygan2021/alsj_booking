// Public 3D observation stations. Actor scripts and advanced reports stay private.
export const publicInvestigationNodes = [
  {
    id: "AR-01",
    title: "尸体位置分析",
    area: "档案室验尸区",
    filename: "body-analysis",
    fallback: "evidence-case",
    clueIds: ["E-13"],
    body: "观察索恩倒地位置与周围环境。现场初步记录显示头部钝性外伤，具体死亡时间应结合其他证据判断。",
  },
  {
    id: "AR-02",
    title: "头部创伤鉴定",
    area: "档案室验尸区",
    filename: "body-analysis",
    fallback: "evidence-case",
    clueIds: ["E-14"],
    body: "查看非血腥创伤示意，比较头部钝伤轮廓与奖杯底座形态。模型仅用于虚构案件分析，结论以对应鉴定报告为准。",
  },
  {
    id: "AR-03",
    title: "佩戴设备分析",
    area: "档案室验尸区",
    filename: "smart-watch",
    fallback: "echo-terminal",
    clueIds: ["E-23"],
    body: "观察手表、表带与传感器。设备异常和生理数据中断能支持时间分析，但不等于精确医学死亡时刻。",
  },
  {
    id: "AR-04",
    title: "奖杯微量物证",
    area: "极光档案室",
    filename: "aurora-trophy",
    fallback: "evidence-case",
    clueIds: ["E-06", "E-17"],
    body: "旋转极光之眼奖杯，检查底座背面的破损和附着纤维。纤维来源需通过交叉比对确认，不能只看模型判断。",
  },
  {
    id: "AR-05",
    title: "酒杯检验",
    area: "档案室验尸区",
    filename: "wine-glass",
    fallback: "evidence-case",
    clueIds: [],
    body: "查看酒杯与模拟检验样本。案件现有资料不支持枪击或酒杯毒物为直接死因；排除性调查仍需与初步法医报告结合。",
  },
  {
    id: "AR-06",
    title: "档案室出入路线",
    area: "极光档案室",
    filename: "archive-route",
    fallback: "echo-terminal",
    clueIds: ["E-03", "E-04"],
    body: "观察档案室与东西两条通道。东侧摄像机只覆盖东侧，不能据此判断西侧无人进出。门禁时间窗口以记录为准。",
  },
];
export function findPublicInvestigationNode(id) {
  if (id === "AR-INV")
    return {
      id,
      title: "索恩庄园 · 极光之夜邀请函",
      area: "庄园迎宾处",
      filename: "sealed-letter",
      fallback: "sealed-letter",
      presentation: "invitation",
      poster_url: "/invitation/alaska-poster.jpg",
      valid_until: "2026-10-31T23:59:59+08:00",
      body: "致受邀宾客：\n诚邀您于2026年10月31日莅临索恩庄园，参加《阿拉斯加之夜：最后的遗嘱》沉浸式真人TRPG推理体验。\n当AI可以模仿逝者，人类是否真正拥有永生？\n50名玩家 · 6名NPC演员\n破冰交际 → 秘密拍卖 → 死亡与搜证 → 模拟庭审\n实体证据 + VR场景搜证 + 3D AR验尸\nFBI调查阵营 / 索恩遗产阵营 / 杀手同伙阵营\n阿德里安·索恩 · 瑟琳娜·温特 · ADS · ECHO／回声计划\n联合主办：量迹、滇峰青年社、ADS。\n本函为活动邀请展示；入场以报名确认为准。",
    };
  return publicInvestigationNodes.find((node) => node.id === id);
}
