import * as THREE from "three";

// Small, repeatable PBR textures are generated locally; no texture downloads.
function canvasMap(draw, size = 512, color = true) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  draw(canvas.getContext("2d"), size);
  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 4;
  if (color) map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

function random(seed = 17) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function masonry(context, size, height = false) {
  const noise = random();
  context.fillStyle = height ? "#444" : "#29343c";
  context.fillRect(0, 0, size, size);
  const bw = size / 4,
    bh = size / 8;
  for (let row = 0; row < 8; row++) {
    for (let col = -1; col < 5; col++) {
      const x = col * bw + ((row % 2) * bw) / 2,
        y = row * bh;
      const shade = Math.floor(noise() * 22);
      context.fillStyle = height
        ? `rgb(${175 + shade},${175 + shade},${175 + shade})`
        : `rgb(${76 + shade},${89 + shade},${94 + shade})`;
      context.fillRect(x + 2, y + 2, bw - 4, bh - 4);
      context.strokeStyle = height ? "#e0e0e0" : "#8b979a";
      context.lineWidth = 1;
      context.strokeRect(x + 4, y + 4, bw - 8, bh - 8);
      for (let i = 0; i < 95; i++) {
        context.fillStyle = height
          ? `rgba(0,0,0,${noise() * 0.12})`
          : `rgba(${noise() > 0.5 ? "220,223,214" : "8,22,27"},${noise() * 0.15})`;
        context.fillRect(
          x + 4 + noise() * (bw - 8),
          y + 4 + noise() * (bh - 8),
          1 + noise() * 3,
          1 + noise() * 2,
        );
      }
    }
  }
}

export function createCastleSurfaces() {
  const stoneMap = canvasMap((c, s) => masonry(c, s));
  const stoneBump = canvasMap((c, s) => masonry(c, s, true), 512, false);
  const slateMap = canvasMap((c, s) => {
    const noise = random(51);
    c.fillStyle = "#172f38";
    c.fillRect(0, 0, s, s);
    for (let row = 0; row < 12; row++)
      for (let col = -1; col < 9; col++) {
        const x = (col * s) / 8 + ((row % 2) * s) / 16,
          y = (row * s) / 12;
        const n = Math.floor(noise() * 18);
        c.fillStyle = `rgb(${30 + n},${56 + n},${66 + n})`;
        c.fillRect(x + 1, y + 1, s / 8 - 2, s / 12 - 2);
        c.strokeStyle = "#77918c";
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(x + 2, y + s / 12 - 2);
        c.lineTo(x + s / 8 - 2, y + s / 12 - 2);
        c.stroke();
      }
  });
  const snowBump = canvasMap(
    (c, s) => {
      const noise = random(90);
      c.fillStyle = "#ccc";
      c.fillRect(0, 0, s, s);
      for (let i = 0; i < 9000; i++) {
        c.fillStyle = `rgba(255,255,255,${noise() * 0.5})`;
        c.fillRect(noise() * s, noise() * s, 2, 2);
      }
    },
    256,
    false,
  );
  const fabric = canvasMap(
    (c, s) => {
      c.fillStyle = "#ddd";
      c.fillRect(0, 0, s, s);
      for (let i = 0; i < s; i += 4) {
        c.fillStyle = i % 8 ? "#a5a5a5" : "#f3f3f3";
        c.fillRect(i, 0, 1, s);
        c.fillRect(0, i, s, 1);
      }
    },
    256,
    false,
  );
  return {
    stone: new THREE.MeshStandardMaterial({
      color: 0xc7d2ce,
      map: stoneMap,
      bumpMap: stoneBump,
      bumpScale: 0.003,
      roughness: 0.88,
    }),
    trim: new THREE.MeshStandardMaterial({
      color: 0x85958e,
      bumpMap: stoneBump,
      bumpScale: 0.001,
      roughness: 0.8,
    }),
    roof: new THREE.MeshStandardMaterial({
      color: 0xadc3bf,
      map: slateMap,
      bumpMap: slateMap,
      bumpScale: 0.0015,
      metalness: 0.22,
      roughness: 0.55,
    }),
    brass: new THREE.MeshStandardMaterial({
      color: 0xd7ad62,
      metalness: 0.78,
      roughness: 0.32,
    }),
    snow: new THREE.MeshStandardMaterial({
      color: 0xcbd9d5,
      bumpMap: snowBump,
      bumpScale: 0.002,
      roughness: 0.95,
    }),
    glow: new THREE.MeshStandardMaterial({
      color: 0xffdda0,
      emissive: 0xffb94f,
      emissiveIntensity: 0.7,
      roughness: 0.3,
    }),
    dark: new THREE.MeshStandardMaterial({
      color: 0x14232d,
      metalness: 0.12,
      roughness: 0.65,
    }),
    coat: new THREE.MeshStandardMaterial({
      color: 0x982f3e,
      bumpMap: fabric,
      bumpScale: 0.0007,
      roughness: 0.85,
    }),
    scarf: new THREE.MeshStandardMaterial({
      color: 0xd8c18e,
      bumpMap: fabric,
      bumpScale: 0.0005,
      roughness: 0.9,
    }),
  };
}

// Match stone courses to world size instead of stretching one tile per wall.
export function scaleSurfaceUVs(geometry, material) {
  if (!material.map && !material.bumpMap) return geometry;
  const uv = geometry.attributes.uv;
  const p = geometry.attributes.position,
    n = geometry.attributes.normal;
  if (geometry.type === "BoxGeometry") {
    for (let i = 0; i < uv.count; i++) {
      const x = p.getX(i),
        y = p.getY(i),
        z = p.getZ(i);
      if (Math.abs(n.getZ(i)) > 0.5) uv.setXY(i, x / 0.32, y / 0.32);
      else if (Math.abs(n.getX(i)) > 0.5) uv.setXY(i, y / 0.32, z / 0.32);
      else uv.setXY(i, x / 0.32, z / 0.32);
    }
  } else if (geometry.type === "CylinderGeometry") {
    const { radiusTop, height } = geometry.parameters;
    for (let i = 0; i < uv.count; i++)
      uv.setXY(
        i,
        (uv.getX(i) * 2 * Math.PI * radiusTop) / 0.32,
        (uv.getY(i) * height) / 0.32,
      );
  }
  return geometry;
}
