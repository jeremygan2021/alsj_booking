import * as THREE from "three";

const ease = (t) => t * t * (3 - 2 * t);
const labels = {
  letter: ["拆开信件", "收起信件", "信件已展开 · 移动手机查看"],
  terminal: ["启动终端", "关闭终端", "终端已启动 · 正在回放信号"],
  case: ["打开物证箱", "合上物证箱", "物证箱已打开 · 靠近查看细节"],
  archive: ["展开档案", "收起档案", "档案已展开 · 内容以线索记录为准"],
  prop: ["查看背面", "恢复正面", "已转向背面 · 移动手机观察细节"],
};

function attachParts(root, names, pivotPosition) {
  const parts = [];
  root.traverse((object) => {
    if (names(object.name)) parts.push(object);
  });
  const pivot = new THREE.Group();
  pivot.position.set(...pivotPosition);
  root.add(pivot);
  root.updateMatrixWorld(true);
  parts.forEach((part) => pivot.attach(part));
  return pivot;
}
function box(parent, size, position, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
}
function plaque() {
  const root = new THREE.Group();
  root.name = "QR_opaque_cover";
  const brass = new THREE.MeshStandardMaterial({
    color: 0xa58145,
    metalness: 0.8,
    roughness: 0.3,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x102d2b,
    metalness: 0.28,
    roughness: 0.53,
  });
  // A 1.48-square footprint also covers the four-module quiet zone of a v1 QR.
  // Its back lies on the tracked wall. All ornament is real plane-local geometry.
  box(root, [1.48, 1.48, 0.028], [0, 0, 0.014], brass);
  box(root, [1.438, 1.438, 0.015], [0, 0, 0.035], dark);
  const inlay = new THREE.MeshStandardMaterial({
    color: 0xd0b77e,
    metalness: 0.65,
    roughness: 0.37,
  });
  for (const sign of [-1, 1]) {
    box(root, [1.31, 0.004, 0.003], [0, sign * 0.655, 0.044], inlay);
    box(root, [0.004, 1.31, 0.003], [sign * 0.655, 0, 0.044], inlay);
    for (const sy of [-1, 1]) {
      const diamond = box(
        root,
        [0.032, 0.032, 0.004],
        [sign * 0.655, sy * 0.655, 0.047],
        inlay,
      );
      diamond.rotation.z = Math.PI / 4;
    }
  }
  // A soft contact shadow grounds the object without expensive realtime shadows.
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d"),
      g = ctx.createRadialGradient(64, 64, 12, 64, 64, 64);
    g.addColorStop(0, "rgba(0,0,0,.58)");
    g.addColorStop(0.6, "rgba(0,0,0,.32)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 1.25),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(canvas),
        transparent: true,
        depthWrite: false,
      }),
    );
    shadow.position.z = 0.045;
    root.add(shadow);
  }
  return root;
}

