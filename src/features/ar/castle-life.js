import * as THREE from "three";

export function createCastleLife(castle, surfaces, reducedMotion) {
  const staff = [];
  const skin = new THREE.MeshStandardMaterial({
    color: 0xd7b38f,
    roughness: 0.8,
  });
  const uniform = new THREE.MeshStandardMaterial({
    color: 0x255048,
    roughness: 0.8,
  });
  for (const side of [-1, 1]) {
    const person = new THREE.Group();
    person.name = "Estate_Steward";
    person.userData.action = "castleGuide";
    castle.add(person);
    person.position.set(side * 0.23, -0.18, 0.078);
    person.scale.setScalar(0.8);
    const mesh = (geometry, material, x, y, z, parent = person) => {
      const object = new THREE.Mesh(geometry, material);
      object.position.set(x, y, z);
      parent.add(object);
      return object;
    };
    const cylinder = (r, h, z, material) => {
      const object = mesh(
        new THREE.CylinderGeometry(r, r, h, 12),
        material,
        0,
        0,
        z,
      );
      object.rotation.x = Math.PI / 2;
      return object;
    };
    cylinder(0.025, 0.075, 0.085, uniform);
    mesh(new THREE.SphereGeometry(0.026, 12, 8), skin, 0, 0, 0.145);
    cylinder(0.031, 0.012, 0.17, surfaces.dark);
    cylinder(0.025, 0.018, 0.182, surfaces.dark);
    for (const x of [-0.012, 0.012]) {
      mesh(
        new THREE.BoxGeometry(0.016, 0.027, 0.043),
        surfaces.dark,
        x,
        0,
        0.026,
      );
      mesh(
        new THREE.SphereGeometry(0.003, 6, 4),
        surfaces.dark,
        x * 0.8,
        -0.025,
        0.15,
      );
    }
    mesh(
      new THREE.BoxGeometry(0.007, 0.009, 0.044),
      surfaces.brass,
      0,
      -0.025,
      0.094,
    );
    const arm = new THREE.Group();
    person.add(arm);
    arm.position.set(side * 0.032, 0, 0.111);
    const sleeve = mesh(
      new THREE.CylinderGeometry(0.009, 0.009, 0.05, 10),
      uniform,
      0,
      0,
      -0.022,
      arm,
    );
    sleeve.rotation.x = Math.PI / 2;
    mesh(new THREE.SphereGeometry(0.009, 8, 6), skin, 0, 0, -0.047, arm);
    const otherArm = sleeve.clone();
    person.add(otherArm);
    otherArm.position.set(-side * 0.032, 0, 0.087);
    staff.push({ person, arm, side });
  }
  let clock = 0;
  return {
    update(dt, active, welcoming) {
      if (active) clock += dt;
      for (const { person, arm, side } of staff) {
        person.rotation.z =
          side * (0.22 + (reducedMotion ? 0 : Math.sin(clock * 0.55) * 0.12));
        arm.rotation.y = side * (welcoming ? 2.1 : 0.28);
        arm.rotation.x = reducedMotion
          ? 0
          : (welcoming ? 0.35 : 0.08) * Math.sin(clock * 2.4);
      }
    },
  };
}
