import { Matrix4, Quaternion, Vector3 } from "three";

// Pinhole planar pose, in QR-side units, not calibrated physical centimetres.
// Homography initialization + reprojection refinement follows the principles in
// https://docs.opencv.org/4.x/d9/dab/tutorial_homography.html and
// https://docs.opencv.org/4.x/d5/d1f/calib3d_solvePnP.html . No lens-distortion
// calibration is assumed; inconsistent corner geometry is rejected instead.
const NAMES = [
  "topLeftCorner",
  "topRightCorner",
  "bottomRightCorner",
  "bottomLeftCorner",
];
const LOCAL = [
  [-0.5, 0.5],
  [0.5, 0.5],
  [0.5, -0.5],
  [-0.5, -0.5],
];
const UNIT = new Vector3(1, 1, 1);

function linearSolve(a, b) {
  const n = b.length;
  const rows = a.map((row, i) => [...row, b[i]]);
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++)
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column]))
        pivot = row;
    if (
      !Number.isFinite(rows[pivot][column]) ||
      Math.abs(rows[pivot][column]) < 1e-12
    )
      return null;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let k = column; k <= n; k++) rows[column][k] /= divisor;
    for (let row = 0; row < n; row++) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let k = column; k <= n; k++)
        rows[row][k] -= factor * rows[column][k];
    }
  }
  const result = rows.map((row) => row[n]);
  return result.every(Number.isFinite) ? result : null;
}

function homography(points, width, height) {
  const scale = Math.max(width, height),
    a = [],
    b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = LOCAL[i];
    const u = (points[i].x - width / 2) / scale;
    const v = (height / 2 - points[i].y) / scale;
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = linearSolve(a, b);
  return h ? [...h, 1] : null;
}

function focalFromHomography(h, scale) {
  // After inverse intrinsics, the two plane axes must be orthogonal and equal
  // length: A*q+B=0, where q=(scale/f)^2. Both constraints are used together.
  const a = [
    h[0] * h[1] + h[3] * h[4],
    (h[0] ** 2 + h[3] ** 2 - h[1] ** 2 - h[4] ** 2) / 2,
  ];
  const b = [h[6] * h[7], (h[6] ** 2 - h[7] ** 2) / 2];
  const denominator = a[0] ** 2 + a[1] ** 2;
  if (denominator < 1e-15) return null;
  const q = -(a[0] * b[0] + a[1] * b[1]) / denominator;
  return Number.isFinite(q) && q > 0 ? scale / Math.sqrt(q) : null;
}

function chooseFocal(h, points, width, height, side) {
  const scale = Math.max(width, height);
  // 60 degrees along the longer video dimension; the scene converts this
  // pixel focal length to its vertical FOV and applies the same cover crop.
  const fallback = scale / (2 * Math.tan(Math.PI / 6));
  const g = fallback / scale;
  const tiltSignal =
    Math.hypot(h[6], h[7]) / Math.hypot(h[0] / g, h[3] / g, h[1] / g, h[4] / g);
  const candidate = focalFromHomography(h, scale);
  if (
    !candidate ||
    candidate < scale * 0.3 ||
    candidate > scale * 3 ||
    tiltSignal < 0.12 ||
    Math.hypot(h[6], h[7]) * side < 8
  )
    return fallback;
  // Near front-on, a tiny corner error produces an enormous focal-length
  // change. Only infer intrinsics when half-pixel perturbations are stable.
  for (let i = 0; i < 4; i++)
    for (const axis of ["x", "y"]) {
      const perturbed = points.map((p) => ({ ...p }));
      perturbed[i][axis] += 0.5;
      const alternative = focalFromHomography(
        homography(perturbed, width, height) || [],
        scale,
      );
      if (!alternative || Math.abs(alternative / candidate - 1) > 0.18)
        return fallback;
    }
  return candidate;
}

function initialPose(h, focal, scale) {
  const g = focal / scale;
  // The third homography coordinate is positive depth, while Three looks -Z.
  const a = new Vector3(h[0] / g, h[3] / g, -h[6]);
  const b = new Vector3(h[1] / g, h[4] / g, -h[7]);
  const al = a.length(),
    bl = b.length();
  if (!al || !bl || Math.abs(al - bl) / (al + bl) > 0.35) return null;
  a.divideScalar(al);
  b.divideScalar(bl);
  if (Math.abs(a.dot(b)) > 0.65) return null;
  // Symmetric orthogonalization avoids favouring either measured QR axis.
  const sum = a.clone().add(b).normalize(),
    difference = a.clone().sub(b).normalize();
  const x = sum.clone().add(difference).multiplyScalar(Math.SQRT1_2);
  const y = sum.clone().sub(difference).multiplyScalar(Math.SQRT1_2);
  const z = new Vector3().crossVectors(x, y).normalize();
  return {
    rotation: new Quaternion().setFromRotationMatrix(
      new Matrix4().makeBasis(x, y, z),
    ),
    translation: new Vector3(h[2] / g, h[5] / g, -1).multiplyScalar(
      2 / (al + bl),
    ),
  };
}

