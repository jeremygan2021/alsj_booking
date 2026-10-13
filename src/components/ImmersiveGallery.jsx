import React, { useEffect, useRef, useState } from "react";
import { Box, Glasses, LockKeyhole } from "lucide-react";
import { Badge, Button, Modal } from "./ui";
import { EvidenceModelStage, useXrSupport } from "./EvidenceModelViewer";
import "./immersive.css";

// Prepare resources before the click so requestSession retains user activation.
function HeadsetViewer({ clue }) {
  const supported = useXrSupport("immersive-vr");
  const resources = useRef(null);
  const container = useRef(null);
  const [prepared, setPrepared] = useState(false);
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setPrepared(false);
    setActive(false);
    setStarting(false);
    setError("");
    if (!supported || !clue?.model_url) return;
    let cancelled = false;
    const abort = new AbortController();
    let renderer;
    let scene;
    let environment;
    function disposeScene() {
      scene?.traverse((object) => {
        object.geometry?.dispose();
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        materials.forEach((material) => {
          if (!material) return;
          Object.values(material).forEach(
            (value) => value?.isTexture && value.dispose(),
          );
          material.dispose();
        });
      });
      environment?.dispose();
      renderer?.setAnimationLoop(null);
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderer?.domElement.remove();
    }
    async function prepare() {
      const [THREE, { GLTFLoader }, { RoomEnvironment }] = await Promise.all([
        import("three"),
        import("three/addons/loaders/GLTFLoader.js"),
        import("three/addons/environments/RoomEnvironment.js"),
      ]);
      if (cancelled) return;
      const response = await fetch(clue.model_url, {
        credentials: "same-origin",
        signal: abort.signal,
      });
      if (!response.ok)
        throw new Error("模型读取失败，请确认已登录并解锁该线索。");
      const data = await response.arrayBuffer();
      if (cancelled) return;
      const gltf = await new GLTFLoader().parseAsync(data, "");
      scene = new THREE.Scene();
      scene.background = new THREE.Color("#101914");
      scene.add(gltf.scene);
      if (cancelled) {
        disposeScene();
        return;
      }
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(640, 400);
      renderer.xr.enabled = true;
      renderer.xr.setReferenceSpaceType("local-floor");
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      container.current?.appendChild(renderer.domElement);
      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      environment = pmrem.fromScene(room, 0.04);
      scene.environment = environment.texture;
      room.dispose();
      pmrem.dispose();
      scene.add(new THREE.HemisphereLight(0xffebcc, 0x405047, 2));
      const key = new THREE.DirectionalLight(0xffe1b0, 2);
      key.position.set(1, 3, 1);
      scene.add(key);
      const bounds = new THREE.Box3().setFromObject(gltf.scene);
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const scale = 0.65 / Math.max(size.x, size.y, size.z);
      gltf.scene.position.sub(center);
      const model = new THREE.Group();
      scene.remove(gltf.scene);
      model.add(gltf.scene);
      model.scale.setScalar(scale);
      model.position.set(0, 1.25 + (size.y * scale) / 2, -1.6);
      scene.add(model);
      const pedestal = new THREE.Mesh(
        new THREE.CylinderGeometry(0.46, 0.5, 1.25, 48),
        new THREE.MeshStandardMaterial({
          color: 0x202b25,
          roughness: 0.55,
          metalness: 0.25,
        }),
      );
      pedestal.position.set(0, 0.625, -1.6);
      scene.add(pedestal);
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(10, 10),
        new THREE.MeshStandardMaterial({ color: 0x1a211d, roughness: 0.9 }),
      );
      floor.rotation.x = -Math.PI / 2;
      scene.add(floor);
      const camera = new THREE.PerspectiveCamera(60, 1.6, 0.01, 50);
      camera.position.set(0, 1.6, 0);
      for (let index = 0; index < 2; index += 1) {
        const controller = renderer.xr.getController(index);
        controller.addEventListener("select", () => {
          model.rotation.y += Math.PI / 8;
        });
        scene.add(controller);
      }
      resources.current = { renderer, scene, camera, session: null };
      setPrepared(true);
    }
    prepare().catch((cause) => {
      if (!cancelled && cause.name !== "AbortError")
        setError(cause.message || "VR 展示准备失败，请重试。");
      disposeScene();
    });
    return () => {
      cancelled = true;
      abort.abort();
      const current = resources.current;
      resources.current = null;
      current?.session?.end().catch(() => {});
      disposeScene();
    };
  }, [supported, clue?.model_url, retry]);

  async function enter() {
    const current = resources.current;
    if (!current || starting || active) return;
    setStarting(true);
    setError("");
    try {
      // Request in the click handler. Private assets stay within this origin.
      const session = await navigator.xr.requestSession("immersive-vr", {
        requiredFeatures: ["local-floor"],
      });
      if (resources.current !== current) {
        await session.end();
        return;
      }
      current.session = session;
      session.addEventListener(
        "end",
        () => {
          current.session = null;
          current.renderer.setAnimationLoop(null);
          if (resources.current === current) setActive(false);
        },
        { once: true },
      );
      try {
        await current.renderer.xr.setSession(session);
        if (resources.current !== current) {
          await session.end().catch(() => {});
          return;
        }
        current.renderer.setAnimationLoop(() =>
          current.renderer.render(current.scene, current.camera),
        );
      } catch (cause) {
        await session.end();
        throw cause;
      }
      if (resources.current === current) setActive(true);
    } catch {
      if (resources.current === current)
        setError(
          "暂时连不上头显，请确认已连接并允许空间访问，也可继续在上方查看证物。",
        );
    } finally {
      if (resources.current === current) setStarting(false);
    }
  }

  return (
    <div className="model-vr-panel" data-testid="headset-viewer">
      <div className="model-vr-canvas" ref={container} aria-hidden="true" />
      <div>
        <p>
          {supported
            ? "戴上头显环绕观察；手柄扳机可转动证物，系统菜单可退出。"
            : "这台设备暂不能连接 VR 头显，仍可在上方拖动查看证物。"}
        </p>
      </div>
      <Button
        disabled={!supported || !prepared || starting}
        onClick={active ? () => resources.current?.session?.end() : enter}
      >
        {active
          ? "退出 VR"
          : starting
            ? "正在连接头显…"
            : supported && !prepared && !error
              ? "正在准备 VR…"
              : "进入 VR 头显"}
      </Button>
      {error && (
        <div className="model-error" role="alert">
          <p>{error}</p>
          {!prepared && (
            <Button kind="ghost" onClick={() => setRetry((value) => value + 1)}>
              重新准备 VR
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function HeadsetOption({ clue }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      className="model-options model-headset-option"
      data-testid="headset-options"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        <Glasses size={17} /> 使用VR头显（可选）
      </summary>
      {expanded && <HeadsetViewer clue={clue} />}
    </details>
  );
}

export default function ImmersiveGallery({ clues = [], onClose }) {
  const available = clues.filter((clue) => Boolean(clue.model_url));
  const [selectedId, setSelectedId] = useState(available[0]?.id || "");
  const selected =
    available.find((clue) => clue.id === selectedId) || available[0];
  return (
    <Modal title="360°证物查看" onClose={onClose} wide>
      <div className="immersive-gallery" data-testid="immersive-gallery">
        <p className="gallery-intro">选择已找到的证物，拖动查看每一面。</p>
        {!selected ? (
          <div className="empty">
            <LockKeyhole size={30} />
            <h3>展厅等待第一件物证</h3>
            <p>先在搜证入口扫描现场二维码、解锁线索，再回来环绕查看模型。</p>
            <Button onClick={onClose}>返回搜证</Button>
          </div>
        ) : (
          <>
            <div className="gallery-model-grid" aria-label="选择已解锁物证">
              {available.map((clue) => (
                <button
                  className={`gallery-model-card ${selected.id === clue.id ? "selected" : ""}`}
                  key={clue.id}
                  onClick={() => setSelectedId(clue.id)}
                  aria-pressed={selected.id === clue.id}
                >
                  <Box size={20} />
                  <span>
                    <strong>
                      {clue.id} · {clue.title}
                    </strong>
                    <small>
                      {clue.area} · {clue.model_label || "物证模型"}
                    </small>
                  </span>
                </button>
              ))}
            </div>
            <EvidenceModelStage
              key={`stage-${selected.id}`}
              clue={selected}
              mode="vr"
            />
            <article className="model-evidence-copy">
              <Badge tone="gold">
                {selected.id} · {selected.area}
              </Badge>
              <h3>{selected.title}</h3>
              <p>{selected.body}</p>
              {selected.detail && (
                <div className="advanced">
                  <span className="eyebrow">已完成鉴定 · 进阶细节</span>
                  <p>{selected.detail}</p>
                </div>
              )}
            </article>
            <HeadsetOption
              key={`headset-option-${selected.id}`}
              clue={selected}
            />
          </>
        )}
      </div>
    </Modal>
  );
}
