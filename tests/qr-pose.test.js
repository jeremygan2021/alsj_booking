import { test } from "node:test";
import assert from "node:assert/strict";
import { Euler, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from "three";
import { estimateQrPose } from "../src/features/ar/qr-pose.js";

const names = [
  "topLeftCorner",
  "topRightCorner",
  "bottomRightCorner",
  "bottomLeftCorner",
];
const corners = [
  new Vector3(-0.5, 0.5, 0),
  new Vector3(0.5, 0.5, 0),
  new Vector3(0.5, -0.5, 0),
  new Vector3(-0.5, -0.5, 0),
];
function projected(matrix, width, height, focalLength) {
  const camera = new PerspectiveCamera(
    (2 * Math.atan(height / (2 * focalLength)) * 180) / Math.PI,
    width / height,
    0.01,
    1000,
  );
  camera.updateMatrixWorld();
  return Object.fromEntries(
    corners.map((point, i) => {
      const p = point.clone().applyMatrix4(matrix).project(camera);
      return [
        names[i],
        { x: ((p.x + 1) * width) / 2, y: ((1 - p.y) * height) / 2 },
      ];
    }),
  );
}
const matrixFor = (translation, rotation = [0, 0, 0]) =>
  new Matrix4().compose(
    new Vector3(...translation),
    new Quaternion().setFromEuler(new Euler(...rotation)),
    new Vector3(1, 1, 1),
  );
function verifyProjection(result, target, width, height, tolerance) {
  assert.ok(result, "valid observed QR should produce a pose");
  assert.ok(result.matrix instanceof Matrix4);
  const image = projected(result.matrix, width, height, result.focalLength);
  for (const name of names)
    assert.ok(
      Math.hypot(
        image[name].x - target[name].x,
        image[name].y - target[name].y,
      ) < tolerance,
      name,
    );
  assert.ok(Math.abs(result.matrix.determinant() - 1) < 1e-9);
  for (const point of corners)
    assert.ok(point.clone().applyMatrix4(result.matrix).z < 0);
  const position = new Vector3().setFromMatrixPosition(result.matrix);
  const normal = new Vector3(0, 0, 1).transformDirection(result.matrix);
  assert.ok(
    normal.dot(position) < 0,
    "printed front normal must face the camera",
  );
  return image;
}

test("QR平面位姿正确重投影正面、平移、倾斜、滚转及远近缩放，使用Three相机-Z坐标", () => {
  const width = 1280,
    height = 720,
    focalLength = 950;
  const cases = [
    matrixFor([0, 0, -3]),
    matrixFor([0.45, -0.3, -4]),
    matrixFor([-0.45, 0.1, -3.4], [0.42, -0.58, 0.25]),
    matrixFor([0.1, -0.05, -3.8], [0, 0, Math.PI / 2]),
    matrixFor([0.1, 0.05, -3.8], [0.5, 0.3, -0.9]),
    matrixFor([0, 0, -2]),
    matrixFor([0.4, -0.1, -10], [-0.4, 0.5, 0.8]),
  ];
  for (const expected of cases) {
    const target = projected(expected, width, height, focalLength);
    const result = estimateQrPose(target, width, height, { focalLength });
    verifyProjection(result, target, width, height, 1e-6);
    assert.equal(result.focalLength, focalLength);
    assert.ok(result.reprojectionError < 1e-6);
    for (let i = 0; i < 16; i++)
      assert.ok(
        Math.abs(result.matrix.elements[i] - expected.elements[i]) < 1e-6,
        `matrix element ${i}`,
      );
  }
  const front = estimateQrPose(
    projected(cases[0], width, height, focalLength),
    width,
    height,
    { focalLength },
  );
  const center = new Vector3().setFromMatrixPosition(front.matrix);
  assert.ok(
    new Vector3(0, 0, 0.2).applyMatrix4(front.matrix).z > center.z,
    "+Z emerges toward the camera",
  );
  assert.ok(new Vector3(0.2, 0, 0).applyMatrix4(front.matrix).x > center.x);
  assert.ok(new Vector3(0, 0.2, 0).applyMatrix4(front.matrix).y > center.y);
});

test("横屏和竖屏使用原视频像素焦距，倾斜充分时可从方形四角恢复未知焦距", () => {
  for (const [width, height] of [
    [1280, 720],
    [720, 1280],
  ])
    for (const focalLength of [650, 1050, 1500]) {
      const expected = matrixFor([0.1, -0.1, -4.5], [0.58, -0.47, 0.24]);
      const target = projected(expected, width, height, focalLength);
      const result = estimateQrPose(target, width, height);
      verifyProjection(result, target, width, height, 1e-5);
      assert.ok(Math.abs(result.focalLength / focalLength - 1) < 1e-6);
      assert.ok(result.reprojectionError < 1e-5);
    }
});

test("正面近退化焦距不随亚像素噪声跳动，已知焦距下小角点噪声经过重投影细化", () => {
  const width = 1280,
    height = 720;
  const fallback = Math.max(width, height) / (2 * Math.tan(Math.PI / 6));
  const front = projected(matrixFor([0.1, -0.05, -4]), width, height, fallback);
  const tilted = projected(
    matrixFor([0.2, -0.1, -3.5], [0.5, -0.4, 0.2]),
    width,
    height,
    950,
  );
  const inferredFocals = [];
  for (let frame = 0; frame < 30; frame++) {
    const noisy = Object.fromEntries(
      names.map((name, i) => [
        name,
        {
          x: tilted[name].x + Math.sin(frame * 0.6 + i * 2.1) * 0.35,
          y: tilted[name].y + Math.cos(frame * 0.9 + i * 1.7) * 0.35,
        },
      ]),
    );
    const result = estimateQrPose(noisy, width, height, { focalLength: 950 });
    verifyProjection(result, noisy, width, height, 1);
    assert.ok(result.reprojectionError < 0.6);
    const automatic = estimateQrPose(noisy, width, height);
    verifyProjection(automatic, noisy, width, height, 1);
    assert.ok(Math.abs(automatic.focalLength / 950 - 1) < 0.1);
    inferredFocals.push(automatic.focalLength);
    const frontNoisy = Object.fromEntries(
      names.map((name, i) => [
        name,
        {
          x: front[name].x + Math.sin(frame + i) * 0.15,
          y: front[name].y + Math.cos(frame + i * 1.2) * 0.15,
        },
      ]),
    );
    const frontResult = estimateQrPose(frontNoisy, width, height);
    verifyProjection(frontResult, frontNoisy, width, height, 1);
    assert.equal(frontResult.focalLength, fallback);
  }
  assert.ok(
    (Math.max(...inferredFocals) - Math.min(...inferredFocals)) / 950 < 0.08,
  );
});

test("无效尺寸、角点、过小二维码、非凸退化和不符合方形针孔投影的畸变返回null", () => {
  const width = 1280,
    height = 720,
    focalLength = 950;
  const valid = projected(matrixFor([0, 0, -4]), width, height, focalLength);
  const options = { focalLength };
  for (const dimensions of [
    [0, height],
    [width, 0],
    [NaN, height],
    [width, Infinity],
    [20, height],
    [20000, height],
  ])
    assert.equal(estimateQrPose(valid, ...dimensions, options), null);
  for (const focal of [0, -1, NaN, Infinity, "950", null, 100000])
    assert.equal(
      estimateQrPose(valid, width, height, { focalLength: focal }),
      null,
    );
  assert.equal(estimateQrPose(valid, width, height, null), null);
  assert.equal(estimateQrPose(null, width, height, options), null);
  assert.equal(estimateQrPose({}, width, height, options), null);
  const clone = () => structuredClone(valid);
  const mutations = [
    (v) => {
      delete v.bottomLeftCorner;
    },
    (v) => {
      v.topLeftCorner.x = NaN;
    },
    (v) => {
      v.topRightCorner.y = Infinity;
    },
    (v) => {
      v.topRightCorner = { ...v.topLeftCorner };
    },
    (v) => {
      v.bottomLeftCorner.x = -100;
    },
    (v) => {
      [v.topRightCorner, v.bottomRightCorner] = [
        v.bottomRightCorner,
        v.topRightCorner,
      ];
    },
    (v) => {
      [
        v.topLeftCorner,
        v.topRightCorner,
        v.bottomRightCorner,
        v.bottomLeftCorner,
      ] = [
        v.topRightCorner,
        v.topLeftCorner,
        v.bottomLeftCorner,
        v.bottomRightCorner,
      ];
    },
    (v) => {
      v.bottomRightCorner.x += 130;
      v.bottomRightCorner.y -= 65;
    },
  ];
  for (const mutate of mutations) {
    const invalid = clone();
    mutate(invalid);
    assert.equal(estimateQrPose(invalid, width, height, options), null);
  }
  const collinear = Object.fromEntries(
    names.map((name, i) => [name, { x: 200 + i * 30, y: 300 }]),
  );
  assert.equal(estimateQrPose(collinear, width, height, options), null);
  const small = projected(matrixFor([0, 0, -100]), width, height, focalLength);
  assert.equal(estimateQrPose(small, width, height, options), null);
  const edgeOn = projected(
    matrixFor([0, 0, -4], [0, 1.56, 0]),
    width,
    height,
    focalLength,
  );
  assert.equal(estimateQrPose(edgeOn, width, height, options), null);
  const rectangle = {
    topLeftCorner: { x: 400, y: 200 },
    topRightCorner: { x: 800, y: 200 },
    bottomRightCorner: { x: 800, y: 500 },
    bottomLeftCorner: { x: 400, y: 500 },
  };
  assert.equal(estimateQrPose(rectangle, width, height, options), null);
  assert.deepEqual(
    valid,
    projected(matrixFor([0, 0, -4]), width, height, focalLength),
    "input corners are not mutated",
  );
});
