// Offline fallback: a synthetic harbour town (used when GSI tiles cannot be reached, or with ?demo=1)
import { makeFrame, hash01 } from './geo.js';
import { finishRegion } from './region.js';

export function syntheticRegion(N = 512, L = 1200) {
  const dx = L / N, half = L / 2;
  const ground = new Float32Array(N * N);
  const water = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -half + (i + 0.5) * dx, z = -half + (j + 0.5) * dx;
    // sea to the south, gently curved shoreline; land rises to a hill in the north
    const shore = 180 + 60 * Math.sin(x / 190);
    const k = j * N + i;
    // a river crossing the town
    const river = Math.abs(x - 120 - 40 * Math.sin(z / 120)) < 14 && z > -half + 40;
    if (z > shore || (river && z > -350)) { water[k] = 1; continue; }
    const t = (shore - z) / 900;
    ground[k] = 1.2 + 14 * t * t + 3 * Math.sin(x / 90) * t + (z < -380 ? (-380 - z) * 0.18 : 0);
  }
  const buildings = [];
  let id = 0;
  for (let bz = -520; bz < 170; bz += 34) for (let bx = -560; bx < 560; bx += 30) {
    const r = hash01(bx, bz);
    if (r < 0.18) continue; // plazas / streets
    const w = 14 + 10 * hash01(bx + 1, bz), d = 12 + 12 * hash01(bx, bz + 1);
    const cx = bx + 15 + (hash01(bx + 7, bz) - 0.5) * 4, cz = bz + 17 + (hash01(bx, bz + 7) - 0.5) * 4;
    if (Math.abs(cx - 120 - 40 * Math.sin(cz / 120)) < 30) continue;
    const solid = r > 0.8;
    buildings.push({
      ring: [[cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2]].reverse(),
      src: 'synthetic', kind: solid ? 'solid' : 'normal', height: solid ? 12 + 12 * r : 6 + 2 * r, props: {}, id: id++,
    });
  }
  const frame = makeFrame(33.5, 133.5);
  const region = finishRegion({ N, L, dx, ground, water, frame, buildings, center: { lat: 33.5, lon: 133.5 } });
  // a plausible photo: fields, roads grid, beach
  const cv = new OffscreenCanvas(2048, 2048);
  const g = cv.getContext('2d');
  g.fillStyle = '#7b8069'; g.fillRect(0, 0, 2048, 2048);
  for (let i = 0; i < 4000; i++) { g.fillStyle = `hsl(${70 + 30 * Math.random()},${12 + 10 * Math.random()}%,${38 + 14 * Math.random()}%)`; g.fillRect(Math.random() * 2048, Math.random() * 2048, 30, 30); }
  g.fillStyle = '#8e8c86';
  for (let x = 0; x < 2048; x += 51) g.fillRect(x, 0, 6, 2048);
  for (let y = 0; y < 2048; y += 58) g.fillRect(0, y, 2048, 7);
  region.photo = { canvas: cv, got: 1, total: 1 };
  region.official = { cells: [], covered: false, available: false };
  region.stats = { dem5aShare: 0, buildings: { synthetic: buildings.length }, photoTiles: 0, synthetic: true };
  return region;
}
