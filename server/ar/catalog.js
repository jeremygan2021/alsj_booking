const identifier = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const vector = (v) =>
  Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);

// Store object keys, not provider-specific OSS URLs, in scene configuration.
export function createAssetResolver(baseUrl = "/ar-assets/") {
  if (!/^\/(?!\/)/.test(baseUrl)) {
    const url = new URL(baseUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        "AR_ASSET_BASE_URL 必须是同源路径或无鉴权参数的 HTTPS 目录",
      );
  } else if (/[?#\\]|\.\./.test(baseUrl)) {
    throw new Error("AR_ASSET_BASE_URL 目录无效");
  }
  const base = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
  return (key) => {
    if (
      typeof key !== "string" ||
      !key ||
      key.length > 512 ||
      key
        .split("/")
        .some((part) => !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(part))
    )
      throw new Error("AR 资源必须使用相对对象键，不能包含 URL 或路径穿越");
    return base + key;
  };
}

export function createSceneCatalog(scenes = [], baseUrl) {
  const resolve = createAssetResolver(baseUrl);
  if (!Array.isArray(scenes)) throw new Error("AR 场景配置必须是数组");
  const catalog = new Map();
  for (const input of scenes) {
    const scene = structuredClone(input);
    if (scene.enabled !== undefined && typeof scene.enabled !== "boolean")
      throw new Error("场景启用状态无效");
    if (
      !identifier.test(scene.id || "") ||
      catalog.has(scene.id) ||
      typeof scene.title !== "string" ||
      !scene.title.trim() ||
      !["page", "wall", "zone"].includes(scene.mode) ||
      !Number.isInteger(scene.phase) ||
      scene.phase < 1 ||
      scene.phase > 4 ||
      scene.tracking?.kind !== "image" ||
      !Number.isInteger(scene.tracking.targetIndex) ||
      scene.tracking.targetIndex < 0 ||
      !Number.isFinite(scene.tracking.physicalWidthMeters) ||
      scene.tracking.physicalWidthMeters <= 0 ||
      !Array.isArray(scene.models) ||
      !scene.models.length ||
      !Array.isArray(scene.hotspots) ||
      !scene.hotspots.length
    )
      throw new Error(`AR 场景配置无效: ${scene.id || "unknown"}`);
    resolve(scene.tracking.targetKey);
    if (!scene.tracking.targetKey.endsWith(".mind"))
      throw new Error("图像目标必须为 .mind 文件");
    const modelIds = new Set();
    for (const model of scene.models) {
      if (
        !identifier.test(model.id || "") ||
        modelIds.has(model.id) ||
        !vector(model.position) ||
        !vector(model.rotation) ||
        !vector(model.scale) ||
        model.scale.some((v) => v <= 0)
      )
        throw new Error("AR 模型坐标或编号无效");
      modelIds.add(model.id);
      resolve(model.assetKey);
      if (!model.assetKey.endsWith(".glb"))
        throw new Error("模型必须为 GLB 文件");
    }
    const hotspotIds = new Set();
    for (const hotspot of scene.hotspots) {
      if (
        !identifier.test(hotspot.id || "") ||
        hotspotIds.has(hotspot.id) ||
        !/^E-\d{2}$/.test(hotspot.clueId || "") ||
        !vector(hotspot.position) ||
        !Number.isFinite(hotspot.radius) ||
        hotspot.radius <= 0
      )
        throw new Error("AR 热点坐标、编号或证据绑定无效");
      hotspotIds.add(hotspot.id);
    }
    catalog.set(scene.id, scene);
  }
  return {
    get(id) {
      return structuredClone(catalog.get(id));
    },
    manifest(scene) {
      return {
        schemaVersion: 1,
        id: scene.id,
        title: scene.title,
        mode: scene.mode,
        phase: scene.phase,
        coordinateSystem: "image-width",
        tracking: {
          kind: "image",
          targetUrl: resolve(scene.tracking.targetKey),
          targetIndex: scene.tracking.targetIndex,
          physicalWidthMeters: scene.tracking.physicalWidthMeters,
        },
        models: scene.models.map(
          ({ id, assetKey, position, rotation, scale }) => ({
            id,
            url: resolve(assetKey),
            position,
            rotation,
            scale,
          }),
        ),
        // Clue text and advanced evidence never travel in a scene manifest.
        hotspots: scene.hotspots.map(({ id, position, radius }) => ({
          id,
          position,
          radius,
        })),
      };
    },
  };
}
