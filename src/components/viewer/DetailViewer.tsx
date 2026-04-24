import { useCallback, useEffect, useRef, useState, type ComponentRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { FileEntry } from "../../generated";
import { MeshLoader } from "./MeshLoader";
import { PrintBedGrid } from "./PrintBedGrid";

export type OrbitControlsRef = ComponentRef<typeof OrbitControls>;

interface Props {
  file: FileEntry;
  onClose: () => void;
}

export function DetailViewer({ file, onClose }: Props) {
  const [wireframe, setWireframe] = useState(false);
  const [flatShading, setFlatShading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const controlsRef = useRef<OrbitControlsRef | null>(null);

  useEffect(() => setError(null), [file.id]);

  // Scoped to the viewer's lifetime so the grid's own Escape handling isn't
  // clobbered while the viewer is closed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key.toLowerCase() === "w") {
        setWireframe((v) => !v);
      } else if (e.key.toLowerCase() === "s") {
        setFlatShading((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleError = useCallback((msg: string) => setError(msg), []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950/95 backdrop-blur-sm">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-neutral-800/70 bg-neutral-900/60 px-3">
        <div className="min-w-0 flex-1 truncate text-sm text-neutral-200" title={file.name}>
          {file.name}
        </div>
        <ToggleButton
          active={wireframe}
          onClick={() => setWireframe((v) => !v)}
          label="Wireframe"
          hint="W"
        />
        <ToggleButton
          active={!flatShading}
          onClick={() => setFlatShading((v) => !v)}
          label="Smooth"
          hint="S"
        />
        <button
          type="button"
          onClick={onClose}
          className="ml-2 rounded px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
          title="Close (Esc)"
        >
          Close
        </button>
      </header>

      <div className="min-h-0 flex-1">
        {error ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-red-400">
            Failed to load mesh: {error}
          </div>
        ) : (
          <Canvas camera={{ fov: 35, near: 0.1, far: 10000, position: [200, -200, 150] }}>
            <ambientLight intensity={0.6} />
            <directionalLight position={[200, 200, 400]} intensity={0.9} />
            <PrintBedGrid />
            <MeshLoader
              key={file.id}
              fileId={file.id}
              extension={file.extension}
              wireframe={wireframe}
              flatShading={flatShading}
              controlsRef={controlsRef}
              onError={handleError}
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
          ? "bg-indigo-500/30 text-indigo-100"
          : "text-neutral-300 hover:bg-neutral-800")
      }
      title={`${label} (${hint})`}
    >
      {label}
    </button>
  );
}
