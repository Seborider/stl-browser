// Worker: receive an STL ArrayBuffer, parse with three.js STLLoader,
// render to a reused 512x512 OffscreenCanvas, post the PNG back.
//
// Import three via esm.sh — it rewrites three's bare-specifier imports
// (e.g. STLLoader's `from "three"`) into absolute URLs so they resolve
// inside a worker without an import map.

import * as THREE from "https://esm.sh/three@0.160.0";
import { STLLoader } from "https://esm.sh/three@0.160.0/examples/jsm/loaders/STLLoader.js";

const SIZE = 512;
const canvas = new OffscreenCanvas(SIZE, SIZE);

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setSize(SIZE, SIZE, false);
  renderer.setClearColor(0x111418, 1);
} catch (err) {
  // Surface to main thread on first job instead of crashing silently.
  self.addEventListener("message", (e) => {
    self.postMessage({
      jobId: e.data?.jobId,
      error: `WebGL init failed in worker: ${err.message || err}`,
    });
  });
}

const loader = new STLLoader();

self.addEventListener("message", async (e) => {
  if (!renderer) return; // already reported error in init
  const { jobId, stlBuffer } = e.data;
  const t0 = performance.now();

  try {
    const geometry = loader.parse(stlBuffer);
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111418);

    const material = new THREE.MeshStandardMaterial({
      color: 0xcdd0d4,
      metalness: 0.1,
      roughness: 0.55,
    });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(1, 1.2, 1);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.4);
    fill.position.set(-1, -0.5, -1);
    scene.add(fill);

    const { center, radius } = geometry.boundingSphere;
    const fov = 35;
    const distance =
      (radius / Math.tan((Math.PI * fov) / 360)) * 1.25; // 1.25 = padding
    const camera = new THREE.PerspectiveCamera(
      fov,
      1,
      Math.max(radius * 0.01, 0.01),
      distance + radius * 4,
    );
    const dir = new THREE.Vector3(0.8, 0.7, 1).normalize();
    camera.position.copy(center).addScaledVector(dir, distance);
    camera.lookAt(center);

    renderer.render(scene, camera);

    const blob = await canvas.convertToBlob({ type: "image/png" });
    const pngBuffer = await blob.arrayBuffer();

    // Clean up GPU-side resources so long sessions don't leak.
    geometry.dispose();
    material.dispose();

    const workerElapsed = performance.now() - t0;
    self.postMessage({ jobId, pngBuffer, workerElapsed }, [pngBuffer]);
  } catch (err) {
    self.postMessage({
      jobId,
      error: err?.message || String(err),
    });
  }
});
