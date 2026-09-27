import { useEffect, useRef } from 'react';
import type { Difficulty, Landscape, Vec3 } from '../game/landscape';
import { buildTerrainMesh, drawTerrainMesh, FOG, lossColor, type PaletteId, type TerrainMesh } from '../game/render';
import {
  groundBasis, makeCamera3D, project3D, projectDir3D, WORLD_SCALE, HEIGHT_WORLD_SCALE, type Camera3D,
} from '../game/camera3d';
import type { Dict } from '../lib/i18n';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export const MAX_STEP = 0.8; // world units (normalised [-1,1] space) of a full-power (lr = 1) shot
const FLIGHT_MS = 750;
const DEAD_ZONE = 14; // px: drags shorter than this cancel the shot

// ----- third-person chase camera: azimuth (theta) + pitch (phi) + distance, orbited by the user.
// The camera is "solid to the ball" — it always looks at the ball, following it every frame — but
// its azimuth/pitch/distance are whatever the player last set, exactly like the chase camera in a
// typical 3D mobile game.
const FOV_Y = 58;
const CAM_PHI0 = (24 * Math.PI) / 180;
const CAM_DIST0 = 1.55;
const PHI_MIN = (10 * Math.PI) / 180;
const PHI_MAX = (75 * Math.PI) / 180;
const DIST_MIN = 0.7;
const DIST_MAX = 3.2;
const CAM_LERP = 0.18; // per-frame smoothing toward the target angle/zoom/ball position
const ROT_STEP = Math.PI / 8; // 22.5° per button click
const ZOOM_STEP = 1.25; // per button click
const clampPhi = (p: number) => clamp(p, PHI_MIN, PHI_MAX);
const clampDist = (d: number) => clamp(d, DIST_MIN, DIST_MAX);

interface CamState {
  theta: number; phi: number; dist: number;
  tTheta: number; tPhi: number; tDist: number;
  // smoothed look-at target (world units) — trails the ball a little so flight/landing feels fluid
  tx: number; ty: number; tz: number;
}
/** The camera's forward direction (camera -> ball) is -(cosTheta, sinTheta) on the ground plane;
 * past the ball, that same ray keeps going, so aiming it at the world's centre (0, 0) means
 * pointing it opposite the ball's own position — theta = atan2(y, x) does exactly that. */
const facingCenterTheta = (x: number, y: number) => Math.atan2(y, x);

const initialCam = (bx: number, by: number, bz: number): CamState => {
  const theta0 = facingCenterTheta(bx, by);
  return {
    theta: theta0, phi: CAM_PHI0, dist: CAM_DIST0,
    tTheta: theta0, tPhi: CAM_PHI0, tDist: CAM_DIST0,
    tx: bx, ty: by, tz: bz,
  };
};

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
  disabled: boolean;
  revealAll: boolean;
  onShoot: (step: [number, number]) => void;
  onLand: () => void;
}

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

// a handful of fixed "stars" for the backdrop — cheap atmosphere, deterministic so they don't
// swim between frames
const STARS: [number, number, number][] = Array.from({ length: 60 }, (_, i) => {
  const r = (seed: number) => {
    let h = Math.imul(seed ^ i, 2654435761) >>> 0;
    h = (h ^ (h >>> 15)) >>> 0;
    return h / 4294967296;
  };
  return [r(1), r(2) * 0.62, 0.4 + r(3) * 0.6];
});

