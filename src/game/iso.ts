/**
 * General rotatable orthographic projection used by the 3D landscape view. World (x, y) live
 * in [-1, 1]; `h` is a normalised elevation in [0, 1] (0 = valley floor, 1 = tallest peak — so
 * the global minimum, which is always elevation 0, sits at the bottom of a valley).
 *
 * The camera has two angles — azimuth `theta` (spin around the vertical axis) and pitch `phi`
 * (how far you're looking down from the side) — plus a `zoom` multiplier. Screen position comes
 * from projecting the world point onto the camera's "right" and "up" basis vectors:
 *
 *   right = (sinT, -cosT, 0)
 *   up    = (-cosT sinP, -sinT sinP, cosP)
 *
 * (`up` is what makes height read as height: at phi = 0, up = (0, 0, 1), so elevation maps
 * straight onto the screen's vertical axis, the way a side-on view should look.)
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
  const right = x * v.sinT - y * v.cosT;
  const up = -v.sinP * (x * v.cosT + y * v.sinT) + hw * v.cosP;
  return [v.ox + right * v.scale, v.oy - up * v.scale];
}

/** Camera-space distance from the camera (larger = farther) — paints the terrain back-to-front. */
export function isoDepth(v: IsoView, x: number, y: number, h: number): number {
  const hw = h * HEIGHT_WORLD_SCALE;
  return -(v.cosP * (x * v.cosT + y * v.sinT) + hw * v.sinP);
}

/** Projects a direction vector (not a position) — used for the gradient-hint arrow. */
export function isoProjectDir(v: IsoView, dx: number, dy: number): [number, number] {
  const right = dx * v.sinT - dy * v.cosT;
  const up = -v.sinP * (dx * v.cosT + dy * v.sinT);
  return [right * v.scale, -up * v.scale];
}
