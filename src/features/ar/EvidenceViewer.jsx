import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export default function EvidenceViewer({ url, hotspotId }) {
  const host = useRef(null),
    [error, setError] = useState("");
  useEffect(() => {
    let closed = false,
      source,
      controls;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const scene = new THREE.Scene(),
      group = new THREE.Group();
    scene.add(group);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 30);
    camera.position.set(0.8, 0.55, 3.7);
    scene.add(new THREE.HemisphereLight(0xffefd6, 0x39493d, 2.5));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(2, 3, 4);
    scene.add(light);
    const container = host.current;
    container.appendChild(renderer.domElement);
    const resize = () => {
      renderer.setSize(container.clientWidth, container.clientHeight);
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    const dispose = (root) =>
      root?.traverse((object) => {
        object.geometry?.dispose();
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          if (!material) continue;
          for (const value of Object.values(material))
            if (value?.isTexture) value.dispose();
          material.dispose();
        }
      });
    new GLTFLoader()
      .loadAsync(url)
      .then((gltf) => {
        source = gltf.scene;
        if (closed) {
          dispose(source);
          return;
        }
        const names = {
          document: ["document", "document-seal"],
          recorder: ["recorder", "recorder-button"],
          key: ["key-ring", "key-shaft", "key-tooth"],
        };
        const nodes = [];
        source.traverse((object) => {
          if (names[hotspotId]?.includes(object.name)) nodes.push(object);
        });
        if (nodes.length) nodes.forEach((object) => group.add(object));
        else group.add(source);
        const bounds = new THREE.Box3().setFromObject(group),
          size = bounds.getSize(new THREE.Vector3()),
          center = bounds.getCenter(new THREE.Vector3());
        for (const child of group.children) child.position.sub(center);
        group.scale.setScalar(1.8 / Math.max(size.x, size.y, size.z, 0.001));
        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.enablePan = false;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.5;
        controls.minDistance = 2;
        controls.maxDistance = 6;
        renderer.setAnimationLoop(() => {
          controls.update();
          renderer.render(scene, camera);
        });
      })
      .catch(() => {
        if (!closed) setError("证物模型加载失败，请关闭后重试。");
      });
    const touch = () => {
      if (controls) controls.autoRotate = false;
    };
    renderer.domElement.addEventListener("pointerdown", touch);
    return () => {
      closed = true;
      observer.disconnect();
      controls?.dispose();
      renderer.setAnimationLoop(null);
      dispose(group);
      dispose(source);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [url, hotspotId]);
  return (
    <>
      <div
        className="ar-object-viewer"
        ref={host}
        aria-label="360度证物查看器"
      />
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <p className="ar-object-hint">拖动旋转 360° · 双指缩放 · 查看正反面</p>
      )}
    </>
  );
}
