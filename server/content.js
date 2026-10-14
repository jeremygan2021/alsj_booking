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
    "拍卖登记记载了一件古董手枪舞台模型。",
    "模型没有发射能力，尸体也没有枪伤，与死因无关。",
    "排除",
  ],
].sort((a, b) => a[0].localeCompare(b[0]));
export const lots = [
  ["古董手枪模型", 18, "一件无法发射的舞台模型，可申请物证鉴定。", "鉴定"],
  ["证人承诺卡", 15, "庭审时要求一位NPC真实回答一个已知事实问题。", "证人"],
  ["封存档案开启权", 20, "由GM放行一份非唯一关键档案。", "档案"],
  ["命运重掷券", 12, "对一次小组鉴定重掷，保留较高结果。", "重掷"],
  ["未公开遗嘱", 22, "庭审时申请诺拉·里德核对遗产相关文件。", "遗嘱"],
  ["专家鉴定申请", 16, "申请一张已获得证据的官方补充说明。", "鉴定"],
];
