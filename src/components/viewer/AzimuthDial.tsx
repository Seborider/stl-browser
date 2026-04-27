import { useCallback, useRef } from "react";

interface Props {
  azimuthDeg: number;
  onChange: (deg: number) => void;
  size?: number;
}

// SVG dial: 0° points to +X (right), CCW positive (standard math convention).
// Drag the handle to set azimuth; arrow keys nudge ±1° (Shift = ±15°).
export function AzimuthDial({ azimuthDeg, onChange, size = 140 }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const radius = size / 2 - 12;
  const cx = size / 2;
  const cy = size / 2;

  const az = ((azimuthDeg % 360) + 360) % 360;
  const rad = (az * Math.PI) / 180;
  const handleX = cx + radius * Math.cos(rad);
  const handleY = cy - radius * Math.sin(rad);

  const angleFromEvent = useCallback(
    (clientX: number, clientY: number): number => {
      const svg = svgRef.current;
      if (!svg) return 0;
      const rect = svg.getBoundingClientRect();
      const x = clientX - rect.left - cx;
      const y = -(clientY - rect.top - cy);
      const a = (Math.atan2(y, x) * 180) / Math.PI;
      return ((a % 360) + 360) % 360;
    },
    [cx, cy],
  );

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
    onChange(angleFromEvent(e.clientX, e.clientY));
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!(e.buttons & 1)) return;
    onChange(angleFromEvent(e.clientX, e.clientY));
  };

  const onKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    const step = e.shiftKey ? 15 : 1;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      onChange(az + step);
      e.preventDefault();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      onChange(az - step);
      e.preventDefault();
    }
  };

  return (
    <svg
      ref={svgRef}
      width={size}
      height={size}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={Math.round(az)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyDown={onKeyDown}
      className="cursor-pointer touch-none select-none focus:outline-none"
    >
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        className="fill-neutral-100 stroke-neutral-300 dark:fill-neutral-800 dark:stroke-neutral-700"
        strokeWidth={1}
      />
      <line
        x1={cx}
        y1={cy}
        x2={handleX}
        y2={handleY}
        className="stroke-indigo-500"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <circle
        cx={handleX}
        cy={handleY}
        r={6}
        className="fill-indigo-500 stroke-white dark:stroke-neutral-900"
        strokeWidth={2}
      />
      <circle cx={cx} cy={cy} r={2} className="fill-neutral-400 dark:fill-neutral-500" />
    </svg>
  );
}
