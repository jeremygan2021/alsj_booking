// Neutral observation markers only; no hidden identities, timestamps or verdicts.
const point = (
  id,
  label,
  position,
  note,
  orbit = "0deg 55deg auto",
  normal = [0, 0, 1],
) => ({ id, label, position, normal, note, orbit });
const inspection = {
  "aurora-trophy": [
    point(
      "base",
      "底座背面",
      [0.008, 0.066, -0.039],
      "转到奖杯背面，比较底座轮廓和缺口。",
      "180deg 55deg auto",
      [0, 0, -1],
    ),
    point(
      "fiber",
      "附着物",
      [0.017, 0.074, -0.04],
      "放大查看破损边缘的附着物；来源以鉴定报告为准。",
      "160deg 50deg auto",
      [0, 0, -1],
    ),
  ],
  "body-analysis": [
    point(
      "head",
      "头部轮廓",
      [0, 0.23, -0.7],
      "查看非血腥头部示意，与其他物证轮廓比较。",
      "20deg 35deg auto",
    ),
    point(
      "position",
      "倒地位置",
      [0, 0.18, -0.15],
      "观察身体、礼服和现场相对位置。",
      "0deg 30deg auto",
    ),
  ],
  "scarf-samples": [
    point(
      "weave",
      "织纹样本",
      [-0.085, 0.049, 0],
      "比较两块样本的织纹与断裂边缘。",
      "0deg 20deg auto",
    ),
    point(
      "edge",
      "破损边缘",
      [0.085, 0.05, -0.03],
      "观察边缘形状；样本归属以案件证据为准。",
      "0deg 20deg auto",
    ),
  ],
  "smart-watch": [
    point(
      "screen",
      "设备表面",
      [0, 0.078, 0.006],
      "查看设备构造；异常时间与信号含义请阅读对应日志。",
      "0deg 20deg auto",
    ),
  ],
  "access-console": [
    point(
      "mode",
      "显示屏",
      [0, 0.19, 0.008],
      "核对模式记录和正常刷卡记录的区别。",
    ),
    point(
      "reader",
      "读卡器",
      [0, 0.09, 0.012],
      "正常刷卡与安全通行属于不同出入方式。",
    ),
  ],
  "audio-console": [
    point(
      "file",
      "播控屏幕",
      [-0.033, 0.16, 0.006],
      "核对文件来源、播放安排及麦克风状态。",
    ),
    point(
      "port",
      "接口",
      [0.123, 0.075, -0.116],
      "观察终端接口；模型不替代正式播控记录。",
      "160deg 65deg auto",
      [0, 0, -1],
    ),
  ],
  "archive-folios": [
    point(
      "seal",
      "封蜡信件",
      [-0.091, 0.078, 0.008],
      "财富遗嘱与数字处置文件须分开理解。",
      "0deg 20deg auto",
    ),
    point(
      "folder",
      "数字档案夹",
      [0.073, 0.06, -0.01],
      "文书内容以当前线索记录为准。",
      "0deg 20deg auto",
    ),
  ],
  "personality-terminal": [
    point(
      "directory",
      "档案目录",
      [0, 0.16, 0.03],
      "查看人格实例记录的主体、授权与处置状态。",
    ),
  ],
  "security-camera": [
    point(
      "lens",
      "摄像机",
      [-0.1, 0.27, 0.034],
      "镜头覆盖范围不等于全场无人进出。",
    ),
    point("screen", "影像终端", [0, 0.13, -0.021], "核对影像来源和记录时间。"),
  ],
  "photo-frame": [
    point(
      "plate",
      "照片展示面",
      [0, 0.15, -0.009],
      "这是一件展示道具；具体照片事实以证据文字或配套原图为准。",
    ),
  ],
  "memory-recorder": [
    point(
      "recording",
      "录音载体",
      [-0.074, 0.127, 0.05],
      "区分真实录制与数字生成的来源元数据。",
    ),
    point(
      "archive",
      "档案播放面",
      [0, 0.063, 0.047],
      "记录属于何种来源，应依据档案说明判断。",
    ),
  ],
  "wine-glass": [
    point(
      "rim",
      "杯口",
      [0, 0.216, 0],
      "观察酒杯与采样位置，检验结论以记录为准。",
    ),
    point(
      "sample",
      "采样瓶",
      [0.074, 0.084, 0.045],
      "这是模拟检验样本，不能据外形断定毒物。",
    ),
  ],
  "archive-route": [
    point(
      "east",
      "东侧覆盖区",
      [0.18, 0.071, -0.02],
      "东侧镜头只覆盖东侧路线。",
      "0deg 20deg auto",
    ),
    point(
      "west",
      "西侧通道",
      [-0.176, 0.057, 0.015],
      "查看独立的西侧通道，再核对门禁时间窗口。",
      "0deg 20deg auto",
    ),
  ],
};
export function modelInspectionPoints(filename) {
  return inspection[filename] || [];
}
