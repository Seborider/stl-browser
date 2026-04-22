// Generates a ~100MB binary STL so Spike 2 has something chunky to stream.
// Same displaced-grid geometry as Spike 1, scaled up.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET_BYTES = 100 * 1024 * 1024; // 100 MB

const HEADER_LEN = 80;
const TRI_SIZE = 50;
// triangles = (bytes - 84) / 50 — solve for n where 2*n*n ≈ triangles.
const targetTris = Math.floor((TARGET_BYTES - HEADER_LEN - 4) / TRI_SIZE);
const n = Math.ceil(Math.sqrt(targetTris / 2));
const triangles = n * n * 2;
const bytes = HEADER_LEN + 4 + triangles * TRI_SIZE;

const buf = Buffer.alloc(bytes);
buf.writeUInt32LE(triangles, HEADER_LEN);

let off = HEADER_LEN + 4;
const sizeMm = 200;

const vertex = (ix, iy) => {
  const x = (ix / n) * sizeMm - sizeMm / 2;
  const y = (iy / n) * sizeMm - sizeMm / 2;
  const z =
    Math.sin((ix / n) * Math.PI * 6) * Math.cos((iy / n) * Math.PI * 6) * 10;
  return [x, y, z];
};

const writeVec3 = (v) => {
  buf.writeFloatLE(v[0], off); off += 4;
  buf.writeFloatLE(v[1], off); off += 4;
  buf.writeFloatLE(v[2], off); off += 4;
};

const writeTriangle = (a, b, c) => {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len; ny /= len; nz /= len;
  writeVec3([nx, ny, nz]);
  writeVec3(a); writeVec3(b); writeVec3(c);
  buf.writeUInt16LE(0, off); off += 2;
};

for (let iy = 0; iy < n; iy++) {
  for (let ix = 0; ix < n; ix++) {
    const a = vertex(ix, iy);
    const b = vertex(ix + 1, iy);
    const c = vertex(ix + 1, iy + 1);
    const d = vertex(ix, iy + 1);
    writeTriangle(a, b, c);
    writeTriangle(a, c, d);
  }
}

const out = resolve(HERE, "fixture-100mb.stl");
writeFileSync(out, buf);
console.log(
  `${out}: ${triangles.toLocaleString()} tris, ${(bytes / 1048576).toFixed(1)} MB`,
);
