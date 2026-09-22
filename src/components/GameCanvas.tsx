import { useEffect, useRef, useState } from 'react';
import type { Difficulty, Landscape, Vec3 } from '../game/landscape';
import { lossColor, paintHeat, paintTerrain3D, RES, type PaletteId } from '../game/render';
import { isoProject, isoProjectDir, isoUnprojectDelta, makeIsoView, type IsoView } from '../game/iso';
import type { Dict } from '../lib/i18n';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const MAX_STEP = 0.8; // world units of a full-power (lr = 1) shot
const FLIGHT_MS = 750;
const DEAD_ZONE = 14; // px: drags shorter than this cancel the shot

export interface Flight { from: Vec3; to: Vec3; t0: number }

interface Props {
  ls: Landscape;
  diff: Difficulty;
  theme: PaletteId;
  t: Dict;
  z: number;
  path: Vec3[];
  losses: number[];
  reveals: Vec3[];
  flight: Flight | null;
  /** unit vector (world x/y) of the (noisy) steepest-descent direction at the ball */
  hintDir: [number, number];
  autoAim: boolean;
  disabled: boolean;
  revealAll: boolean;
  view3d: boolean;
  onShoot: (step: [number, number]) => void;
  onLand: () => void;
}

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

export function GameCanvas(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const heatRef = useRef<HTMLCanvasElement | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const aimRef = useRef<{ sx: number; sy: number; cx: number; cy: number } | null>(null);
  const landedRef = useRef<Flight | null>(null);
  const sizeRef = useRef({ css: 300, dpr: 1 });
  const [size, setSize] = useState(300);

  // ----- terrain layer: a flat heat-map, or a shaded 3D relief mesh (recomputed only when the
  // revealed area / slice / view mode changes, then just blitted every frame)
  useEffect(() => {
    let off = heatRef.current;
    if (!off) {
      off = document.createElement('canvas');
      heatRef.current = off;
    }
    const ball = props.path[props.path.length - 1];
    if (props.view3d) {
      off.width = size;
      off.height = size;
      const octx = off.getContext('2d')!;
      octx.clearRect(0, 0, size, size);
      paintTerrain3D(
        octx, makeIsoView(size), props.ls, props.z, props.reveals, [ball[0], ball[1]],
        props.diff.vision, props.revealAll, props.theme,
      );
    } else {
      off.width = RES;
      off.height = RES;
      const octx = off.getContext('2d')!;
      const img = octx.createImageData(RES, RES);
      // the finished round always reveals cleanly (no stippling) so the recap map reads well
      const pixelSample = props.revealAll ? 1 : props.diff.pixelSample;
      paintHeat(
        img, props.ls, props.z, props.reveals, [ball[0], ball[1]],
        props.diff.vision, props.revealAll, pixelSample, props.theme,
      );
      octx.putImageData(img, 0, 0);
    }
  }, [
    props.ls, props.z, props.reveals, props.path, props.diff.vision, props.diff.pixelSample,
    props.revealAll, props.theme, props.view3d, size,
  ]);

  // ----- sizing
  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const resize = () => {
      const css = Math.floor(wrap.clientWidth);
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      sizeRef.current = { css, dpr };
      canvas.width = css * dpr;
      canvas.height = css * dpr;
      setSize(css);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // ----- pointer input
  useEffect(() => {
    const canvas = canvasRef.current!;
    const rel = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    const down = (e: PointerEvent) => {
      const p = propsRef.current;
      if (p.disabled || p.flight) return;
      canvas.setPointerCapture(e.pointerId);
      const [x, y] = rel(e);
      aimRef.current = { sx: x, sy: y, cx: x, cy: y };
    };
    const move = (e: PointerEvent) => {
      if (!aimRef.current) return;
      const [x, y] = rel(e);
      aimRef.current.cx = x;
      aimRef.current.cy = y;
    };
    const up = () => {
      const a = aimRef.current;
      aimRef.current = null;
      if (!a) return;
      const step = computeStep(a, propsRef.current, sizeRef.current.css);
      if (step) propsRef.current.onShoot(step.world);
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', () => (aimRef.current = null));
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
    };
  }, []);

  // ----- render loop
  useEffect(() => {
    let raf = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d')!;
      const p = propsRef.current;
      const { css: S, dpr } = sizeRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const px = (x: number) => ((x + 1) / 2) * S;
      const py = (y: number) => ((y + 1) / 2) * S;
      const iso: IsoView | null = p.view3d ? makeIsoView(S) : null;
      const span = p.ls.hi - p.ls.lo;
      const elevOf = (loss: number) => clamp01((loss - p.ls.lo) / span);
      // world position + normalised elevation -> screen pixel, in whichever mode is active
      const proj = (x: number, y: number, elev: number): [number, number] =>
        iso ? isoProject(iso, x, y, elev) : [px(x), py(y)];

      // heat / terrain — always clear first: the 3D mesh is a diamond that doesn't cover the
      // full square, so leftover pixels from a previous (possibly 2D) frame would show through
      ctx.clearRect(0, 0, S, S);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      if (heatRef.current) ctx.drawImage(heatRef.current, 0, 0, S, S);
      else { ctx.fillStyle = '#0d1420'; ctx.fillRect(0, 0, S, S); }

      // flat reference grid — only meaningful in the top-down 2D view
      if (!iso) {
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 1; i < 8; i++) {
          ctx.moveTo((S * i) / 8, 0); ctx.lineTo((S * i) / 8, S);
          ctx.moveTo(0, (S * i) / 8); ctx.lineTo(S, (S * i) / 8);
        }
        ctx.stroke();
      }

      // ball position (animated)
      let ball: Vec3 = p.path[p.path.length - 1];
      let flying = false;
      if (p.flight) {
        const t = Math.min(1, (now - p.flight.t0) / FLIGHT_MS);
        const e = ease(t);
        const f = p.flight;
        ball = [f.from[0] + (f.to[0] - f.from[0]) * e, f.from[1] + (f.to[1] - f.from[1]) * e, f.from[2] + (f.to[2] - f.from[2]) * e];
        flying = t < 1;
        if (t >= 1 && landedRef.current !== f) {
          landedRef.current = f;
          p.onLand();
        }
      }
      const ballElev = elevOf(p.ls.loss(ball[0], ball[1], ball[2]));
      const [bx, by] = proj(ball[0], ball[1], ballElev);
      // true when the slice being painted (from the w-slider) isn't the ball's own slice
      const previewing = p.ls.fourD && !p.revealAll && Math.abs(p.z - ball[2]) > 0.02;

      // trail
      ctx.lineJoin = 'round';
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      p.path.forEach((v, i) => {
        const [x, y] = proj(v[0], v[1], elevOf(p.losses[i]));
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      if (flying && p.flight) ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      p.path.forEach((v, i) => {
        const [x, y] = proj(v[0], v[1], elevOf(p.losses[i]));
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.fillStyle = lossColor(p.ls, p.losses[i], p.theme);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        ctx.fillStyle = '#0b1220';
        ctx.fillText(i === 0 ? 'S' : String(i), x, y + 0.5);
      });

      // goal flag once the round is over
      if (p.revealAll) {
        const [gx, gy] = proj(p.ls.best[0], p.ls.best[1], 0); // the goal is the global minimum: elevation 0
        const sameSlice = !p.ls.fourD || Math.abs(p.z - p.ls.best[2]) < 0.25;
        ctx.globalAlpha = sameSlice ? 1 : 0.55;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx, gy - 26); ctx.stroke();
        ctx.fillStyle = '#ff4d6d';
        ctx.beginPath(); ctx.moveTo(gx, gy - 26); ctx.lineTo(gx + 16, gy - 20); ctx.lineTo(gx, gy - 14); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(gx, gy, 3.5, 0, Math.PI * 2); ctx.fill();
        if (!sameSlice) {
          ctx.font = '600 11px system-ui, sans-serif';
          ctx.fillText(p.t.goalAtLabel(p.ls.best[2].toFixed(2)), gx, gy + 14);
        }
        ctx.globalAlpha = 1;
      }

      if (!p.revealAll) {
        // vision ring — a world-space circle around the ball, sampled and projected
        ctx.setLineDash([3, 6]);
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (iso) {
          const rWorld = p.diff.vision / 2;
          const STEPS = 40;
          for (let k = 0; k <= STEPS; k++) {
            const ang = (k / STEPS) * Math.PI * 2;
            const [qx, qy] = proj(ball[0] + Math.cos(ang) * rWorld, ball[1] + Math.sin(ang) * rWorld, ballElev);
            k ? ctx.lineTo(qx, qy) : ctx.moveTo(qx, qy);
          }
        } else {
          ctx.arc(bx, by, (p.diff.vision / 2) * S, 0, Math.PI * 2);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // gradient hint + aiming
      if (!p.disabled && !p.flight) {
        const pulse = 0.75 + 0.25 * Math.sin(now / 260);
        let hx = p.hintDir[0];
        let hy = p.hintDir[1];
        if (iso) {
          const [dxp, dyp] = isoProjectDir(iso, hx, hy);
          const m = Math.hypot(dxp, dyp) || 1;
          hx = dxp / m;
          hy = dyp / m;
        }
        const L = 44;
        ctx.strokeStyle = `rgba(255,214,102,${pulse})`;
        ctx.fillStyle = `rgba(255,214,102,${pulse})`;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(bx + hx * 14, by + hy * 14);
        ctx.lineTo(bx + hx * L, by + hy * L);
        ctx.stroke();
        const ex = bx + hx * (L + 8);
        const ey = by + hy * (L + 8);
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - hx * 12 - hy * 7, ey - hy * 12 + hx * 7);
        ctx.lineTo(ex - hx * 12 + hy * 7, ey - hy * 12 - hx * 7);
        ctx.fill();

        const a = aimRef.current;
        if (a) {
          const st = computeStep(a, p, S);
          if (st) {
            const wtx = ball[0] + st.world[0];
            const wty = ball[1] + st.world[1];
            const tgtElev = elevOf(p.ls.loss(wtx, wty, ball[2]));
            const [tx, ty] = proj(wtx, wty, tgtElev);
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 3;
            ctx.setLineDash([2, 8]);
            ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
            ctx.setLineDash([]);
            ctx.beginPath(); ctx.arc(tx, ty, 8 + p.diff.landNoise * S, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2; ctx.stroke();
            const label = `lr ${st.lr.toFixed(2)}`;
            ctx.font = '700 13px system-ui, sans-serif';
            const lw = ctx.measureText(label).width + 14;
            const lx = Math.min(S - lw / 2 - 4, Math.max(lw / 2 + 4, tx));
            const ly = ty < 40 ? ty + 28 : ty - 24;
            ctx.fillStyle = 'rgba(7,11,20,0.85)';
            ctx.beginPath(); ctx.roundRect(lx - lw / 2, ly - 12, lw, 24, 8); ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.fillText(label, lx, ly + 1);
          }
        }
      }

      // ball — dimmed to a ghost while previewing a different w-slice than it actually sits on
      ctx.globalAlpha = previewing ? 0.35 : 1;
      const grd = ctx.createRadialGradient(bx, by, 2, bx, by, 22);
      grd.addColorStop(0, 'rgba(255,255,255,0.55)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(bx, by, 22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#0b1220';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(bx, by, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 1;

      // preview badge: makes it unmistakable that the terrain shown is a different w-slice
      if (previewing) {
        const label = p.t.previewingLabel(p.z.toFixed(2));
        ctx.font = '700 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const lw = ctx.measureText(label).width + 20;
        const lx = S / 2;
        const ly = 20;
        ctx.fillStyle = 'rgba(90,209,255,0.16)';
        ctx.strokeStyle = 'rgba(90,209,255,0.9)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.roundRect(lx - lw / 2, ly - 13, lw, 26, 13); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#5ad1ff';
        ctx.fillText(label, lx, ly + 1);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} className="game-canvas" />
    </div>
  );
}

function computeStep(
  a: { sx: number; sy: number; cx: number; cy: number },
  p: Props,
  size: number,
): { world: [number, number]; lr: number } | null {
  const vx = a.cx - a.sx;
  const vy = a.cy - a.sy;
  const len = Math.hypot(vx, vy);
  if (len < DEAD_ZONE) return null;
  const lr = Math.min(1, len / (0.4 * size));
  let dir: [number, number];
  if (p.autoAim) {
    dir = p.hintDir;
  } else if (p.view3d) {
    const [wx, wy] = isoUnprojectDelta(makeIsoView(size), vx, vy);
    const m = Math.hypot(wx, wy) || 1;
    dir = [wx / m, wy / m];
  } else {
    dir = [vx / len, vy / len];
  }
  return { world: [dir[0] * lr * MAX_STEP, dir[1] * lr * MAX_STEP], lr };
}
