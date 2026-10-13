import { mkdir, writeFile } from "node:fs/promises";
import QRCode from "qrcode";
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

// Reproducible project-owned artwork and GLB; no remote runtime assets.
const root = new URL("../../public/ar-assets/", import.meta.url);
await mkdir(new URL("targets/", root), { recursive: true });
await mkdir(new URL("models/", root), { recursive: true });
const qr = await QRCode.toString("https://alsj.luna.ski/ar/demo", {
  type: "svg",
  margin: 4,
  errorCorrectionLevel: "H",
});
let seed = 20261013;
const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const texture = Array.from({ length: 130 }, () => {
  const x = 45 + random() * 810,
    y = 55 + random() * 1080,
    size = 5 + random() * 27;
  return `<path d="M${x.toFixed(1)} ${y.toFixed(1)}l${size.toFixed(1)} 0 0 ${size.toFixed(1)} -${size.toFixed(1)} 0Z" fill="${random() > 0.5 ? "#574b35" : "#c6a574"}" opacity=".65" transform="rotate(${Math.floor(random() * 360)} ${x} ${y})"/>`;
}).join("");
const poster = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
<rect width="900" height="1200" fill="#eee5d1"/>${texture}
<rect x="30" y="30" width="840" height="1140" fill="none" stroke="#292e28" stroke-width="10"/>
<path d="M70 210L210 70M680 70L830 220M70 960L210 1130M680 1130L830 970" stroke="#8b7048" stroke-width="18"/>
<rect x="175" y="115" width="550" height="170" fill="#eee5d1"/>
<text x="450" y="175" text-anchor="middle" font-family="Georgia,serif" font-size="36" letter-spacing="5" fill="#292e28">ALASKA NIGHTS</text>
<text x="450" y="240" text-anchor="middle" font-family="serif" font-size="46" fill="#292e28">墙面搜证 · 体验锚点</text>
<svg x="210" y="350" width="480" height="480" viewBox="${qr.match(/viewBox="([^"]+)"/)[1]}">${qr.replace(/^.*?<svg[^>]*>/s, "").replace(/<\/svg>\s*$/, "")}</svg>
<rect x="170" y="895" width="560" height="190" fill="#eee5d1"/>
<text x="450" y="945" text-anchor="middle" font-family="serif" font-size="30" fill="#292e28">扫码进入 · 再用摄像头对准整张海报</text>
<text x="450" y="1000" text-anchor="middle" font-family="Georgia,serif" font-size="24" fill="#574b35">alsj.luna.ski/ar/demo</text>
<text x="450" y="1050" text-anchor="middle" font-family="serif" font-size="25" fill="#574b35">整张图宽 18 cm · 平整张贴 · 保留边框</text></svg>`;
await writeFile(new URL("targets/study-wall.svg", root), poster);

globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
};
const scene = new THREE.Scene();
const wood = new THREE.MeshStandardMaterial({
  color: 0x45372a,
  roughness: 0.75,
});
const brass = new THREE.MeshStandardMaterial({
  color: 0xc6a574,
  metalness: 0.7,
  roughness: 0.35,
});
const paper = new THREE.MeshStandardMaterial({
  color: 0xe8dfc7,
  roughness: 0.9,
});
const dark = new THREE.MeshStandardMaterial({ color: 0x202822 });
const box = (name, size, position, material) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.name = name;
  mesh.position.set(...position);
  scene.add(mesh);
  return mesh;
};
// Geometry uses metres. Target width is .18 m: renderer converts units.
box("cabinet-back", [0.27, 0.23, 0.012], [0, 0, 0], wood);
box("cabinet-left", [0.014, 0.23, 0.1], [-0.135, 0, 0.045], wood);
box("cabinet-right", [0.014, 0.23, 0.1], [0.135, 0, 0.045], wood);
for (const y of [-0.12, -0.04, 0.04, 0.12])
  box("shelf", [0.285, 0.012, 0.1], [0, y, 0.045], wood);
box("document", [0.1, 0.005, 0.065], [-0.03, 0.052, 0.06], paper).rotation.y =
  0.15;
box("document-seal", [0.018, 0.007, 0.018], [-0.04, 0.057, 0.08], brass);
box("recorder", [0.065, 0.027, 0.044], [0.025, -0.021, 0.065], dark);
box("recorder-button", [0.009, 0.004, 0.009], [0.015, -0.005, 0.076], brass);
const key = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.003, 8, 20), brass);
key.name = "key-ring";
key.position.set(-0.05, -0.099, 0.082);
scene.add(key);
box("key-shaft", [0.045, 0.005, 0.006], [-0.023, -0.099, 0.082], brass);
box("key-tooth", [0.005, 0.015, 0.005], [-0.008, -0.105, 0.082], brass);
const data = await new GLTFExporter().parseAsync(scene, { binary: true });
await writeFile(new URL("models/study-cabinet.glb", root), Buffer.from(data));
console.log(
  "Generated wall artwork and GLB. Compile the PNG target with scripts/ar/compile-target.js.",
);
