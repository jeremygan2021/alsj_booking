import * as THREE from "three";
import { createInvitationPresentation } from "./invitation-presentation.js";

export async function createCastleInvitation(clue, onGameChange) {
  const invitation = await createInvitationPresentation(clue);
  const root = new THREE.Group(),
    castle = new THREE.Group();
  root.add(castle, invitation.root);
  root.name = "Thorne_Estate_AR_Experience";
  castle.rotation.x = -0.75;
  const stone = new THREE.MeshStandardMaterial({
    color: 0x304751,
    roughness: 0.72,
  });
  const roof = new THREE.MeshStandardMaterial({
    color: 0x123238,
    metalness: 0.28,
    roughness: 0.4,
  });
  const brass = new THREE.MeshStandardMaterial({
    color: 0xcda45c,
    metalness: 0.7,
    roughness: 0.3,
  });
  const snow = new THREE.MeshStandardMaterial({
    color: 0xf3efe6,
    roughness: 0.95,
  });
  const glow = new THREE.MeshStandardMaterial({
    color: 0xf2ce86,
    emissive: 0xe5b76a,
    emissiveIntensity: 0.55,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x111f26,
    roughness: 0.8,
  });
  const add = (geo, mat, parent = castle) => {
    const m = new THREE.Mesh(geo, mat);
    parent.add(m);
    return m;
  };
  const box = (w, d, h, x, y, z, mat, parent = castle) => {
    const m = add(new THREE.BoxGeometry(w, d, h), mat, parent);
    m.position.set(x, y, z);
    return m;
  };
  const cylinder = (r, h, x, y, z, mat, parent = castle, segments = 18) => {
    const m = add(new THREE.CylinderGeometry(r, r, h, segments), mat, parent);
    m.rotation.x = Math.PI / 2;
    m.position.set(x, y, z);
    return m;
  };
  const island = cylinder(0.78, 0.045, 0, 0, 0.028, snow);
  island.userData.action = "walkCastle";
  const rim = cylinder(0.8, 0.018, 0, 0, 0.009, brass);
  const moat = cylinder(
    0.74,
    0.008,
    0,
    0,
    0.056,
    new THREE.MeshStandardMaterial({
      color: 0x356977,
      metalness: 0.45,
      roughness: 0.2,
    }),
  );
  moat.userData.action = "walkCastle";
  const terrace = box(1.15, 1.24, 0.012, 0, 0.04, 0.065, snow);
  terrace.userData.action = "walkCastle";
  const path = box(0.2, 0.69, 0.008, 0, -0.35, 0.076, stone);
  path.userData.action = "walkCastle";
  for (let i = 0; i < 9; i++) {
    const step = box(0.19, 0.035, 0.011, 0, -0.66 + i * 0.061, 0.085, brass);
    step.userData.action = "walkCastle";
  }
  // Split front wall creates a real open archway; the figure can enter it.
  box(0.31, 0.052, 0.26, -0.25, -0.065, 0.21, stone);
  box(0.31, 0.052, 0.26, 0.25, -0.065, 0.21, stone);
  box(0.2, 0.06, 0.08, 0, -0.065, 0.37, stone);
  box(0.86, 0.052, 0.29, 0, 0.51, 0.225, stone);
  box(0.05, 0.55, 0.27, -0.405, 0.23, 0.215, stone);
  box(0.05, 0.55, 0.27, 0.405, 0.23, 0.215, stone);
  const hall = box(0.42, 0.35, 0.24, 0, 0.31, 0.225, stone);
  hall.userData.action = "castleLights";
  const roofGeometry = new THREE.ConeGeometry(0.34, 0.24, 4);
  const hallRoof = add(roofGeometry, roof);
  hallRoof.rotation.x = Math.PI / 2;
  hallRoof.rotation.y = Math.PI / 4;
  hallRoof.position.set(0, 0.31, 0.44);
  const windows = [];
  for (const x of [-0.43, 0.43])
    for (const y of [-0.055, 0.51]) {
      const tower = cylinder(0.095, 0.4, x, y, 0.285, stone);
      tower.userData.action = "castleLights";
      cylinder(0.109, 0.023, x, y, 0.489, brass);
      const cone = add(new THREE.ConeGeometry(0.132, 0.19, 12), roof);
      cone.rotation.x = Math.PI / 2;
      cone.position.set(x, y, 0.586);
      const cap = add(new THREE.SphereGeometry(0.015, 8, 6), brass);
      cap.position.set(x, y, 0.686);
      const window = box(0.045, 0.008, 0.084, x, y - 0.096, 0.34, glow);
      windows.push(window);
      for (let k = 0; k < 3; k++)
        cylinder(0.101, 0.006, x, y, 0.145 + k * 0.108, snow);
    }
  for (const x of [-0.15, 0, 0.15]) {
    const window = box(0.04, 0.01, 0.073, x, 0.129, 0.27, glow);
    windows.push(window);
  }
  const door = new THREE.Group();
  castle.add(door);
  door.position.set(0, -0.099, 0.087);
  door.userData.action = "castleLights";
  for (let i = 0; i < 6; i++)
    box(0.009, 0.012, 0.25, -0.078 + i * 0.031, 0, 0.125, brass, door);
  for (const z of [0.04, 0.125, 0.21])
    box(0.17, 0.014, 0.008, 0, 0, z, brass, door);
  const banner = box(0.11, 0.018, 0.064, 0, -0.111, 0.395, brass);
  banner.userData.action = "castleLights";
  for (const x of [-0.29, 0.29]) {
    cylinder(0.012, 0.12, x, -0.25, 0.15, brass);
    const lantern = box(0.042, 0.038, 0.055, x, -0.25, 0.222, glow);
    windows.push(lantern);
    const point = new THREE.PointLight(0xffcc87, 0.18, 0.55);
    point.position.copy(lantern.position);
    castle.add(point);
  }
  for (let i = 0; i < 6; i++) {
    const x = (i % 2 ? 1 : -1) * (0.54 + (i % 3) * 0.045),
      y = -0.38 + (i % 3) * 0.31;
    cylinder(0.014, 0.065, x, y, 0.105, stone);
    const tree = add(new THREE.ConeGeometry(0.064, 0.18, 8), roof);
    tree.rotation.x = Math.PI / 2;
    tree.position.set(x, y, 0.2);
    const frost = add(new THREE.ConeGeometry(0.047, 0.12, 8), snow);
    frost.rotation.x = Math.PI / 2;
    frost.position.set(x, y, 0.252);
  }
  const walker = new THREE.Group();
  castle.add(walker);
  walker.position.set(0, -0.63, 0.084);
  const coat = new THREE.MeshStandardMaterial({
    color: 0x863730,
    roughness: 0.6,
  });
  const skin = new THREE.MeshStandardMaterial({
    color: 0xe7c29b,
    roughness: 0.65,
  });
  cylinder(0.025, 0.072, 0, 0, 0.086, coat, walker, 12);
  const head = add(new THREE.SphereGeometry(0.028, 14, 10), skin, walker);
  head.position.z = 0.145;
  cylinder(0.037, 0.012, 0, 0, 0.171, dark, walker, 14);
  cylinder(0.026, 0.027, 0, 0, 0.188, dark, walker, 14);
  const limbs = [];
  for (const x of [-0.02, 0.02]) {
    const leg = new THREE.Group();
    walker.add(leg);
    leg.position.set(x, 0, 0.054);
    cylinder(0.009, 0.043, 0, 0, -0.02, dark, leg, 10);
    box(0.018, 0.031, 0.012, 0, 0.009, -0.047, dark, leg);
    limbs.push(leg);
    const arm = new THREE.Group();
    walker.add(arm);
    arm.position.set(x * 1.8, 0, 0.108);
    cylinder(0.009, 0.051, 0, 0, -0.022, coat, arm, 10);
    limbs.push(arm);
  }
  box(0.054, 0.013, 0.013, 0, 0.028, 0.119, brass, walker);
  const guide = new THREE.Group();
  castle.add(guide);
  guide.position.set(0, -0.17, 0.096);
  const ring = add(new THREE.TorusGeometry(0.105, 0.006, 6, 32), brass, guide);
  const sparkles = [];
  for (let i = 0; i < 28; i++) {
    const m = add(new THREE.SphereGeometry(0.005, 4, 4), snow);
    sparkles.push(m);
  }
  const materials = new Map();
  castle.traverse((o) => {
    if (o.material) materials.set(o.material, o.material.opacity);
  });
  const reduced =
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  let phase = "castle",
    input = { x: 0, y: 0 },
    destination = null,
    last = null,
    gate = 0,
    entry = 0,
    reveal = 0,
    lights = true,
    walkClock = 0;
  const emit = () =>
    onGameChange?.({
      phase,
      unlocked: phase === "invitation",
      instruction:
        phase === "castle"
          ? "操控小人沿金色步道走进城门"
          : phase === "entering"
            ? "城门已开启 · 小人正在入场"
            : "庄园之邀已解锁 · 轻触启封或接受邀请",
    });
  emit();
  function update(time, visibility = 1, camera) {
    const dt = Math.max(
      0,
      Math.min(0.064, last === null ? 0.016 : (time - last) / 1000),
    );
    last = time;
    const active = visibility > 0.8;
    if (phase === "castle" && active) {
      let direction = new THREE.Vector2();
      if (input.x || input.y) {
        const inverse = castle
          .getWorldQuaternion(new THREE.Quaternion())
          .invert();
        const cq = camera.getWorldQuaternion(new THREE.Quaternion());
        const right3 = new THREE.Vector3(1, 0, 0)
          .applyQuaternion(cq)
          .applyQuaternion(inverse);
        const up3 = new THREE.Vector3(0, 1, 0)
          .applyQuaternion(cq)
          .applyQuaternion(inverse);
        const right = new THREE.Vector2(right3.x, right3.y).normalize();
        const up = new THREE.Vector2(-right.y, right.x);
        if (up.dot(new THREE.Vector2(up3.x, up3.y)) < 0) up.negate();
        direction
          .copy(right.multiplyScalar(input.x).add(up.multiplyScalar(input.y)))
          .normalize();
      } else if (destination) {
        direction.set(
          destination.x - walker.position.x,
          destination.y - walker.position.y,
        );
        if (direction.length() < 0.018) destination = null;
        else direction.normalize();
      }
      const x = THREE.MathUtils.clamp(
        walker.position.x + direction.x * dt * 0.3,
        -0.59,
        0.59,
      );
      const y = THREE.MathUtils.clamp(
        walker.position.y + direction.y * dt * 0.3,
        -0.65,
        0.62,
      );
      const nearDoor =
        Math.abs(walker.position.x) < 0.12 && walker.position.y > -0.28;
      gate = THREE.MathUtils.clamp(gate + (nearDoor ? dt * 1.6 : -dt), 0, 1);
      const insideWall = Math.abs(x) < 0.49 && y > -0.145 && y < 0.59;
      const doorway = Math.abs(x) < 0.083 && y < 0.1 && gate > 0.72;
      if (!insideWall || doorway) {
        walker.position.x = x;
        walker.position.y = y;
      }
      if (direction.lengthSq()) {
        walkClock += dt * 8;
        walker.rotation.z = -Math.atan2(direction.x, direction.y);
      }
      limbs.forEach(
        (limb, i) =>
          (limb.rotation.x = direction.lengthSq()
            ? Math.sin(walkClock + (i % 2) * Math.PI) * 0.42
            : 0),
      );
      if (Math.abs(walker.position.x) < 0.083 && walker.position.y > -0.09) {
        phase = "entering";
        input = { x: 0, y: 0 };
        destination = null;
        emit();
      }
    }
    if (phase === "entering" && active) {
      entry = Math.min(1, entry + dt);
      walker.position.y = -0.08 + entry * 0.18;
      walker.scale.setScalar(1 - entry * 0.55);
      gate = 1;
      if (entry >= 1) {
        phase = "invitation";
        invitation.toggle();
        emit();
      }
    }
    if (phase === "invitation" && active)
      reveal = Math.min(1, reveal + dt * 0.65);
    door.position.z = 0.087 + 0.29 * gate;
    const pulse = reduced ? 1 : 0.7 + 0.3 * Math.sin(time * 0.003);
    guide.visible = phase === "castle";
    guide.scale.setScalar(0.85 + 0.15 * pulse);
    glow.emissiveIntensity = (lights ? 0.8 : 0.12) + gate * 0.3;
    const s = 1 - 0.48 * reveal;
    castle.scale.setScalar(s);
    castle.position.y = -0.44 * reveal;
    for (let i = 0; i < sparkles.length; i++) {
      const p = sparkles[i];
      p.position.set(
        Math.sin(i * 2.4) * 0.67,
        Math.cos(i * 1.71) * 0.64,
        reduced ? 0.36 : 0.1 + ((i / 28 + time * 0.00003) % 1) * 0.7,
      );
    }
    for (const [m, opacity] of materials) {
      m.opacity = opacity * visibility;
      m.transparent = visibility < 0.999;
      m.depthWrite = visibility > 0.9;
    }
    invitation.root.visible = reveal > 0;
    invitation.root.position.z =
      0.28 +
      0.08 * reveal +
      (reduced ? 0 : 0.012 * Math.sin(time * 0.0008)) * reveal;
    invitation.root.scale.setScalar(0.6 + 0.4 * reveal);
    invitation.update(time, visibility * reveal, camera);
    root.userData.kind = "castle-invitation";
    root.userData.phase = phase;
    return phase === "invitation" ? reveal : 0;
  }
  return {
    root,
    kind: "castle-invitation",
    update,
    move(vector) {
      input = vector;
      destination = null;
    },
    walkTo(point) {
      if (phase !== "castle") return;
      const p = castle.worldToLocal(point.clone());
      destination = {
        x: THREE.MathUtils.clamp(p.x, -0.58, 0.58),
        y: THREE.MathUtils.clamp(p.y, -0.62, 0.08),
      };
      input = { x: 0, y: 0 };
    },
    restartGame() {
      if (invitation.interaction.opened) invitation.toggle();
      phase = "castle";
      gate = entry = reveal = 0;
      input = { x: 0, y: 0 };
      destination = null;
      walker.position.set(0, -0.63, 0.084);
      walker.scale.setScalar(1);
      emit();
    },
    get acceptEnabled() {
      return phase === "invitation" && reveal > 0.9 && invitation.acceptEnabled;
    },
    toggle() {
      if (phase === "invitation") return invitation.toggle();
      lights = !lights;
      return this.interaction;
    },
    get interaction() {
      return phase === "invitation"
        ? invitation.interaction
        : {
            kind: "castle-invitation",
            opened: false,
            label:
              phase === "entering"
                ? "城门已开启"
                : lights
                  ? "调暗庄园灯光"
                  : "点亮庄园灯光",
            message:
              phase === "entering"
                ? "城门已打开 · 正在迎接宾客"
                : "先操控小人走进城堡，解锁3D邀请函",
          };
    },
  };
}
