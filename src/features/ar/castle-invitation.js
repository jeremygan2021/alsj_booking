import * as THREE from "three";
import { createInvitationPresentation } from "./invitation-presentation.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createCastleSurfaces, scaleSurfaceUVs } from "./castle-surfaces.js";
import { createCastleLife } from "./castle-life.js";
import { createCastleGameplay } from "./castle-gameplay.js";
import {
  CASTLE_VIEWS,
  INVITATION_VIEWS,
  createCastleViewRig,
} from "./castle-views.js";

export async function createCastleInvitation(clue, onGameChange, onSound) {
  const invitation = await createInvitationPresentation(clue);
  const root = new THREE.Group(),
    stage = new THREE.Group(),
    castle = new THREE.Group();
  stage.name = "Tracked_Castle_View_Rig";
  castle.name = "Thorne_Castle";
  stage.add(castle);
  root.add(stage, invitation.root);
  root.name = "Thorne_Estate_AR_Experience";
  // Local XY is the physical QR plane; tower height is local +Z.
  const surfaces = createCastleSurfaces();
  const { stone, trim, roof, brass, snow, glow, dark, coat, scarf } = surfaces;
  const add = (geo, mat, parent = castle) => {
    const m = new THREE.Mesh(scaleSurfaceUVs(geo, mat), mat);
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
  box(0.2, 0.06, 0.026, 0, -0.065, 0.399, trim);
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
  hallRoof.geometry.rotateY(Math.PI / 4);
  hallRoof.rotation.y = 0;
  hallRoof.scale.set(0.96, 1, 0.86);
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
      window.userData.action = "castleLights";
      for (let k = 0; k < 3; k++)
        cylinder(0.101, 0.006, x, y, 0.145 + k * 0.108, snow);
    }
  for (const x of [-0.15, 0, 0.15]) {
    const window = box(0.04, 0.01, 0.073, x, 0.129, 0.27, glow);
    window.userData.action = "castleLights";
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
    lantern.userData.action = "castleLights";
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
  walker.name = "Estate_Guest";
  walker.position.set(0, -0.63, 0.094);
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
  // Lapels, a woven scarf, gloves, eyes and a small travel satchel read at close range.
  box(0.054, 0.016, 0.014, 0, 0.026, 0.119, scarf, walker);
  box(0.013, 0.009, 0.046, 0.013, 0.028, 0.097, scarf, walker);
  for (const x of [-0.01, 0.01]) {
    const eye = add(new THREE.SphereGeometry(0.003, 8, 6), dark, walker);
    eye.position.set(x, 0.026, 0.15);
    box(0.009, 0.006, 0.038, x * 1.2, 0.022, 0.09, dark, walker).rotation.y =
      x * 8;
  }
  const nose = add(new THREE.SphereGeometry(0.005, 8, 6), skin, walker);
  nose.position.set(0, 0.029, 0.142);
  for (const z of [0.074, 0.09, 0.105]) {
    const button = add(new THREE.SphereGeometry(0.0035, 8, 6), brass, walker);
    button.position.set(0, 0.025, z);
  }
  for (const [index, arm] of [
    [1, limbs[1]],
    [3, limbs[3]],
  ]) {
    const glove = add(new THREE.SphereGeometry(0.01, 10, 6), dark, arm);
    glove.position.z = -0.047;
    if (index === 3) box(0.035, 0.017, 0.028, 0.009, 0, -0.067, dark, arm);
  }
  const shadowMap = document.createElement("canvas");
  shadowMap.width = shadowMap.height = 64;
  const shadowContext = shadowMap.getContext("2d");
  const shadowGradient = shadowContext.createRadialGradient(
    32,
    32,
    3,
    32,
    32,
    32,
  );
  shadowGradient.addColorStop(0, "rgba(8,19,24,.45)");
  shadowGradient.addColorStop(1, "rgba(8,19,24,0)");
  shadowContext.fillStyle = shadowGradient;
  shadowContext.fillRect(0, 0, 64, 64);
  const contactShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.11, 0.085),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(shadowMap),
      transparent: true,
      depthWrite: false,
    }),
  );
  contactShadow.position.z = -0.003;
  walker.add(contactShadow);
  const guide = new THREE.Group();
  castle.add(guide);
  guide.position.set(0, -0.17, 0.096);
  const ring = add(new THREE.TorusGeometry(0.105, 0.006, 6, 32), brass, guide);
  batchCastleArchitecture(walker, new Set([contactShadow]));
  const snowfall = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.005, 4, 4),
    snow,
    28,
  );
  snowfall.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  snowfall.frustumCulled = false;
  castle.add(snowfall);
  const snowflake = new THREE.Object3D();
  addCastleDetails({
    castle,
    add,
    box,
    cylinder,
    stone,
    trim,
    roof,
    brass,
    snow,
    glow,
    dark,
    coat,
  });
  batchCastleArchitecture(castle, new Set([snowfall]));
  const reduced =
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  const gameplay = createCastleGameplay(castle, surfaces, reduced);
  const life = createCastleLife(castle, surfaces, reduced);
  const materials = new Map();
  castle.traverse((o) => {
    if (o.material)
      materials.set(o.material, {
        opacity: o.material.opacity,
        transparent: o.material.transparent,
        depthWrite: o.material.depthWrite,
      });
  });
  const viewRig = createCastleViewRig(stage, reduced);
  let castleViewIndex = 0,
    invitationViewIndex = 0,
    zoom = 1;
  const currentView = () =>
    phase === "invitation"
      ? INVITATION_VIEWS[invitationViewIndex]
      : CASTLE_VIEWS[castleViewIndex];
  let phase = "castle",
    input = { x: 0, y: 0 },
    destination = null,
    last = null,
    gate = 0,
    entry = 0,
    reveal = 0,
    lights = true,
    walkClock = 0,
    footstep = 0,
    revealStarted = false;
  const snapshot = () => ({
    phase,
    unlocked: phase === "invitation",
    view: currentView(),
    zoom,
    adventure: gameplay.state,
    nextView: (phase === "invitation" ? INVITATION_VIEWS : CASTLE_VIEWS)[
      ((phase === "invitation" ? invitationViewIndex : castleViewIndex) + 1) %
        (phase === "invitation" ? INVITATION_VIEWS.length : CASTLE_VIEWS.length)
    ],
    instruction:
      phase === "castle"
        ? "收集星光，避开冰刺 · 走进城门解锁邀请"
        : phase === "entering"
          ? "城门已开启 · 小人正在入场"
          : "庄园之邀已解锁 · 轻触启封或接受邀请",
  });
  const emit = () => onGameChange?.(snapshot());
  emit();
  function update(time, visibility = 1, camera, trackingActive = true) {
    const dt = Math.max(
      0,
      Math.min(0.064, last === null ? 0.016 : (time - last) / 1000),
    );
    last = time;
    const active = visibility > 0.8 && trackingActive;
    life.update(dt, active, phase !== "castle" || gate > 0.5);
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
      const previousGate = gate;
      gate = THREE.MathUtils.clamp(gate + (nearDoor ? dt * 1.6 : -dt), 0, 1);
      if (previousGate === 0 && gate > 0) onSound?.("gate");
      const insideWall = Math.abs(x) < 0.49 && y > -0.145 && y < 0.59;
      // Reserve the figure's shoulder radius within the physical door opening.
      const doorway = Math.abs(x) < 0.046 && y < 0.1 && gate > 0.82;
      const towerCollision = [-0.43, 0.43].some((tx) =>
        [-0.055, 0.51].some((ty) => Math.hypot(x - tx, y - ty) < 0.14),
      );
      if ((!insideWall || doorway) && !towerCollision) {
        const moved =
          Math.hypot(x - walker.position.x, y - walker.position.y) > 0.0001;
        walker.position.x = x;
        walker.position.y = y;
        walker.position.z = Math.abs(x) < 0.11 && y < -0.14 ? 0.094 : 0.074;
        if (moved) {
          footstep += dt;
          if (footstep >= 0.28) {
            footstep = 0;
            onSound?.("step");
          }
        }
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
      if (Math.abs(walker.position.x) < 0.046 && walker.position.y > -0.09) {
        phase = "entering";
        onSound?.("enter");
        input = { x: 0, y: 0 };
        destination = null;
        emit();
      }
    }
    if (phase === "castle") {
      const adventure = gameplay.update(dt, walker.position, active);
      const ground =
        Math.abs(walker.position.x) < 0.11 && walker.position.y < -0.14
          ? 0.094
          : 0.074;
      walker.position.z = ground + adventure.jumpHeight;
      if (adventure.hit) {
        walker.position.set(0, -0.63, 0.094);
        destination = null;
        input = { x: 0, y: 0 };
        onSound?.("hurt");
      }
      if (adventure.collectedNow) onSound?.("collect");
      walker.scale.setScalar(adventure.immune ? 0.97 : 1);
    } else gameplay.finish();
    walker.visible = phase !== "invitation";
    if (phase === "entering" && active) {
      entry = Math.min(1, entry + dt);
      walker.position.y = -0.08 + entry * 0.18;
      walker.position.z = 0.074;
      walker.scale.setScalar(1 - entry * 0.55);
      gate = 1;
      if (entry >= 1) {
        phase = "invitation";
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
    const compact = THREE.MathUtils.smoothstep(reveal, 0, 0.45);
    const s = 1 - 0.58 * compact;
    castle.scale.setScalar(s);
    castle.position.y = -0.6 * compact;
    for (let i = 0; i < 28; i++) {
      snowflake.position.set(
        Math.sin(i * 2.4) * 0.67,
        Math.cos(i * 1.71) * 0.64,
        reduced ? 0.36 : 0.1 + ((i / 28 + time * 0.00003) % 1) * 0.7,
      );
      snowflake.updateMatrix();
      snowfall.setMatrixAt(i, snowflake.matrix);
    }
    snowfall.instanceMatrix.needsUpdate = true;
    for (const [m, original] of materials) {
      m.opacity = original.opacity * visibility;
      m.transparent = original.transparent || visibility < 0.999;
      m.depthWrite = original.depthWrite && visibility > 0.9;
    }
    viewRig.update(
      CASTLE_VIEWS[castleViewIndex],
      walker.position,
      dt,
      phase !== "invitation",
      zoom,
    );
    root.userData.viewMatrix = stage.matrix.elements;
    root.userData.guestPosition = walker.position.toArray();
    const invitationReveal = THREE.MathUtils.smoothstep(reveal, 0.45, 1);
    if (invitationReveal > 0 && !revealStarted) {
      revealStarted = true;
      invitation.toggle();
      onSound?.("open");
    }
    invitation.root.visible = invitationReveal > 0;
    invitation.root.position.z =
      0.5 +
      0.1 * invitationReveal +
      (reduced ? 0 : 0.012 * Math.sin(time * 0.0008)) * invitationReveal;
    invitation.root.scale.setScalar(0.6 + 0.4 * invitationReveal);
    invitation.update(
      time,
      visibility * invitationReveal,
      camera,
      currentView().id,
      zoom,
    );
    root.userData.kind = "castle-invitation";
    root.userData.phase = phase;
    return phase === "invitation" ? reveal : 0;
  }
  return {
    root,
    get experienceState() {
      return snapshot();
    },
    kind: "castle-invitation",
    update,
    changeZoom(delta) {
      zoom =
        Math.round(THREE.MathUtils.clamp(zoom + delta, 0.65, 1.6) * 100) / 100;
      emit();
      return snapshot();
    },
    greet() {
      if (phase === "castle") {
        gameplay.hint();
        onSound?.("hint");
        emit();
      }
    },
    jump() {
      if (phase === "castle" && gameplay.jump()) onSound?.("jump");
    },
    cycleView() {
      if (phase === "invitation")
        invitationViewIndex =
          (invitationViewIndex + 1) % INVITATION_VIEWS.length;
      else castleViewIndex = (castleViewIndex + 1) % CASTLE_VIEWS.length;
      input = { x: 0, y: 0 };
      destination = null;
      emit();
      return snapshot();
    },
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
      if (Math.abs(destination.x) < 0.49 && destination.y > -0.145)
        destination.x = THREE.MathUtils.clamp(destination.x, -0.04, 0.04);
      input = { x: 0, y: 0 };
    },
    restartGame() {
      if (invitation.interaction.opened) invitation.toggle();
      phase = "castle";
      gate = entry = reveal = 0;
      revealStarted = false;
      castleViewIndex = invitationViewIndex = 0;
      zoom = 1;
      gameplay.reset();
      walker.rotation.z = 0;
      input = { x: 0, y: 0 };
      destination = null;
      walker.position.set(0, -0.63, 0.094);
      walker.scale.setScalar(1);
      emit();
    },
    get acceptEnabled() {
      return phase === "invitation" && reveal > 0.9 && invitation.acceptEnabled;
    },
    toggle() {
      if (phase === "invitation") {
        revealStarted = true;
        const next = invitation.toggle();
        onSound?.(next.opened ? "open" : "close");
        return next;
      }
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

function addCastleDetails({
  castle,
  add,
  box,
  cylinder,
  stone,
  trim,
  roof,
  brass,
  snow,
  glow,
  dark,
  coat,
}) {
  // Cut stone voussoirs form an actual rounded gateway, with an open centre.
  for (let i = 0; i < 11; i++) {
    const a = (i * Math.PI) / 11 + 0.018,
      b = ((i + 1) * Math.PI) / 11 - 0.018;
    const shape = new THREE.Shape();
    shape.moveTo(Math.cos(a) * 0.096, Math.sin(a) * 0.096);
    shape.lineTo(Math.cos(a) * 0.126, Math.sin(a) * 0.126);
    shape.lineTo(Math.cos(b) * 0.126, Math.sin(b) * 0.126);
    shape.lineTo(Math.cos(b) * 0.096, Math.sin(b) * 0.096);
    shape.closePath();
    const arch = add(
      new THREE.ExtrudeGeometry(shape, { depth: 0.067, bevelEnabled: false }),
      trim,
    );
    arch.rotation.x = Math.PI / 2;
    arch.position.set(0, -0.03, 0.272);
  }
  for (const x of [-0.113, 0.113]) {
    for (let z = 0.114; z < 0.27; z += 0.042)
      box(0.034, 0.067, 0.039, x, -0.065, z, trim);
    box(0.044, 0.076, 0.018, x, -0.065, 0.086, brass);
  }
  const archedWindow = (
    x,
    y,
    z,
    rotation = 0,
    width = 0.057,
    height = 0.095,
  ) => {
    const group = new THREE.Group();
    castle.add(group);
    group.position.set(x, y, z);
    group.rotation.z = rotation;
    group.userData.action = "castleLights";
    const shape = new THREE.Shape();
    const r = width / 2;
    shape.moveTo(-r, 0);
    shape.lineTo(r, 0);
    shape.lineTo(r, height - r);
    shape.absarc(0, height - r, r, 0, Math.PI, false);
    shape.closePath();
    const frame = add(
      new THREE.ExtrudeGeometry(shape, { depth: 0.009, bevelEnabled: false }),
      brass,
      group,
    );
    frame.rotation.x = Math.PI / 2;
    const pane = add(new THREE.ShapeGeometry(shape), glow, group);
    pane.rotation.x = Math.PI / 2;
    pane.scale.set(0.79, 0.86, 1);
    pane.position.set(0, -0.01, 0.006);
    box(0.004, 0.005, height * 0.8, 0, -0.013, height * 0.43, dark, group);
    box(width * 0.82, 0.005, 0.004, 0, -0.013, height * 0.46, dark, group);
    box(width * 1.4, 0.024, 0.012, 0, -0.006, -0.007, trim, group);
    // Bake static window subgroups into the castle batch below.
    for (const child of [...group.children]) castle.attach(child);
    castle.remove(group);
  };
  for (const x of [-0.43, 0.43])
    for (const y of [-0.055, 0.51]) {
      cylinder(0.103, 0.031, x, y, 0.097, trim);
      cylinder(0.104, 0.018, x, y, 0.471, trim);
      for (let k = 0; k < 8; k++) {
        const angle = (k * Math.PI) / 4;
        const corbel = box(
          0.025,
          0.026,
          0.036,
          x + Math.sin(angle) * 0.09,
          y + Math.cos(angle) * 0.09,
          0.45,
          trim,
        );
        corbel.rotation.z = -angle;
      }
      archedWindow(x, y - 0.097, 0.3);
      archedWindow(
        x + (x < 0 ? -0.097 : 0.097),
        y,
        0.29,
        x < 0 ? -Math.PI / 2 : Math.PI / 2,
      );
      const snowRoof = add(new THREE.ConeGeometry(0.078, 0.11, 16), snow);
      snowRoof.rotation.x = Math.PI / 2;
      snowRoof.position.set(x, y, 0.625);
      cylinder(0.003, 0.115, x, y, 0.745, brass);
      const flagShape = new THREE.Shape();
      flagShape.moveTo(0, 0);
      flagShape.lineTo(0.083, -0.004);
      flagShape.lineTo(0.064, -0.03);
      flagShape.lineTo(0.083, -0.058);
      flagShape.lineTo(0, -0.058);
      flagShape.closePath();
      const flag = add(new THREE.ShapeGeometry(flagShape), coat);
      flag.material = coat;
      coat.side = THREE.DoubleSide;
      flag.rotation.x = Math.PI / 2;
      flag.position.set(x + 0.003, y, 0.796);
    }
  for (const x of [-0.15, 0, 0.15])
    archedWindow(x, 0.126, 0.234, 0, 0.057, 0.097);
  for (const x of [-0.212, 0.212])
    for (const y of [0.24, 0.4])
      archedWindow(x, y, 0.237, x < 0 ? -Math.PI / 2 : Math.PI / 2);
  // Buttresses and snow-dusted crenellations give walls depth in oblique views.
  for (const x of [-0.31, -0.2, 0.2, 0.31]) {
    box(0.036, 0.071, 0.26, x, -0.071, 0.21, trim);
    box(0.05, 0.083, 0.011, x, -0.071, 0.345, snow);
  }
  for (const y of [0.045, 0.17, 0.295, 0.42])
    for (const x of [-0.409, 0.409]) {
      box(0.073, 0.033, 0.23, x, y, 0.195, trim);
      box(0.079, 0.044, 0.009, x, y, 0.318, snow);
      box(0.075, 0.065, 0.045, x, y, 0.377, stone);
      box(0.077, 0.067, 0.009, x, y, 0.404, snow);
    }
  for (let x = -0.33; x <= 0.34; x += 0.11) {
    box(0.065, 0.069, 0.046, x, 0.51, 0.394, stone);
    box(0.069, 0.073, 0.009, x, 0.51, 0.422, snow);
  }
  for (const x of [-0.25, 0.25]) {
    box(0.316, 0.068, 0.016, x, -0.065, 0.35, trim);
    box(0.32, 0.072, 0.01, x, -0.065, 0.363, snow);
  }
  box(0.88, 0.071, 0.017, 0, 0.51, 0.372, trim);
  box(0.48, 0.4, 0.022, 0, 0.31, 0.351, trim);
  for (const x of [-0.105, 0.105]) {
    box(0.061, 0.055, 0.085, x, 0.247, 0.429, stone);
    const dormer = add(new THREE.ConeGeometry(0.057, 0.044, 4), roof);
    dormer.geometry.rotateY(Math.PI / 4);
    dormer.rotation.x = Math.PI / 2;
    dormer.position.set(x, 0.247, 0.489);
    archedWindow(x, 0.218, 0.412, 0, 0.028, 0.045);
  }
  box(0.054, 0.059, 0.15, 0.145, 0.388, 0.477, stone);
  box(0.069, 0.074, 0.017, 0.145, 0.388, 0.557, trim);
  box(0.049, 0.054, 0.003, 0.145, 0.388, 0.567, dark);
  box(0.072, 0.076, 0.008, 0.145, 0.388, 0.575, snow);
  // Courtyard paving, a frozen fountain, clipped hedges and wooden benches.
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 7; col++)
      box(
        0.096,
        0.054,
        0.005,
        -0.3 + col * 0.1,
        -0.014 + row * 0.06,
        0.078,
        trim,
      );
  cylinder(0.068, 0.02, -0.25, 0.086, 0.091, trim, castle, 24);
  cylinder(0.053, 0.006, -0.25, 0.086, 0.105, roof, castle, 24);
  cylinder(0.01, 0.064, -0.25, 0.086, 0.138, brass);
  const bowl = add(new THREE.TorusGeometry(0.031, 0.007, 8, 24), trim);
  bowl.position.set(-0.25, 0.086, 0.162);
  cylinder(0.027, 0.004, -0.25, 0.086, 0.162, snow);
  for (const x of [-0.3, 0.3]) {
    for (const y of [-0.42, -0.32]) {
      const hedge = add(new THREE.SphereGeometry(0.045, 12, 8), roof);
      hedge.position.set(x, y, 0.112);
      hedge.scale.z = 0.7;
      const frost = add(new THREE.SphereGeometry(0.035, 10, 6), snow);
      frost.position.set(x, y, 0.132);
      frost.scale.z = 0.24;
    }
    for (const z of [0.113, 0.144]) box(0.12, 0.025, 0.008, x, 0.067, z, dark);
    for (const dx of [-0.045, 0.045])
      box(0.008, 0.037, 0.044, x + dx, 0.067, 0.099, brass);
  }
  // Path edging and lantern housings stay distinct from the walkable surface.
  for (const x of [-0.111, 0.111])
    box(0.011, 0.53, 0.008, x, -0.404, 0.082, snow);
  for (const x of [-0.29, 0.29]) {
    for (const z of [0.192, 0.252]) box(0.052, 0.048, 0.009, x, -0.25, z, dark);
    for (const dx of [-0.019, 0.019])
      box(0.004, 0.04, 0.055, x + dx, -0.25, 0.222, brass);
    const cap = add(new THREE.ConeGeometry(0.037, 0.025, 4), roof);
    cap.geometry.rotateY(Math.PI / 4);
    cap.rotation.x = Math.PI / 2;
    cap.position.set(x, -0.25, 0.27);
  }
}

// Hundreds of stone/roof details share a handful of draw calls on phones.
// Animated groups and walkable hit targets retain their own transforms/actions.
function batchCastleArchitecture(castle, excluded) {
  const batches = new Map();
  for (const object of [...castle.children]) {
    if (!object.isMesh || excluded.has(object)) continue;
    object.updateMatrix();
    const key = `${object.material.uuid}:${object.userData.action || "castleLights"}`;
    if (!batches.has(key))
      batches.set(key, {
        material: object.material,
        action: object.userData.action || "castleLights",
        geometries: [],
      });
    const baked = object.geometry.index
      ? object.geometry.toNonIndexed()
      : object.geometry.clone();
    batches.get(key).geometries.push(baked.applyMatrix4(object.matrix));
    castle.remove(object);
    object.geometry.dispose();
  }
  for (const { material, action, geometries } of batches.values()) {
    const geometry = mergeGeometries(geometries);
    geometries.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `Castle_Architecture_${action}`;
    mesh.userData.action = action;
    castle.add(mesh);
  }
}
