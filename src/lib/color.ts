import * as THREE from "three";

const GROUND_LIGHTNESS = 0.7;
const GROUND_SATURATION = 0.6;

// Same hue as the background, darker + less saturated so the model reads
// against the floor regardless of the user's background pick. Mutates and
// returns `scratch`; pass a dedicated THREE.Color so callers don't allocate
// per drag tick.
export function deriveGroundColor(hex: string, scratch: THREE.Color): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  scratch.set(hex);
  scratch.getHSL(hsl);
  scratch.setHSL(hsl.h, hsl.s * GROUND_SATURATION, hsl.l * GROUND_LIGHTNESS);
  return scratch;
}

export function deriveGroundHex(hex: string): string {
  return `#${deriveGroundColor(hex, new THREE.Color()).getHexString()}`;
}
