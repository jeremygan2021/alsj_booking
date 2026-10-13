import { test } from "node:test";
import assert from "node:assert/strict";
import { Matrix4, Vector3, Quaternion } from "three";
import { PoseStabilizer } from "../src/features/ar/pose-stabilizer.js";
const pose = (x) =>
  new Matrix4().compose(
    new Vector3(x, 0, -3),
    new Quaternion(),
    new Vector3(1, 1, 1),
  );
test("墙面定位过滤高频抖动和单帧跳变，持续真实移动仍能跟随", () => {
  const filter = new PoseStabilizer();
  filter.sample(pose(0), 0);
  let rawTravel = 0,
    filteredTravel = 0,
    previousRaw = 0,
    previousFiltered = 0;
  for (let i = 1; i < 100; i++) {
    const raw = i % 2 ? 0.025 : -0.025;
    filter.sample(pose(raw), i * 16);
    const filtered = filter.render(0.016).elements[12];
    rawTravel += Math.abs(raw - previousRaw);
    filteredTravel += Math.abs(filtered - previousFiltered);
    previousRaw = raw;
    previousFiltered = filtered;
  }
  assert.ok(filteredTravel < rawTravel * 0.2);
  filter.sample(pose(4), 1600);
  assert.ok(Math.abs(filter.render(0.016).elements[12]) < 0.05);
  for (let i = 0; i < 60; i++) {
    filter.sample(pose((i / 60) * 0.2), 1700 + i * 16);
    filter.render(0.016);
  }
  assert.ok(filter.render(0.016).elements[12] > 0.17);
  filter.reset();
  filter.sample(pose(2), 3000);
  assert.equal(filter.render(0.016).elements[12], 2);
});
