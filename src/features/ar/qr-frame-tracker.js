import jsQR from "jsqr";
import jsfeat from "jsfeat";

export const QR_CORNERS = [
  "topLeftCorner",
  "topRightCorner",
  "bottomRightCorner",
  "bottomLeftCorner",
];

// LK follows the printed texture between QR confirmations. Forward/backward
// checks and a robust planar fit reject occluders and unrelated wall features.
export function createQrFrameTracker() {
  let previous,
    current,
    dimensions = "",
    location,
    data,
    confirmedAt = -Infinity;
  let decodedAt = -Infinity,
    count = 0,
    filtered,
    filteredAt = 0,
    filteredData;
  const xy = new Float32Array(162),
    next = new Float32Array(162),
    back = new Float32Array(162);
  const status = new Uint8Array(81),
    reverseStatus = new Uint8Array(81);
  const kernel = new jsfeat.motion_model.homography2d();
  const matrix = new jsfeat.matrix_t(3, 3, jsfeat.F32C1_t);
  const mask = new jsfeat.matrix_t(81, 1, jsfeat.U8C1_t);
  const params = new jsfeat.ransac_params_t(4, 1.3, 0.5, 0.99);
  const copy = (points) =>
    Object.fromEntries(QR_CORNERS.map((k) => [k, { ...points[k] }]));

  function seed() {
    const [a, b, c, d] = QR_CORNERS.map((k) => location[k]);
    count = 0;
    for (let row = 1; row <= 9; row++)
      for (let col = 1; col <= 9; col++) {
        const u = col / 10,
          v = row / 10;
        xy[count * 2] =
          a.x * (1 - u) * (1 - v) +
          b.x * u * (1 - v) +
          c.x * u * v +
          d.x * (1 - u) * v;
        xy[count * 2 + 1] =
          a.y * (1 - u) * (1 - v) +
          b.y * u * (1 - v) +
          c.y * u * v +
          d.y * (1 - u) * v;
        count++;
      }
  }
  function flow() {
    if (!location || count < 16) return null;
    jsfeat.optical_flow_lk.track(
      previous,
      current,
      xy,
      next,
      count,
      15,
      20,
      status,
      0.01,
      0.001,
    );
    jsfeat.optical_flow_lk.track(
      current,
      previous,
      next,
      back,
      count,
      15,
      20,
      reverseStatus,
      0.01,
      0.001,
    );
    const from = [],
      to = [];
    for (let i = 0; i < count; i++) {
      if (
        !status[i] ||
        !reverseStatus[i] ||
        Math.hypot(back[i * 2] - xy[i * 2], back[i * 2 + 1] - xy[i * 2 + 1]) >
          0.9
      )
        continue;
      from.push({ x: xy[i * 2], y: xy[i * 2 + 1] });
      to.push({ x: next[i * 2], y: next[i * 2 + 1] });
    }
    if (
      from.length < Math.max(16, count * 0.55) ||
      !jsfeat.motion_estimator.ransac(
        params,
        kernel,
        from,
        to,
        from.length,
        matrix,
        mask,
        80,
      )
    )
      return null;
    const goodFrom = from.filter((_, i) => mask.data[i]),
      goodTo = to.filter((_, i) => mask.data[i]);
    if (goodFrom.length < Math.max(16, count * 0.5)) return null;
    const [a, b, c, d] = QR_CORNERS.map((k) => location[k]);
    const span = Math.max(
      Math.hypot(a.x - c.x, a.y - c.y),
      Math.hypot(b.x - d.x, b.y - d.y),
    );
    if (
      Math.max(...goodFrom.map((p) => p.x)) -
        Math.min(...goodFrom.map((p) => p.x)) <
        span * 0.25 ||
      Math.max(...goodFrom.map((p) => p.y)) -
        Math.min(...goodFrom.map((p) => p.y)) <
        span * 0.25
    )
      return null;
    if (!kernel.run(goodFrom, goodTo, matrix, goodFrom.length)) return null;
    const h = matrix.data;
    const result = Object.fromEntries(
      QR_CORNERS.map((k) => {
        const p = location[k],
          divisor = h[6] * p.x + h[7] * p.y + h[8];
        return [
          k,
          {
            x: (h[0] * p.x + h[1] * p.y + h[2]) / divisor,
            y: (h[3] * p.x + h[4] * p.y + h[5]) / divisor,
          },
        ];
      }),
    );
    if (
      QR_CORNERS.some(
        (k) =>
          !Number.isFinite(result[k].x) ||
          !Number.isFinite(result[k].y) ||
          Math.hypot(result[k].x - location[k].x, result[k].y - location[k].y) >
            span * 0.45,
      )
    )
      return null;
    count = goodTo.length;
    goodTo.forEach((p, i) => {
      xy[i * 2] = p.x;
      xy[i * 2 + 1] = p.y;
    });
    return result;
  }
  return {
    update(pixels, time) {
      const key = `${pixels.width}:${pixels.height}`;
      if (key !== dimensions) {
        dimensions = key;
        previous = new jsfeat.pyramid_t(3);
        current = new jsfeat.pyramid_t(3);
        previous.allocate(pixels.width, pixels.height, jsfeat.U8C1_t);
        current.allocate(pixels.width, pixels.height, jsfeat.U8C1_t);
        location = filtered = null;
        count = 0;
      }
      jsfeat.imgproc.grayscale(
        pixels.data,
        pixels.width,
        pixels.height,
        current.data[0],
      );
      current.build(current.data[0], true);
      let source = "optical-flow",
        qr;
      if (time - decodedAt >= 110 || !location) {
        qr = jsQR(pixels.data, pixels.width, pixels.height, {
          inversionAttempts: "attemptBoth",
        });
        decodedAt = time;
      }
      if (qr) {
        data = qr.data;
        location = copy(qr.location);
        confirmedAt = time;
        seed();
        source = "qr";
      } else {
        location = time - confirmedAt < 650 ? flow() : null;
      }
      [previous, current] = [current, previous];
      if (!location) return null;
      // Low-pass tiny corner noise only. Larger motion snaps to the measurement
      // so smoothing never leaves the cover visibly trailing behind the paper.
      const distance = filtered
        ? Math.max(
            ...QR_CORNERS.map((k) =>
              Math.hypot(
                location[k].x - filtered[k].x,
                location[k].y - filtered[k].y,
              ),
            ),
          )
        : Infinity;
      const alpha =
        distance > 2.5 || data !== filteredData || time - filteredAt > 180
          ? 1
          : Math.min(1, 1 - Math.exp(-(time - filteredAt) / 55));
      if (!filtered) filtered = copy(location);
      else
        for (const k of QR_CORNERS)
          for (const axis of ["x", "y"])
            filtered[k][axis] +=
              alpha * (location[k][axis] - filtered[k][axis]);
      filteredAt = time;
      filteredData = data;
      return { data, location: copy(filtered), source, points: count };
    },
  };
}
