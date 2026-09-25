import { useEffect, useRef } from 'react';
import { buildLandscape, getDifficulty, type Difficulty, type Landscape } from '../game/landscape';
import { PALETTES, palette } from '../game/render';
import { useLang, type Dict } from '../lib/i18n';

/**
 * Attract-mode banner for the leaderboard: a slowly orbiting 3D loss landscape where a golf ball
 * hops down −∇L shot by shot, sinks into the global minimum, and then the terrain morphs into a
 * fresh random course. Purely decorative — it never touches scores or game state.
 */

// smoother than the playable SGD course so the relief reads from across a room
const BANNER_DIFF: Difficulty = { ...getDifficulty('medium'), decoys: 4, ripple: 0.045 };

const G = 38; // quads per side
const V = G + 1;
const HWS = 1.0; // elevation, in world units, before camera scale
const GH = 1.18; // ground half-extent used for auto-fit (slightly under √2: corners may graze the edge)
const LIGHT = [-0.55, -0.35, 0.75] as const;
const LIGHT_MAG = Math.hypot(...LIGHT);
const STOPS = PALETTES.sunset.stops;
const CONFETTI = ['#b8ff5a', '#5ad1ff', '#eef4ff', '#d6ff38', '#00e096'];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (t: number) => t * t * (3 - 2 * t);

interface Course {
  ls: Landscape;
  lo: number;
  hi: number;
  elev: Float32Array;
  col: Float32Array;
}

function buildCourse(seed: string): Course {
  const ls = buildLandscape(seed, BANNER_DIFF);
  const raw = new Float32Array(V * V);
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) raw[j * V + i] = ls.loss(-1 + (2 * i) / G, -1 + (2 * j) / G, 0);
  // near-max elevation cap: a lower percentile flattens the hills into a plateau
  const sorted = Array.from(raw).sort((a, b) => a - b);
  const lo = ls.lo;
  const hi = sorted[Math.floor(sorted.length * 0.995)];
  const elev = new Float32Array(V * V);
  const col = new Float32Array(V * V * 3);
  for (let k = 0; k < V * V; k++) {
    const t = clamp01((raw[k] - lo) / (hi - lo));
    const [r, g, b] = palette(STOPS, t * 0.82); // stop short of the near-black end of the scale
    elev[k] = t;
    col[k * 3] = r; col[k * 3 + 1] = g; col[k * 3 + 2] = b;
  }
  return { ls, lo, hi, elev, col };
}

const elevAt = (c: Course, x: number, y: number) => clamp01((c.ls.loss(x, y, 0) - c.lo) / (c.hi - c.lo));

interface View { cT: number; sT: number; cP: number; sP: number; scale: number; ox: number; oy: number }

function makeView(W: number, H: number, theta: number, phi: number): View {
  const cP = Math.cos(phi), sP = Math.sin(phi);
  // wide banners are height-bound: zoom past the strict fit so the course spans more of the width
  // (only the far corner can graze the top edge, and only briefly as the camera orbits)
  const zoom = W / H > 2.2 ? 1.18 : 1;
  const scale = zoom * Math.min((W * 0.96) / (2 * GH), (H * 0.94) / (2 * GH * sP + HWS * cP));
  return { cT: Math.cos(theta), sT: Math.sin(theta), cP, sP, scale, ox: W / 2, oy: H / 2 + 0.5 * HWS * cP * scale + H * 0.03 };
}
const proj = (v: View, x: number, y: number, h: number): [number, number] => {
  const right = x * v.sT - y * v.cT;
  const up = -v.sP * (x * v.cT + y * v.sT) + h * HWS * v.cP;
  return [v.ox + right * v.scale, v.oy - up * v.scale];
};
const depth = (v: View, x: number, y: number, h: number) => -(v.cP * (x * v.cT + y * v.sT) + h * HWS * v.sP);

type Phase = 'morph' | 'drop' | 'aim' | 'hop' | 'sink' | 'win';
interface Hop { x0: number; y0: number; h0: number; x1: number; y1: number; h1: number; peak: number; dur: number; dx: number; dy: number }
interface Particle { x: number; y: number; vx: number; vy: number; t: number; life: number; c: string; r: number }

