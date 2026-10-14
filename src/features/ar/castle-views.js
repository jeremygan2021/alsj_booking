import * as THREE from "three";

export const CASTLE_VIEWS = [
  {
    id: "overview",
    label: "庄园全景",
    eye: [-1.7, -2.8, 2.5],
    focus: [0, 0.04, 0.26],
    scale: 0.72,
  },
  {
    id: "gate",
    label: "城门近景",
    eye: [0.6, -3, 1.5],
    focus: [0, -0.12, 0.25],
    scale: 1.65,
  },
  { id: "guest", label: "小人跟随", eye: [0.7, -3, 1.9], scale: 2.7 },
  {
    id: "courtyard",
    label: "庭院鸟瞰",
    eye: [1.5, -1.4, 3.5],
    focus: [0, 0.12, 0.16],
    scale: 0.85,
  },
  { id: "marker", label: "实景原位", focus: [0, 0, 0], scale: 1 },
];

export const INVITATION_VIEWS = [
  { id: "rotate", label: "邀请函环绕" },
  { id: "front", label: "海报正面" },
  { id: "back", label: "邀请函背面" },
  { id: "seal", label: "信封细节" },
];

// The tracked anchor and physical camera never change. Only this child rig
// receives a fixed view offset, so real phone motion retains AR parallax.
export function createCastleViewRig(stage, reducedMotion = false) {
  const targetRotation = new THREE.Quaternion();
  const focus = new THREE.Vector3();
  const position = new THREE.Vector3();
  const look = new THREE.Matrix4();
  const up = new THREE.Vector3(0, 0, 1);
  const origin = new THREE.Vector3(0, 0.03, 0.14);
  let initialized = false;
  return {
    update(view, guest, dt, enabled = true, zoom = 1) {
      if (!enabled || view.id === "marker") {
        targetRotation.identity();
        position.set(0, 0, 0);
      } else {
        // The guest view follows position, never heading: controls stay stable.
        focus.copy(
          view.id === "guest" ? guest : new THREE.Vector3(...view.focus),
        );
        if (view.id === "guest") focus.z += 0.1;
        look.lookAt(new THREE.Vector3(...view.eye), new THREE.Vector3(), up);
        targetRotation.setFromRotationMatrix(look).invert();
        position
          .copy(focus)
          .multiplyScalar(view.scale * zoom)
          .applyQuaternion(targetRotation)
          .negate()
          .add(origin);
      }
      const scale = enabled ? view.scale * zoom : 1;
      const blend = reducedMotion || !initialized ? 1 : 1 - Math.exp(-dt * 9);
      stage.quaternion.slerp(targetRotation, blend);
      stage.position.lerp(position, blend);
      stage.scale.lerp(new THREE.Vector3(scale, scale, scale), blend);
      stage.updateWorldMatrix(true, true);
      initialized = true;
    },
  };
}
