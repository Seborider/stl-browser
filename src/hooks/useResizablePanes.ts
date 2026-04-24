import { useCallback, useRef } from "react";

export function useDragHandle(onDelta: (deltaPx: number) => void) {
  const lastXRef = useRef(0);
  // Latest-ref pattern: App.tsx recreates `onDelta` each render and its closure
  // captures `paneWidths` at render time. Storing it in a ref (updated every
  // render) lets the mousemove handler read the freshest callback — so widths
  // accumulate across a drag instead of snapping to `start + lastDelta`.
  const onDeltaRef = useRef(onDelta);
  onDeltaRef.current = onDelta;

  return useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    lastXRef.current = e.clientX;

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - lastXRef.current;
      lastXRef.current = ev.clientX;
      if (delta !== 0) onDeltaRef.current(delta);
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
  }, []);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
