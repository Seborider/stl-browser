const UNITS = ["B", "KB", "MB", "GB"] as const;

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 100 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${UNITS[unitIndex]}`;
}

export function formatDate(mtimeMs: number): string {
  const d = new Date(mtimeMs);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function formatMm(mm: number): string {
  return `${mm.toFixed(1)} mm`;
}

// Known 3D file extensions get a distinctive tile color; anything else
// falls back to neutral. The mapping is deliberately small — it grows
// when the Phase 3 scanner learns new extensions.
const FORMAT_COLOR_MAP: Record<string, string> = {
  stl: "#8b5cf6",
  "3mf": "#22d3ee",
  obj: "#f59e0b",
};

const UNKNOWN_COLOR = "#52525b";

export function formatColor(extension: string): string {
  return FORMAT_COLOR_MAP[extension.toLowerCase()] ?? UNKNOWN_COLOR;
}

export function formatLabel(extension: string): string {
  return extension.toUpperCase();
}
