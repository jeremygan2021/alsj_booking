import * as THREE from "three";

export function createCastleGameplay(castle, surfaces, reducedMotion) {
  const root = new THREE.Group();
  root.name = "Courtyard_Adventure";
  castle.add(root);
  const traps = [];
  for (const [index, [x, y]] of [
    [0, [0, -0.39]],
    [1, [-0.22, -0.49]],
    [2, [0.23, -0.24]],
  ]) {
    const group = new THREE.Group();
    group.position.set(x, y, 0.087);
    group.userData.action = "walkCastle";
    root.add(group);
    const material = new THREE.MeshStandardMaterial({
      color: 0x527c85,
      emissive: 0x28545a,
      emissiveIntensity: 0.25,
      metalness: 0.25,
      roughness: 0.5,
    });
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(0.063, 0.067, 0.012, 20),
      surfaces.dark,
    );
    plate.rotation.x = Math.PI / 2;
    group.add(plate);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.056, 0.004, 6, 24),
      material,
    );
    rim.position.z = 0.009;
    group.add(rim);
    const spikes = new THREE.Group();
    group.add(spikes);
    for (let k = 0; k < 5; k++) {
      const angle = (k * Math.PI * 2) / 5;
      const spike = new THREE.Mesh(
        new THREE.ConeGeometry(0.012, 0.065, 6),
        material,
      );
      spike.rotation.x = Math.PI / 2;
      spike.position.set(
        Math.sin(angle) * 0.031,
        Math.cos(angle) * 0.031,
        0.037,
      );
      spikes.add(spike);
    }
    traps.push({ x, y, spikes, material, offset: index * 1.15, active: false });
  }
  const tokens = [
    [-0.17, -0.56],
    [0.19, -0.37],
    [0, -0.19],
  ].map(([x, y], index) => {
    const group = new THREE.Group();
    root.add(group);
    group.position.set(x, y, 0.155);
    group.userData.action = "walkCastle";
    const crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.021),
      new THREE.MeshStandardMaterial({
        color: 0x9aeadc,
        emissive: 0x4bc8b6,
        emissiveIntensity: 0.45,
        metalness: 0.35,
        roughness: 0.25,
      }),
    );
    group.add(crystal);
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.032, 0.002, 6, 20),
      surfaces.brass,
    );
    halo.rotation.x = Math.PI / 2;
    group.add(halo);
    return { group, x, y, index, taken: false };
  });
  let clock = 0,
    jumpStart = -Infinity,
    immuneUntil = 0,
    feedbackUntil = 0;
  let health = 3,
    collected = 0,
    feedback = "";
  const state = () => ({
    health,
    collected,
    total: tokens.length,
    jumpReady: clock - jumpStart >= 1.05,
    feedback: clock < feedbackUntil ? feedback : "",
  });
  return {
    get state() {
      return state();
    },
    hint() {
      feedback =
        collected === tokens.length
          ? "管家：星光集齐了，请进城门领取邀请函"
          : "管家：冰刺升起前会变金色，提前跳跃或绕行";
      feedbackUntil = clock + 3;
    },
    jump() {
      if (clock - jumpStart < 1.05) return false;
      jumpStart = clock;
      return true;
    },
    update(dt, position, active) {
      if (active) clock += dt;
      const jumpProgress = (clock - jumpStart) / 0.75;
      const jumpHeight =
        jumpProgress >= 0 && jumpProgress < 1
          ? Math.sin(jumpProgress * Math.PI) * 0.145
          : 0;
      let hit = false,
        collectedNow = false;
      for (const trap of traps) {
        const phase = (clock + trap.offset) % 4.4;
        const warning = phase >= 1.9 && phase < 2.6;
        trap.active = phase >= 2.6 && phase < 3.6;
        trap.spikes.scale.z = trap.active ? 1 : warning ? 0.18 : 0.025;
        trap.material.color.setHex(
          trap.active ? 0xe27365 : warning ? 0xe7b95e : 0x527c85,
        );
        trap.material.emissive.setHex(
          trap.active ? 0xb53429 : warning ? 0xa4742b : 0x28545a,
        );
        trap.material.emissiveIntensity = trap.active
          ? 0.8
          : warning
            ? 0.5
            : 0.18;
        if (
          active &&
          trap.active &&
          clock >= immuneUntil &&
          jumpHeight < 0.065 &&
          Math.hypot(position.x - trap.x, position.y - trap.y) < 0.081
        ) {
          hit = true;
          health--;
          immuneUntil = clock + 2;
          feedback =
            health > 0
              ? "碰到冰刺 · 已退回安全步道"
              : "体力恢复 · 从起点再试一次";
          if (health === 0) health = 3;
          feedbackUntil = clock + 2.2;
        }
      }
      for (const token of tokens) {
        if (
          active &&
          !hit &&
          !token.taken &&
          Math.hypot(position.x - token.x, position.y - token.y) < 0.065
        ) {
          token.taken = true;
          collected++;
          collectedNow = true;
          feedback =
            collected === tokens.length
              ? "星光集齐 · 庄园向你致意"
              : `拾取星光 · ${collected} / ${tokens.length}`;
          feedbackUntil = clock + 2;
        }
        token.group.visible = !token.taken;
        token.group.rotation.z = reducedMotion ? 0 : clock * 1.4;
        token.group.position.z =
          0.155 +
          (reducedMotion ? 0 : Math.sin(clock * 2 + token.index) * 0.009);
      }
      root.visible = true;
      return { jumpHeight, hit, collectedNow, immune: clock < immuneUntil };
    },
    finish() {
      root.visible = false;
      feedback = "";
      feedbackUntil = 0;
    },
    reset() {
      clock = collected = 0;
      health = 3;
      jumpStart = -Infinity;
      immuneUntil = feedbackUntil = 0;
      feedback = "";
      tokens.forEach((token) => {
        token.taken = false;
        token.group.visible = true;
      });
      root.visible = true;
    },
  };
}
