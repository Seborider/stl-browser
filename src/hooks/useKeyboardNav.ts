import { useEffect, useRef } from "react";
import type { FileEntry } from "../generated";
import { deleteFile } from "../ipc/commands";
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
  const viewerFileId = useAppStore((s) => s.viewerFileId);
  const setViewerFileId = useAppStore((s) => s.setViewerFileId);

  // Keep handler's closure fresh without re-binding the listener every render.
  const latest = useRef({
    files,
    columns,
    selectedFileId,
    viewerFileId,
    focusInspector,
    scrollToIndex,
    setSelectedFile,
    setViewerFileId,
  });
  latest.current = {
    files,
    columns,
    selectedFileId,
    viewerFileId,
    focusInspector,
    scrollToIndex,
    setSelectedFile,
    setViewerFileId,
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;

      const {
        files,
        columns,
        selectedFileId,
        viewerFileId,
        focusInspector,
        scrollToIndex,
        setSelectedFile,
        setViewerFileId,
      } = latest.current;

      // Space: Finder-style quick preview. Toggle the detail viewer for the
      // selected file. Keep this before the `files.length === 0` guard so
      // pressing Space with an already-open viewer still closes it.
      if (e.key === " ") {
        if (viewerFileId !== null) {
          e.preventDefault();
          setViewerFileId(null);
          return;
        }
        if (selectedFileId !== null) {
          e.preventDefault();
          setViewerFileId(selectedFileId);
          return;
        }
        return;
      }

      if (e.key === "Escape") {
        if (viewerFileId !== null) {
          e.preventDefault();
          setViewerFileId(null);
          return;
        }
        if (selectedFileId !== null) {
          e.preventDefault();
          setSelectedFile(null);
          return;
        }
        return;
      }

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
        case "Delete":
        case "Backspace":
          if (selectedFileId !== null) {
            e.preventDefault();
            void deleteFile(selectedFileId).catch((err) => {
              console.error("delete_file failed", err);
            });
          }
          break;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
