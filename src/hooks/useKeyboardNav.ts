import { useEffect, useRef } from "react";
import type { FileEntry } from "../generated";
import { useAppStore } from "../state/store";

interface Params {
  files: FileEntry[];
  columns: number;
  focusInspector: () => void;
  scrollToIndex: (index: number) => void;
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export function useKeyboardNav({
  files,
  columns,
  focusInspector,
  scrollToIndex,
}: Params) {
  const selectedFileId = useAppStore((s) => s.selectedFileId);
  const setSelectedFile = useAppStore((s) => s.setSelectedFile);

  // Keep handler's closure fresh without re-binding the listener every render.
  const latest = useRef({
    files,
    columns,
    selectedFileId,
    focusInspector,
    scrollToIndex,
    setSelectedFile,
  });
  latest.current = {
    files,
    columns,
    selectedFileId,
    focusInspector,
    scrollToIndex,
    setSelectedFile,
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;

      const {
        files,
        columns,
        selectedFileId,
        focusInspector,
        scrollToIndex,
        setSelectedFile,
      } = latest.current;

      if (files.length === 0) return;

      const currentIndex = selectedFileId !== null
        ? files.findIndex((f) => f.id === selectedFileId)
        : -1;

      const move = (delta: number) => {
        const base = currentIndex === -1 ? 0 : currentIndex;
        const next = Math.min(files.length - 1, Math.max(0, base + delta));
        if (currentIndex === -1 || next !== currentIndex) {
          setSelectedFile(files[next].id);
          scrollToIndex(next);
        }
      };

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          move(-1);
          break;
        case "ArrowRight":
          e.preventDefault();
          move(1);
          break;
        case "ArrowUp":
          e.preventDefault();
          move(-columns);
          break;
        case "ArrowDown":
          e.preventDefault();
          move(columns);
          break;
        case "Enter":
          if (currentIndex >= 0) {
            e.preventDefault();
            focusInspector();
          }
          break;
        case "Escape":
          if (selectedFileId !== null) {
            e.preventDefault();
            setSelectedFile(null);
          }
          break;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
