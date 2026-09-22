export type Vec3 = [number, number, number];

export type DifficultyId = 'easy' | 'medium' | 'hard';

export interface Difficulty {
  id: DifficultyId;
  /** ML jargon (e.g. "SGD") — left untranslated everywhere it's shown. Description text for the
   *  player lives in the i18n dict (Dict.diffBlurb), keyed by `id`. */
  label: string;
  shots: number;
  /** Loss depends on a 3rd parameter `w` (=> 4D plot) controlled by a slider. */
  fourD: boolean;
  decoys: number;
  ripple: number;
  /** Relative noise on the gradient hint (mini-batch noise). */
  gradNoise: number;
  /** Std-dev of the noise added to where the ball actually lands (world units). */
  landNoise: number;
  /** Radius of the region revealed around every visited point. */
  vision: number;
  /** Fraction of pixels inside the revealed radius that are actually painted (1 = a solid patch,
   *  lower = a sparse, speckled reveal that shows only scattered samples of the true terrain). */
  pixelSample: number;
  multiplier: number;
  autoAim: boolean;
}

export const DIFFICULTIES: Difficulty[] = [
  {
    id: 'easy', label: 'Batch GD',
    shots: 8, fourD: false, decoys: 0, ripple: 0.03, gradNoise: 0, landNoise: 0,
    vision: 0.6, pixelSample: 1, multiplier: 1, autoAim: true,
  },
  {
    id: 'medium', label: 'SGD',
    shots: 7, fourD: false, decoys: 5, ripple: 0.11, gradNoise: 0.3, landNoise: 0.03,
    vision: 0.21, pixelSample: 0.5, multiplier: 1.25, autoAim: false,
  },
  {
    id: 'hard', label: 'Hyper-SGD 4D',
    shots: 7, fourD: true, decoys: 7, ripple: 0.16, gradNoise: 0.45, landNoise: 0.05,
    vision: 0.16, pixelSample: 0.3, multiplier: 1.5, autoAim: false,
  },
];

export const getDifficulty = (id: string): Difficulty =>
  DIFFICULTIES.find((d) => d.id === id) ?? DIFFICULTIES[0];

