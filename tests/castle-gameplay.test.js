import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createCastleGameplay } from "../src/features/ar/castle-gameplay.js";
import {
  CASTLE_VIEWS,
  createCastleViewRig,
} from "../src/features/ar/castle-views.js";

function adventure() {
  return createCastleGameplay(
    new THREE.Group(),
    {
      dark: new THREE.MeshStandardMaterial(),
      brass: new THREE.MeshStandardMaterial(),
    },
    true,
  );
}

test("ice traps pause with tracking loss, jumping clears spikes, damage has a grace period", () => {
  const game = adventure();
  const safe = new THREE.Vector3(0, -0.63, 0.094);
  game.update(2.45, safe, true);
  assert.equal(game.jump(), true);
  assert.equal(game.jump(), false);
  const airborne = game.update(0.3, new THREE.Vector3(0, -0.39, 0.094), true);
  assert.ok(airborne.jumpHeight > 0.1);
  assert.equal(airborne.hit, false);
  assert.equal(game.state.health, 3);
  const paused = game.update(30, safe, false);
  assert.equal(paused.jumpHeight, airborne.jumpHeight);
  game.update(0.46, safe, true);
  assert.equal(
    game.update(0.01, new THREE.Vector3(0, -0.39, 0.094), true).hit,
    true,
  );
  assert.equal(game.state.health, 2);
  assert.equal(
    game.update(0.01, new THREE.Vector3(0, -0.39, 0.094), true).hit,
    false,
  );
  assert.equal(game.state.health, 2);
  game.reset();
  assert.equal(game.state.health, 3);
  assert.equal(game.state.jumpReady, true);
});

test("each star is collected once and restart restores every collectible", () => {
  const game = adventure();
  for (const [x, y] of [
    [-0.17, -0.56],
    [0.19, -0.37],
    [0, -0.19],
  ]) {
    const position = new THREE.Vector3(x, y, 0.094);
    assert.equal(game.update(0.01, position, false).collectedNow, false);
    assert.equal(game.update(0.01, position, true).collectedNow, true);
    assert.equal(game.update(0.01, position, true).collectedNow, false);
  }
  assert.equal(game.state.collected, 3);
  game.reset();
  assert.equal(game.state.collected, 0);
  assert.equal(
    game.update(0.01, new THREE.Vector3(-0.17, -0.56, 0.094), true)
      .collectedNow,
    true,
  );
});

test("fixed views inherit real anchor motion; guest focus is stable across zoom and heading", () => {
  const anchor = new THREE.Group(),
    stage = new THREE.Group();
  anchor.add(stage);
  const rig = createCastleViewRig(stage, true);
  const guest = new THREE.Vector3(0.13, -0.4, 0.094);
  rig.update(CASTLE_VIEWS[2], guest, 0.016, true, 1.6);
  const focus = guest.clone();
  focus.z += 0.1;
  const world = stage.localToWorld(focus.clone());
  assert.ok(world.distanceTo(new THREE.Vector3(0, 0.03, 0.14)) < 1e-10);
  const localView = stage.matrix.clone();
  anchor.position.set(0.4, 0.3, -4);
  anchor.rotation.y = 0.4;
  rig.update(CASTLE_VIEWS[2], guest, 0.016, true, 1.6);
  assert.deepEqual(stage.matrix.elements, localView.elements);
  assert.ok(stage.localToWorld(focus.clone()).distanceTo(world) > 3);
  rig.update(CASTLE_VIEWS[4], guest, 0.016, true, 1);
  assert.ok(stage.quaternion.angleTo(new THREE.Quaternion()) < 1e-10);
  assert.equal(stage.position.length(), 0);
  assert.equal(stage.scale.x, 1);
});