export function DescentBanner() {
  const { t } = useLang();
  const tRef = useRef<Dict>(t);
  tRef.current = t;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sparkRef = useRef<HTMLCanvasElement>(null);
  const lossRef = useRef<HTMLSpanElement>(null);
  const shotRef = useRef<HTMLElement>(null);
  const roundRef = useRef<HTMLElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const statusKey = useRef<{ fn: (d: Dict) => string; win: boolean }>({ fn: (d) => d.banner.teeOff, win: false });

  useEffect(() => {
    const cv = canvasRef.current!, sp = sparkRef.current!;
    const ctx = cv.getContext('2d')!, sctx = sp.getContext('2d')!;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let W = 0, H = 0, dpr = 1;
    const resize = () => {
      const r = cv.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = r.width; H = r.height;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(cv);
    resize();

    const setStatus = (fn: (d: Dict) => string, win = false) => {
      statusKey.current = { fn, win };
      const el = statusRef.current;
      if (el) { el.textContent = fn(tRef.current); el.classList.toggle('win', win); }
    };

    let course: Course, from: Course | null = null;
    let round = 0, phase: Phase = 'drop', pt = 0;
    let shots = 0, shotIdx = 0, hop: Hop | null = null;
    const ball = { x: 0, y: 0, h: 0, s: 1 };
    let trail: [number, number, number][] = [];
    let history: number[] = [];
    let particles: Particle[] = [];
    let rings: { x: number; y: number; h: number; t: number }[] = [];
    let theta = 0.6, clock = 0;

    const newRound = (first: boolean) => {
      round++;
      from = first ? null : course;
      course = buildCourse(`banner-${round}-${Math.random()}`);
      const [sx, sy] = course.ls.start;
      Object.assign(ball, { x: sx, y: sy, h: elevAt(course, sx, sy), s: 1 });
      trail = []; history = [course.ls.loss(sx, sy, 0)];
      shots = 5 + Math.floor(Math.random() * 3); shotIdx = 0;
      phase = first ? 'drop' : 'morph'; pt = 0;
      if (roundRef.current) roundRef.current.textContent = String(round);
      if (shotRef.current) shotRef.current.textContent = '0';
      setStatus(first ? (d) => d.banner.teeOff : (d) => d.banner.newLandscape);
    };

    const planShot = () => {
      shotIdx++;
      const { ls } = course;
      const g = ls.grad(ball.x, ball.y, 0);
      let sx = -0.35 * g[0], sy = -0.35 * g[1];
      const m = Math.hypot(sx, sy);
      if (m > 0.42) { sx *= 0.42 / m; sy *= 0.42 / m; }
      if (m < 0.06) { const k = 0.06 / (m || 1); sx *= k; sy *= k; }
      // SGD-style wobble, plus a pull toward the true minimum that grows every shot so each
      // loop still ends in the hole while reading as a descent
      const noise = 0.08 * (1 - shotIdx / shots);
      let tx = ball.x + sx + (Math.random() * 2 - 1) * noise;
      let ty = ball.y + sy + (Math.random() * 2 - 1) * noise;
      const w = shotIdx === shots ? 1 : Math.pow(shotIdx / shots, 1.6);
      tx += (ls.best[0] - tx) * w; ty += (ls.best[1] - ty) * w;
      tx = Math.max(-0.95, Math.min(0.95, tx)); ty = Math.max(-0.95, Math.min(0.95, ty));
      const dist = Math.hypot(tx - ball.x, ty - ball.y);
      hop = {
        x0: ball.x, y0: ball.y, h0: ball.h, x1: tx, y1: ty, h1: elevAt(course, tx, ty),
        peak: 0.12 + dist * 0.55, dur: 0.75 + dist * 0.6, dx: tx - ball.x, dy: ty - ball.y,
      };
    };

    const land = () => {
      trail.push([ball.x, ball.y, ball.h]);
      history.push(course.ls.loss(ball.x, ball.y, 0));
      rings.push({ x: ball.x, y: ball.y, h: ball.h, t: 0 });
    };

    const burst = () => {
      for (let i = 0; i < 70; i++) {
        const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 200;
        particles.push({
          x: 0, y: 0, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7 - 160, t: 0,
          life: 1 + Math.random() * 0.9, c: CONFETTI[i % CONFETTI.length], r: 1.5 + Math.random() * 2.5,
        });
      }
    };

    const step = (dt: number) => {
      pt += dt;
      if (phase === 'morph') {
        if (pt >= 1.6) { from = null; phase = 'drop'; pt = 0; setStatus((d) => d.banner.teeOff); }
      } else if (phase === 'drop') {
        const f = Math.min(1, pt / 0.7);
        const g = elevAt(course, ball.x, ball.y);
        ball.h = g + (1 - f * f) * 0.9;
        if (f >= 1) { ball.h = g; land(); phase = 'aim'; pt = 0; planShot(); setStatus((d) => d.banner.aiming); }
      } else if (phase === 'aim') {
        if (pt >= 0.6) {
          phase = 'hop'; pt = 0;
          if (shotRef.current) shotRef.current.textContent = String(shotIdx);
          setStatus(shotIdx === shots ? (d) => d.banner.finalApproach : (d) => d.banner.descending);
        }
      } else if (phase === 'hop' && hop) {
        const f = Math.min(1, pt / hop.dur), e = ease(f);
        ball.x = hop.x0 + (hop.x1 - hop.x0) * e;
        ball.y = hop.y0 + (hop.y1 - hop.y0) * e;
        ball.h = hop.h0 + (hop.h1 - hop.h0) * e + 4 * hop.peak * e * (1 - e);
        if (f >= 1) {
          ball.h = hop.h1; land();
          if (shotIdx >= shots) { phase = 'sink'; pt = 0; }
          else {
            phase = 'aim'; pt = 0; planShot();
            const gm = Math.hypot(...course.ls.grad(ball.x, ball.y, 0));
            setStatus(gm < 0.25 ? (d) => d.banner.localMin : (d) => d.banner.aiming);
          }
        }
      } else if (phase === 'sink') {
        ball.s = Math.max(0, 1 - pt / 0.45);
        if (pt >= 0.45) {
          phase = 'win'; pt = 0; burst();
          const n = shots;
          setStatus((d) => d.banner.globalMin(n), true);
        }
      } else if (phase === 'win') {
        if (pt >= 2.4) newRound(false);
      }
    };

    // ---------- drawing ----------
    const quad = (v: View, E: Float32Array, C: Float32Array, i: number, j: number) => {
      const k00 = j * V + i, k10 = k00 + 1, k01 = k00 + V, k11 = k01 + 1;
      const x0 = -1 + (2 * i) / G, x1 = x0 + 2 / G, y0 = -1 + (2 * j) / G, y1 = y0 + 2 / G;
      const dx = ((E[k10] + E[k11] - E[k00] - E[k01]) / 2) * 2.6;
      const dy = ((E[k01] + E[k11] - E[k00] - E[k10]) / 2) * 2.6;
      const br = Math.min(1.35, Math.max(0.4, (-dx * LIGHT[0] - dy * LIGHT[1] + LIGHT[2]) / (Math.hypot(dx, dy, 1) * LIGHT_MAG)));
      const ch = (o: number) => Math.min(255, (((C[k00 * 3 + o] + C[k10 * 3 + o] + C[k01 * 3 + o] + C[k11 * 3 + o]) / 4) * br) | 0);
      const a = proj(v, x0, y0, E[k00]), b = proj(v, x1, y0, E[k10]);
      const c = proj(v, x1, y1, E[k11]), d = proj(v, x0, y1, E[k01]);
      const fill = `rgb(${ch(0)},${ch(1)},${ch(2)})`;
      ctx.fillStyle = fill; ctx.strokeStyle = fill; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.closePath();
      ctx.fill(); ctx.stroke();
    };

    const ballR = (v: View) => v.scale * 0.045 * ball.s;

    const drawShadow = (v: View, gh: number) => {
      const [sx, sy] = proj(v, ball.x, ball.y, gh);
      const air = Math.max(0, ball.h - gh), R = ballR(v) * (1 + air);
      ctx.fillStyle = `rgba(0,0,0,${0.45 * Math.max(0.15, 1 - air * 1.5)})`;
      ctx.beginPath(); ctx.ellipse(sx, sy, R, R * 0.45, 0, 0, Math.PI * 2); ctx.fill();
    };

    const drawBall = (v: View) => {
      const R = ballR(v);
      if (R <= 0) return;
      const [bx, by] = proj(v, ball.x, ball.y, ball.h);
      const cy = by - R;
      const glow = ctx.createRadialGradient(bx, cy, 0, bx, cy, R * 3.2);
      glow.addColorStop(0, 'rgba(184,255,90,0.35)'); glow.addColorStop(1, 'rgba(184,255,90,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(bx, cy, R * 3.2, 0, Math.PI * 2); ctx.fill();
      const g = ctx.createRadialGradient(bx - R * 0.35, cy - R * 0.4, R * 0.1, bx, cy, R);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.7, '#dfe8f5'); g.addColorStop(1, '#8d9bb3');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bx, cy, R, 0, Math.PI * 2); ctx.fill();
    };

    const drawTrailDot = (v: View, p: [number, number, number], n: number) => {
      const [x, y] = proj(v, p[0], p[1], p[2]);
      ctx.fillStyle = n === 0 ? 'rgba(238,244,255,0.9)' : 'rgba(90,209,255,0.95)';
      ctx.beginPath(); ctx.arc(x, y, Math.max(2, v.scale * 0.011), 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(7,11,20,0.8)'; ctx.lineWidth = 1; ctx.stroke();
    };

    const drawFlag = (v: View, bh: number, alpha: number) => {
      const { best } = course.ls;
      const [hx, hy] = proj(v, best[0], best[1], bh);
      const pole = v.scale * 0.42, R = v.scale * 0.03;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(7,11,20,0.85)';
      ctx.beginPath(); ctx.ellipse(hx, hy, R * 1.3, R * 0.55, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#eef4ff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx, hy - pole); ctx.stroke();
      const fw = pole * 0.55, fh = pole * 0.3, top = hy - pole;
      const wave = (u: number) => Math.sin(clock * 5 - u * 4) * 3 * u;
      ctx.fillStyle = '#b8ff5a';
      ctx.beginPath(); ctx.moveTo(hx, top);
      for (let s = 1; s <= 8; s++) { const u = s / 8; ctx.lineTo(hx + fw * u, top + fh * 0.5 * u + wave(u)); }
      for (let s = 8; s >= 0; s--) { const u = s / 8; ctx.lineTo(hx + fw * u, top + fh - fh * 0.5 * u + wave(u)); }
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    };

    const drawArrow = (v: View, h: Hop) => {
      const [bx, by] = proj(v, ball.x, ball.y, ball.h);
      const m = Math.hypot(h.dx, h.dy) || 1;
      const right = (h.dx * v.sT - h.dy * v.cT) / m;
      const up = (-v.sP * (h.dx * v.cT + h.dy * v.sT)) / m;
      const sm = Math.hypot(right, up) || 1;
      const ux = right / sm, uy = -up / sm;
      const f = ease(Math.min(1, pt / 0.35));
      const len = v.scale * (0.18 + Math.min(0.25, m * 0.5)) * f;
      const sx = bx, sy = by - ballR(v);
      const ex = sx + ux * len, ey = sy + uy * len, hs = 9;
      ctx.strokeStyle = '#5ad1ff'; ctx.fillStyle = '#5ad1ff'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ex + ux * 3, ey + uy * 3);
      ctx.lineTo(ex - ux * hs - uy * hs * 0.6, ey - uy * hs + ux * hs * 0.6);
      ctx.lineTo(ex - ux * hs + uy * hs * 0.6, ey - uy * hs - ux * hs * 0.6);
      ctx.closePath(); ctx.fill();
      if (f > 0.6) {
        ctx.font = '700 13px ui-monospace, Menlo, Consolas, monospace';
        ctx.fillStyle = '#eef4ff'; ctx.textAlign = 'center';
        ctx.fillText('−∇L', ex + ux * 18, ey + uy * 18 + 4);
      }
    };

    const drawScene = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      // flatter camera on wide banners: less vertical extent means a bigger course on screen
      const phiBase = W / H > 2.2 ? 0.7 : 0.82;
      const v = makeView(W, H, theta, phiBase + 0.07 * Math.sin(clock * 0.21));
      const { ls } = course;

      let E = course.elev, C = course.col;
      if (from) {
        const f = ease(Math.min(1, pt / 1.6));
        E = new Float32Array(V * V); C = new Float32Array(V * V * 3);
        for (let k = 0; k < V * V; k++) {
          const wob = Math.sin(f * Math.PI) * 0.12 * Math.sin(k * 0.37 + clock * 3);
          E[k] = from.elev[k] + (course.elev[k] - from.elev[k]) * f + wob;
        }
        for (let k = 0; k < V * V * 3; k++) C[k] = from.col[k] + (course.col[k] - from.col[k]) * f;
      }

      // painter's algorithm over terrain quads and scene props together, so hills occlude the ball
      type Item = { d: number; draw: () => void };
      const items: Item[] = [];
      for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
        const k = j * V + i;
        const ce = (E[k] + E[k + 1] + E[k + V] + E[k + V + 1]) / 4;
        items.push({ d: depth(v, -1 + (2 * i + 1) / G, -1 + (2 * j + 1) / G, ce), draw: () => quad(v, E, C, i, j) });
      }
      const bh = elevAt(course, ls.best[0], ls.best[1]);
      const flagA = from ? clamp01((pt - 1.1) / 0.5) : 1;
      if (flagA > 0) items.push({ d: depth(v, ls.best[0], ls.best[1], bh) - 0.07, draw: () => drawFlag(v, bh, flagA) });
      if (phase !== 'morph') {
        const gh = elevAt(course, ball.x, ball.y);
        items.push({ d: depth(v, ball.x, ball.y, gh) - 0.05, draw: () => drawShadow(v, gh) });
        items.push({ d: depth(v, ball.x, ball.y, Math.max(ball.h, gh)) - 0.09, draw: () => drawBall(v) });
        trail.forEach((p, n) => items.push({ d: depth(v, p[0], p[1], p[2]) - 0.05, draw: () => drawTrailDot(v, p, n) }));
      }
      items.sort((a, b) => b.d - a.d);
      for (const it of items) it.draw();

      for (const r of rings) {
        const [px, py] = proj(v, r.x, r.y, r.h);
        const f = r.t / 0.6, rad = 4 + f * 26;
        ctx.strokeStyle = `rgba(238,244,255,${0.7 * (1 - f)})`; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(px, py, rad, rad * 0.45 * v.sP + 1, 0, 0, Math.PI * 2); ctx.stroke();
      }
      if (phase === 'aim' && hop) drawArrow(v, hop);
      if (particles.length) {
        const [hx, hy] = proj(v, ls.best[0], ls.best[1], bh);
        for (const p of particles) {
          ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
          ctx.fillStyle = p.c;
          ctx.beginPath(); ctx.arc(hx + p.x, hy + p.y, p.r, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    };

    const drawSpark = () => {
      const w = sp.width, h = sp.height;
      sctx.clearRect(0, 0, w, h);
      const pts = history.slice();
      if (phase === 'hop') pts.push(course.ls.loss(ball.x, ball.y, 0));
      const lo = course.lo, hi = Math.max(history[0], lo + 1e-6);
      const n = Math.max(shots + 1, pts.length);
      const X = (i: number) => 6 + (i / (n - 1)) * (w - 12);
      const Y = (val: number) => 6 + (1 - clamp01((val - lo) / (hi - lo))) * (h - 12);
      sctx.strokeStyle = 'rgba(142,160,189,0.35)'; sctx.lineWidth = 2; sctx.setLineDash([4, 4]);
      sctx.beginPath(); sctx.moveTo(6, h - 6); sctx.lineTo(w - 6, h - 6); sctx.stroke(); sctx.setLineDash([]);
      sctx.strokeStyle = '#b8ff5a'; sctx.lineWidth = 3; sctx.lineJoin = 'round';
      sctx.beginPath();
      pts.forEach((p, i) => (i ? sctx.lineTo(X(i), Y(p)) : sctx.moveTo(X(i), Y(p))));
      sctx.stroke();
      sctx.fillStyle = '#b8ff5a';
      sctx.beginPath(); sctx.arc(X(pts.length - 1), Y(pts[pts.length - 1]), 5, 0, Math.PI * 2); sctx.fill();
    };

    newRound(true);
    let raf = 0, last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      clock += dt;
      theta += dt * (reduce ? 0.03 : 0.16);
      step(dt);
      for (const p of particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 320 * dt; }
      particles = particles.filter((p) => p.t < p.life);
      for (const r of rings) r.t += dt;
      rings = rings.filter((r) => r.t < 0.6);
      if (W > 0 && H > 0) {
        drawScene();
        drawSpark();
        const cur = phase === 'morph' ? history[0] : phase === 'sink' || phase === 'win' ? course.lo : course.ls.loss(ball.x, ball.y, 0);
        if (lossRef.current) lossRef.current.textContent = cur.toFixed(3);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  // re-render the current status in the new language when the user switches it
  useEffect(() => {
    if (statusRef.current) statusRef.current.textContent = statusKey.current.fn(t);
  }, [t]);

  return (
    <div className="descent-banner">
      <canvas ref={canvasRef} className="db-scene" role="img" aria-label={t.banner.aria} />
      <div className="db-hud" aria-hidden="true">
        <span className="db-lbl">loss L(θ)</span>
        <span className="db-loss" ref={lossRef}>0.000</span>
        <canvas ref={sparkRef} width={280} height={76} />
      </div>
      <div className="db-shot" aria-hidden="true">
        {t.banner.shot} <b ref={shotRef}>0</b> · {t.banner.round} <b ref={roundRef}>1</b>
        <br />η = 0.35
      </div>
      <div className="db-status" ref={statusRef} aria-hidden="true" />
    </div>
  );
}
