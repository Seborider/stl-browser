import { useEffect, type RefObject } from "react";
import * as THREE from "three";
import { useAppStore } from "../../state/store";

interface Props {
  materialRef: RefObject<THREE.MeshStandardMaterial | null>;
  lightRef: RefObject<THREE.DirectionalLight | null>;
  bounds: { center: THREE.Vector3; radius: number } | null;
}

const ELEVATION_RAD = Math.PI / 4; // fixed 45° for v1
const ORIGIN = new THREE.Vector3();

// Headless: subscribes to the store and mutates three.js objects imperatively.
// `Color.set("#hex")` interprets the input as sRGB and converts to linear
// internally (three r152+ default), so material/light colors stay correct
// without explicit colorSpace flags on <Canvas gl>.
export function ViewerAppearance({ materialRef, lightRef, bounds }: Props) {
  const modelColor = useAppStore((s) => s.modelColor);
  const lightColor = useAppStore((s) => s.lightColor);
  const lightAzimuthDeg = useAppStore((s) => s.lightAzimuthDeg);

  useEffect(() => {
    materialRef.current?.color.set(modelColor);
  }, [modelColor, materialRef]);

  useEffect(() => {
    lightRef.current?.color.set(lightColor);
  }, [lightColor, lightRef]);

  useEffect(() => {
    const light = lightRef.current;
    if (!light) return;
    const center = bounds?.center ?? ORIGIN;
    const radius = bounds?.radius ?? 100;
    const az = THREE.MathUtils.degToRad(lightAzimuthDeg);
    const r = Math.max(radius * 3, 200);
    light.position.set(
      center.x + r * Math.cos(ELEVATION_RAD) * Math.cos(az),
      center.y + r * Math.cos(ELEVATION_RAD) * Math.sin(az),
      center.z + r * Math.sin(ELEVATION_RAD),
    );
    light.target.position.copy(center);
    light.target.updateMatrixWorld();
  }, [lightAzimuthDeg, bounds, lightRef]);

  return null;
}
