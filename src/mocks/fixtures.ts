export type FileFormat = "stl" | "3mf" | "obj";

export interface MockLibrary {
  id: string;
  name: string;
  path: string;
}

export interface BoundingBox {
  x: number;
  y: number;
  z: number;
}

export interface MockFile {
  id: string;
  name: string;
  path: string;
  libraryId: string;
  sizeBytes: number;
  mtimeMs: number;
  format: FileFormat;
  triangleCount: number;
  boundingBox: BoundingBox;
}

export const mockLibraries: MockLibrary[] = [
  {
    id: "lib-printables",
    name: "Printables Favorites",
    path: "/Users/sebo/Downloads/Printables",
  },
  {
    id: "lib-prusa",
    name: "Prusa Projects",
    path: "/Users/sebo/Documents/Prusa",
  },
];

const ADJECTIVES = [
  "Articulated", "Low-poly", "Modular", "Parametric", "Hinged", "Flexi",
  "Stackable", "Geometric", "Voronoi", "Hollow", "Fractal", "Minimalist",
  "Retro", "Angular", "Organic", "Faceted", "Tapered", "Reinforced",
  "Calibration", "Scaled", "Decorative", "Functional", "Textured", "Smooth",
  "Braced", "Threaded", "Snap-fit", "Interlocking", "Beveled", "Chamfered",
];

const NOUNS = [
  "Dragon", "Benchy", "Cube", "Gear", "Bracket", "Vase", "Planter", "Hook",
  "Clamp", "Skull", "Whistle", "Fidget", "Knob", "Handle", "Coin", "Chess Piece",
  "Keychain", "Ring", "Spool Holder", "Phone Stand", "Cable Tie", "Drawer",
  "Tray", "Lid", "Container", "Base Plate", "Mount", "Adapter", "Bushing",
  "Pulley", "Lever", "Valve", "Nozzle", "Coupler", "Propeller", "Fan Duct",
  "Shelf", "Lamp Shade", "Coaster", "Bookend", "Pencil Holder", "Doorstop",
];

// Deterministic PRNG (mulberry32) so fixtures are stable across reloads.
function mulberry32(seed: number) {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const FORMATS: FileFormat[] = ["stl", "3mf", "obj"];

function pick<T>(rand: () => number, arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

const NOW = Date.UTC(2026, 3, 18);
const ONE_DAY_MS = 86_400_000;

function generateFiles(): MockFile[] {
  const rand = mulberry32(0xC0FFEE);
  const files: MockFile[] = [];

  for (let i = 0; i < 2000; i++) {
    const library = mockLibraries[i % mockLibraries.length];
    const adj = pick(rand, ADJECTIVES);
    const noun = pick(rand, NOUNS);
    const variant = Math.floor(rand() * 999);
    const format = pick(rand, FORMATS);
    const name = `${adj} ${noun} ${variant.toString().padStart(3, "0")}.${format}`;

    const sizeBytes = Math.floor(10_000 + rand() * 120_000_000);
    const ageDays = Math.floor(rand() * 365 * 3);
    const mtimeMs = NOW - ageDays * ONE_DAY_MS - Math.floor(rand() * ONE_DAY_MS);
    const triangleCount = Math.floor(500 + rand() * 800_000);
    const boundingBox: BoundingBox = {
      x: +(5 + rand() * 215).toFixed(2),
      y: +(5 + rand() * 215).toFixed(2),
      z: +(5 + rand() * 215).toFixed(2),
    };

    files.push({
      id: `file-${i}`,
      name,
      path: `${library.path}/${name}`,
      libraryId: library.id,
      sizeBytes,
      mtimeMs,
      format,
      triangleCount,
      boundingBox,
    });
  }

  return files;
}

export const mockFiles: MockFile[] = generateFiles();
