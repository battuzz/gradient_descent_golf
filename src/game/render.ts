import type { Landscape, Vec3 } from './landscape';
import { isoDepth, isoProject, type IsoView } from './iso';

/** Resolution of the offscreen heat-map (it is up-scaled smoothly on the visible canvas). */
export const RES = 140;

export type PaletteId = 'sunset' | 'viridis' | 'cividis' | 'iceFire';

interface PaletteDef {
  /** proper name of the colour scale — left untranslated (e.g. "Viridis" everywhere) */
  name: string;
  /** t=0 → best/lowest loss (bright), t=1 → worst/highest loss (dark, blends into the fog) */
  stops: [number, [number, number, number]][];
}

export const PALETTES: Record<PaletteId, PaletteDef> = {
  sunset: {
    name: 'Sunset',
    stops: [
      [0.0, [214, 255, 56]],
      [0.18, [0, 224, 150]],
      [0.45, [0, 149, 255]],
      [0.72, [130, 40, 220]],
      [1.0, [22, 7, 46]],
    ],
  },
  viridis: {
    name: 'Viridis',
    stops: [
      [0.0, [253, 231, 37]],
      [0.25, [94, 201, 98]],
      [0.5, [33, 145, 140]],
      [0.75, [59, 82, 139]],
      [1.0, [68, 1, 84]],
    ],
  },
  cividis: {
    name: 'Cividis',
    stops: [
      [0.0, [255, 234, 70]],
      [0.35, [184, 171, 91]],
      [0.65, [123, 123, 122]],
      [0.85, [65, 79, 107]],
      [1.0, [0, 32, 77]],
    ],
  },
  iceFire: {
    name: 'Ice & Fire',
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

export function palette(stops: [number, [number, number, number]][], t: number): [number, number, number] {
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

/** Mesh resolution of the 3D relief view (quads per side). */
export const TERRAIN_GRID = 32;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
const smooth = (a: number) => a * a * (3 - 2 * a);

// fixed upper-left key light, in (x, y, elevation) space
const LIGHT: [number, number, number] = [-0.55, -0.35, 0.75];
const LIGHT_MAG = Math.hypot(LIGHT[0], LIGHT[1], LIGHT[2]);
const SLOPE_K = 2.6; // exaggerates elevation differences into visible relief
/** quads whose 4 corners average below this visibility are skipped entirely, not drawn faint */
const VIS_CUTOFF = 0.03;

export interface TerrainMesh {
  grid: number;
  /** per-vertex elevation, visibility and colour — cheap to reproject every frame, expensive
   *  to resample (loss/palette calls), so this is rebuilt only when the game state changes */
  elev: Float32Array;
  vis: Float32Array;
  col: Float32Array;
}

/**
 * Samples the loss landscape into a heightfield mesh (loss -> elevation) with the same
 * fog-of-war visibility as `paintHeat`. Unlike the flat heat-map, unrevealed vertices keep
 * their real elevation and colour — `drawTerrainMesh` uses `vis` to skip drawing them
 * entirely, rather than flattening them into a visible "fog plane".
 */
export function buildTerrainMesh(
  ls: Landscape,
  z: number,
  reveals: Vec3[],
  ballXY: [number, number],
  vision: number,
  revealAll: boolean,
  theme: PaletteId,
): TerrainMesh {
  const stops = PALETTES[theme].stops;
  const span = ls.hi - ls.lo;
  const inner = vision * 0.55;
  const N = TERRAIN_GRID;

  const visAlpha = (x: number, y: number): number => {
    if (revealAll) return 1;
    let a = 0;
    const bdd = Math.hypot(x - ballXY[0], y - ballXY[1]);
    if (bdd < vision) a = bdd <= inner ? 1 : 1 - (bdd - inner) / (vision - inner);
    for (const p of reveals) {
      const dd = Math.hypot(x - p[0], y - p[1]);
      if (dd >= vision) continue;
      let w = dd <= inner ? 1 : 1 - (dd - inner) / (vision - inner);
      if (ls.fourD) {
        const dz = (z - p[2]) / W_SIGMA;
        w *= Math.exp(-dz * dz);
      }
      if (w > a) a = w;
    }
    return a;
  };

  const verts = N + 1;
  const elev = new Float32Array(verts * verts);
  const vis = new Float32Array(verts * verts);
  const col = new Float32Array(verts * verts * 3);
  const vidx = (i: number, j: number) => j * verts + i;
  for (let j = 0; j < verts; j++) {
    const y = -1 + (2 * j) / N;
    for (let i = 0; i < verts; i++) {
      const x = -1 + (2 * i) / N;
      const t = clamp01((ls.loss(x, y, z) - ls.lo) / span);
      const [r, g, b] = palette(stops, t);
      const k = vidx(i, j);
      elev[k] = t;
      vis[k] = smooth(clamp01(visAlpha(x, y)));
      col[k * 3] = r; col[k * 3 + 1] = g; col[k * 3 + 2] = b;
    }
  }
  return { grid: N, elev, vis, col };
}

/**
 * Reprojects and draws a mesh built by `buildTerrainMesh` through the given camera — cheap
 * (no loss/palette sampling), so it's safe to call every animation frame while the camera
 * orbits. Quads that are entirely unexplored are skipped, not drawn as a flat "fog plane".
 */
export function drawTerrainMesh(ctx: CanvasRenderingContext2D, mesh: TerrainMesh, view: IsoView): void {
  const N = mesh.grid;
  const verts = N + 1;
  const { elev, vis, col } = mesh;
  const vidx = (i: number, j: number) => j * verts + i;

  const cells: [number, number, number][] = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k00 = vidx(i, j), k10 = vidx(i + 1, j), k01 = vidx(i, j + 1), k11 = vidx(i + 1, j + 1);
      const v = (vis[k00] + vis[k10] + vis[k01] + vis[k11]) / 4;
      if (v <= VIS_CUTOFF) continue; // unexplored: not drawn at all, rather than a flat plane
      const cx = -1 + (2 * i + 1) / N, cy = -1 + (2 * j + 1) / N;
      const ce = (elev[k00] + elev[k10] + elev[k01] + elev[k11]) / 4;
      cells.push([i, j, isoDepth(view, cx, cy, ce)]);
    }
  }
  // painter's algorithm: paint back-to-front so nearer quads correctly overdraw farther ones
  cells.sort((a, b) => b[2] - a[2]);

  for (const [i, j] of cells) {
    const x0 = -1 + (2 * i) / N, x1 = -1 + (2 * (i + 1)) / N;
    const y0 = -1 + (2 * j) / N, y1 = -1 + (2 * (j + 1)) / N;
    const k00 = vidx(i, j), k10 = vidx(i + 1, j), k01 = vidx(i, j + 1), k11 = vidx(i + 1, j + 1);
    const e00 = elev[k00], e10 = elev[k10], e01 = elev[k01], e11 = elev[k11];

    const dEdx = ((e10 + e11 - e00 - e01) / 2) * SLOPE_K;
    const dEdy = ((e01 + e11 - e00 - e10) / 2) * SLOPE_K;
    const nx = -dEdx, ny = -dEdy, nz = 1;
    const nMag = Math.hypot(nx, ny, nz);
    const bright = Math.min(1.35, Math.max(0.4, (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / (nMag * LIGHT_MAG)));

    const cr = (col[k00 * 3] + col[k10 * 3] + col[k01 * 3] + col[k11 * 3]) / 4;
    const cg = (col[k00 * 3 + 1] + col[k10 * 3 + 1] + col[k01 * 3 + 1] + col[k11 * 3 + 1]) / 4;
    const cb = (col[k00 * 3 + 2] + col[k10 * 3 + 2] + col[k01 * 3 + 2] + col[k11 * 3 + 2]) / 4;
    const alpha = (vis[k00] + vis[k10] + vis[k01] + vis[k11]) / 4;

    const [p00x, p00y] = isoProject(view, x0, y0, e00);
    const [p10x, p10y] = isoProject(view, x1, y0, e10);
    const [p11x, p11y] = isoProject(view, x1, y1, e11);
    const [p01x, p01y] = isoProject(view, x0, y1, e01);

    const fill = `rgb(${clamp255(cr * bright)},${clamp255(cg * bright)},${clamp255(cb * bright)})`;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(p00x, p00y);
    ctx.lineTo(p10x, p10y);
    ctx.lineTo(p11x, p11y);
    ctx.lineTo(p01x, p01y);
    ctx.closePath();
    ctx.fill();
    // stroking each quad in its own fill colour papers over the hairline anti-aliasing seams
    // canvas otherwise leaves between adjacent polygon fills
    ctx.strokeStyle = fill;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
