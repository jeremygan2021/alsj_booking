export const phases = ["黄金舞会", "命运拍卖会", "午夜命案", "最后的庭审"];
export const factions = {
  fbi: "FBI调查阵营",
  croft: "盖茨比阵营",
  conspirator: "隐藏同伙",
};

export const formatTime = (value) =>
  new Date(value.replace(" ", "T") + "Z").toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