export function GameCanvas(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const meshRef = useRef<TerrainMesh | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const aimRef = useRef<{ sx: number; sy: number; cx: number; cy: number } | null>(null);
  const landedRef = useRef<Flight | null>(null);
  const sizeRef = useRef({ w: 300, h: 300, dpr: 1 });
  const ball0 = props.path[props.path.length - 1];
  const camRef = useRef<CamState>(initialCam(ball0[0] * WORLD_SCALE, ball0[1] * WORLD_SCALE, 0));
  // where the ball was last drawn on screen — updated every frame, read by the pointer handler to
  // tell "started on the ball" (charge a shot) apart from "started elsewhere" (rotate the camera)
  const ballScreenRef = useRef<{ x: number; y: number } | null>(null);

  // ----- terrain mesh: sampling the loss/palette is only redone when the revealed area / slice
  // changes; the mesh is then reprojected every frame at whatever camera angle/zoom is current.
  useEffect(() => {
    const ball = props.path[props.path.length - 1];
    const pixelSample = props.revealAll ? 1 : props.diff.pixelSample;
    meshRef.current = buildTerrainMesh(
      props.ls, props.z, props.reveals, [ball[0], ball[1]], props.diff.vision, props.revealAll,
      pixelSample, props.theme,
    );
  }, [
    props.ls, props.z, props.reveals, props.path, props.diff.vision, props.diff.pixelSample,
    props.revealAll, props.theme,
  ]);

  // ----- sizing (the canvas fills its wrapper, which is now the whole play viewport — not a
  // fixed square — so width and height are tracked separately for the perspective projection)
  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const resize = () => {
      const w = Math.floor(wrap.clientWidth);
      const h = Math.floor(wrap.clientHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      sizeRef.current = { w, h, dpr };
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // ----- pointer input, tuned for one-thumb mobile play. What a single finger does depends on
  // where it lands, so the same gesture (drag) never means two different things at once:
  //  - starts on the ball: charge a shot, exactly like a slingshot — drag backward and let go;
  //    the ball launches the opposite way, and how far you pulled sets the power.
  //  - starts anywhere else: orbit the camera around the ball (left/right = spin, up/down = tilt).
  //  - 2 fingers, anywhere: zoom only (pinch) — never rotates, so it can't be confused with orbit.
  //  - mouse wheel: zoom, for desktop testing.
  const BALL_HIT_RADIUS = 40; // px — generous touch target around the ball's on-screen position
  useEffect(() => {
    const canvas = canvasRef.current!;
    const pointers = new Map<number, { x: number; y: number }>();
    let orbitDrag: { sx: number; sy: number; theta: number; phi: number } | null = null;
    let pinch: { dist: number; zoom: number } | null = null;

    const rel = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    const pinchDist = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y) || 1;
    };
    const down = (e: PointerEvent) => {
      const [x, y] = rel(e);
      pointers.set(e.pointerId, { x, y });
      canvas.setPointerCapture(e.pointerId);
      const p = propsRef.current;
      if (pointers.size === 2) {
        aimRef.current = null; // a second finger cancels any in-progress aim/orbit — zoom only
        orbitDrag = null;
        pinch = { dist: pinchDist(), zoom: camRef.current.tDist };
      } else if (pointers.size === 1) {
        const b = ballScreenRef.current;
        const onBall = !p.disabled && !p.flight && !!b && Math.hypot(x - b.x, y - b.y) <= BALL_HIT_RADIUS;
        if (onBall) {
          aimRef.current = { sx: x, sy: y, cx: x, cy: y };
        } else {
          const cam = camRef.current;
          orbitDrag = { sx: x, sy: y, theta: cam.tTheta, phi: cam.tPhi };
        }
      }
    };
    const move = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      const [x, y] = rel(e);
      pointers.set(e.pointerId, { x, y });
      if (pointers.size === 2 && pinch) {
        camRef.current.tDist = clampDist(pinch.zoom * (pinch.dist / pinchDist()));
      } else if (orbitDrag) {
        const cam = camRef.current;
        cam.tTheta = orbitDrag.theta - (x - orbitDrag.sx) * 0.012;
        cam.tPhi = clampPhi(orbitDrag.phi + (y - orbitDrag.sy) * 0.008);
      } else if (aimRef.current) {
        aimRef.current.cx = x;
        aimRef.current.cy = y;
      }
    };
    const release = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size >= 2) {
        pinch = { dist: pinchDist(), zoom: camRef.current.tDist }; // still 2+ down: keep zooming
      } else if (pointers.size === 1) {
        pinch = null;
      } else {
        orbitDrag = null;
        pinch = null;
        const a = aimRef.current;
        aimRef.current = null;
        if (a) {
          const step = computeStep(a, groundBasis(camRef.current.theta), sizeRef.current);
          if (step) propsRef.current.onShoot(step.world);
        }
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      camRef.current.tDist = clampDist(camRef.current.tDist * Math.exp(e.deltaY * 0.0015));
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', release);
      canvas.removeEventListener('pointercancel', release);
      canvas.removeEventListener('wheel', wheel);
    };
  }, []);

  const rotateCam = (d: number) => { camRef.current.tTheta += d; };
  const zoomCam = (f: number) => { camRef.current.tDist = clampDist(camRef.current.tDist * f); };
  const resetCam = () => {
    const cam = camRef.current;
    const ball = propsRef.current.path[propsRef.current.path.length - 1];
    cam.tTheta = facingCenterTheta(ball[0], ball[1]); cam.tPhi = CAM_PHI0; cam.tDist = CAM_DIST0;
  };

  // ----- render loop
  useEffect(() => {
    let raf = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d')!;
      const p = propsRef.current;
      const { w: W, h: H, dpr } = sizeRef.current;
      if (W < 2 || H < 2) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const span = p.ls.hi - p.ls.lo;
      const elevOf = (loss: number) => clamp01((loss - p.ls.lo) / span);

      // ball position (animated along its flight arc)
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
      const ballWX = ball[0] * WORLD_SCALE, ballWY = ball[1] * WORLD_SCALE, ballWZ = ballElev * HEIGHT_WORLD_SCALE;

      // camera: smoothly ease toward whatever the last drag/pinch/button/wheel set as target, and
      // toward the ball's current (animated) position — this is what makes it "solid to the ball"
      const cam = camRef.current;
      cam.theta += (cam.tTheta - cam.theta) * CAM_LERP;
      cam.phi += (cam.tPhi - cam.phi) * CAM_LERP;
      cam.dist += (cam.tDist - cam.dist) * CAM_LERP;
      cam.tx += (ballWX - cam.tx) * CAM_LERP;
      cam.ty += (ballWY - cam.ty) * CAM_LERP;
      cam.tz += (ballWZ - cam.tz) * CAM_LERP;
      const view: Camera3D = makeCamera3D(W, H, FOV_Y, cam.theta, cam.phi, cam.dist, cam.tx, cam.ty, cam.tz);

      // sky backdrop
      const skyGrd = ctx.createLinearGradient(0, 0, 0, H);
      skyGrd.addColorStop(0, '#1a2540');
      skyGrd.addColorStop(0.55, `rgb(${FOG[0]},${FOG[1]},${FOG[2]})`);
      skyGrd.addColorStop(1, '#04060b');
      ctx.fillStyle = skyGrd;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ffffff';
      for (const [sx, sy, b] of STARS) {
        ctx.globalAlpha = b * 0.5;
        ctx.fillRect(sx * W, sy * H, 1.4, 1.4);
      }
      ctx.globalAlpha = 1;

      if (meshRef.current) drawTerrainMesh(ctx, meshRef.current, view);
      drawBoundary(ctx, view);

      const proj = (x: number, y: number, elev: number) => project3D(view, x * WORLD_SCALE, y * WORLD_SCALE, elev * HEIGHT_WORLD_SCALE);
      const [bx, by] = proj(ball[0], ball[1], ballElev) ?? [W / 2, H / 2];
      ballScreenRef.current = { x: bx, y: by };
      // true when the slice being painted (from the w-slider) isn't the ball's own slice — while
      // aiming, or while exploring other slices of the fully revealed map after the round
      const previewing = p.ls.fourD && Math.abs(p.z - ball[2]) > 0.02;

      // trail — drawn as independent segments so a point that falls behind the camera just drops
      // that segment instead of distorting the whole line
      ctx.lineJoin = 'round';
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 2;
      const pathPts = p.path.map((v, i) => proj(v[0], v[1], elevOf(p.losses[i])));
      if (flying && p.flight) pathPts.push(proj(ball[0], ball[1], ballElev));
      ctx.beginPath();
      let started = false;
      for (const pt of pathPts) {
        if (!pt) { started = false; continue; }
        if (started) ctx.lineTo(pt[0], pt[1]); else { ctx.moveTo(pt[0], pt[1]); started = true; }
      }
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      p.path.forEach((v, i) => {
        const pt = proj(v[0], v[1], elevOf(p.losses[i]));
        if (!pt) return;
        const [x, y, depth] = pt;
        const r = clamp(9 * (1.4 / Math.max(depth, 0.3)), 4, 20);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = lossColor(p.ls, p.losses[i], p.theme);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        if (r > 6) {
          ctx.fillStyle = '#0b1220';
          ctx.font = `600 ${Math.round(r * 1.2)}px system-ui, sans-serif`;
          ctx.fillText(i === 0 ? 'S' : String(i), x, y + 0.5);
        }
      });

      // goal flag once the round is over
      if (p.revealAll) {
        const goal = proj(p.ls.best[0], p.ls.best[1], 0); // the goal is the global minimum: elevation 0
        if (goal) {
          const [gx, gy] = goal;
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
      }

      if (!p.revealAll) {
        // vision ring — a world-space circle around the ball, sampled and projected
        ctx.setLineDash([3, 6]);
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const rWorld = p.diff.vision / 2;
        const STEPS = 48;
        let ringStarted = false;
        for (let k = 0; k <= STEPS; k++) {
          const ang = (k / STEPS) * Math.PI * 2;
          const q = proj(ball[0] + Math.cos(ang) * rWorld, ball[1] + Math.sin(ang) * rWorld, ballElev);
          if (!q) { ringStarted = false; continue; }
          if (ringStarted) ctx.lineTo(q[0], q[1]); else { ctx.moveTo(q[0], q[1]); ringStarted = true; }
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // gradient hint + aiming
      if (!p.disabled && !p.flight) {
        const pulse = 0.75 + 0.25 * Math.sin(now / 260);
        const [hx0, hy0] = projectDir3D(view, ballWX, ballWY, ballWZ, p.hintDir[0], p.hintDir[1]);
        const hm = Math.hypot(hx0, hy0) || 1;
        const hx = hx0 / hm, hy = hy0 / hm;
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
          // the pull itself: a slingshot band from the ball to the finger, so charging the shot
          // and seeing where it'll land (drawn opposite, below) both stay visible at once
          ctx.strokeStyle = 'rgba(255,255,255,0.4)';
          ctx.lineWidth = 3;
          ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(a.cx, a.cy); ctx.stroke();
          ctx.beginPath(); ctx.arc(a.cx, a.cy, 9, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2; ctx.stroke();

          const st = computeStep(a, view, sizeRef.current);
          if (st) {
            const wtx = ball[0] + st.world[0];
            const wty = ball[1] + st.world[1];
            const tgtElev = elevOf(p.ls.loss(wtx, wty, ball[2]));
            const tgt = proj(wtx, wty, tgtElev);
            if (tgt) {
              const [tx, ty] = tgt;
              ctx.strokeStyle = '#fff';
              ctx.lineWidth = 3;
              ctx.setLineDash([2, 8]);
              ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
              ctx.setLineDash([]);
              ctx.beginPath(); ctx.arc(tx, ty, 8 + p.diff.landNoise * Math.min(W, H), 0, Math.PI * 2);
              ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2; ctx.stroke();
              const label = `lr ${st.lr.toFixed(2)}`;
              ctx.font = '700 13px system-ui, sans-serif';
              const lw = ctx.measureText(label).width + 14;
              const lx = Math.min(W - lw / 2 - 4, Math.max(lw / 2 + 4, tx));
              const ly = ty < 40 ? ty + 28 : ty - 24;
              ctx.fillStyle = 'rgba(7,11,20,0.85)';
              ctx.beginPath(); ctx.roundRect(lx - lw / 2, ly - 12, lw, 24, 8); ctx.fill();
              ctx.fillStyle = '#fff';
              ctx.fillText(label, lx, ly + 1);
            }
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
        const label = p.revealAll ? p.t.sliceLabel(p.z.toFixed(2)) : p.t.previewingLabel(p.z.toFixed(2));
        ctx.font = '700 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const lw = ctx.measureText(label).width + 20;
        const lx = W / 2;
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
      <div className="cam-controls" role="group" aria-label={props.t.camControlsAria}>
        <button onClick={() => rotateCam(ROT_STEP)} aria-label={props.t.rotateLeftAria}>◂</button>
        <button onClick={() => rotateCam(-ROT_STEP)} aria-label={props.t.rotateRightAria}>▸</button>
        <button onClick={() => zoomCam(ZOOM_STEP)} aria-label={props.t.zoomOutAria}>−</button>
        <button onClick={() => zoomCam(1 / ZOOM_STEP)} aria-label={props.t.zoomInAria}>+</button>
        <button onClick={resetCam} aria-label={props.t.resetViewAria}>⟲</button>
      </div>
    </div>
  );
}

/** A low, glowing rim at the edge of the (bounded) world — the only way to tell you're near the
 * boundary in a chase camera that can't see the whole map at once. Doesn't reveal any loss-map
 * information, so it's always drawn regardless of fog-of-war. */
function drawBoundary(ctx: CanvasRenderingContext2D, view: Camera3D) {
  const S = WORLD_SCALE;
  const H = 0.16; // wall height, in the same (already-scaled) world units as elevation
  const edges: [number, number, number, number][] = [
    [-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1],
  ];
  ctx.strokeStyle = 'rgba(90,209,255,0.5)';
  ctx.fillStyle = 'rgba(90,209,255,0.14)';
  ctx.lineWidth = 1.5;
  for (const [x0, y0, x1, y1] of edges) {
    const a = project3D(view, x0 * S, y0 * S, 0);
    const b = project3D(view, x1 * S, y1 * S, 0);
    const c = project3D(view, x1 * S, y1 * S, H);
    const d = project3D(view, x0 * S, y0 * S, H);
    if (!a || !b || !c || !d) continue;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

// the drag vector is in screen pixels; project it onto the camera's ground-plane basis so
// "drag away from you" always means "shoot further from the camera", regardless of orbit angle
function computeStep(
  a: { sx: number; sy: number; cx: number; cy: number },
  view: { groundFwdX: number; groundFwdY: number; groundRightX: number; groundRightY: number },
  size: { w: number; h: number },
): { world: [number, number]; lr: number } | null {
  const vx = a.cx - a.sx;
  const vy = a.cy - a.sy;
  const len = Math.hypot(vx, vy);
  if (len < DEAD_ZONE) return null;
  const diag = Math.hypot(size.w, size.h);
  const lr = Math.min(1, len / (0.35 * diag));
  // screen-right -> camera's ground-right; screen-up (negative vy) -> camera's ground-forward
  const wx = vx * view.groundRightX + -vy * view.groundFwdX;
  const wy = vx * view.groundRightY + -vy * view.groundFwdY;
  const m = Math.hypot(wx, wy) || 1;
  // slingshot: the ball launches opposite the pull, not toward it
  const dir: [number, number] = [-wx / m, -wy / m];
  return { world: [dir[0] * lr * MAX_STEP, dir[1] * lr * MAX_STEP], lr };
}
