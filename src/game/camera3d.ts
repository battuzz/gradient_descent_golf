/**
 * Perspective third-person chase camera. The camera orbits a moving target (the ball) at a
 * player-controlled distance `dist` and elevation angle `phi`, always looking at the target —
 * "solid to the ball, but offset", the way a chase camera follows a character in a 3D game.
 *
 * World (x, y) live in [-1, 1] * WORLD_SCALE; `elev` is a normalised elevation in [0, 1] * HEIGHT_
 * WORLD_SCALE (0 = valley floor, the global minimum; 1 = the tallest peak). Scaling only at this
 * render layer — never in the loss-landscape math itself — keeps the world feeling bigger and more
 * open in third person without touching the tuned gameplay/difficulty numbers.
 *
 * `theta` (azimuth, spin around the vertical axis) and `phi` (pitch, how far the camera looks
 * down) are in radians. The camera position is:
 *
 *   camPos = target + dist * (cosP cosT, cosP sinT, sinP)
 *
 * i.e. "behind" the target along azimuth theta, raised by pitch phi. `forward` (camera -> target)
 * is the unit vector -(cosP cosT, cosP sinT, sinP); `right`/`up` complete an orthonormal basis via
 * the standard cross products against world-up (0, 0, 1) — which is why `right` always stays flat
 * (no z component): it's what lets a screen-space drag map onto a ground-plane aim direction that
 * doesn't warp as the camera's pitch changes.
 */

export const WORLD_SCALE = 1.6;
export const HEIGHT_WORLD_SCALE = 0.85;

/** World-space near plane: points closer than this to the camera (or behind it) aren't drawn. */
const NEAR = 0.05;

export interface Camera3D {
  camX: number; camY: number; camZ: number;
  rightX: number; rightY: number;
  upX: number; upY: number; upZ: number;
  fwdX: number; fwdY: number; fwdZ: number;
  /** pitch-independent ground-plane basis — used to turn a screen drag into a world aim
   *  direction that always means "toward/away from camera" and "camera-left/right" on the
   *  ground, regardless of how far the camera is currently tilted down. */
  groundFwdX: number; groundFwdY: number;
  groundRightX: number; groundRightY: number;
  focal: number;
  cx: number; cy: number;
}

/** The pitch-independent ground-plane basis alone — cheap enough to recompute from just the
 * camera's azimuth, without building a full Camera3D, which is what aiming needs while the
 * player is still dragging (there's no fresh per-frame camera to hand it yet at that point). */
export function groundBasis(theta: number): { groundFwdX: number; groundFwdY: number; groundRightX: number; groundRightY: number } {
  const cosT = Math.cos(theta), sinT = Math.sin(theta);
  return { groundFwdX: -cosT, groundFwdY: -sinT, groundRightX: -sinT, groundRightY: cosT };
}

export function makeCamera3D(
  width: number,
  height: number,
  fovYDeg: number,
  theta: number,
  phi: number,
  dist: number,
  targetX: number,
  targetY: number,
  targetZ: number,
): Camera3D {
  const cosT = Math.cos(theta), sinT = Math.sin(theta);
  const cosP = Math.cos(phi), sinP = Math.sin(phi);
  const camX = targetX + dist * cosP * cosT;
  const camY = targetY + dist * cosP * sinT;
  const camZ = targetZ + dist * sinP;
  const focal = (height / 2) / Math.tan((fovYDeg * Math.PI) / 360);
  return {
    camX, camY, camZ,
    rightX: -sinT, rightY: cosT,
    upX: -cosT * sinP, upY: -sinT * sinP, upZ: cosP,
    fwdX: -cosP * cosT, fwdY: -cosP * sinT, fwdZ: -sinP,
    groundFwdX: -cosT, groundFwdY: -sinT,
    groundRightX: -sinT, groundRightY: cosT,
    focal,
    cx: width / 2, cy: height / 2,
  };
}

/** Projects a world point to screen space + view-space depth (larger = farther, used for the
 * painter's-algorithm sort). Returns null when the point is behind (or too close to) the camera. */
export function project3D(cam: Camera3D, x: number, y: number, z: number): [number, number, number] | null {
  const dx = x - cam.camX, dy = y - cam.camY, dz = z - cam.camZ;
  const depth = dx * cam.fwdX + dy * cam.fwdY + dz * cam.fwdZ;
  if (depth < NEAR) return null;
  const right = dx * cam.rightX + dy * cam.rightY;
  const up = dx * cam.upX + dy * cam.upY + dz * cam.upZ;
  const s = cam.focal / depth;
  return [cam.cx + right * s, cam.cy - up * s, depth];
}

/** Camera-space depth only (no projection) — cheap enough to call for every mesh quad before
 * deciding whether it's worth projecting at all. */
export function depth3D(cam: Camera3D, x: number, y: number, z: number): number {
  return (x - cam.camX) * cam.fwdX + (y - cam.camY) * cam.fwdY + (z - cam.camZ) * cam.fwdZ;
}

/** Projects a direction (not a position), anchored at a world point — used for the gradient-hint
 * arrow, which is drawn as a short screen-space ray from the ball. */
export function projectDir3D(
  cam: Camera3D,
  atX: number, atY: number, atZ: number,
  dx: number, dy: number,
): [number, number] {
  const depth = (atX - cam.camX) * cam.fwdX + (atY - cam.camY) * cam.fwdY + (atZ - cam.camZ) * cam.fwdZ;
  const s = cam.focal / Math.max(depth, NEAR);
  const right = dx * cam.rightX + dy * cam.rightY;
  const up = dx * cam.upX + dy * cam.upY;
  return [right * s, -up * s];
}