export function createEvidencePresentation(gltf) {
  gltf.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(gltf);
  if (bounds.isEmpty()) throw new Error("证物模型暂时无法显示，请重试。");
  const size = bounds.getSize(new THREE.Vector3()),
    center = bounds.getCenter(new THREE.Vector3());
  const kind = gltf.getObjectByName("Folded_Envelope_Flap")
    ? "letter"
    : [
          "Record_Display",
          "file_browser",
          "mode_screen",
          "profile_directory",
          "replay_screen",
          "letter_slot",
        ].some((name) => gltf.getObjectByName(name))
      ? "terminal"
      : gltf.getObjectByName("Open_Lid")
        ? "case"
        : gltf.getObjectByName("document_page")
          ? "archive"
          : "prop";
  const root = new THREE.Group();
  root.add(plaque());
  const oriented = new THREE.Group();
  oriented.rotation.x = kind === "terminal" ? Math.PI / 5 : Math.PI / 2;
  oriented.position.z = 0.05;
  root.add(oriented);
  const positioned = new THREE.Group();
  positioned.scale.setScalar(1.18 / Math.max(size.x, size.z, 0.001));
  oriented.add(positioned);
  // Rig in the glTF's original coordinates, before normalizing its assembly.
  let flap,
    seal,
    lid,
    paper,
    screen,
    traces = [],
    keys = [],
    lamps = [],
    archivePage;
  if (kind === "letter") {
    flap = attachParts(
      gltf,
      (n) => n === "Folded_Envelope_Flap" || n === "Fold_Edge",
      [0, 0.031, -0.078],
    );
    seal = attachParts(
      gltf,
      (n) => /^(Wax_|Seal_)/.test(n),
      [0, 0.0345, 0.012],
    );
    const parchment = new THREE.MeshStandardMaterial({
      color: 0xe9d9af,
      roughness: 0.9,
      side: THREE.DoubleSide,
    });
    paper = new THREE.Group();
    gltf.add(paper);
    box(paper, [0.225, 0.0015, 0.14], [0, 0.03, 0], parchment);
    const ink = new THREE.MeshStandardMaterial({
      color: 0x796e54,
      roughness: 1,
    });
    for (let i = 0; i < 6; i++)
      box(
        paper,
        [0.15 - (i % 3) * 0.025, 0.0003, 0.0013],
        [-0.014, 0.031, -0.04 + i * 0.012],
        ink,
      );
  } else if (kind === "case") {
    lid = attachParts(
      gltf,
      (n) =>
        n === "Open_Lid" || /^(Lid_(?!Hinge$|Hinge\.)|Rear_Lid_Rib)/.test(n),
      [0, 0.075, -0.132],
    );
  } else if (kind === "archive") {
    archivePage = attachParts(
      gltf,
      (name) => name === "document_page" || name.startsWith("blank_page_rule"),
      [0, 0.06, 0],
    );
  } else if (kind === "terminal") {
    screen = [
      "Record_Display",
      "file_browser",
      "mode_screen",
      "profile_directory",
      "replay_screen",
      "letter_slot",
    ]
      .map((name) => gltf.getObjectByName(name))
      .find(Boolean);
    gltf.traverse((object) => {
      if (!object.isMesh) return;
      if (
        /^(Record_Display|file_browser|mode_screen|profile_directory|replay_screen|letter_slot|Display_Trace_|Status_Lamp)/.test(
          object.name,
        )
      )
        object.material = object.material.clone();
      if (object.name.startsWith("Display_Trace_")) traces.push(object);
      if (object.name.startsWith("Key_"))
        keys.push({ object, y: object.position.y });
      if (object.name.startsWith("Status_Lamp")) lamps.push(object);
    });
  }
  gltf.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));
  positioned.add(gltf);
  if (kind === "terminal") {
    // Mount the instrument facing out from the wall, with its rearmost edge
    // resting on the plaque. A top-down view hides the interactive display.
    const mounted = new THREE.Box3().setFromObject(oriented);
    oriented.position.z += 0.05 - mounted.min.z;
    oriented.position.y -= mounted.getCenter(new THREE.Vector3()).y;
  }
  const materials = new Map();
  root.traverse((object) => {
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material])
      if (material)
        materials.set(material, {
          opacity: material.opacity,
          transparent: material.transparent,
          depthWrite: material.depthWrite,
        });
  });
  let progress = 0,
    target = 0,
    lastTime = null,
    opacity = -1;
  const reduced =
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  function update(time, visibility = 1) {
    const dt = Math.min(64, lastTime === null ? 16 : time - lastTime);
    lastTime = time;
    progress = reduced
      ? target
      : THREE.MathUtils.clamp(
          progress +
            ((target ? 1 : -1) * dt) / (kind === "letter" ? 1000 : 850),
          0,
          1,
        );
    const p = ease(progress);
    if (flap) {
      flap.rotation.x = -2.55 * p;
      seal.position.set(
        0.075 * p,
        0.0345 + 0.025 * Math.sin((p * Math.PI) / 2),
        0.012 + 0.045 * p,
      );
      seal.rotation.z = -0.28 * p;
      paper.visible = p > 0.25;
      paper.position.set(0, 0.035 * p, -0.055 * p);
    }
    if (lid) lid.rotation.x = Math.PI / 2 - p * (Math.PI / 2 + 0.85);
    if (archivePage) {
      archivePage.position.y = 0.06 + 0.045 * p;
      archivePage.rotation.x = -0.2 * p;
    }
    if (kind === "prop") positioned.rotation.y = Math.PI * p;
    if (screen) {
      screen.material.emissive.setHex(0x4bcab4);
      screen.material.emissiveIntensity = p * 0.65;
      traces.forEach((line, i) => {
        line.visible = p > 0.12;
        line.scale.x =
          0.45 + 0.55 * (0.5 + 0.5 * Math.sin(time * 0.003 - i * 0.85)) * p;
        line.material.emissive.setHex(0x70e9b4);
        line.material.emissiveIntensity =
          p * (0.5 + 0.3 * Math.sin(time * 0.004 + i));
      });
      lamps.forEach((lamp, i) => {
        lamp.material.emissive.setHex(0xfac679);
        lamp.material.emissiveIntensity =
          p * (0.8 + 0.5 * Math.sin(time * 0.004 + i));
      });
      keys.forEach(({ object, y }, i) => {
        object.position.y =
          y -
          (progress > 0 && progress < 1
            ? 0.0025 * Math.max(0, Math.sin(progress * 18 - i * 0.5))
            : 0);
      });
    }
    if (opacity !== visibility) {
      opacity = visibility;
      for (const [material, original] of materials) {
        material.opacity = original.opacity * visibility;
        material.transparent = original.transparent || visibility < 0.999;
        material.depthWrite = original.depthWrite && visibility > 0.9;
      }
    }
    root.userData.progress = progress;
    root.userData.kind = kind;
    return progress;
  }
  update(0, 0);
  return {
    root,
    kind,
    update,
    toggle() {
      target = target ? 0 : 1;
      return this.interaction;
    },
    get interaction() {
      return {
        kind,
        opened: Boolean(target),
        label: labels[kind][target],
        message: target ? labels[kind][2] : "轻触证物，查看其中的线索",
      };
    },
  };
}
