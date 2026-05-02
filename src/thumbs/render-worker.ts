// Thumbnail render worker. Structure proven in `spikes/spike1-offscreen-worker`:
// single reused OffscreenCanvas + three.js renderer, one job per message,
// transfers the PNG ArrayBuffer back to the main thread.
//
// Runs as a module worker via Vite's `new Worker(new URL(...),
// { type: "module" })` pattern. Vite bundles `three` into the worker chunk.
// We don't pull in the WebWorker lib because it clashes with DOM's `self`;
// the narrow interface below is all we use.

import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { DOMParser as LinkedomDOMParser } from "linkedom";

// WKWebView Web Workers don't expose `DOMParser`, but three's 3MFLoader
// needs one that supports `querySelectorAll` to walk the .model XML inside
// the 3MF zip. linkedom ships a `DOMParser` that dispatches by mime type
// (XML stays case-sensitive — critical for 3MF tags like "Relationship").
(globalThis as unknown as { DOMParser: typeof LinkedomDOMParser }).DOMParser =
  LinkedomDOMParser;

import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";

interface MinimalWorkerGlobalScope {
  addEventListener(type: "message", listener: (ev: MessageEvent) => void): void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const ctx = self as unknown as MinimalWorkerGlobalScope;

export interface RenderJob {
  fileId: number;
  cacheKey: string;
  meshUrl: string; // asset:// URL for the mesh file
  extension: string;
}

export interface RenderSuccess {
  kind: "ok";
  fileId: number;
  cacheKey: string;
  width: number;
  height: number;
  png: ArrayBuffer;
  elapsedMs: number;
}

export interface RenderFailure {
  kind: "err";
  fileId: number;
  cacheKey: string;
  message: string;
}

export type RenderResult = RenderSuccess | RenderFailure;

const WIDTH = 512;
const HEIGHT = 512;

// Reused between jobs — constructing a WebGL context is expensive.
let canvas: OffscreenCanvas | null = null;
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;

function ensureStage() {
  if (canvas && renderer && scene && camera) return;
  canvas = new OffscreenCanvas(WIDTH, HEIGHT);
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: false,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH, HEIGHT, false);
  renderer.setClearColor(0x000000, 0); // transparent background

  scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(1, 1, 1);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35);
  fill.position.set(-1, 0.5, -0.5);
  scene.add(fill);

  camera = new THREE.PerspectiveCamera(35, WIDTH / HEIGHT, 0.1, 10000);
}

// Parse mesh bytes into a renderable subject (+ a disposer for any GPU
// resources it owns). Returns an Object3D so multi-mesh formats like OBJ and
// 3MF survive intact instead of being squashed to the first geometry.
function parseSubject(
  bytes: ArrayBuffer,
  extension: string,
): { obj: THREE.Object3D; dispose: () => void } {
  const ext = extension.toLowerCase();
  if (ext === "stl") {
    const geom = new STLLoader().parse(bytes);
    geom.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xc0c0d0,
      metalness: 0.1,
      roughness: 0.65,
      flatShading: true,
    });
    const mesh = new THREE.Mesh(geom, mat);
    return {
      obj: mesh,
      dispose: () => {
        geom.dispose();
        mat.dispose();
      },
    };
  }
  if (ext === "obj") {
    const text = new TextDecoder().decode(bytes);
    const group = new OBJLoader().parse(text);
    applyDefaultMaterial(group);
    return { obj: group, dispose: () => disposeTree(group) };
  }
  if (ext === "3mf") {
    const group = new ThreeMFLoader().parse(bytes);
    applyDefaultMaterial(group);
    return { obj: group, dispose: () => disposeTree(group) };
  }
  throw new Error(`unsupported extension: ${extension}`);
}

// Iterative tree walk. `Object3D.traverse` recurses, which overflows the
// stack on pathological 3MF group nesting and crashes the worker.
function walkIter(root: THREE.Object3D, visit: (node: THREE.Object3D) => void) {
  const stack: THREE.Object3D[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as THREE.Object3D;
    visit(node);
    const children = node.children;
    for (let i = 0; i < children.length; i++) stack.push(children[i]);
  }
}

// 3MF/OBJ may or may not carry materials. For the thumbnail we want a
// uniform matte look regardless, so overwrite every mesh's material.
function applyDefaultMaterial(root: THREE.Object3D) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xc0c0d0,
    metalness: 0.1,
    roughness: 0.65,
    flatShading: true,
  });
  walkIter(root, (child) => {
    const m = child as THREE.Mesh;
    if (m.isMesh) {
      const g = m.geometry as THREE.BufferGeometry;
      if (!g.attributes.normal) g.computeVertexNormals();
      m.material = mat;
    }
  });
}

