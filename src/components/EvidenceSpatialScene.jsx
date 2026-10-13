import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Crosshair, RotateCcw, ScanLine, X } from "lucide-react";
import "./evidence-spatial-scene.css";

// Text lives in the scene graph, so it follows the same AR anchor as the evidence.
function sceneText(
  THREE,
  text,
  { width = 1.8, color = "#f4e0b7", size = 92 } = {},
) {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("场景文字暂时无法绘制，请重新打开。");
  const font = `500 ${size}px "Noto Serif SC", "Songti SC", "SimSun", serif`;
  context.font = font;
  const lines = [];
  let line = "";
  for (const character of String(text || "物证")) {
    if (
      character === "\n" ||
      context.measureText(line + character).width > 1840
    ) {
      lines.push(line);
      line = character === "\n" ? "" : character;
    } else line += character;
  }
  if (line) lines.push(line);
  const visible = lines.slice(0, 3);
  if (lines.length > 3) visible[2] = visible[2].slice(0, -1) + "…";
  canvas.height = Math.max(150, visible.length * size * 1.4 + 48);
  context.font = font;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = color;
  context.shadowColor = "#031211";
  context.shadowBlur = 18;
  context.lineWidth = 7;
  context.strokeStyle = "rgba(3, 18, 17, 0.55)";
  visible.forEach((value, index) => {
    const y =
      canvas.height / 2 + (index - (visible.length - 1) / 2) * size * 1.4;
    context.strokeText(value, 1024, y);
    context.fillText(value, 1024, y);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    }),
  );
  sprite.scale.set(width, (canvas.height / canvas.width) * width, 1);
  return sprite;
}

function disposeTree(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root?.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    (Array.isArray(object.material)
      ? object.material
      : [object.material]
    ).forEach((material) => {
      if (!material) return;
      materials.add(material);
      Object.values(material).forEach((value) => {
        if (value?.isTexture) textures.add(value);
      });
    });
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  textures.forEach((texture) => {
    texture.dispose();
    texture.source?.data?.close?.();
  });
}

