import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import { useTranslation } from "react-i18next";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { FileEntry } from "../../generated";
import { AppearanceControls } from "./AppearanceControls";
import { GroundDisc } from "./GroundDisc";
import { MeshLoader } from "./MeshLoader";
import { PrintBedGrid } from "./PrintBedGrid";
import { ViewerAppearance } from "./ViewerAppearance";

export type OrbitControlsRef = ComponentRef<typeof OrbitControls>;

interface Props {
  file: FileEntry;
  onClose: () => void;
}

export function DetailViewer({ file, onClose }: Props) {
  const { t } = useTranslation();
  const [wireframe, setWireframe] = useState(false);
  const [flatShading, setFlatShading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bounds, setBounds] = useState<{ center: THREE.Vector3; radius: number } | null>(null);
  const controlsRef = useRef<OrbitControlsRef | null>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const groundRef = useRef<THREE.Mesh | null>(null);
  const light0 = useRef<THREE.DirectionalLight | null>(null);
  const light1 = useRef<THREE.DirectionalLight | null>(null);
  const light2 = useRef<THREE.DirectionalLight | null>(null);
  const light3 = useRef<THREE.DirectionalLight | null>(null);
  const lightRefs = useMemo(
    () => [light0, light1, light2, light3],
    [],
  );

  useEffect(() => {
    setError(null);
    setBounds(null);
  }, [file.id]);

  const handleMaterial = useCallback(
    (mat: THREE.MeshStandardMaterial | null) => {
      materialRef.current = mat;
    },
    [],
  );
  const handleBounds = useCallback(
    (b: { center: THREE.Vector3; radius: number } | null) => setBounds(b),
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "w") {
        setWireframe((v) => !v);
      } else if (e.key.toLowerCase() === "s") {
        setFlatShading((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleError = useCallback((msg: string) => setError(msg), []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-50/95 backdrop-blur-sm dark:bg-neutral-950/95">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-neutral-200/70 bg-neutral-100/80 px-3 dark:border-neutral-800/70 dark:bg-neutral-900/60">
        <div className="min-w-0 flex-1 truncate text-sm text-neutral-800 dark:text-neutral-200" title={file.name}>
          {file.name}
        </div>
        <ToggleButton
          active={wireframe}
          onClick={() => setWireframe((v) => !v)}
          label={t("viewer.wireframe")}
          hint="W"
        />
        <ToggleButton
          active={!flatShading}
          onClick={() => setFlatShading((v) => !v)}
          label={t("viewer.smooth")}
          hint="S"
        />
        <div className="mx-1 h-5 w-px bg-neutral-300 dark:bg-neutral-700" aria-hidden />
        <AppearanceControls />
        <button
          type="button"
          onClick={onClose}
          className="ml-2 rounded px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-800"
          title={t("viewer.closeHint")}
        >
          {t("viewer.close")}
        </button>
      </header>

      <div className="min-h-0 flex-1">
        {error ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-red-600 dark:text-red-400">
            {t("viewer.loadFailed", { reason: error })}
          </div>
        ) : (
          <Canvas camera={{ fov: 35, near: 0.1, far: 10000, position: [200, -200, 150] }}>
            <ambientLight intensity={0.6} />
            {lightRefs.map((ref, i) => (
              <directionalLight key={i} ref={ref} intensity={i === 0 ? 0.9 : 0} />
            ))}
            <GroundDisc ref={groundRef} bounds={bounds} />
            <PrintBedGrid />
            <MeshLoader
              key={file.id}
              fileId={file.id}
              extension={file.extension}
              wireframe={wireframe}
              flatShading={flatShading}
              controlsRef={controlsRef}
              onError={handleError}
              onMaterialChange={handleMaterial}
              onBoundsChange={handleBounds}
            />
            <ViewerAppearance
              materialRef={materialRef}
              lightRefs={lightRefs}
              groundRef={groundRef}
              bounds={bounds}
            />
            <OrbitControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.08} />
          </Canvas>
        )}
      </div>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "rounded px-2 py-1 text-xs transition-colors " +
        (active
          ? "bg-indigo-500/30 text-indigo-900 dark:text-indigo-100"
          : "text-neutral-700 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-800")
      }
      title={`${label} (${hint})`}
    >
      {label}
    </button>
  );
}