function evaluate(pose, points, focal, width, height, derivatives = false) {
  const residuals = [],
    jacobian = [];
  let sum = 0,
    maximum = 0;
  for (let i = 0; i < 4; i++) {
    const v = new Vector3(...LOCAL[i], 0).applyQuaternion(pose.rotation);
    const p = v.clone().add(pose.translation),
      depth = -p.z;
    if (depth <= 0.025 || !Number.isFinite(depth)) return null;
    const u = width / 2 + (focal * p.x) / depth;
    const w = height / 2 - (focal * p.y) / depth;
    const du = points[i].x - u,
      dv = points[i].y - w;
    residuals.push(du, dv);
    const squared = du * du + dv * dv;
    sum += squared;
    maximum = Math.max(maximum, Math.sqrt(squared));
    if (derivatives) {
      const ux = focal / depth,
        uz = (focal * p.x) / depth ** 2;
      const vy = -focal / depth,
        vz = (-focal * p.y) / depth ** 2;
      jacobian.push([uz * v.y, ux * v.z - uz * v.x, -ux * v.y, ux, 0, uz]);
      jacobian.push([-vy * v.z + vz * v.y, -vz * v.x, vy * v.x, 0, vy, vz]);
    }
  }
  return Number.isFinite(sum) ? { sum, maximum, residuals, jacobian } : null;
}

function refine(pose, points, focal, width, height) {
  let current = evaluate(pose, points, focal, width, height);
  if (!current) return null;
  let damping = 1e-3;
  for (let iteration = 0; iteration < 15 && current.sum > 1e-10; iteration++) {
    const measured = evaluate(pose, points, focal, width, height, true);
    const a = Array.from({ length: 6 }, () => Array(6).fill(0)),
      b = Array(6).fill(0);
    for (let row = 0; row < 8; row++)
      for (let j = 0; j < 6; j++) {
        b[j] += measured.jacobian[row][j] * measured.residuals[row];
        for (let k = 0; k < 6; k++)
          a[j][k] += measured.jacobian[row][j] * measured.jacobian[row][k];
      }
    for (let j = 0; j < 6; j++) a[j][j] += damping * Math.max(a[j][j], 1);
    const step = linearSolve(a, b);
    if (!step) break;
    const rotationVector = new Vector3(step[0], step[1], step[2]);
    const angle = rotationVector.length();
    if (angle > 0.4) {
      const factor = 0.4 / angle;
      for (let i = 0; i < 6; i++) step[i] *= factor;
      rotationVector.multiplyScalar(factor);
    }
    const delta = new Quaternion();
    if (rotationVector.length() > 1e-12)
      delta.setFromAxisAngle(
        rotationVector.clone().normalize(),
        rotationVector.length(),
      );
    const candidate = {
      rotation: pose.rotation.clone().premultiply(delta).normalize(),
      translation: pose.translation
        .clone()
        .add(new Vector3(step[3], step[4], step[5])),
    };
    const result = evaluate(candidate, points, focal, width, height);
    if (result && result.sum < current.sum) {
      const improvement = current.sum - result.sum;
      pose = candidate;
      current = result;
      damping = Math.max(1e-8, damping / 3);
      if (improvement < 1e-8) break;
    } else damping = Math.min(1e8, damping * 10);
  }
  return { pose, error: Math.sqrt(current.sum / 4), maximum: current.maximum };
}

/**
 * jsQR.location -> local QR XY plane to Three camera coordinates (-Z forward).
 * Corners are pixels in the original, unmirrored video. QR edge length is one;
 * +Z points out of its printed front. focalLength is pixels, not millimetres.
 * This function is stateless. Pass a stable/calibrated focalLength when known;
 * otherwise observable tilted squares can estimate it, with front-on fallback.
 */
export function estimateQrPose(corners, width, height, options = {}) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 32 ||
    height < 32 ||
    width > 16384 ||
    height > 16384 ||
    !corners ||
    !options ||
    typeof options !== "object"
  )
    return null;
  const points = NAMES.map((name) => corners[name]);
  const margin = Math.max(2, Math.min(width, height) * 0.01);
  if (
    points.some(
      (p) =>
        !p ||
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        p.x < -margin ||
        p.y < -margin ||
        p.x > width + margin ||
        p.y > height + margin,
    )
  )
    return null;
  const sides = points.map((p, i) =>
    Math.hypot(p.x - points[(i + 1) % 4].x, p.y - points[(i + 1) % 4].y),
  );
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const p = points[i],
      q = points[(i + 1) % 4],
      r = points[(i + 2) % 4];
    const cross = (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x);
    if (cross < sides[i] * sides[(i + 1) % 4] * 0.025) return null;
    area += p.x * q.y - p.y * q.x;
  }
  area /= 2;
  const side = sides.reduce((a, b) => a + b, 0) / 4;
  if (
    Math.min(...sides) < 18 ||
    area < 400 ||
    area / Math.max(...sides) ** 2 < 0.04
  )
    return null;
  const h = homography(points, width, height);
  if (!h) return null;
  let focal = options.focalLength;
  if (
    focal !== undefined &&
    (!Number.isFinite(focal) ||
      focal <= 0 ||
      focal > Math.max(width, height) * 10)
  )
    return null;
  if (focal === undefined) focal = chooseFocal(h, points, width, height, side);
  const initial = initialPose(h, focal, Math.max(width, height));
  if (!initial) return null;
  const result = refine(initial, points, focal, width, height);
  const tolerance = Math.max(1.5, Math.min(4, side * 0.015));
  if (!result || result.error > tolerance || result.maximum > tolerance * 1.8)
    return null;
  const normal = new Vector3(0, 0, 1).applyQuaternion(result.pose.rotation);
  if (normal.dot(result.pose.translation) >= -0.025) return null;
  return {
    matrix: new Matrix4().compose(
      result.pose.translation,
      result.pose.rotation,
      UNIT,
    ),
    focalLength: focal,
    reprojectionError: result.error,
  };
}
