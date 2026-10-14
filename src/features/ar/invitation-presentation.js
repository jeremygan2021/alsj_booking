import * as THREE from "three";

// Everything is rendered in the tracked QR's local 3D space, including the poster.
export async function createInvitationPresentation(clue) {
  const root = new THREE.Group();
  root.name = "Aurora_Invitation";
  const cream = new THREE.MeshStandardMaterial({
    color: 0xf5ecdc,
    roughness: 0.85,
    side: THREE.DoubleSide,
  });
  const gold = new THREE.MeshStandardMaterial({
    color: 0xc8a35c,
    metalness: 0.72,
    roughness: 0.28,
  });
  const black = new THREE.MeshStandardMaterial({
    color: 0x141c24,
    metalness: 0.3,
    roughness: 0.45,
  });
  const mesh = (geometry, material, parent = root) => {
    const m = new THREE.Mesh(geometry, material);
    parent.add(m);
    return m;
  };
  const slab = (w, h, d, x, y, z, material, parent = root) => {
    const m = mesh(new THREE.BoxGeometry(w, h, d), material, parent);
    m.position.set(x, y, z);
    return m;
  };
  const texture = (draw, w = 1024, h = 512) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const panel = (w, h, t, parent = root) =>
    mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        map: t,
        side: THREE.DoubleSide,
        transparent: true,
      }),
      parent,
    );
  const paperGrain = texture(
    (c, w, h) => {
      c.fillStyle = "#c9c9c9";
      c.fillRect(0, 0, w, h);
      for (let i = 0; i < 16000; i++) {
        const x = (i * 97) % w,
          y = (i * 193 + Math.floor(i / w) * 37) % h;
        c.fillStyle = i % 3 ? "#dedede" : "#ababab";
        c.fillRect(x, y, 1 + (i % 3), 1);
      }
    },
    512,
    512,
  );
  paperGrain.colorSpace = THREE.NoColorSpace;
  paperGrain.wrapS = paperGrain.wrapT = THREE.RepeatWrapping;
  cream.bumpMap = paperGrain;
  cream.bumpScale = 0.0012;
  black.map = texture(
    (c, w, h) => {
      const gradient = c.createLinearGradient(0, 0, w, h);
      gradient.addColorStop(0, "#233b41");
      gradient.addColorStop(1, "#0e1923");
      c.fillStyle = gradient;
      c.fillRect(0, 0, w, h);
      c.strokeStyle = "#47605e";
      c.lineWidth = 1;
      for (let i = -h; i < w; i += 32) {
        c.beginPath();
        c.moveTo(i, 0);
        c.lineTo(i + h, h);
        c.stroke();
        c.beginPath();
        c.moveTo(i + h, 0);
        c.lineTo(i, h);
        c.stroke();
      }
    },
    512,
    512,
  );
  const sealMap = texture(
    (c, w, h) => {
      c.fillStyle = "#111b24";
      c.fillRect(0, 0, w, h);
      c.strokeStyle = "#d8b36c";
      c.lineWidth = 9;
      c.beginPath();
      c.arc(w / 2, h / 2, h * 0.43, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = "#e6c489";
      c.textAlign = "center";
      c.font = "italic 180px Georgia";
      c.fillText("AN", w / 2, h * 0.67);
    },
    512,
    512,
  );
  const inviteMap = texture((c, w, h) => {
    c.fillStyle = "#10262c";
    c.fillRect(0, 0, w, h);
    c.strokeStyle = "#c7a568";
    c.lineWidth = 5;
    c.strokeRect(24, 24, w - 48, h - 48);
    c.fillStyle = "#d8b87d";
    c.textAlign = "center";
    c.font = "32px Georgia";
    c.fillText("THE THORNE ESTATE", w / 2, 85);
    c.fillStyle = "#fbf0d9";
    c.font = "bold 62px serif";
    c.fillText("庄园之邀", w / 2, 172);
    c.font = "30px serif";
    c.fillText("2026年10月31日", w / 2, 242);
    c.font = "25px serif";
    c.fillText("50名玩家 · 6名NPC演员", w / 2, 302);
    c.fillStyle = "#b7e0d4";
    c.font = "26px serif";
    c.fillText("有些真相，从不长眠。", w / 2, 376);
    c.fillStyle = "#d8b87d";
    c.font = "20px Georgia";
    c.fillText("Some truths never stay buried.", w / 2, 426);
  });
  const statusMap = texture(
    (c, w, h) => {
      c.fillStyle = "rgba(15,47,40,.96)";
      c.beginPath();
      c.roundRect(8, 8, w - 16, h - 16, 38);
      c.fill();
      c.strokeStyle = "#d8b779";
      c.lineWidth = 7;
      c.stroke();
      c.fillStyle = "#f6dfab";
      c.textAlign = "center";
      c.font = "bold 92px serif";
      c.fillText(clue.invitation_valid ? "邀请有效" : "邀请已结束", w / 2, 140);
      c.font = "32px Georgia";
      c.fillText("31 OCT 2026 · ALASKA NIGHT", w / 2, 209);
      c.font = "28px serif";
      c.fillText("活动邀请 · 入场以报名确认为准", w / 2, 266);
    },
    1024,
    320,
  );
  const posterTexture = await new THREE.TextureLoader().loadAsync(
    clue.poster_url,
  );
  posterTexture.colorSpace = THREE.SRGBColorSpace;
  // An opaque embossed envelope hides the printed marker behind the invitation.
  const backing = new THREE.Group();
  root.add(backing);
  slab(1.52, 1.52, 0.025, 0, 0, 0.015, black, backing);
  slab(1.47, 1.47, 0.014, 0, 0, 0.035, gold, backing);
  slab(1.43, 1.43, 0.01, 0, 0, 0.048, black, backing);
  for (const x of [-0.64, 0.64])
    for (const y of [-0.64, 0.64]) {
      const corner = mesh(
        new THREE.TorusGeometry(0.053, 0.004, 6, 24),
        gold,
        backing,
      );
      corner.position.set(x, y, 0.059);
      slab(0.095, 0.004, 0.005, x, y, 0.06, gold, backing).rotation.z =
        Math.PI / 4;
    }
  const envelope = new THREE.Group();
  root.add(envelope);
  envelope.position.set(0, -0.39, 0.1);
  slab(1.34, 0.77, 0.052, 0, 0, 0, cream, envelope);
  // Embossed seams are line segments rather than filled triangles.
  const edgeLine = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.34, 0.77, 0.055)),
    new THREE.LineBasicMaterial({ color: 0xc7a568 }),
  );
  envelope.add(edgeLine);
  const flap = new THREE.Group();
  envelope.add(flap);
  flap.position.set(0, 0.385, 0.044);
  const shape = new THREE.Shape();
  shape.moveTo(-0.67, 0);
  shape.lineTo(0.67, 0);
  shape.lineTo(0, -0.49);
  shape.closePath();
  mesh(new THREE.ShapeGeometry(shape), cream, flap);
  const seal = new THREE.Group();
  envelope.add(seal);
  seal.position.set(0, -0.055, 0.075);
  const waxMaterial = new THREE.MeshStandardMaterial({
    color: 0x792b36,
    roughness: 0.5,
    metalness: 0.12,
    bumpMap: paperGrain,
    bumpScale: 0.0008,
  });
  const wax = mesh(
    new THREE.CylinderGeometry(0.119, 0.126, 0.027, 48),
    waxMaterial,
    seal,
  );
  wax.rotation.x = Math.PI / 2;
  const sealFace = mesh(
    new THREE.CircleGeometry(0.103, 48),
    new THREE.MeshBasicMaterial({ map: sealMap }),
    seal,
  );
  sealFace.position.z = 0.015;
  const sealRim = mesh(
    new THREE.TorusGeometry(0.109, 0.003, 8, 48),
    gold,
    seal,
  );
  sealRim.position.z = 0.016;
  const coverText = panel(0.84, 0.42, inviteMap, envelope);
  coverText.position.set(0, -0.13, 0.034);
  const card = new THREE.Group();
  root.add(card);
  slab(0.89, 1.6, 0.048, 0, 0, 0, gold, card);
  slab(0.865, 1.575, 0.023, 0, 0, 0.026, cream, card);
  const poster = panel(0.84, 1.493, posterTexture, card);
  poster.position.z = 0.04;
  for (const x of [-0.431, 0.431])
    slab(0.012, 1.57, 0.019, x, 0, 0.043, gold, card);
  for (const y of [-0.785, 0.785])
    slab(0.87, 0.012, 0.019, 0, y, 0.043, gold, card);
  const back = panel(0.84, 0.42, inviteMap, card);
  back.position.set(0, 0, -0.025);
  back.rotation.y = Math.PI;
  const status = panel(1.12, 0.35, statusMap);
  status.position.set(0, -0.81, 0.23);
  const medallion = mesh(new THREE.TorusGeometry(0.89, 0.009, 8, 96), gold);
  medallion.position.z = 0.065;
  const outer = mesh(new THREE.TorusGeometry(0.96, 0.0035, 6, 96), gold);
  outer.position.z = 0.061;
  const sparkles = [];
  for (let i = 0; i < 56; i++) {
    const star = mesh(
      new THREE.SphereGeometry(i % 5 === 0 ? 0.009 : 0.0045, 5, 4),
      new THREE.MeshBasicMaterial({ color: i % 3 ? 0xffffff : 0xf1cd83 }),
    );
    sparkles.push({
      star,
      x: Math.sin(i * 2.399) * (0.7 + (i % 7) * 0.065),
      y: (i / 56) * 2.3 - 1.15,
      z: 0.14 + (i % 9) * 0.035,
      speed: 0.06 + (i % 5) * 0.012,
    });
  }
  const ribbons = [];
  for (let i = 0; i < 3; i++) {
    const positions = [];
    for (let k = 0; k < 33; k++) {
      const x = -0.9 + (k / 32) * 1.8;
      const y = 0.8 + 0.08 * Math.sin(k * 0.21 + i);
      positions.push(x, y, 0.05, x, y + 0.16 + 0.035 * Math.sin(k * 0.4), 0.05);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    const indices = [];
    for (let k = 0; k < 32; k++) {
      let n = k * 2;
      indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
    }
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const ribbon = mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: [0x72e7be, 0x82bfda, 0xbc9ce6][i],
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ribbon.position.set(0, i * 0.07, -i * 0.015);
    ribbons.push(ribbon);
  }
  const birds = [];
  for (const side of [-1, 1]) {
    const bird = new THREE.Group();
    root.add(bird);
    const body = mesh(new THREE.SphereGeometry(0.034, 10, 6), black, bird);
    body.scale.set(1, 1.65, 0.7);
    const head = mesh(new THREE.SphereGeometry(0.026, 10, 6), black, bird);
    head.position.y = 0.047;
    const beak = mesh(new THREE.ConeGeometry(0.01, 0.037, 5), gold, bird);
    beak.rotation.z = -Math.PI / 2;
    beak.position.set(0.031, 0.047, 0);
    const wings = [];
    for (const direction of [-1, 1]) {
      const wing = new THREE.Group();
      bird.add(wing);
      wing.position.x = direction * 0.025;
      const s = new THREE.Shape();
      s.moveTo(0, 0);
      s.lineTo(direction * 0.18, 0.08);
      s.lineTo(direction * 0.125, -0.05);
      s.closePath();
      mesh(new THREE.ShapeGeometry(s), black, wing);
      wings.push(wing);
    }
    birds.push({ bird, wings, side });
  }
  const key = new THREE.Group();
  root.add(key);
  const bow = mesh(new THREE.TorusGeometry(0.053, 0.009, 8, 24), gold, key);
  slab(0.012, 0.16, 0.012, 0, -0.12, 0, gold, key);
  slab(0.053, 0.018, 0.018, 0.021, -0.185, 0, gold, key);
  const acceptMap = texture(
    (c, w, h) => {
      c.fillStyle = "#153b34";
      c.fillRect(0, 0, w, h);
      c.strokeStyle = "#e7c987";
      c.lineWidth = 9;
      c.strokeRect(10, 10, w - 20, h - 20);
      c.fillStyle = "#f8e6b7";
      c.textAlign = "center";
      c.font = "bold 74px serif";
      c.fillText("接受邀请  →", w / 2, 107);
      c.font = "25px Georgia";
      c.fillText("ACCEPT THE INVITATION", w / 2, 156);
    },
    1024,
    192,
  );
  const accept = new THREE.Group();
  root.add(accept);
  accept.userData.action = "acceptInvitation";
  slab(0.97, 0.23, 0.065, 0, 0, 0, gold, accept);
  const acceptFace = panel(0.94, 0.2, acceptMap, accept);
  acceptFace.position.z = 0.034;
  const supportGeometry = new THREE.BufferGeometry();
  supportGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(new Float32Array(25 * 3), 3),
  );
  const support = new THREE.Line(
    supportGeometry,
    new THREE.LineBasicMaterial({
      color: 0xe6c78a,
      transparent: true,
      opacity: 0.7,
    }),
  );
  root.add(support);
  // Separate artwork from the sign so portrait/landscape layout can move it
  // without rotating the readable button or blocking the unfolding card.
  const artwork = new THREE.Group();
  for (const child of [...root.children])
    if (child !== accept && child !== support) artwork.add(child);
  root.add(artwork);
  const worldRotation = new THREE.Quaternion(),
    cameraRotation = new THREE.Quaternion(),
    sway = new THREE.Quaternion();
  const originals = new Map();
  root.traverse((o) => {
    for (const m of Array.isArray(o.material) ? o.material : [o.material])
      if (m)
        originals.set(m, {
          opacity: m.opacity,
          transparent: m.transparent,
          depthWrite: m.depthWrite,
        });
  });
  const reduced =
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  const projectedBounds = () => {
    root.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(
      detailView ? envelope : card.visible && fixedCardView ? card : envelope,
    );
    if (!detailView && !fixedCardView) {
      if (card.visible) bounds.union(new THREE.Box3().setFromObject(card));
      bounds.union(new THREE.Box3().setFromObject(medallion));
      if (status.visible) bounds.union(new THREE.Box3().setFromObject(status));
    }
    const min = new THREE.Vector2(Infinity, Infinity),
      max = new THREE.Vector2(-Infinity, -Infinity);
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z]) {
          const point = new THREE.Vector3(x, y, z).project(layoutCamera);
          min.min(point);
          max.max(point);
        }
    return { min, max };
  };
  let layoutCamera,
    detailView = false,
    fixedCardView = false;
  let spinStart = null;
  let target = 0,
    progress = 0,
    last = null;
  const smooth = (p) => p * p * (3 - 2 * p);
  function update(time, visibility = 1, camera, viewId = "rotate", zoom = 1) {
    const dt = Math.max(0, Math.min(64, last === null ? 16 : time - last));
    last = time;
    detailView = viewId === "seal";
    fixedCardView =
      (viewId === "front" || viewId === "back") && progress > 0.42;
    backing.visible =
      medallion.visible =
      outer.visible =
        !detailView && !fixedCardView;
    envelope.visible = !fixedCardView;
    key.visible = !detailView && !fixedCardView;
    sparkles.forEach(({ star }) => {
      star.visible = !detailView && !fixedCardView;
    });
    ribbons.forEach((r) => {
      r.visible = !detailView && !fixedCardView;
    });
    birds.forEach(({ bird }) => {
      bird.visible = !detailView && !fixedCardView;
    });
    progress = reduced
      ? target
      : THREE.MathUtils.clamp(progress + ((target ? 1 : -1) * dt) / 2400, 0, 1);
    const p = smooth(progress),
      lift = smooth(THREE.MathUtils.clamp((progress - 0.22) / 0.6, 0, 1));
    flap.rotation.x = 2.7 * smooth(Math.min(1, progress / 0.48));
    // Move the opened envelope aside before the detached card starts rotating.
    envelope.position.set(
      detailView ? 0 : -1.1 * lift,
      detailView ? 0 : -0.39,
      0.1,
    );
    envelope.scale.setScalar(detailView ? 1 : 1 - 0.45 * lift);
    if (detailView) flap.rotation.x = 0;
    seal.position.set(
      0.55 * p,
      -0.055 + 0.2 * Math.sin(p * Math.PI),
      0.075 + 0.16 * p,
    );
    seal.rotation.z = detailView ? 0 : -1.2 * p;
    if (detailView) seal.position.set(0, -0.055, 0.075);
    card.visible = !detailView && progress > 0.42;
    card.position.set(0, -0.29 + 0.84 * lift, 0.12 + 0.66 * lift);
    card.scale.setScalar(0.52 + 0.48 * lift);
    card.rotation.set(0, viewId === "back" ? Math.PI : (1 - lift) * 0.2, 0);
    status.visible = !detailView && !fixedCardView && progress > 0.82;
    status.scale.setScalar(
      Math.max(0.001, smooth(Math.max(0, (progress - 0.82) / 0.18))),
    );
    medallion.rotation.z = reduced ? 0 : time * 0.000055;
    outer.rotation.z = -medallion.rotation.z;
    const motion = reduced ? 0 : time * 0.001;
    for (const { star, x, y, z, speed } of sparkles) {
      star.position.set(
        x + 0.025 * Math.sin(motion + y * 4),
        reduced
          ? y
          : ((((y + 1.15 - motion * speed) % 2.3) + 2.3) % 2.3) - 1.15,
        z,
      );
      star.scale.setScalar(0.4 + 0.6 * p);
    }
    ribbons.forEach((r, i) => {
      r.position.y =
        i * 0.07 + (reduced ? 0 : 0.026 * Math.sin(motion * 0.6 + i));
      r.scale.y = 0.55 + 0.45 * p;
    });
    birds.forEach(({ bird, wings, side }, i) => {
      bird.position.set(
        side * (0.68 + 0.11 * p),
        0.52 + 0.13 * p + (reduced ? 0 : 0.035 * Math.sin(motion * 1.5 + i)),
        0.23,
      );
      bird.rotation.z = -side * 0.2;
      wings.forEach(
        (w, j) =>
          (w.rotation.y =
            (j ? 1 : -1) *
            (reduced ? 0.3 : 0.5 + 0.5 * Math.sin(motion * 5 + i))),
      );
    });
    key.position.set(0.72, -0.52 + 0.08 * p, 0.22);
    key.rotation.z = -0.3 + (reduced ? 0 : 0.09 * Math.sin(motion));
    accept.position.set(
      0,
      1.1 + (reduced ? 0 : 0.025 * Math.sin(motion * 0.65)),
      0.48,
    );
    // The pedestal stands at 90° to the QR plane. The sign faces the viewer
    // so its text remains readable when the marker lies flat or on a wall.
    if (camera && visibility > 0.01) {
      if (lift > 0.98 && spinStart === null) spinStart = time;
      layoutCamera = camera;
      root.getWorldQuaternion(worldRotation);
      camera.getWorldQuaternion(cameraRotation);
      accept.quaternion.copy(worldRotation.invert().multiply(cameraRotation));
      const up = new THREE.Vector3(0, 1, 0)
        .applyQuaternion(cameraRotation)
        .applyQuaternion(worldRotation);
      artwork.rotation.z = Math.atan2(-up.x, up.y);
      artwork.scale.setScalar(1);
      artwork.position.set(0, 0, 0);
      // The invitation sheet turns gently toward the guest after emerging,
      // preserving readable poster text even when the QR plane is steeply tilted.
      const cardFacing = artwork
        .getWorldQuaternion(new THREE.Quaternion())
        .invert()
        .multiply(cameraRotation);
      // Keep the sheet's tilt bounded: its full rotation must clear the envelope
      // and the marker backing, even when the phone views the QR obliquely.
      const faceAngle = card.quaternion.angleTo(cardFacing);
      card.quaternion.slerp(
        cardFacing,
        Math.min(lift * 0.9, 0.18 / Math.max(0.001, faceAngle)),
      );
      if (viewId === "rotate" && !reduced && spinStart !== null && lift > 0.98)
        card.quaternion.multiply(
          new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            (time - spinStart) * 0.00026 * lift,
          ),
        );
      let bounds = projectedBounds();
      const scale = Math.min(
        1,
        1.48 / Math.max(0.05, bounds.max.x - bounds.min.x),
        0.76 / Math.max(0.05, bounds.max.y - bounds.min.y),
      );
      artwork.scale.setScalar(scale * zoom);
      bounds = projectedBounds();
      // Large zoom may intentionally crop the artwork. Keep its focus centred
      // and the independently laid-out accept button inside the safe viewport.
      const offsetX =
        zoom > 1 || detailView || fixedCardView
          ? -(bounds.min.x + bounds.max.x) / 2
          : THREE.MathUtils.clamp(0, -0.76 - bounds.min.x, 0.76 - bounds.max.x);
      const offsetY =
        zoom > 1 || detailView || fixedCardView
          ? -0.065 - (bounds.min.y + bounds.max.y) / 2
          : THREE.MathUtils.clamp(0, -0.45 - bounds.min.y, 0.3 - bounds.max.y);
      const depth = root
        .getWorldPosition(new THREE.Vector3())
        .project(camera).z;
      const origin = new THREE.Vector3(0, 0, depth).unproject(camera);
      const shifted = new THREE.Vector3(offsetX, offsetY, depth).unproject(
        camera,
      );
      const localOrigin = root.worldToLocal(origin),
        localShift = root.worldToLocal(shifted);
      artwork.position.copy(localShift.sub(localOrigin));
      bounds = projectedBounds();
      const buttonX = THREE.MathUtils.clamp(
        (bounds.min.x + bounds.max.x) / 2,
        -0.48,
        0.48,
      );
      const buttonY = THREE.MathUtils.clamp(
        bounds.max.y + 0.16 + (reduced ? 0 : 0.008 * Math.sin(motion * 0.65)),
        0.37,
        0.49,
      );
      accept.position.copy(
        root.worldToLocal(
          new THREE.Vector3(buttonX, buttonY, depth - 0.0005).unproject(camera),
        ),
      );
      accept.scale.setScalar(1);
      root.updateWorldMatrix(true, true);
      const left = accept
        .localToWorld(new THREE.Vector3(-0.485, 0, 0))
        .project(camera);
      const right = accept
        .localToWorld(new THREE.Vector3(0.485, 0, 0))
        .project(camera);
      accept.scale.setScalar(
        THREE.MathUtils.clamp(
          (2 * Math.min(260, window.innerWidth * 0.56)) /
            window.innerWidth /
            Math.max(0.001, Math.abs(right.x - left.x)),
          0.04,
          12,
        ),
      );
      const line = supportGeometry.attributes.position;
      for (let i = 0; i < 25; i++) {
        const t = i / 24;
        const local = root.worldToLocal(
          new THREE.Vector3(
            buttonX + 0.018 * Math.sin(t * Math.PI),
            bounds.max.y + 0.015 + t * (buttonY - 0.06 - bounds.max.y - 0.015),
            depth,
          ).unproject(camera),
        );
        line.setXYZ(i, local.x, local.y, local.z);
      }
      line.needsUpdate = true;
      supportGeometry.computeBoundingSphere();
    }
    if (visibility <= 0.01) spinStart = null;
    sway.setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      reduced ? 0 : 0.09 * Math.sin(motion * 0.42),
    );
    accept.quaternion.multiply(sway);
    for (const [m, o] of originals) {
      m.opacity = o.opacity * visibility;
      m.transparent = o.transparent || visibility < 0.999;
      m.depthWrite = o.depthWrite && visibility > 0.9;
    }
    root.userData.kind = "invitation";
    root.userData.progress = progress;
    return progress;
  }
  update(0, 0);
  return {
    root,
    kind: "invitation",
    update,
    acceptEnabled: clue.invitation_valid,
    toggle() {
      target = target ? 0 : 1;
      return this.interaction;
    },
    get interaction() {
      return {
        kind: "invitation",
        opened: Boolean(target),
        label: target ? "合上邀请函" : "启封庄园之邀",
        message: target
          ? clue.invitation_valid
            ? "邀请有效 · 海报正在展开"
            : "活动邀请已结束"
          : "轻触蜡封，开启您的庄园邀请",
      };
    },
  };
}
