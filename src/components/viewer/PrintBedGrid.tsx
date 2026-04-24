import { useEffect, useMemo } from "react";
import * as THREE from "three";

const BED_SIZE_MM = 220;
const DIVISIONS = 22; // 10mm per line

// `gridHelper` is authored in XZ (Y-up), so rotate a quarter turn to lie flat
// on the XY print-bed plane.
export function PrintBedGrid() {
  const grid = useMemo(() => {
    const g = new THREE.GridHelper(BED_SIZE_MM, DIVISIONS, 0x64748b, 0x334155);
    g.rotation.x = Math.PI / 2;
    return g;
  }, []);
  useEffect(
    () => () => {
      grid.geometry.dispose();
      const mat = grid.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat.dispose();
    },
    [grid],
  );
  return <primitive object={grid} />;
}
