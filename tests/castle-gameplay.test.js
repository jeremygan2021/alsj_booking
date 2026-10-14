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

test("friendly traps assist jumping, never rewind the guest, and pause with tracking loss", () => {
  const game = adventure();
  const safe = new THREE.Vector3(0, -0.63, 0.094);
  game.update(4.3, safe, true);
  const guest = new THREE.Vector3(0, -0.39, 0.094);
  assert.equal(game.update(0.01, guest, true).assistedJump, true);
  const airborne = game.update(0.3, guest, true);
  assert.ok(airborne.jumpHeight > 0.1);
  const paused = game.update(30, guest, false);
  assert.equal(paused.jumpHeight, airborne.jumpHeight);
  assert.equal(guest.y, -0.39);
  assert.equal("health" in game.state, false);
  game.reset();
  assert.equal(game.state.jumpReady, true);
  assert.equal(game.jump(), true);
  assert.equal(game.jump(), false);
});

test("automatic arrival clears even dormant traps and picks up stars beside the path", () => {
  const game = adventure();
  game.update(0.01, new THREE.Vector3(0, -0.63, 0.094), true);
  assert.equal(game.state.collected, 0);
  const star = game.update(
    0.01,
    new THREE.Vector3(0, -0.56, 0.094),
    true,
    true,
  );
  assert.equal(star.collectedNow, true);
  assert.equal(game.state.collected, 1);
  const crossing = game.update(
    0.01,
    new THREE.Vector3(0, -0.47, 0.094),
    true,
    true,
  );
  assert.equal(crossing.assistedJump, true);
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