function disposeTree(root: THREE.Object3D) {
  walkIter(root, (child) => {
    const m = child as THREE.Mesh;
    if (m.isMesh) {
      (m.geometry as THREE.BufferGeometry).dispose();
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) (mat as THREE.Material).dispose();
    }
  });
}

// Iterative parent-before-children matrix update. `Object3D.updateMatrixWorld`
// recurses; deep 3MF graphs overflow the stack on it just like `traverse`.
function updateMatrixWorldIter(root: THREE.Object3D) {
  const stack: THREE.Object3D[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as THREE.Object3D;
    node.updateMatrix();
    if (node.parent) {
      node.matrixWorld.multiplyMatrices(node.parent.matrixWorld, node.matrix);
    } else {
      node.matrixWorld.copy(node.matrix);
    }
    const children = node.children;
    for (let i = 0; i < children.length; i++) stack.push(children[i]);
  }
}

// Iterative world-space bbox: walks the tree with a manual stack instead of
// `Box3.setFromObject` / `Object3D.traverse`, both of which recurse and
// overflow on deeply nested 3MF component graphs (a real-world freeze cause
// in WKWebView Web Workers).
function computeWorldBbox(root: THREE.Object3D, out: THREE.Box3): THREE.Box3 {
  out.makeEmpty();
  const childBox = new THREE.Box3();
  const stack: THREE.Object3D[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as THREE.Object3D;
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh) {
      const geom = mesh.geometry as THREE.BufferGeometry | undefined;
      if (geom) {
        if (!geom.boundingBox) geom.computeBoundingBox();
        if (geom.boundingBox) {
          childBox.copy(geom.boundingBox).applyMatrix4(mesh.matrixWorld);
          out.union(childBox);
        }
      }
    }
    const children = node.children;
    for (let i = 0; i < children.length; i++) stack.push(children[i]);
  }
  return out;
}

async function render(job: RenderJob): Promise<ArrayBuffer> {
  ensureStage();
  const r = renderer!;
  const s = scene!;
  const cam = camera!;

  // Fetch raw bytes via the asset:// protocol. `cache: "no-store"` is
  // critical: without it, WKWebView retains every fetched response in its
  // URL cache forever. With 100s of multi-MB mesh files that adds up to
  // many GB of resident memory in the WebContent process — the dominant
  // contributor to the renderer being killed during long sessions.
  const response = await fetch(job.meshUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`fetch ${job.meshUrl}: ${response.status}`);
  }
  const bytes = await response.arrayBuffer();
  const { obj, dispose } = parseSubject(bytes, job.extension);

  // Add to scene inside try so any throw between here and the render still
  // detaches `obj`. A previous bug leaked failed objects into the persistent
  // worker scene on every crash, slowly destabilizing the renderer.
  s.add(obj);
  try {
    updateMatrixWorldIter(obj);
    const bbox = computeWorldBbox(obj, new THREE.Box3());
    if (bbox.isEmpty()) {
      throw new Error("mesh contained no renderable geometry");
    }
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    obj.position.sub(center);
    updateMatrixWorldIter(obj);

    // 3/4 view. Camera distance derived from bounding sphere so any mesh fits.
    const sphere = new THREE.Sphere();
    computeWorldBbox(obj, new THREE.Box3()).getBoundingSphere(sphere);
    const radius = sphere.radius || 1;
    const fov = (cam.fov * Math.PI) / 180;
    const dist = (radius / Math.sin(fov / 2)) * 1.35;
    cam.position.set(dist * 0.8, dist * 0.65, dist * 0.9);
    cam.near = Math.max(0.01, dist / 1000);
    cam.far = dist * 10;
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();

    r.render(s, cam);
    const blob = await (canvas as OffscreenCanvas).convertToBlob({
      type: "image/png",
    });
    return await blob.arrayBuffer();
  } finally {
    s.remove(obj);
    dispose();
  }
}

ctx.addEventListener("message", async (ev: MessageEvent<RenderJob>) => {
  const job = ev.data;
  const t0 = performance.now();
  try {
    const png = await render(job);
    const ok: RenderSuccess = {
      kind: "ok",
      fileId: job.fileId,
      cacheKey: job.cacheKey,
      width: WIDTH,
      height: HEIGHT,
      png,
      elapsedMs: performance.now() - t0,
    };
    ctx.postMessage(ok, [png]);
  } catch (e) {
    // Log inside the worker so the stack survives — postMessage only carries
    // the message string. The queue side also logs the (kind: "err") message.
    console.error("render-worker failed", job.extension, job.meshUrl, e);
    const err: RenderFailure = {
      kind: "err",
      fileId: job.fileId,
      cacheKey: job.cacheKey,
      message: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    };
    ctx.postMessage(err);
  }
});
