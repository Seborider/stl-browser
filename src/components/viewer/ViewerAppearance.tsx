import { useEffect, useMemo, type RefObject } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { deriveGroundColor } from "../../lib/color";
import { useAppStore } from "../../state/store";

interface Props {
  materialRef: RefObject<THREE.MeshStandardMaterial | null>;
  lightRefs: RefObject<THREE.DirectionalLight | null>[];
  groundRef: RefObject<THREE.Mesh | null>;
  bounds: { center: THREE.Vector3; radius: number } | null;
}

const ELEVATION_RAD = Math.PI / 4;
const COS_ELEVATION = Math.cos(ELEVATION_RAD);
const SIN_ELEVATION = Math.sin(ELEVATION_RAD);
const ORIGIN = new THREE.Vector3();
const INTENSITY_GAIN = 0.9;

// Headless: subscribes to the store and mutates three.js objects imperatively.
// `Color.set("#hex")` interprets the input as sRGB and converts to linear
// internally (three r152+ default), so material/light colors stay correct
// without explicit colorSpace flags on <Canvas gl>.
export function ViewerAppearance({
  materialRef,
  lightRefs,
  groundRef,
  bounds,
}: Props) {
  const modelColor = useAppStore((s) => s.modelColor);
  const lights = useAppStore((s) => s.lights);
  const backgroundColor = useAppStore((s) => s.backgroundColor);
  const scene = useThree((s) => s.scene);

  const bgColor = useMemo(() => new THREE.Color(), []);
  const groundScratch = useMemo(() => new THREE.Color(), []);

  useEffect(() => {
    materialRef.current?.color.set(modelColor);
  }, [modelColor, materialRef]);

  useEffect(() => {
    const center = bounds?.center ?? ORIGIN;
    const radius = bounds?.radius ?? 100;
    const r = Math.max(radius * 3, 200);

    for (let i = 0; i < lightRefs.length; i++) {
      const light = lightRefs[i].current;
      if (!light) continue;
      const cfg = lights[i];
      if (!cfg || !cfg.enabled) {
        light.visible = false;
        light.intensity = 0;
        continue;
      }
      light.visible = true;
      light.color.set(cfg.color);
      light.intensity = cfg.intensityNorm * INTENSITY_GAIN;
      const az = THREE.MathUtils.degToRad(cfg.azimuthDeg);
      light.position.set(
        center.x + r * COS_ELEVATION * Math.cos(az),
        center.y + r * COS_ELEVATION * Math.sin(az),
        center.z + r * SIN_ELEVATION,
      );
      light.target.position.copy(center);
      light.target.updateMatrixWorld();
    }
  }, [lights, bounds, lightRefs]);

  useEffect(() => {
    bgColor.set(backgroundColor);
    scene.background = bgColor;
    const ground = groundRef.current;
    if (ground) {
      const mat = ground.material as THREE.MeshStandardMaterial;
      mat.color.copy(deriveGroundColor(backgroundColor, groundScratch));
    }
  }, [backgroundColor, scene, groundRef, bgColor, groundScratch]);

  return null;
}
