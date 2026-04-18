import type { FileFormat } from "../mocks/fixtures";

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

export const FORMAT_COLORS: Record<FileFormat, string> = {
  stl: "#8b5cf6",
  "3mf": "#22d3ee",
  obj: "#f59e0b",
};

export const FORMAT_LABELS: Record<FileFormat, string> = {
  stl: "STL",
  "3mf": "3MF",
  obj: "OBJ",
};