// ---------- deterministic randomness ----------

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gauss(r: () => number): number {
  const u = 1 - r();
  const v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------- landscape ----------

interface Well { c: Vec3; depth: number; s: Vec3 }
interface Ripple { k: Vec3; phase: number; amp: number }

export interface Landscape {
  fourD: boolean;
  loss(x: number, y: number, z: number): number;
  grad(x: number, y: number, z: number): Vec3;
  start: Vec3;
  best: Vec3;
  /** global minimum, colour-scale upper bound, and a "typical" loss used for scoring */
  lo: number;
  hi: number;
  median: number;
  /** stable per-round seed, used to make the stippled fog-reveal pattern deterministic */
  seedHash: number;
}

export function buildLandscape(seed: string, d: Difficulty): Landscape {
  const seedHash = hashString(seed);
  const r = rng(seedHash);
  const fourD = d.fourD;
  const rp = (m: number) => (r() * 2 - 1) * m;

  const wells: Well[] = [];
  const gc: Vec3 = [rp(0.7), rp(0.7), fourD ? rp(0.6) : 0];
  wells.push({ c: gc, depth: 1.1, s: [0.26, 0.26, fourD ? 0.4 : 50] });
  for (let i = 0; i < d.decoys; i++) {
    let c: Vec3 = [0, 0, 0];
    for (let tries = 0; tries < 30; tries++) {
      c = [rp(0.85), rp(0.85), fourD ? rp(0.85) : 0];
      if (Math.hypot(c[0] - gc[0], c[1] - gc[1], c[2] - gc[2]) > 0.55) break;
    }
    const s = 0.14 + r() * 0.14;
    wells.push({ c, depth: 0.4 + r() * 0.4, s: [s, s * (0.8 + r() * 0.5), fourD ? 0.3 + r() * 0.3 : 50] });
  }

  const ripples: Ripple[] = [];
  for (let i = 0; i < 4; i++) {
    const a = r() * Math.PI * 2;
    const f = 6 + r() * 8;
    ripples.push({
      k: [Math.cos(a) * f, Math.sin(a) * f, fourD ? (r() * 2 - 1) * 8 : 0],
      phase: r() * 6.28,
      amp: d.ripple * (0.6 + r() * 0.8),
    });
  }

  const loss = (x: number, y: number, z: number): number => {
    if (!fourD) z = 0;
    let v = 0.28 * (x * x + y * y) + (fourD ? 0.18 * z * z : 0);
    for (const w of wells) {
      const dx = (x - w.c[0]) / w.s[0];
      const dy = (y - w.c[1]) / w.s[1];
      const dz = (z - w.c[2]) / w.s[2];
      v -= w.depth * Math.exp(-(dx * dx + dy * dy + dz * dz));
    }
    for (const p of ripples) v += p.amp * Math.sin(p.k[0] * x + p.k[1] * y + p.k[2] * z + p.phase);
    return v;
  };

  const grad = (x: number, y: number, z: number): Vec3 => {
    const h = 1e-3;
    return [
      (loss(x + h, y, z) - loss(x - h, y, z)) / (2 * h),
      (loss(x, y + h, z) - loss(x, y - h, z)) / (2 * h),
      fourD ? (loss(x, y, z + h) - loss(x, y, z - h)) / (2 * h) : 0,
    ];
  };

  // Coarse scan for the global minimum + colour-scale statistics.
  const N = 56;
  const ZN = fourD ? 21 : 1;
  const samples: number[] = [];
  let bestV = Infinity;
  let best: Vec3 = [0, 0, 0];
  for (let k = 0; k < ZN; k++) {
    const z = fourD ? -1 + (2 * k) / (ZN - 1) : 0;
    for (let j = 0; j < N; j++) {
      const y = -1 + (2 * j) / (N - 1);
      for (let i = 0; i < N; i++) {
        const x = -1 + (2 * i) / (N - 1);
        const v = loss(x, y, z);
        samples.push(v);
        if (v < bestV) { bestV = v; best = [x, y, z]; }
      }
    }
  }
  // Refine by zooming a local grid.
  let span = 0.08;
  for (let it = 0; it < 4; it++) {
    const c = best;
    const n = 9;
    for (let k = 0; k < (fourD ? n : 1); k++) {
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const x = c[0] + span * ((2 * i) / (n - 1) - 1);
          const y = c[1] + span * ((2 * j) / (n - 1) - 1);
          const z = fourD ? c[2] + span * ((2 * k) / (n - 1) - 1) : 0;
          const v = loss(x, y, z);
          if (v < bestV) { bestV = v; best = [x, y, z]; }
        }
      }
    }
    span /= 3;
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length * 0.5)];
  const hi = samples[Math.floor(samples.length * 0.97)];

  // Start somewhere unpromising and far from the goal.
  let start: Vec3 = [0.8, 0.8, 0];
  for (let tries = 0; tries < 300; tries++) {
    const c: Vec3 = [rp(0.9), rp(0.9), fourD ? rp(0.9) : 0];
    if (Math.hypot(c[0] - best[0], c[1] - best[1], c[2] - best[2]) > 1.1 && loss(...c) > median) {
      start = c;
      break;
    }
  }

  return { fourD, loss, grad, start, best, lo: bestV, hi, median, seedHash };
}

/**
 * Points for a run that reached `bestLoss`, scaled by how much of the descent from this
 * round's own starting loss down to the global minimum was actually covered. Anchoring on
 * the start (rather than an abstract global percentile) keeps every round's scoring fair
 * regardless of how harsh that particular starting spot happened to be.
 */
export function computePoints(ls: Landscape, d: Difficulty, startLoss: number, bestLoss: number): number {
  const span = Math.max(startLoss - ls.lo, 1e-6);
  const t = Math.min(1, Math.max(0, (startLoss - bestLoss) / span));
  return Math.round(1000 * Math.pow(t, 1.5) * d.multiplier);
}
