import { npcMaterialSeeds, evidenceMaterialSeeds } from "./story-materials.js";
export const phases = ["黄金舞会", "命运拍卖会", "午夜命案", "最后的庭审"];
export const npcOrder =
  "CASE id WHEN 'host' THEN 1 WHEN 'singer' THEN 2 WHEN 'attorney' THEN 3 WHEN 'detective' THEN 4 WHEN 'security' THEN 5 WHEN 'scientist' THEN 6 ELSE 7 END";
// Story materials preserve code IDs while mapping the author's EV IDs explicitly.
export const npcs = npcMaterialSeeds;
export const evidence = [
  ...evidenceMaterialSeeds,
  [
    "E-09",
    "拍卖物品档案",
    "黄金宴会厅",
    "洞察",
    10,
    "拍卖登记记载了一件古董手枪舞台模型，拍品编号与现场模型一致。",
    "模型枪管为封闭结构，没有发射能力；索恩头部伤情为钝性外伤，未见枪伤。",
    "排除",
  ],
].sort((a, b) => a[0].localeCompare(b[0]));
export const lots = [
  [
    "古董手枪模型",
    18,
    "收藏一件无法发射的舞台模型。第四幕向GM登记，读取预写的道具观察提示；核心物证核查免费开放。",
    "鉴定",
  ],
  [
    "证人承诺卡",
    15,
    "第四幕向GM登记，读取一条预写的非核心证人补充说明。NPC无需临场编答案，核心证言保底公开。",
    "证人",
  ],
  [
    "封存档案开启权",
    20,
    "第四幕向GM登记，读取一份预写的非核心背景档案；不影响关键事实公开。",
    "档案",
  ],
  [
    "加急核查券",
    12,
    "第四幕向GM登记，读取一条已获证物的预写观察提示。核心核查无需竞拍，也不因骰子失败丢失。",
    "重掷",
  ],
  [
    "未公开遗嘱",
    22,
    "第四幕向GM登记，读取一条遗嘱的预写背景说明。无需演员现场核对条款，关键规则免费公开。",
    "遗嘱",
  ],
  [
    "专家鉴定申请",
    16,
    "第四幕向GM登记，读取一条预写的证物观察提示。无需演员临场鉴定，致伤物与断口等核心事实保底公开。",
    "鉴定",
  ],
];