export default function EvidenceSpatialScene({
  clue,
  onClose,
  preferAR = true,
  audioControls = null,
}) {
  const dialog = useRef(null);
  const overlay = useRef(null);
  const mount = useRef(null);
  const resources = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  const headingId = useId();
  const descriptionId = useId();
  const [retry, setRetry] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [arError, setArError] = useState("");
  const [xrSupported, setXrSupported] = useState(false);
  const [xrState, setXrState] = useState("idle");
  const [planeFound, setPlaneFound] = useState(false);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    let active = true;
    const check = () => {
      if (!preferAR || !window.isSecureContext || !navigator.xr) {
        setXrSupported(false);
        return;
      }
      navigator.xr.isSessionSupported("immersive-ar").then(
        (supported) => active && setXrSupported(supported),
        () => active && setXrSupported(false),
      );
    };
    check();
    navigator.xr?.addEventListener("devicechange", check);
    return () => {
      active = false;
      navigator.xr?.removeEventListener("devicechange", check);
    };
  }, [preferAR]);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const items = () =>
      [
        ...(dialog.current?.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]',
        ) || []),
      ].filter((element) => element.getClientRects().length);
    (items()[0] || dialog.current)?.focus();
    const handleKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      event.stopImmediatePropagation();
      const focusable = items();
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first) {
        event.preventDefault();
        dialog.current?.focus();
      } else if (
        event.shiftKey &&
        (document.activeElement === first ||
          !dialog.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !dialog.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    // DOM overlay input must not also place an XR object behind the button.
    const preventXrSelect = (event) => {
      if (
        event.target?.closest?.(
          "button, input, select, textarea, .spatial-audio-controls",
        )
      )
        event.preventDefault();
    };
    const element = overlay.current;
    element?.addEventListener("beforexrselect", preventXrSelect);
    document.addEventListener("keydown", handleKey, true);
    return () => {
      document.body.style.overflow = oldOverflow;
      element?.removeEventListener("beforexrselect", preventXrSelect);
      document.removeEventListener("keydown", handleKey, true);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let current;
    let renderer;
    let scene;
    let environment;
    let resizeObserver;
    let disposeFinished = false;
    const abort = new AbortController();
    const motionPreference = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    setReady(false);
    setError("");
    setArError("");
    setXrState("idle");
    setPlaneFound(false);
    setScanning(false);

    const dispose = () => {
      if (disposeFinished) return;
      disposeFinished = true;
      current?.controls?.dispose();
      current?.hitSource?.cancel();
      current?.removeSessionEvents?.();
      disposeTree(scene);
      environment?.dispose();
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderer?.domElement.remove();
    };

    async function prepare() {
      const [THREE, { GLTFLoader }, { OrbitControls }, { RoomEnvironment }] =
        await Promise.all([
          import("three"),
          import("three/addons/loaders/GLTFLoader.js"),
          import("three/addons/controls/OrbitControls.js"),
          import("three/addons/environments/RoomEnvironment.js"),
        ]);
      if (cancelled) return;
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.xr.enabled = true;
      renderer.xr.setReferenceSpaceType("local");
      renderer.domElement.dataset.testid = "spatial-scene-canvas";
      renderer.domElement.tabIndex = 0;
      renderer.domElement.setAttribute("role", "img");
      renderer.domElement.setAttribute(
        "aria-label",
        `${clue?.title || "物证"}三维场景；拖动旋转，滚轮或双指缩放，方向键观察，加减键缩放。`,
      );
      mount.current?.appendChild(renderer.domElement);

      scene = new THREE.Scene();
      const desktopBackground = new THREE.Color("#081213");
      const desktopFog = new THREE.FogExp2("#081213", 0.09);
      scene.background = desktopBackground;
      scene.fog = desktopFog;
      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      environment = pmrem.fromScene(room, 0.04);
      scene.environment = environment.texture;
      room.dispose();
      pmrem.dispose();
      scene.add(new THREE.HemisphereLight(0xe0ffff, 0x1b302d, 2.3));
      const key = new THREE.DirectionalLight(0xffd99e, 3.1);
      key.position.set(-1.5, 3, 2.5);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0x6edcd7, 2.1);
      rim.position.set(2, 1.5, -2);
      scene.add(rim);

      const camera = new THREE.PerspectiveCamera(43, 1, 0.01, 50);
      camera.position.set(1.5, 1.6, 3.5);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 0.83, 0);
      controls.enablePan = false;
      controls.enableDamping = !motionPreference.matches;
      controls.dampingFactor = 0.08;
      controls.minDistance = 2;
      controls.maxDistance = 5.4;
      controls.maxPolarAngle = Math.PI * 0.57;
      controls.minPolarAngle = Math.PI * 0.22;
      controls.update();

      const floor = new THREE.Group();
      const ground = new THREE.Mesh(
        new THREE.CircleGeometry(5, 96),
        new THREE.MeshStandardMaterial({
          color: 0x0b1a1b,
          roughness: 0.85,
          metalness: 0.2,
        }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.012;
      floor.add(ground);
      const grid = new THREE.GridHelper(8, 32, 0x335352, 0x172c2c);
      grid.material.transparent = true;
      grid.material.opacity = 0.33;
      floor.add(grid);
      scene.add(floor);

      const anchor = new THREE.Group();
      scene.add(anchor);
      const title = sceneText(THREE, clue?.title || "现场物证", {
        width: 2.35,
        size: 106,
      });
      title.position.set(0, 1.62, 0);
      anchor.add(title);
      const metadata = sceneText(
        THREE,
        [clue?.id, clue?.area].filter(Boolean).join("   /   ") || "现场搜证",
        { width: 1.55, color: "#9fd0cd", size: 74 },
      );
      metadata.position.set(0, 1.4, 0);
      anchor.add(metadata);

      const rings = new THREE.Group();
      anchor.add(rings);
      [0.59, 0.68, 0.81].forEach((radius, index) => {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(radius, radius + 0.003, 96),
          new THREE.MeshBasicMaterial({
            color: index === 1 ? 0xcead70 : 0x6daaa7,
            transparent: true,
            opacity: index === 1 ? 0.63 : 0.22,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.012 + index * 0.002;
        rings.add(ring);
      });
      for (let index = 0; index < 48; index++) {
        const angle = (index / 48) * Math.PI * 2;
        const length = index % 6 === 0 ? 0.047 : 0.018;
        const geometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(
            Math.cos(angle) * 0.72,
            0.02,
            Math.sin(angle) * 0.72,
          ),
          new THREE.Vector3(
            Math.cos(angle) * (0.72 + length),
            0.02,
            Math.sin(angle) * (0.72 + length),
          ),
        ]);
        rings.add(
          new THREE.Line(
            geometry,
            new THREE.LineBasicMaterial({
              color: 0xd5ba82,
              transparent: true,
              opacity: index % 6 === 0 ? 0.7 : 0.25,
            }),
          ),
        );
      }
      const arc = new THREE.Mesh(
        new THREE.TorusGeometry(0.68, 0.0035, 5, 70, Math.PI * 0.68),
        new THREE.MeshBasicMaterial({
          color: 0x91d9d1,
          transparent: true,
          opacity: 0.77,
          depthWrite: false,
        }),
      );
      arc.rotation.x = -Math.PI / 2;
      const rotatingArc = new THREE.Group();
      rotatingArc.position.y = 0.025;
      rotatingArc.add(arc);
      anchor.add(rotatingArc);

      const pulse = new THREE.Mesh(
        new THREE.RingGeometry(0.6, 0.614, 96),
        new THREE.MeshBasicMaterial({
          color: 0xdac18f,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      pulse.rotation.x = -Math.PI / 2;
      pulse.position.y = 0.028;
      anchor.add(pulse);
      const sweep = new THREE.Mesh(
        new THREE.PlaneGeometry(1.34, 1.34),
        new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          uniforms: { opacity: { value: 0 } },
          vertexShader:
            "varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
          fragmentShader:
            "varying vec2 vUv; uniform float opacity; void main(){ float edge=1.0-smoothstep(0.33,0.5,length(vUv-0.5)); float line=pow(1.0-abs(sin(vUv.x*44.0)),18.0)+pow(1.0-abs(sin(vUv.y*44.0)),18.0); gl_FragColor=vec4(0.42,0.87,0.82,(0.035+line*0.055)*edge*opacity); }",
        }),
      );
      sweep.rotation.x = -Math.PI / 2;
      anchor.add(sweep);
      const sweepEdge = new THREE.Mesh(
        new THREE.TorusGeometry(0.48, 0.002, 4, 64),
        new THREE.MeshBasicMaterial({
          color: 0x85d4ce,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      );
      sweepEdge.rotation.x = -Math.PI / 2;
      anchor.add(sweepEdge);

      const positions = new Float32Array(42 * 3);
      for (let index = 0; index < 42; index++) {
        // Deterministic positions keep the exhibit stable between retries.
        const angle = index * 2.39996;
        const radius = 0.72 + (index % 7) * 0.027;
        positions[index * 3] = Math.cos(angle) * radius;
        positions[index * 3 + 1] = 0.13 + (index / 42) * 1.05;
        positions[index * 3 + 2] = Math.sin(angle) * radius;
      }
      const particleGeometry = new THREE.BufferGeometry();
      particleGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3),
      );
      const particles = new THREE.Points(
        particleGeometry,
        new THREE.PointsMaterial({
          color: 0x8ac1b9,
          size: 0.012,
          transparent: true,
          opacity: 0.32,
          depthWrite: false,
        }),
      );
      anchor.add(particles);

      const reticle = new THREE.Group();
      const reticleRing = new THREE.Mesh(
        new THREE.RingGeometry(0.12, 0.125, 64),
        new THREE.MeshBasicMaterial({
          color: 0xbfe5d4,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      reticleRing.rotation.x = -Math.PI / 2;
      reticle.add(reticleRing);
      const placeHint = sceneText(THREE, "轻点平面 · 放置物证", {
        width: 0.55,
        color: "#e4f3da",
        size: 84,
      });
      placeHint.position.y = 0.12;
      reticle.add(placeHint);
      reticle.visible = false;
      scene.add(reticle);

      current = {
        THREE,
        renderer,
        scene,
        camera,
        controls,
        anchor,
        floor,
        reticle,
        session: null,
        hitSource: null,
        placed: false,
        planeFound: false,
        scanTime: 5,
        scanActive: false,
        elapsed: 0,
        lastTime: null,
        reducedMotion: motionPreference.matches,
        disposed: false,
      };
      resources.current = current;
      current.runScan = () => {
        if (current.disposed) return;
        current.scanTime = 0;
        current.scanActive = true;
        setScanning(true);
      };
      current.stopScan = () => {
        current.scanActive = false;
        sweep.material.uniforms.opacity.value = 0;
        sweepEdge.material.opacity = 0;
        pulse.material.opacity = 0;
        if (!current.disposed) setScanning(false);
      };
      current.place = () => {
        if (!current.session || !reticle.visible || current.placed) return;
        anchor.position.copy(reticle.position);
        anchor.quaternion.copy(reticle.quaternion);
        // The complete scene is a compact, fixed-size exhibit in real space.
        anchor.scale.setScalar(0.58);
        anchor.visible = true;
        current.placed = true;
        reticle.visible = false;
        setXrState("placed");
        current.runScan();
      };
      current.reposition = () => {
        if (!current.session) return;
        current.placed = false;
        current.planeFound = false;
        anchor.visible = false;
        setPlaneFound(false);
        setXrState("searching");
      };
      current.endSession = () => {
        current.hitSource?.cancel();
        current.hitSource = null;
        current.session = null;
        current.placed = false;
        current.planeFound = false;
        current.removeSessionEvents?.();
        if (current.disposed) return;
        anchor.visible = true;
        anchor.position.set(0, 0, 0);
        anchor.quaternion.identity();
        anchor.scale.setScalar(1);
        floor.visible = true;
        reticle.visible = false;
        scene.background = desktopBackground;
        scene.fog = desktopFog;
        controls.enabled = true;
        camera.position.set(1.5, 1.6, 3.5);
        controls.target.set(0, 0.83, 0);
        controls.update();
        setXrState("idle");
        setPlaneFound(false);
        if (!document.hidden) renderer.setAnimationLoop(current.render);
      };

      current.render = (time, frame) => {
        if (current.disposed || document.hidden) return;
        const delta =
          current.lastTime === null
            ? 0
            : Math.min((time - current.lastTime) / 1000, 0.05);
        current.lastTime = time;
        current.elapsed += delta;
        if (frame && current.hitSource && !current.placed) {
          const hit = frame.getHitTestResults(current.hitSource)[0];
          const pose = hit?.getPose(renderer.xr.getReferenceSpace());
          reticle.visible = Boolean(pose);
          if (pose) {
            const matrix = new THREE.Matrix4().fromArray(pose.transform.matrix);
            matrix.decompose(
              reticle.position,
              reticle.quaternion,
              reticle.scale,
            );
          }
          if (current.planeFound !== Boolean(pose)) {
            current.planeFound = Boolean(pose);
            setPlaneFound(Boolean(pose));
          }
        }
        if (!current.reducedMotion) {
          rotatingArc.rotation.y = current.elapsed * 0.19;
          particles.rotation.y = -current.elapsed * 0.028;
        }
        if (current.scanActive) {
          current.scanTime += delta;
          const t = current.scanTime / 3.5;
          const fade = Math.sin(Math.min(t, 1) * Math.PI);
          sweep.visible = !current.reducedMotion;
          sweepEdge.visible = !current.reducedMotion;
          sweep.position.y = 0.11 + Math.min(t, 1) * 1.06;
          sweepEdge.position.y = sweep.position.y;
          sweep.material.uniforms.opacity.value = fade;
          sweepEdge.material.opacity = fade * 0.65;
          pulse.material.opacity = current.reducedMotion
            ? 0
            : Math.max(0, 0.7 - current.scanTime) * 0.48;
          pulse.scale.setScalar(1 + Math.min(current.scanTime, 1.5) * 0.8);
          if (t >= 1) {
            current.scanActive = false;
            sweep.material.uniforms.opacity.value = 0;
            sweepEdge.material.opacity = 0;
            pulse.material.opacity = 0;
            setScanning(false);
          }
        }
        controls.update();
        try {
          renderer.render(scene, camera);
        } catch {
          renderer.setAnimationLoop(null);
          if (!current.disposed) setError("场景渲染中断，请重新加载场景。");
        }
      };
      const resize = () => {
        if (!mount.current || current.disposed || renderer.xr.isPresenting)
          return;
        const { width, height } = mount.current.getBoundingClientRect();
        renderer.setSize(Math.max(width, 1), Math.max(height, 1));
        camera.aspect = Math.max(width, 1) / Math.max(height, 1);
        // The title and model remain visible above the controls on portrait phones.
        camera.fov = width / height < 0.85 ? 53 : 43;
        camera.updateProjectionMatrix();
      };
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(mount.current);
      resize();
      current.resize = resize;
      renderer.setAnimationLoop(current.render);

      current.keyHandler = (event) => {
        if (
          current.session ||
          ![
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
            "+",
            "=",
            "-",
          ].includes(event.key)
        )
          return;
        event.preventDefault();
        const offset = camera.position.clone().sub(controls.target);
        const spherical = new THREE.Spherical().setFromVector3(offset);
        if (event.key === "ArrowLeft") spherical.theta -= 0.11;
        if (event.key === "ArrowRight") spherical.theta += 0.11;
        if (event.key === "ArrowUp") spherical.phi -= 0.08;
        if (event.key === "ArrowDown") spherical.phi += 0.08;
        if (event.key === "+" || event.key === "=") spherical.radius *= 0.9;
        if (event.key === "-") spherical.radius *= 1.1;
        spherical.radius = THREE.MathUtils.clamp(
          spherical.radius,
          controls.minDistance,
          controls.maxDistance,
        );
        spherical.phi = THREE.MathUtils.clamp(
          spherical.phi,
          controls.minPolarAngle,
          controls.maxPolarAngle,
        );
        camera.position
          .copy(controls.target)
          .add(new THREE.Vector3().setFromSpherical(spherical));
        controls.update();
      };
      renderer.domElement.addEventListener("keydown", current.keyHandler);
      current.contextLost = (event) => {
        event.preventDefault();
        renderer.setAnimationLoop(null);
        if (!current.disposed) {
          setReady(false);
          setError("图形环境暂时中断，点击重新加载即可恢复。");
          current.session?.end().catch(() => {});
        }
      };
      renderer.domElement.addEventListener(
        "webglcontextlost",
        current.contextLost,
      );

      if (!clue?.model_url)
        throw new Error("这条线索暂未配置物证模型，仍可在证据册阅读线索。");
      const source = new URL(clue.model_url, window.location.href);
      if (!["https:", "http:"].includes(source.protocol))
        throw new Error("物证模型地址无法读取，请返回证据册重试。");
      const sameOrigin = source.origin === window.location.origin;
      const response = await fetch(source.href, {
        credentials: sameOrigin ? "same-origin" : "omit",
        signal: abort.signal,
      });
      if (!response.ok)
        throw new Error("物证模型读取失败，请确认线索可访问后重试。");
      const data = await response.arrayBuffer();
      if (cancelled) return;
      const loader = new GLTFLoader();
      loader.setWithCredentials(sameOrigin);
      const gltf = await loader.parseAsync(data, new URL(".", source).href);
      if (cancelled) {
        disposeTree(gltf.scene);
        return;
      }
      const model = gltf.scene;
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const largest = Math.max(size.x, size.y, size.z);
      if (!Number.isFinite(largest) || largest <= 0) {
        disposeTree(model);
        throw new Error("物证模型没有可显示的几何内容，请重新加载。");
      }
      const scale = 0.97 / largest;
      const modelGroup = new THREE.Group();
      model.position.sub(center);
      modelGroup.add(model);
      modelGroup.scale.setScalar(scale);
      modelGroup.position.y = 0.22 + (size.y * scale) / 2;
      anchor.add(modelGroup);
      setReady(true);
      current.runScan();
    }

    const hidden = () => {
      if (!current || current.disposed) return;
      current.lastTime = null;
      if (document.hidden) {
        current.stopScan();
        renderer.setAnimationLoop(null);
        current.session?.end().catch(() => {});
      } else renderer.setAnimationLoop(current.render);
    };
    const motionChanged = () => {
      if (!current) return;
      current.reducedMotion = motionPreference.matches;
      current.controls.enableDamping = !motionPreference.matches;
    };
    document.addEventListener("visibilitychange", hidden);
    motionPreference.addEventListener("change", motionChanged);
    prepare().catch((cause) => {
      if (cancelled || cause.name === "AbortError") return;
      setReady(false);
      setError(cause.message || "三维场景暂时无法打开，请重新加载。");
      renderer?.setAnimationLoop(null);
    });
    return () => {
      cancelled = true;
      abort.abort();
      document.removeEventListener("visibilitychange", hidden);
      motionPreference.removeEventListener("change", motionChanged);
      resizeObserver?.disconnect();
      renderer?.setAnimationLoop(null);
      if (current) {
        current.disposed = true;
        renderer.domElement.removeEventListener("keydown", current.keyHandler);
        renderer.domElement.removeEventListener(
          "webglcontextlost",
          current.contextLost,
        );
        if (resources.current === current) resources.current = null;
      }
      const session = current?.session;
      if (session)
        session
          .end()
          .catch(() => {})
          .finally(dispose);
      else dispose();
    };
  }, [clue?.model_url, clue?.id, clue?.title, clue?.area, retry]);

  async function startAR() {
    const current = resources.current;
    if (!current || !ready || current.session || xrState === "starting") return;
    setArError("");
    setXrState("starting");
    let session;
    try {
      // This is deliberately the first asynchronous operation in the user click.
      session = await navigator.xr.requestSession("immersive-ar", {
        requiredFeatures: ["hit-test"],
        optionalFeatures: ["dom-overlay"],
        // Only HUD and controls are overlaid; the canvas must stay in the XR framebuffer.
        domOverlay: { root: overlay.current },
      });
      if (
        resources.current !== current ||
        current.disposed ||
        document.hidden
      ) {
        if (resources.current === current && !current.disposed) {
          setXrState("idle");
          setPlaneFound(false);
        }
        await session.end();
        return;
      }
      current.session = session;
      const select = () =>
        current.placed ? current.runScan() : current.place();
      const ended = () => {
        current.endSession();
        queueMicrotask(() => !current.disposed && current.resize?.());
      };
      session.addEventListener("select", select);
      session.addEventListener("end", ended);
      current.removeSessionEvents = () => {
        session.removeEventListener("select", select);
        session.removeEventListener("end", ended);
      };
      current.anchor.visible = false;
      current.floor.visible = false;
      current.scene.background = null;
      current.scene.fog = null;
      current.controls.enabled = false;
      await current.renderer.xr.setSession(session);
      if (current.disposed || current.session !== session) return;
      const viewerSpace = await session.requestReferenceSpace("viewer");
      if (current.disposed || current.session !== session) return;
      const hitSource = await session.requestHitTestSource({
        space: viewerSpace,
      });
      if (current.disposed || current.session !== session) {
        hitSource.cancel();
        return;
      }
      current.hitSource = hitSource;
      current.placed = false;
      setXrState("searching");
      current.renderer.setAnimationLoop(current.render);
    } catch {
      if (session && current.session === session) {
        await session.end().catch(() => {});
        current.endSession();
      }
      if (resources.current === current && !current.disposed) {
        setXrState("idle");
        setArError(
          "暂时无法启动现实 AR。可继续在三维场景中观察，或允许相机和空间访问后重试。",
        );
      }
    }
  }

  const inAR = xrState === "searching" || xrState === "placed";
  const status = error
    ? "场景需要重新加载"
    : !ready
      ? "正在载入物证与空间文字…"
      : xrState === "starting"
        ? "正在打开现实 AR…"
        : xrState === "searching"
          ? planeFound
            ? "已找到平面 · 轻点放置物证"
            : "缓慢移动手机 · 寻找平面"
          : xrState === "placed"
            ? "物证、标题与扫描光环已放置"
            : "拖动环绕观察 · 双指或滚轮缩放";

  return createPortal(
    <section
      ref={dialog}
      className={`evidence-spatial-scene${inAR ? " is-ar" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
      tabIndex={-1}
      data-testid="spatial-scene"
      data-ready={ready ? "true" : "false"}
      data-mode={inAR ? "ar" : "3d"}
    >
      <h2 id={headingId} className="spatial-sr-only">
        {clue?.title || "物证"} · 空间搜证
      </h2>
      <p id={descriptionId} className="spatial-sr-only">
        物证标题和编号直接显示在三维空间。支持的设备可点击进入现实
        AR，再寻找平面并放置。扫描光带仅为观察动效，证据以线索文字为准。
      </p>
      <div className="spatial-canvas-mount" ref={mount} />
      <div className="spatial-interface" ref={overlay}>
        <div className="spatial-vignette" aria-hidden="true" />
        <div className="spatial-corner spatial-corner-tl" aria-hidden="true" />
        <div className="spatial-corner spatial-corner-tr" aria-hidden="true" />
        <header className="spatial-header">
          <div className="spatial-brand">
            <span className="spatial-live-dot" />
            <span className="spatial-brand-name">ALASKA NIGHTS</span>
            <span className="spatial-brand-divider">/</span>
            <span className="spatial-brand-mode">空间搜证</span>
          </div>
          <div className="spatial-header-controls">
            {audioControls && (
              <div className="spatial-audio-controls">{audioControls}</div>
            )}
            <button
              className="spatial-close"
              type="button"
              onClick={() => close.current?.()}
              aria-label="关闭空间搜证"
            >
              <X size={22} />
            </button>
          </div>
        </header>
        {!ready && !error && (
          <div className="spatial-loading" role="status">
            <span />
            <p>正在打开物证场景</p>
          </div>
        )}
        {error && (
          <div className="spatial-error" role="alert">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              <RotateCcw size={16} />
              重新加载场景
            </button>
          </div>
        )}
        <div className="spatial-hud">
          <div className="spatial-status" role="status" aria-live="polite">
            <span className={scanning ? " is-scanning" : ""} />
            {status}
          </div>
          <div className="spatial-actions">
            {preferAR && (xrSupported || inAR || xrState === "starting") && (
              <button
                className="spatial-action spatial-action-primary"
                type="button"
                disabled={
                  !ready ||
                  Boolean(error) ||
                  xrState === "starting" ||
                  (xrState === "searching" && !planeFound)
                }
                onClick={
                  xrState === "placed"
                    ? () => resources.current?.reposition()
                    : xrState === "searching"
                      ? () => resources.current?.place()
                      : startAR
                }
                data-testid="spatial-start-ar"
              >
                <Crosshair size={18} />
                {xrState === "placed"
                  ? "重新放置"
                  : xrState === "searching"
                    ? "放置物证"
                    : xrState === "starting"
                      ? "正在启动…"
                      : "进入现实 AR"}
              </button>
            )}
            <button
              className="spatial-action"
              type="button"
              onClick={() => resources.current?.runScan()}
              disabled={
                !ready ||
                Boolean(error) ||
                scanning ||
                (inAR && xrState !== "placed")
              }
              data-testid="spatial-scan"
            >
              <ScanLine size={18} />
              {scanning ? "扫描光带中" : "重播扫描"}
            </button>
            {inAR && (
              <button
                className="spatial-action"
                type="button"
                onClick={() =>
                  resources.current?.session?.end().catch(() => {})
                }
              >
                退出 AR
              </button>
            )}
          </div>
          {arError && (
            <p className="spatial-ar-error" role="alert">
              {arError}
            </p>
          )}
          <p className="spatial-note">
            {preferAR && !xrSupported && !inAR
              ? "沉浸 3D 观察 · 现实 AR 需支持 WebXR 的移动设备"
              : "标题跟随物证留在场景中"}
            <span>线索以现场记录为准</span>
          </p>
        </div>
      </div>
    </section>,
    document.body,
  );
}
