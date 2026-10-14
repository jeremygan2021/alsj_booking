import { createQrFrameTracker } from "./qr-frame-tracker.js";
import { createEvidencePresentation } from "./qr-evidence-presentation.js";
import { createCastleInvitation } from "./castle-invitation.js";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { parseClueCode, parseInvestigationNode } from "../../clue-scan.js";
import { estimateQrPose } from "./qr-pose.js";

// The displayed video and the camera projection share the same centred cover crop.
export function getCoverProjection(
  videoWidth,
  videoHeight,
  width,
  height,
  focalLength,
) {
  const scale = Math.max(width / videoWidth, height / videoHeight);
  return {
    scale,
    offsetX: (width - videoWidth * scale) / 2,
    offsetY: (height - videoHeight * scale) / 2,
    aspect: width / height,
    fov: (2 * Math.atan(height / (2 * focalLength * scale)) * 180) / Math.PI,
  };
}

function disposeTree(root) {
  const textures = new Set();
  const materials = new Set();
  const geometries = new Set();
  root?.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material]) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material))
        if (value?.isTexture) textures.add(value);
    }
  });
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
}

export function createQrSceneRuntime({
  container,
  video,
  polygon,
  signal,
  initialClueId,
  onState,
  onClue,
  onInteraction,
  onAcceptInvitation,
  onExperienceState,
  onSound,
  onUserGesture,
}) {
  let stopped = false;
  let mediaStream, renderer, environment, camera, scene, anchor, raf;
  let currentId = null,
    currentClue = null,
    model = null,
    modelId = null;
  let requestVersion = 0,
    requestController = null;
  let lastState = "",
    lastFrame = -1,
    lastDecodedAt = 0;
  let lastFocalLength = null,
    lastVideoSize = "";
  let candidateFocal = null,
    candidateFrames = 0;
  let hasLocated = false,
    unavailableId = null;
  let lastExperienceState = "";
  let lastNotifiedId = null,
    lastInteractionLabel = "";
  let presentation,
    lastTrackedAt = -Infinity,
    opacity = 0,
    lastRenderAt = 0;
  let reliable = false,
    pointerStart;
  const tracker = createQrFrameTracker();
  const raycaster = new THREE.Raycaster();
  const metadata = new Map();
  const loader = new GLTFLoader();
  const decodeCanvas = document.createElement("canvas");
  const decodeContext = decodeCanvas.getContext("2d", {
    willReadFrequently: true,
  });
  const corners = [
    "topLeftCorner",
    "topRightCorner",
    "bottomRightCorner",
    "bottomLeftCorner",
  ];
  let width = 1,
    height = 1;

  const state = (name, extras = {}) => {
    if (stopped) return;
    container.dataset.trackingState = name;
    if (name !== lastState || extras.error || extras.clue) {
      lastState = name;
      onState({ status: name, ...extras });
    }
  };
  const hide = () => {
    opacity = 0;
    lastTrackedAt = -Infinity;
    reliable = false;
    if (anchor) anchor.visible = false;
    polygon.style.display = "none";
    container.dataset.modelVisible = "false";
    container.dataset.anchorVisible = "false";
    delete container.dataset.markerCorners;
    delete container.dataset.videoCorners;
    delete container.dataset.projectionCorners;
    delete container.dataset.markerCenter;
    delete container.dataset.poseMatrix;
  };
  const interact = () => {
    onUserGesture?.();
    if (
      stopped ||
      !reliable ||
      !anchor?.visible ||
      opacity < 0.8 ||
      modelId !== currentId
    )
      return false;
    const interaction = presentation.toggle();
    container.dataset.interaction = interaction.opened ? "opened" : "closed";
    onInteraction?.(interaction);
    return true;
  };
  const pointerDown = (event) => {
    onUserGesture?.();
    pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
  };
  const pointerUp = (event) => {
    if (
      !pointerStart ||
      pointerStart.id !== event.pointerId ||
      Math.hypot(
        event.clientX - pointerStart.x,
        event.clientY - pointerStart.y,
      ) > 12
    )
      return;
    pointerStart = null;
    const rect = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((event.clientY - rect.top) / rect.height) * 2,
      ),
      camera,
    );
    scene.updateMatrixWorld(true);
    if (!anchor.visible || !reliable || opacity < 0.8 || modelId !== currentId)
      return;
    const hits = raycaster.intersectObject(anchor, true);
    if (!hits.length) return;
    let selected = hits[0].object;
    while (selected && selected !== anchor) {
      if (selected.userData.action === "acceptInvitation") {
        if (presentation.acceptEnabled) onAcceptInvitation?.();
        return;
      }
      if (selected.userData.action === "castleGuide") {
        presentation.greet?.();
        return;
      }
      if (selected.userData.action === "walkCastle") {
        presentation.walkTo?.(hits[0].point);
        return;
      }
      selected = selected.parent;
    }
    interact();
  };
  const render = (time) => {
    const age = time - lastTrackedAt;
    const target = modelId === currentId && age < 140 ? 1 : 0;
    const dt = Math.min(64, time - lastRenderAt || 16);
    lastRenderAt = time;
    opacity = THREE.MathUtils.clamp(
      opacity + ((target ? 1 : -1) * dt) / (target ? 260 : 130),
      0,
      1,
    );
    anchor.visible = Boolean(
      presentation && opacity > 0 && modelId === currentId,
    );
    if (presentation) {
      if (!reliable || opacity < 0.8) presentation.move?.({ x: 0, y: 0 });
      container.dataset.animationProgress = presentation
        .update(time, opacity, camera, reliable)
        .toFixed(3);
      container.dataset.modelKind = presentation.kind;
      const experience = presentation.experienceState;
      const experienceKey =
        experience &&
        JSON.stringify([
          experience.phase,
          experience.view.id,
          experience.zoom,
          experience.autoEntering,
          experience.adventure.collected,
          experience.adventure.jumpReady,
          experience.adventure.feedback,
        ]);
      if (experience && experienceKey !== lastExperienceState) {
        lastExperienceState = experienceKey;
        onExperienceState?.(experience);
      }
      if (experience) {
        container.dataset.autoEntering = String(experience.autoEntering);
        container.dataset.viewPreset = experience.view.id;
        container.dataset.modelZoom = String(experience.zoom);
        container.dataset.viewMatrix = JSON.stringify(
          presentation.root.userData.viewMatrix,
        );
        container.dataset.guestPosition = JSON.stringify(
          presentation.root.userData.guestPosition,
        );
      }
      if (presentation.root.userData.phase)
        container.dataset.experiencePhase = presentation.root.userData.phase;
      const nextInteraction = presentation.interaction;
      container.dataset.interaction = nextInteraction.opened
        ? "opened"
        : "closed";
      if (nextInteraction.label !== lastInteractionLabel) {
        lastInteractionLabel = nextInteraction.label;
        onInteraction?.(nextInteraction);
      }
    }
    container.dataset.modelVisible = String(anchor.visible);
    container.dataset.anchorVisible = String(anchor.visible);
    container.dataset.interactionReady = String(
      reliable && opacity > 0.8 && anchor.visible,
    );
    container.dataset.modelOpacity = opacity.toFixed(3);
    if (
      age >= 140 &&
      hasLocated &&
      !["unknown", "loading", "error"].includes(lastState)
    )
      state("lost");
    renderer.render(scene, camera);
  };
  const resize = () => {
    width = Math.max(container.clientWidth, 1);
    height = Math.max(container.clientHeight, 1);
    renderer?.setSize(width, height, false);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    requestVersion++;
    requestController?.abort();
    observer.disconnect();
    mediaStream?.getTracks().forEach((track) => track.stop());
    video.pause();
    video.srcObject = null;
    hide();
    disposeTree(scene);
    environment?.dispose();
    renderer?.domElement.removeEventListener("pointerdown", pointerDown);
    renderer?.domElement.removeEventListener("pointerup", pointerUp);
    renderer?.dispose();
    renderer?.forceContextLoss();
    renderer?.domElement.remove();
    signal.removeEventListener("abort", cleanup);
  };
  signal.addEventListener("abort", cleanup, { once: true });

  const loadClue = async (id) => {
    if (id === modelId) return;
    const version = ++requestVersion;
    requestController?.abort();
    requestController = new AbortController();
    const requestSignal = requestController.signal;
    state("loading");
    try {
      let clue = metadata.get(id);
      if (!clue) {
        const response = await fetch(
          `/api/ar/${id.startsWith("AR-") ? "nodes" : "clues"}/${encodeURIComponent(id)}`,
          { signal: requestSignal },
        );
        if (!response.ok)
          throw new Error(
            response.status === 404
              ? "这个二维码没有对应的证物。"
              : "证物暂时无法读取，请重试。",
          );
        clue = await response.json();
        if (!clue.model_url || clue.id !== id)
          throw new Error("这个二维码没有对应的证物模型。");
        metadata.set(id, clue);
      }
      if (stopped || version !== requestVersion) return;
      currentClue = clue;
      onState({ status: "loading", clue });
      const url = new URL(clue.model_url, window.location.origin);
      if (
        url.origin !== window.location.origin ||
        !url.pathname.startsWith("/api/ar/models/")
      )
        throw new Error("证物模型地址不可用。");
      const response = await fetch(url, { signal: requestSignal });
      if (!response.ok) throw new Error("证物模型暂时无法读取，请重试。");
      const buffer = await response.arrayBuffer();
      if (stopped || version !== requestVersion) return;
      const gltf = await loader.parseAsync(
        buffer,
        `${url.origin}/api/ar/models/`,
      );
      if (stopped || version !== requestVersion) {
        disposeTree(gltf.scene);
        return;
      }
      const nextPresentation =
        clue.presentation === "invitation"
          ? await createCastleInvitation(clue, undefined, (event) => {
              if (!stopped && modelId === id && reliable && opacity > 0.8)
                onSound?.(event);
            })
          : createEvidencePresentation(gltf.scene);
      if (clue.presentation === "invitation") disposeTree(gltf.scene);
      if (stopped || version !== requestVersion) {
        disposeTree(nextPresentation.root);
        return;
      }
      const nextModel = nextPresentation.root;
      if (model) {
        anchor.remove(model);
        disposeTree(model);
      }
      model = nextModel;
      presentation = nextPresentation;
      opacity = 0;
      container.dataset.interaction = "closed";
      onInteraction?.(presentation.interaction);
      lastInteractionLabel = presentation.interaction.label;
      lastExperienceState = "";
      if (clue.presentation !== "invitation") {
        onExperienceState?.(null);
        for (const key of [
          "autoEntering",
          "viewPreset",
          "modelZoom",
          "viewMatrix",
          "guestPosition",
          "experiencePhase",
        ])
          delete container.dataset[key];
      }
      modelId = id;
      unavailableId = null;
      anchor.add(model);
      state("searching", { clue });
    } catch (error) {
      if (stopped || version !== requestVersion || error.name === "AbortError")
        return;
      unavailableId = id;
      hide();
      state("unknown", { error: error.message });
    }
  };

  const tick = (time) => {
    if (stopped) return;
    raf = requestAnimationFrame(tick);
    if (video.readyState < 2 || !video.videoWidth) return;
    // Decode each new camera frame; do not repeat work at display refresh rate.
    if (video.currentTime === lastFrame) {
      if (time - lastDecodedAt > 140) reliable = false;
      render(time);
      return;
    }
    lastFrame = video.currentTime;
    lastDecodedAt = time;
    const videoWidth = video.videoWidth,
      videoHeight = video.videoHeight;
    const sizeKey = `${videoWidth}:${videoHeight}`;
    if (sizeKey !== lastVideoSize) {
      lastVideoSize = sizeKey;
      lastFocalLength = null;
      candidateFocal = null;
      candidateFrames = 0;
      const downscale = Math.min(1, 720 / Math.max(videoWidth, videoHeight));
      decodeCanvas.width = Math.round(videoWidth * downscale);
      decodeCanvas.height = Math.round(videoHeight * downscale);
      container.dataset.videoSize = `${videoWidth},${videoHeight}`;
    }
    decodeContext.drawImage(
      video,
      0,
      0,
      decodeCanvas.width,
      decodeCanvas.height,
    );
    const pixels = decodeContext.getImageData(
      0,
      0,
      decodeCanvas.width,
      decodeCanvas.height,
    );
    const started = performance.now();
    const qr = tracker.update(pixels, time);
    container.dataset.trackingSource = qr?.source || "hold";
    container.dataset.trackedPoints = String(qr?.points || 0);
    container.dataset.decodeMs = (performance.now() - started).toFixed(1);
    const id =
      qr &&
      (parseInvestigationNode(qr.data, window.location.origin) ||
        parseClueCode(qr.data, window.location.origin));
    if (!id) {
      reliable = false;
      if (qr) {
        hide();
        currentId = null;
        container.dataset.activeClue = "";
        container.dataset.clueId = "";
        requestVersion++;
        requestController?.abort();
        state("unknown");
      } else if (time - lastTrackedAt >= 140)
        state(hasLocated ? "lost" : "searching");
      render(time);
      return;
    }
    if (id !== currentId) {
      // Returning to the already-loaded marker must also cancel a newer load.
      requestVersion++;
      requestController?.abort();
      currentId = id;
      unavailableId = null;
      container.dataset.activeClue = id;
      container.dataset.clueId = id;
      hide();
      if (modelId !== id) void loadClue(id);
      else if (currentClue?.id !== id) {
        currentClue = metadata.get(id);
        state("searching", { clue: currentClue });
      }
    }
    if (unavailableId === id) {
      hide();
      state("unknown");
      render(time);
      return;
    }
    if (metadata.has(id) && lastNotifiedId !== id) {
      lastNotifiedId = id;
      Promise.resolve()
        .then(() => {
          if (!stopped) return onClue?.(id);
        })
        .catch(() => {});
    }
    const fullCorners = Object.fromEntries(
      corners.map((key) => [
        key,
        {
          x: (qr.location[key].x * videoWidth) / decodeCanvas.width,
          y: (qr.location[key].y * videoHeight) / decodeCanvas.height,
        },
      ]),
    );
    let pose = estimateQrPose(
      fullCorners,
      videoWidth,
      videoHeight,
      lastFocalLength ? { focalLength: lastFocalLength } : {},
    );
    // A frontal square cannot calibrate the camera. Recover when later tilt
    // exposes a wrong fallback, and accept a better stable focal estimate.
    if (lastFocalLength && (!pose || pose.reprojectionError > 0.8)) {
      const inferred = estimateQrPose(fullCorners, videoWidth, videoHeight);
      if (
        inferred &&
        (!pose || inferred.reprojectionError < pose.reprojectionError * 0.65)
      ) {
        if (
          candidateFocal &&
          Math.abs(inferred.focalLength / candidateFocal - 1) < 0.08
        )
          candidateFrames++;
        else {
          candidateFocal = inferred.focalLength;
          candidateFrames = 1;
        }
        if (!pose || candidateFrames >= 3) pose = inferred;
      } else {
        candidateFocal = null;
        candidateFrames = 0;
      }
    }
    if (
      !pose ||
      pose.reprojectionError > Math.max(videoWidth, videoHeight) * 0.025
    ) {
      reliable = false;
      if (time - lastTrackedAt >= 140) state(hasLocated ? "lost" : "searching");
      render(time);
      return;
    }
    lastTrackedAt = time;
    reliable = true;
    lastFocalLength = pose.focalLength;
    const projection = getCoverProjection(
      videoWidth,
      videoHeight,
      width,
      height,
      pose.focalLength,
    );
    camera.fov = projection.fov;
    camera.aspect = projection.aspect;
    camera.updateProjectionMatrix();
    anchor.matrix.copy(pose.matrix);
    anchor.matrixWorldNeedsUpdate = true;
    const displayedCorners = corners.map((key) => ({
      x: fullCorners[key].x * projection.scale + projection.offsetX,
      y: fullCorners[key].y * projection.scale + projection.offsetY,
    }));
    polygon.setAttribute(
      "points",
      displayedCorners.map((point) => `${point.x},${point.y}`).join(" "),
    );
    polygon.style.display = "none";
    anchor.visible = modelId === id;
    container.dataset.modelVisible = String(anchor.visible);
    container.dataset.anchorVisible = String(anchor.visible);
    container.dataset.markerCorners = JSON.stringify(displayedCorners);
    container.dataset.videoCorners = JSON.stringify(
      corners.map((key) => fullCorners[key]),
    );
    const projectedCorners = [
      [-0.5, 0.5],
      [0.5, 0.5],
      [0.5, -0.5],
      [-0.5, -0.5],
    ].map(([x, y]) => {
      const point = new THREE.Vector3(x, y, 0)
        .applyMatrix4(pose.matrix)
        .project(camera);
      return {
        x: ((point.x + 1) * width) / 2,
        y: ((1 - point.y) * height) / 2,
      };
    });
    container.dataset.projectionCorners = JSON.stringify(projectedCorners);
    container.dataset.markerCenter = JSON.stringify({
      x: displayedCorners.reduce((sum, point) => sum + point.x, 0) / 4,
      y: displayedCorners.reduce((sum, point) => sum + point.y, 0) / 4,
    });
    container.dataset.poseMatrix = JSON.stringify(pose.matrix.elements);
    container.dataset.reprojectionError = pose.reprojectionError.toFixed(2);
    container.dataset.focalLength = pose.focalLength.toFixed(3);
    hasLocated ||= anchor.visible;
    state(anchor.visible ? "located" : "loading");
    render(time);
  };

  const start = async () => {
    state("requesting");
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error("请在安全连接中用手机浏览器打开，并允许使用摄像头。");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
      });
      if (stopped || signal.aborted) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      mediaStream = stream;
      video.srcObject = stream;
      await video.play();
      if (stopped || signal.aborted) return;
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.domElement.dataset.testid = "qr-tracking-canvas";
      renderer.domElement.setAttribute("aria-hidden", "true");
      container.appendChild(renderer.domElement);
      renderer.domElement.addEventListener("pointerdown", pointerDown);
      renderer.domElement.addEventListener("pointerup", pointerUp);
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(60, 1, 0.005, 100);
      anchor = new THREE.Group();
      anchor.matrixAutoUpdate = false;
      anchor.visible = false;
      scene.add(anchor);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x30443e, 1.5));
      const light = new THREE.DirectionalLight(0xffefd6, 2.5);
      light.position.set(1, 3, 5);
      scene.add(light);
      const room = new RoomEnvironment();
      const pmrem = new THREE.PMREMGenerator(renderer);
      environment = pmrem.fromScene(room, 0.04);
      scene.environment = environment.texture;
      room.dispose();
      pmrem.dispose();
      resize();
      state("searching");
      if (/^(?:E-\d{2}|AR-0[1-6]|AR-INV)$/.test(initialClueId || ""))
        void loadClue(initialClueId);
      raf = requestAnimationFrame(tick);
    } catch (error) {
      if (stopped || signal.aborted) return;
      mediaStream?.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
      const denied = error.name === "NotAllowedError";
      const missing = error.name === "NotFoundError";
      state("error", {
        error: denied
          ? "请允许使用摄像头，再点重试。"
          : missing
            ? "没有找到可用的摄像头，请使用手机打开。"
            : error.message || "摄像头暂时无法打开，请重试。",
      });
    }
  };
  if (signal.aborted) cleanup();
  else void start();
  return {
    cleanup,
    interact,
    cycleView: () => {
      onUserGesture?.();
      if (reliable && opacity > 0.8 && modelId === currentId)
        presentation?.cycleView?.();
    },
    changeZoom: (delta) => {
      if (reliable && opacity > 0.8 && modelId === currentId)
        presentation?.changeZoom?.(delta);
    },
    jump: () => {
      onUserGesture?.();
      if (reliable && opacity > 0.8 && modelId === currentId)
        presentation?.jump?.();
    },
    move: (vector) => {
      if (reliable && opacity > 0.8 && modelId === currentId)
        presentation?.move?.(vector);
    },
    restartGame: () => presentation?.restartGame?.(),
    retryModel() {
      if (currentId) {
        unavailableId = null;
        void loadClue(currentId);
      }
    },
  };
}
