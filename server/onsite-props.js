// Fixed fourth-act aid cards. They organise already-public evidence and never
// require an amateur actor to invent testimony or adjudicate a conclusion.
const cards = new Map([
  ["古董手枪模型", "道具观察卡：这是一件无法发射的舞台模型。把外观相似与致伤方式分开讨论；请用已公开的伤情证据核对，不要求演员现场鉴定。"],
  ["证人承诺卡", "证人整理卡：请选一条已公开证言，按“这位证人亲眼见到什么、哪些只是转述”各写一句。证言未覆盖的部分交GM核对，不让NPC补编事实。"],
  ["封存档案开启权", "背景档案卡：索恩于2021年创立ADS，2023年失去瑟琳娜后转向ECHO。把个人经历与案发当晚的行为分开，再对照已公开的档案。"],
  ["加急核查券", "核查整理卡：把已公开的设备时间、视频时间和门禁时间排成一条时间线，区分“有人在场”与“某设备被使用”。缺失数据由GM核对。"],
  ["未公开遗嘱", "遗嘱整理卡：请分开讨论财产继承与数字人格处置权限；继承利益不等于有权立即改变处置。用已公开条款核对两件事。"],
  ["专家鉴定申请", "鉴定整理卡：将伤情、疑似致伤物、接触痕迹列成三栏，分别写下已收集的证物编号。它们共同支持什么结论，由你们陈述并交GM核对。"],
]);
export function onsitePropHint(title) {
  return cards.get(title) || "请将这件道具的记录出示给GM，由GM按本场已准备的说明执行；NPC无需临时编写额外剧情。";
}
