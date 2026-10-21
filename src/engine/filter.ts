import type { Frame, Landmark } from './types';

/** One-Euro filter (Casiez et al.) for a single scalar. */
export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t: number | null = null;
  constructor(
    private minCutoff = 1.0,
    private beta = 0.02,
    private dCutoff = 1.0,
  ) {}

  private static alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value: number, tMs: number): number {
    if (this.x === null || this.t === null || tMs <= this.t) {
      if (this.x === null) this.x = value;
      this.t = tMs;
      return this.x;
    }
    const dt = (tMs - this.t) / 1000;
    this.t = tMs;
    const dxRaw = (value - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (dxRaw - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

/** Smooths every coordinate of a landmark set; resets when the set disappears. */
class LandmarkSmoother {
  private filters: OneEuro[][] | null = null;
  constructor(
    private minCutoff: number,
    private beta: number,
  ) {}
  apply(lms: Landmark[] | null | undefined, ts: number): Landmark[] | null {
    if (!lms) {
      this.filters = null;
      return null;
    }
    if (!this.filters || this.filters.length !== lms.length)
      this.filters = lms.map(() => [0, 1, 2].map(() => new OneEuro(this.minCutoff, this.beta)));
    return lms.map((p, i) => {
      const [fx, fy, fz] = this.filters![i]!;
      return { x: fx!.filter(p.x, ts), y: fy!.filter(p.y, ts), z: fz!.filter(p.z, ts), v: p.v };
    });
  }
}

/** Per-runner frame smoother (pose + both hands). */
export class FrameSmoother {
  private pose: LandmarkSmoother;
  private left: LandmarkSmoother;
  private right: LandmarkSmoother;
  constructor(minCutoff = 1.0, beta = 0.02) {
    this.pose = new LandmarkSmoother(minCutoff, beta);
    this.left = new LandmarkSmoother(minCutoff, beta);
    this.right = new LandmarkSmoother(minCutoff, beta);
  }
  apply(f: Frame): Frame {
    return {
      ...f,
      pose: this.pose.apply(f.pose, f.ts),
      hands: { left: this.left.apply(f.hands?.left, f.ts), right: this.right.apply(f.hands?.right, f.ts) },
    };
  }
}
