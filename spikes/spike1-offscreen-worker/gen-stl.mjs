// Generates binary STL fixtures with an approximately-requested triangle count.
// Geometry is a square grid displaced on Z by sin*cos so there's something
// visually interesting to shade, and the triangle count scales predictably.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

function generateStl(requestedTriangleCount, outputPath) {
  // Each grid cell = 2 triangles. Pick n so n*n*2 is close to the requested count.
  const n = Math.max(2, Math.round(Math.sqrt(requestedTriangleCount / 2)));
  const triangles = n * n * 2;
  const sizeMm = 100;

  const HEADER_LEN = 80;
  const TRI_SIZE = 50; // 12 normal + 36 verts + 2 attrib
  const buf = Buffer.alloc(HEADER_LEN + 4 + triangles * TRI_SIZE);
  buf.writeUInt32LE(triangles, HEADER_LEN);

  let off = HEADER_LEN + 4;

  const vertex = (ix, iy) => {
    const x = (ix / n) * sizeMm - sizeMm / 2;
    const y = (iy / n) * sizeMm - sizeMm / 2;
    const z =
      Math.sin((ix / n) * Math.PI * 4) * Math.cos((iy / n) * Math.PI * 4) * 8;
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

  writeFileSync(outputPath, buf);
  return { triangles, bytes: buf.length };
}

const fixtures = [
  { requested: 100_000, file: "fixture-100k.stl" },
  { requested: 1_000_000, file: "fixture-1m.stl" },
];

for (const { requested, file } of fixtures) {
  const out = resolve(HERE, file);
  const { triangles, bytes } = generateStl(requested, out);
  const mb = (bytes / (1024 * 1024)).toFixed(1);
  console.log(
    `${file}: ${triangles.toLocaleString()} tris (requested ${requested.toLocaleString()}), ${mb} MB`,
  );
}
