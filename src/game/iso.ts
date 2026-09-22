/**
 * General rotatable orthographic projection used by the 3D landscape view. World (x, y) live
 * in [-1, 1]; `h` is a normalised elevation in [0, 1] (0 = valley floor, 1 = tallest peak).
 *
 * The camera has two angles — azimuth `theta` (spin around the vertical axis) and pitch `phi`
 * (how far you're looking down from the side) — plus a `zoom` multiplier. The ground-plane part
 * of the projection (h = 0) is theta's rotation matrix (orthonormal, so its inverse is its own
 * transpose) composed with a phi-dependent foreshortening; that's what lets a screen-space drag
 * be turned back into a world-space aim direction in 3D mode (see isoUnprojectDelta).
 */
export interface IsoView {
  cosT: number; sinT: number; cosP: number; sinP: number;
  scale: number;
  ox: number; oy: number;
}

const MARGIN = 0.88;
/** Elevation range in the same world units as x/y, before camera scale. */
export const HEIGHT_WORLD_SCALE = 0.85;
/** Worst case, over every azimuth, of the ground plane's projected half-extent. */
const GROUND_HALF = Math.SQRT2;

/**
 * `theta`/`phi` are in radians, `zoom` is a user-controlled multiplier on top of the
 * auto-fit scale. The auto-fit scale is computed from the worst case over *all* angles (not
 * the current ones) so the terrain doesn't grow or shrink as the camera orbits — only `zoom`
 * changes the size on screen.
 */
export function makeIsoView(S: number, theta: number, phi: number, zoom: number): IsoView {
  const vHalfTotal = GROUND_HALF + HEIGHT_WORLD_SCALE;
  const baseScale = (S * MARGIN) / (2 * Math.max(GROUND_HALF, vHalfTotal));
  return {
    cosT: Math.cos(theta), sinT: Math.sin(theta),
    cosP: Math.cos(phi), sinP: Math.sin(phi),
    scale: baseScale * zoom,
    ox: S / 2, oy: S / 2,
  };
}

export function isoProject(v: IsoView, x: number, y: number, h: number): [number, number] {
  const hw = h * HEIGHT_WORLD_SCALE;
  const xc1 = x * v.cosT - y * v.sinT;
  const yc1 = x * v.sinT + y * v.cosT;
  const yc = yc1 * v.cosP - hw * v.sinP;
  return [v.ox + xc1 * v.scale, v.oy - yc * v.scale];
}

/** Camera-space depth (larger = farther) — used to paint the terrain back-to-front. */
export function isoDepth(v: IsoView, x: number, y: number, h: number): number {
  const hw = h * HEIGHT_WORLD_SCALE;
  const yc1 = x * v.sinT + y * v.cosT;
  return yc1 * v.sinP + hw * v.cosP;
}

/** Projects a direction vector (not a position) — used for the gradient-hint arrow. */
export function isoProjectDir(v: IsoView, dx: number, dy: number): [number, number] {
  const xc1 = dx * v.cosT - dy * v.sinT;
  const yc1 = dx * v.sinT + dy * v.cosT;
  return [xc1 * v.scale, -yc1 * v.cosP * v.scale];
}

/** Inverts the ground-plane (h = 0) projection to turn a screen drag into a world (x, y) delta. */
export function isoUnprojectDelta(v: IsoView, dpx: number, dpy: number): [number, number] {
  const a = dpx / v.scale;
  const b = -dpy / (v.scale * v.cosP);
  return [v.cosT * a + v.sinT * b, -v.sinT * a + v.cosT * b];
}
