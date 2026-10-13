import * as THREE from "three-mindar";
import { GLTFLoader } from "three-mindar/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three-mindar/addons/controls/OrbitControls.js";
import { PoseStabilizer } from "./pose-stabilizer.js";

const disposeTree = (root) =>
  root?.traverse((object) => {
    object.geometry?.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material))
        if (value?.isTexture) value.dispose();
      material.dispose();
    }
  });

export async function createArRuntime({
  container,
  manifest,
  preview,
  signal,
  onTracking,
  onPick,
}) {
  let ar,
    renderer,
    camera,
    scene,
    anchor,
    controls,
    stopped = false,
    tracked = Boolean(preview);
  const meshes = [],
    root = new THREE.Group();
  const stabilizer = new PoseStabilizer(),
    clock = new THREE.Clock(),
    evidenceNodes = new Map();
  let opening = null,
    resolveOpening = null;
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    resolveOpening?.(false);
    tracked = false;
    renderer?.setAnimationLoop(null);
    controls?.dispose();
    if (ar) {
      ar.cancelled = true;
      ar.controller?.stopProcessVideo();
      ar.controller?.worker?.terminate();
      ar.video?.srcObject?.getTracks().forEach((track) => track.stop());
      window.removeEventListener("resize", ar.resizeHandler);
      ar.video?.remove();
      ar.cssRenderer?.domElement.remove();
      ar.ui?.hideLoading();
      ar.ui?.hideScanning();
      ar.ui?.hideCompatibility();
    }
    container.removeEventListener("pointerdown", down);
    container.removeEventListener("pointerup", up);
    window.removeEventListener("resize", resize);
    disposeTree(root);
    renderer?.dispose();
    renderer?.forceContextLoss();
    renderer?.domElement.remove();
    signal.removeEventListener("abort", cleanup);
  };
  let pressed;
  const down = (event) => {
    pressed = { x: event.clientX, y: event.clientY };
  };
  const up = (event) => {
    if (
      !tracked ||
      stopped ||
      !pressed ||
      Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 10
    )
      return;
    pressed = null;
    const rect = renderer.domElement.getBoundingClientRect();
    const point = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(point, camera);
    const hit = ray.intersectObjects(meshes, false)[0];
    if (hit) onPick(hit.object.userData.hotspotId);
  };
  const resize = () => {
    if (preview && renderer && !stopped) {
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    }
  };
  signal.addEventListener("abort", cleanup, { once: true });
  try {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    if (preview) {
      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x141716);
      camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
      camera.position.set(0, 0.1, 2.9);
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      container.appendChild(renderer.domElement);
      scene.add(root);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.minDistance = 1.5;
      controls.maxDistance = 5;
      controls.target.set(0, 0, 0.2);
      resize();
      camera.position.set(0.65, 0.45, Math.max(3.4, 2.3 / camera.aspect));
      controls.maxDistance = 10;
      window.addEventListener("resize", resize);
    } else {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "摄像头需要 HTTPS 和浏览器支持，请使用 Safari 或 Chrome 打开。",
        );
      // Validate the target before the SDK's asynchronous startup.
      const target = await fetch(manifest.tracking.targetUrl, { signal });
      if (!target.ok || !(await target.arrayBuffer()).byteLength)
        throw new Error("定位文件加载失败，请重试。");
      const { MindARThree } =
        await import("../../vendor/mindar/mindar-image-three.prod.js");
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      ar = new MindARThree({
        container,
        imageTargetSrc: manifest.tracking.targetUrl,
        maxTrack: 1,
        warmupTolerance: 8,
        missTolerance: 10,
        filterMinCF: 0.001,
        filterBeta: 100,
        uiLoading: "no",
        uiScanning: "no",
        uiError: "no",
      });
      ({ renderer, scene, camera } = ar);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      ar.cssRenderer.domElement.style.pointerEvents = "none";
      anchor = ar.addAnchor(manifest.tracking.targetIndex);
      root.matrixAutoUpdate = false;
      root.visible = false;
      scene.add(root);
      anchor.onTargetFound = () => {
        if (!stopped) {
          stabilizer.reset();
          tracked = true;
          root.visible = true;
          onTracking(true);
        }
      };
      anchor.onTargetLost = () => {
        if (!stopped) {
          tracked = false;
          root.visible = false;
          onTracking(false);
        }
      };
      anchor.onTargetUpdate = () => {
        if (!stopped && anchor.visible)
          stabilizer.sample(anchor.group.matrix, performance.now());
      };
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    scene.add(new THREE.HemisphereLight(0xfff2da, 0x35483d, 2));
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(1, 2, 3);
    scene.add(light);
    const loader = new GLTFLoader();
    for (const model of manifest.models) {
      const gltf = await loader.loadAsync(model.url);
      if (stopped || signal.aborted) {
        disposeTree(gltf.scene);
        throw new DOMException("Cancelled", "AbortError");
      }
      const node = new THREE.Group();
      node.position.fromArray(model.position);
      node.rotation.set(...model.rotation);
      node.scale.set(
        ...model.scale.map(
          (value) => value / manifest.tracking.physicalWidthMeters,
        ),
      );
      node.add(gltf.scene);
      const names = {
        document: ["document", "document-seal"],
        recorder: ["recorder", "recorder-button"],
        key: ["key-ring", "key-shaft", "key-tooth"],
      };
      for (const [id, list] of Object.entries(names)) {
        const objects = [];
        gltf.scene.traverse((object) => {
          if (list.includes(object.name))
            objects.push({ object, original: object.position.clone() });
        });
        if (objects.length) evidenceNodes.set(id, objects);
      }
      root.add(node);
    }
    for (const hotspot of manifest.hotspots) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(hotspot.radius, 16, 12),
        new THREE.MeshBasicMaterial({
          color: 0xe4ca9f,
          transparent: true,
          opacity: 0.2,
          depthWrite: false,
        }),
      );
      mesh.position.fromArray(hotspot.position);
      mesh.userData.hotspotId = hotspot.id;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(
          hotspot.radius * 0.75,
          hotspot.radius * 0.85,
          32,
        ),
        new THREE.MeshBasicMaterial({
          color: 0xe4ca9f,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.85,
        }),
      );
      mesh.add(ring);
      root.add(mesh);
      meshes.push(mesh);
    }
    container.addEventListener("pointerdown", down);
    container.addEventListener("pointerup", up);
    if (!preview) await ar.start();
    if (stopped || signal.aborted)
      throw new DOMException("Cancelled", "AbortError");
    renderer.setAnimationLoop(() => {
      const delta = clock.getDelta();
      if (!preview && tracked) {
        const matrix = stabilizer.render(delta);
        if (matrix) root.matrix.copy(matrix);
      }
      if (opening) {
        const progress = Math.min(
          1,
          (performance.now() - opening.start) / 1100,
        );
        const eased = progress * progress * (3 - 2 * progress);
        for (const { object, original } of evidenceNodes.get(opening.id) || [])
          object.position.z = original.z + eased * 0.045;
        if (progress === 1) {
          opening = null;
          resolveOpening?.(true);
          resolveOpening = null;
        }
      }
      controls?.update();
      renderer.render(scene, camera);
    });
    if (preview) onTracking(true);
    return {
      stop: cleanup,
      openEvidence(id) {
        resolveOpening?.(false);
        opening = { id, start: performance.now() };
        return new Promise((resolve) => {
          resolveOpening = resolve;
        });
      },
      markCollected(id) {
        const mesh = meshes.find((item) => item.userData.hotspotId === id);
        if (mesh) {
          mesh.material.color.setHex(0x98af96);
          mesh.children[0].material.color.setHex(0x98af96);
        }
      },
    };
  } catch (error) {
    cleanup();
    throw error || new Error("摄像头启动失败，请检查相机权限。");
  }
}
