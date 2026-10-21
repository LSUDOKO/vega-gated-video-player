import { hipMid, stdDev, torsoLength } from './geometry';
import type { Landmark } from './types';

/** Rolling lateral sway: std-dev of hip-midpoint x ÷ torso length over a time window. */
export class SwayTracker {
  private buf: { ts: number; x: number }[] = [];
  constructor(private windowMs: number) {}
  push(ts: number, pose: Landmark[]): { sway: number; filled: boolean } {
    this.buf.push({ ts, x: hipMid(pose).x / torsoLength(pose) });
    while (this.buf.length && ts - this.buf[0]!.ts > this.windowMs) this.buf.shift();
    const span = ts - this.buf[0]!.ts;
    return { sway: stdDev(this.buf.map((b) => b.x)), filled: span >= this.windowMs * 0.8 };
  }
  reset() {
    this.buf = [];
  }
}
