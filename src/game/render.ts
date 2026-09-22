import type { Landscape, Vec3 } from './landscape';

/** Resolution of the offscreen heat-map (it is up-scaled smoothly on the visible canvas). */
export const RES = 140;

export type PaletteId = 'sunset' | 'viridis' | 'cividis' | 'iceFire';

interface PaletteDef {
  name: string;
  /** short line describing who/what it's tuned for */
  blurb: string;
  /** t=0 → best/lowest loss (bright), t=1 → worst/highest loss (dark, blends into the fog) */
  stops: [number, [number, number, number]][];
}

export const PALETTES: Record<PaletteId, PaletteDef> = {
  sunset: {
    name: 'Sunset', blurb: 'Default — high-contrast, most colourful',
    stops: [
      [0.0, [214, 255, 56]],
      [0.18, [0, 224, 150]],
      [0.45, [0, 149, 255]],
      [0.72, [130, 40, 220]],
      [1.0, [22, 7, 46]],
    ],
  },
  viridis: {
    name: 'Viridis', blurb: 'Colour-blind friendly (red-green safe)',
    stops: [
      [0.0, [253, 231, 37]],
      [0.25, [94, 201, 98]],
      [0.5, [33, 145, 140]],
      [0.75, [59, 82, 139]],
      [1.0, [68, 1, 84]],
    ],
  },
  cividis: {
    name: 'Cividis', blurb: 'Optimised for colour vision deficiency',
    stops: [
      [0.0, [255, 234, 70]],
      [0.35, [184, 171, 91]],
      [0.65, [123, 123, 122]],
      [0.85, [65, 79, 107]],
      [1.0, [0, 32, 77]],
    ],
  },
  iceFire: {
    name: 'Ice & Fire', blurb: 'Blue/orange — max contrast, no red-green',
    stops: [
      [0.0, [255, 179, 71]],
      [0.32, [255, 240, 200]],
      [0.55, [173, 216, 255]],
      [0.8, [60, 110, 200]],
      [1.0, [17, 26, 58]],
    ],
  },
};

export const PALETTE_IDS: PaletteId[] = ['sunset', 'viridis', 'cividis', 'iceFire'];

function palette(stops: [number, [number, number, number]][], t: number): [number, number, number] {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const f = (t - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
    }
  }
  return stops[stops.length - 1][1];
}

/**
 * CSS gradient string for a swatch/colorbar preview. `angle` follows CSS linear-gradient
 * convention: 90deg goes left→right (t=0 on the left), 180deg goes top→bottom (t=0 on top).
 * t=0 is always the best/lowest-loss end of the scale, t=1 the worst/highest-loss end.
 */
export function paletteSwatchCss(id: PaletteId, angle = 90): string {
  const parts = PALETTES[id].stops.map(([t, [r, g, b]]) => `rgb(${r},${g},${b}) ${Math.round(t * 100)}%`);
  return `linear-gradient(${angle}deg, ${parts.join(', ')})`;
}

export function lossColor(ls: Landscape, v: number, theme: PaletteId): string {
  const [r, g, b] = palette(PALETTES[theme].stops, (v - ls.lo) / (ls.hi - ls.lo));
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

const FOG: [number, number, number] = [9, 13, 24];
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
 *
 * On 4D courses, older reveals fade out as the previewed slice `z` drifts from the w they were
 * seen at — but `ballXY` (where the ball is standing right now) stays fully visible around
 * itself at every `z`, so dragging the w-slider never blinds you to your own surroundings,
 * only to terrain you explored elsewhere.
 */
export function paintHeat(
  img: ImageData,
  ls: Landscape,
  z: number,
  reveals: Vec3[],
  ballXY: [number, number],
  vision: number,
  revealAll: boolean,
  pixelSample: number,
  theme: PaletteId,
): void {
  const d = img.data;
  const stops = PALETTES[theme].stops;
  const span = ls.hi - ls.lo;
  const inner = vision * 0.55;
  for (let j = 0; j < RES; j++) {
    const y = -1 + (2 * (j + 0.5)) / RES;
    for (let i = 0; i < RES; i++) {
      const x = -1 + (2 * (i + 0.5)) / RES;
      let a = 0;
      if (revealAll) a = 1;
      else {
        // the ball's own neighbourhood: full visibility, no w falloff, at every slice
        const bdx = x - ballXY[0];
        const bdy = y - ballXY[1];
        const bdd = Math.sqrt(bdx * bdx + bdy * bdy);
        if (bdd < vision) a = bdd <= inner ? 1 : 1 - (bdd - inner) / (vision - inner);

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
      const [r, g, b] = palette(stops, t);
      // contour lines — darkened harder than the base palette for a punchier, more legible relief
      const band = t * 16;
      const line = Math.abs(band - Math.round(band));
      const shade = line < 0.07 ? 0.55 : 1;
      a = a * a * (3 - 2 * a);
      d[o] = FOG[0] + (r * shade - FOG[0]) * a;
      d[o + 1] = FOG[1] + (g * shade - FOG[1]) * a;
      d[o + 2] = FOG[2] + (b * shade - FOG[2]) * a;
      d[o + 3] = 255;
    }
  }
}
