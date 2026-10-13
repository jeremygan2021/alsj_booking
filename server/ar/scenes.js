export const defaultArScenes = [
  {
    id: "wall-study",
    title: "遗嘱证物柜",
    mode: "wall",
    phase: 3,
    tracking: {
      kind: "image",
      targetKey: "targets/study-wall.mind",
      targetIndex: 0,
      physicalWidthMeters: 0.18,
    },
    models: [
      {
        id: "cabinet",
        assetKey: "models/study-cabinet.glb",
        position: [0, 0, 0.08],
        rotation: [0, 0, 0],
        scale: [0.65, 0.65, 0.65],
      },
    ],
    hotspots: [
      {
        id: "document",
        clueId: "E-01",
        position: [-0.11, 0.19, 0.36],
        radius: 0.09,
      },
      {
        id: "recorder",
        clueId: "E-02",
        position: [0.09, -0.08, 0.36],
        radius: 0.09,
      },
      {
        id: "key",
        clueId: "E-03",
        position: [-0.16, -0.36, 0.4],
        radius: 0.09,
      },
    ],
  },
];

export const demoEvidence = {
  document: {
    title: "密封文件",
    body: "体验证物：文件上的日期与信封邮戳并不相同。你已完成模型点击搜证。",
  },
  recorder: {
    title: "录音装置",
    body: "体验证物：录音装置停在最后十秒。这是演示内容，不计入正式剧情证据册。",
  },
  key: {
    title: "黄铜钥匙",
    body: "体验证物：钥匙齿上留有一处磨损。你可以移动手机，从侧面观察证物柜。",
  },
};
