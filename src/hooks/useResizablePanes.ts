import { useCallback, useRef } from "react";

export function useDragHandle(onDelta: (deltaPx: number) => void) {
  const lastXRef = useRef(0);

  return useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      lastXRef.current = e.clientX;

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - lastXRef.current;
        lastXRef.current = ev.clientX;
        if (delta !== 0) onDelta(delta);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
    },
    [onDelta],
  );
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
