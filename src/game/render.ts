import type { Landscape, Vec3 } from './landscape';

/** Resolution of the offscreen heat-map (it is up-scaled smoothly on the visible canvas). */
export const RES = 140;

const STOPS: [number, [number, number, number]][] = [
  [0.0, [190, 255, 90]],
  [0.22, [30, 215, 160]],
  [0.5, [40, 125, 215]],
  [0.78, [95, 60, 185]],
  [1.0, [38, 14, 72]],
];

function palette(t: number): [number, number, number] {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const [t0, c0] = STOPS[i - 1];
      const [t1, c1] = STOPS[i];
      const f = (t - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

export function lossColor(ls: Landscape, v: number): string {
  const [r, g, b] = palette((v - ls.lo) / (ls.hi - ls.lo));
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

const FOG: [number, number, number] = [13, 19, 32];
const W_SIGMA = 0.32;

/** Deterministic (seed, i, j) → [0, 1) pseudo-random value, stable across repaints. */
function pixelRand(seed: number, i: number, j: number): number {
  let h = (seed ^ Math.imul(i, 374761393) ^ Math.imul(j, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/**
 * Paints the loss slice at height `z` into `img`. Only regions near already-visited points
 * (the "fog of war") show their real colours, unless `revealAll` is set. `pixelSample` < 1
 * additionally keeps only a random fraction of those pixels — a sparse, speckled reveal
 * instead of a solid patch — so higher difficulties give you scattered samples, not the map.
 */
export function paintHeat(
  img: ImageData,
  ls: Landscape,
  z: number,
  reveals: Vec3[],
  vision: number,
  revealAll: boolean,
  pixelSample: number,
): void {
  const d = img.data;
  const span = ls.hi - ls.lo;
  const inner = vision * 0.55;
  for (let j = 0; j < RES; j++) {
    const y = -1 + (2 * (j + 0.5)) / RES;
    for (let i = 0; i < RES; i++) {
      const x = -1 + (2 * (i + 0.5)) / RES;
      let a = 0;
      if (revealAll) a = 1;
      else {
        for (let n = 0; n < reveals.length; n++) {
          const p = reveals[n];
          const dx = x - p[0];
          const dy = y - p[1];
          const dd = Math.sqrt(dx * dx + dy * dy);
          if (dd >= vision) continue;
          let w = dd <= inner ? 1 : 1 - (dd - inner) / (vision - inner);
          if (ls.fourD) {
            const dz = (z - p[2]) / W_SIGMA;
            w *= Math.exp(-dz * dz);
          }
          if (w > a) a = w;
        }
        if (a > 0.01 && pixelSample < 1 && pixelRand(ls.seedHash, i, j) >= pixelSample) a = 0;
      }
      const o = (j * RES + i) * 4;
      if (a <= 0.01) {
        d[o] = FOG[0]; d[o + 1] = FOG[1]; d[o + 2] = FOG[2]; d[o + 3] = 255;
        continue;
      }
      const v = ls.loss(x, y, z);
      const t = (v - ls.lo) / span;
      const [r, g, b] = palette(t);
      // contour lines
      const band = t * 16;
      const line = Math.abs(band - Math.round(band));
      const shade = line < 0.07 ? 0.72 : 1;
      a = a * a * (3 - 2 * a);
      d[o] = FOG[0] + (r * shade - FOG[0]) * a;
      d[o + 1] = FOG[1] + (g * shade - FOG[1]) * a;
      d[o + 2] = FOG[2] + (b * shade - FOG[2]) * a;
      d[o + 3] = 255;
    }
  }
}
