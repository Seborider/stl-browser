import { forwardRef, useEffect, useMemo } from "react";
import * as THREE from "three";

interface Props {
  bounds: { center: THREE.Vector3; radius: number } | null;
}

// Sits at z = -0.1 so it doesn't z-fight with the PrintBedGrid at z = 0. The
// material's color is set imperatively from `ViewerAppearance.tsx` whenever
// `backgroundColor` changes — keep this component dumb and ref-only.
export const GroundDisc = forwardRef<THREE.Mesh, Props>(function GroundDisc(
  { bounds },
  ref,
) {
  const radius = Math.max((bounds?.radius ?? 100) * 1.5, 110);

  const geometry = useMemo(
    () => new THREE.CircleGeometry(radius, 96),
    [radius],
  );
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x000000,
        roughness: 1,
        metalness: 0,
      }),
    [],
  );

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  return (
    <mesh
      ref={ref}
      geometry={geometry}
      material={material}
      position={[0, 0, -0.1]}
      receiveShadow
    />
  );
});
