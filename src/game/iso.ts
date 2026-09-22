/**
 * Isometric ground projection used by the 3D landscape view. World (x, y) live in [-1, 1];
 * `h` is a normalised elevation in [0, 1] (0 = valley floor, 1 = tallest peak).
 *
 * The ground matrix M = [[1,-1],[0.5,0.5]] (screen = M · world) has det = 1, so it inverts
 * cleanly — that's what lets a screen-space drag be turned back into a world-space aim
 * direction in 3D mode (see isoUnprojectDelta).
 */
export interface IsoView {
  scale: number;
  ox: number;
  oy: number;
  heightScale: number;
}

const MARGIN = 0.9;
const HEIGHT_FRAC = 0.62; // headroom reserved above the ground plane for the tallest peaks

export function makeIsoView(S: number): IsoView {
  const gxHalf = 2; // (x - y) spans [-2, 2]
  const gyHalf = 1; // (x + y) * 0.5 spans [-1, 1]
  const heightScale = gyHalf * HEIGHT_FRAC;
  const vHalfTotal = gyHalf + heightScale;
  const scale = (S * MARGIN) / (2 * Math.max(gxHalf, vHalfTotal));
  return {
    scale,
    ox: S / 2,
    oy: S / 2 + (heightScale * scale) / 2,
    heightScale: heightScale * scale,
  };
}

export function isoProject(v: IsoView, x: number, y: number, h: number): [number, number] {
  const gx = (x - y) * v.scale;
  const gy = (x + y) * 0.5 * v.scale;
  return [v.ox + gx, v.oy + gy - h * v.heightScale];
}

/** Projects a direction vector (not a position) — used for the gradient-hint arrow. */
export function isoProjectDir(v: IsoView, dx: number, dy: number): [number, number] {
  return [(dx - dy) * v.scale, (dx + dy) * 0.5 * v.scale];
}

/** Inverts the ground matrix to turn a screen-space drag delta into a world-space (x, y) delta. */
export function isoUnprojectDelta(v: IsoView, dpx: number, dpy: number): [number, number] {
  const gx = dpx / v.scale;
  const gy = dpy / v.scale;
  return [0.5 * gx + gy, -0.5 * gx + gy];
}
