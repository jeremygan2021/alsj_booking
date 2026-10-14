import QRCode from "qrcode";

// A real video track, with readable QR pixels projected through a known camera.
// This exercises decoding and the full video-cover -> 3D projection pipeline.
export async function installQrCamera(context, origin, options = {}) {
  const codes = {};
  for (const id of [
    "E-01",
    "E-02",
    "E-05",
    "E-06",
    "E-09",
    "E-99",
    "AR-05",
    "AR-INV",
  ]) {
    const qr = QRCode.create(
      `${origin}/ar?${id.startsWith("AR-") ? "node" : "clue"}=${id}`,
      {
        errorCorrectionLevel: "M",
      },
    );
    codes[id] = { size: qr.modules.size, data: Array.from(qr.modules.data) };
  }
  await context.addInitScript(
    ({ codes, delayed, configuredFocal }) => {
      const width = 1280;
      const height = 720;
      const focal = configuredFocal || width / (2 * Math.tan(Math.PI / 6));
      let state = {
        id: "E-01",
        x: 0,
        y: 0,
        z: 4.5,
        rx: 0,
        ry: 0,
        rz: 0,
        visible: true,
      };
      let canvas;
      let stream;
      let tracks = [];
      let corners = [];
      let pendingResolve;
      let framePump;
      function point(x, y) {
        const ax = (state.rx * Math.PI) / 180;
        const ay = (state.ry * Math.PI) / 180;
        const az = (state.rz * Math.PI) / 180;
        const x1 = x;
        const y1 = y * Math.cos(ax);
        const z1 = y * Math.sin(ax);
        const x2 = x1 * Math.cos(ay) + z1 * Math.sin(ay);
        const y2 = y1;
        const z2 = -x1 * Math.sin(ay) + z1 * Math.cos(ay);
        const x3 = x2 * Math.cos(az) - y2 * Math.sin(az) + state.x;
        const y3 = x2 * Math.sin(az) + y2 * Math.cos(az) + state.y;
        const depth = state.z - z2;
        return {
          x: width / 2 + (focal * x3) / depth,
          y: height / 2 - (focal * y3) / depth,
        };
      }
      function solve(matrix, rhs) {
        const a = matrix.map((row, i) => [...row, rhs[i]]);
        for (let k = 0; k < rhs.length; k++) {
          let pivot = k;
          for (let i = k + 1; i < rhs.length; i++)
            if (Math.abs(a[i][k]) > Math.abs(a[pivot][k])) pivot = i;
          [a[k], a[pivot]] = [a[pivot], a[k]];
          const value = a[k][k];
          for (let j = k; j <= rhs.length; j++) a[k][j] /= value;
          for (let i = 0; i < rhs.length; i++)
            if (i !== k) {
              const factor = a[i][k];
              for (let j = k; j <= rhs.length; j++) a[i][j] -= factor * a[k][j];
            }
        }
        return a.map((row) => row[rhs.length]);
      }
      function draw() {
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#bcb6aa";
        ctx.fillRect(0, 0, width, height);
        ctx.strokeStyle = "#b7b1a5";
        for (let y = 0; y < height; y += 90) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
          ctx.stroke();
        }
        corners = [
          [-0.5, 0.5],
          [0.5, 0.5],
          [0.5, -0.5],
          [-0.5, -0.5],
        ].map(([x, y]) => point(x, y));
        if (!state.visible) return;
        const qr = codes[state.id];
        const rows = [];
        const values = [];
        // Inverse homography: video pixels -> code coordinates [0,1].
        for (let i = 0; i < 4; i++) {
          const { x, y } = corners[i];
          const [u, v] = [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ][i];
          rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
          values.push(u);
          rows.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
          values.push(v);
        }
        const h = solve(rows, values);
        const margin = 4 / qr.size;
        const expanded = [
          [-0.5 - margin, 0.5 + margin],
          [0.5 + margin, 0.5 + margin],
          [0.5 + margin, -0.5 - margin],
          [-0.5 - margin, -0.5 - margin],
        ].map(([x, y]) => point(x, y));
        const left = Math.max(
          0,
          Math.floor(Math.min(...expanded.map((p) => p.x))),
        );
        const top = Math.max(
          0,
          Math.floor(Math.min(...expanded.map((p) => p.y))),
        );
        const right = Math.min(
          width,
          Math.ceil(Math.max(...expanded.map((p) => p.x))),
        );
        const bottom = Math.min(
          height,
          Math.ceil(Math.max(...expanded.map((p) => p.y))),
        );
        const image = ctx.getImageData(left, top, right - left, bottom - top);
        for (let py = top; py < bottom; py++)
          for (let px = left; px < right; px++) {
            const divisor = h[6] * px + h[7] * py + 1;
            const u = (h[0] * px + h[1] * py + h[2]) / divisor;
            const v = (h[3] * px + h[4] * py + h[5]) / divisor;
            if (u < -margin || u > 1 + margin || v < -margin || v > 1 + margin)
              continue;
            const col = Math.floor(u * qr.size);
            const row = Math.floor(v * qr.size);
            const black =
              col >= 0 &&
              col < qr.size &&
              row >= 0 &&
              row < qr.size &&
              qr.data[row * qr.size + col];
            const index = ((py - top) * (right - left) + px - left) * 4;
            image.data[index] =
              image.data[index + 1] =
              image.data[index + 2] =
                black ? 0 : 255;
            image.data[index + 3] = 255;
          }
        ctx.putImageData(image, left, top);
        if (state.occluded) {
          const a = point(-0.5, 0.5),
            b = point(-0.23, 0.5),
            c = point(-0.23, 0.23),
            d = point(-0.5, 0.23);
          ctx.fillStyle = "#bcb6aa";
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          for (const p of [b, c, d]) ctx.lineTo(p.x, p.y);
          ctx.closePath();
          ctx.fill();
        }
        stream?.getVideoTracks()[0]?.requestFrame?.();
      }
      const fakeCamera = {
        calls: 0,
        constraints: [],
        set(next) {
          state = { ...state, ...next };
          draw();
        },
        get corners() {
          return corners;
        },
        get tracks() {
          return tracks.map((track) => track.readyState);
        },
        get dimensions() {
          return { width, height, focal };
        },
        release() {
          pendingResolve?.(stream);
          pendingResolve = null;
        },
      };
      window.__qrCamera = fakeCamera;
      const getUserMedia = async (constraints) => {
        fakeCamera.calls++;
        fakeCamera.constraints.push(constraints);
        canvas ||= document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        stream = canvas.captureStream(30);
        tracks.push(...stream.getTracks());
        draw();
        clearInterval(framePump);
        framePump = setInterval(() => {
          if (
            !stream.getTracks().some((track) => track.readyState === "live")
          ) {
            clearInterval(framePump);
            return;
          }
          // A camera supplies new frames even when a printed marker stays still.
          canvas.getContext("2d").drawImage(canvas, 0, 0);
        }, 33);
        return delayed
          ? new Promise((resolve) => {
              pendingResolve = resolve;
            })
          : stream;
      };
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: getUserMedia,
      });
    },
    {
      codes,
      delayed: Boolean(options.delayed),
      configuredFocal: options.focal,
    },
  );
}
