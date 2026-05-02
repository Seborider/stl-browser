import { useEffect, useRef, useState, type RefObject } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
import { getMeshAssetUrl } from "../../ipc/commands";
import type { OrbitControlsRef } from "./DetailViewer";

// The worker variant of this wiring lives in src/thumbs/render-worker.ts. We
// intentionally don't share it — the worker polyfills DOMParser via linkedom
// because WKWebView workers lack one, while the main thread has a native
// DOMParser and doesn't need the polyfill. Keeping the loaders duplicated
// avoids pulling linkedom (and its ~100KB of XML parsing) into the main bundle.

interface Props {
  fileId: number;
  extension: string;
  wireframe: boolean;
  flatShading: boolean;
  controlsRef: RefObject<OrbitControlsRef | null>;
  onError: (message: string) => void;
  onMaterialChange?: (mat: THREE.MeshStandardMaterial | null) => void;
  onBoundsChange?: (bounds: { center: THREE.Vector3; radius: number } | null) => void;
}

function parseSubject(bytes: ArrayBuffer, extension: string): THREE.Object3D {
  const ext = extension.toLowerCase();
  if (ext === "stl") {
    const geom = new STLLoader().parse(bytes);
    geom.computeVertexNormals();
    return new THREE.Mesh(geom);
  }
  if (ext === "obj") {
    const text = new TextDecoder().decode(bytes);
    return new OBJLoader().parse(text);
  }
  if (ext === "3mf") {
    return new ThreeMFLoader().parse(bytes);
  }
  throw new Error(`unsupported extension: ${extension}`);
}

function disposeTree(root: THREE.Object3D) {
  root.traverse((child) => {
    const m = child as THREE.Mesh;
    if (m.isMesh) {
      (m.geometry as THREE.BufferGeometry).dispose();
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) (mat as THREE.Material).dispose();
    }
  });
}

export function MeshLoader({
  fileId,
  extension,
  wireframe,
  flatShading,
  controlsRef,
  onError,
  onMaterialChange,
  onBoundsChange,
}: Props) {
  const [subject, setSubject] = useState<THREE.Object3D | null>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;

  useEffect(() => {
    let cancelled = false;
    let loaded: THREE.Object3D | null = null;
    (async () => {
      try {
        const url = await getMeshAssetUrl(fileId);
        // `cache: "no-store"`: see render-worker.ts. WKWebView's URL cache
        // would otherwise retain every opened mesh file (often tens of MB)
        // in the WebContent process for the lifetime of the app.
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
        const bytes = await res.arrayBuffer();
        if (cancelled) return;
        const obj = parseSubject(bytes, extension);

        const mat = new THREE.MeshStandardMaterial({
          color: 0xc0c0d0,
          metalness: 0.1,
          roughness: 0.65,
          flatShading,
          wireframe,
        });
        materialRef.current = mat;
        onMaterialChange?.(mat);
        obj.traverse((child) => {
          const m = child as THREE.Mesh;
          if (m.isMesh) {
            const g = m.geometry as THREE.BufferGeometry;
            if (!g.attributes.normal) g.computeVertexNormals();
            m.material = mat;
          }
        });

        // Centre on X/Y and sit on Z=0 so the bed grid lies beneath the mesh.
        obj.updateMatrixWorld(true);
        const bbox = new THREE.Box3().setFromObject(obj);
        if (bbox.isEmpty()) throw new Error("mesh contained no geometry");
        const center = new THREE.Vector3();
        bbox.getCenter(center);
        const offset = new THREE.Vector3(-center.x, -center.y, -bbox.min.z);
        obj.position.copy(offset);
        const finalBbox = bbox.clone().translate(offset);

        const sphere = new THREE.Sphere();
        finalBbox.getBoundingSphere(sphere);
        const radius = Math.max(sphere.radius, 10);
        onBoundsChange?.({ center: sphere.center.clone(), radius });
        const fov = (camera.fov * Math.PI) / 180;
        const dist = (radius / Math.sin(fov / 2)) * 1.35;

        // Z-up 3/4 view: slightly in front of + above the mesh so the bed is
        // visible underneath. The 0.8/0.9/0.65 triplet is eyeballed to match
        // a Bambu/Prusa-style orbit default.
        camera.up.set(0, 0, 1);
        camera.position.set(
          sphere.center.x + dist * 0.8,
          sphere.center.y - dist * 0.9,
          sphere.center.z + dist * 0.65,
        );
        camera.near = Math.max(0.1, dist / 1000);
        camera.far = dist * 20;
        camera.lookAt(sphere.center);
        camera.updateProjectionMatrix();

        const controls = controlsRef.current;
        if (controls) {
          controls.target.copy(sphere.center);
          controls.update();
        }

        loaded = obj;
        setSubject(obj);
      } catch (e) {
        if (!cancelled) {
          onError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
      if (loaded) disposeTree(loaded);
      if (materialRef.current) {
        materialRef.current.dispose();
        materialRef.current = null;
      }
      onMaterialChange?.(null);
      onBoundsChange?.(null);
      setSubject(null);
    };
  }, [fileId, extension, camera, controlsRef, onError, onMaterialChange, onBoundsChange]);

  // Flipping flatShading on an existing material requires a shader rebuild.
  useEffect(() => {
    const mat = materialRef.current;
    if (!mat) return;
    mat.flatShading = flatShading;
    mat.wireframe = wireframe;
    mat.needsUpdate = true;
  }, [flatShading, wireframe]);

  return subject ? <primitive object={subject} /> : null;
}
