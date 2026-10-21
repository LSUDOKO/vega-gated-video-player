import type { ReferenceTimeline } from '../istep/index';
import type { Landmark } from './types';

type RefFrame = ReferenceTimeline['frames'][number];

function bracket(ref: ReferenceTimeline, t: number): [RefFrame, RefFrame, number] | null {
  const fs = ref.frames;
  if (fs.length === 0) return null;
  if (t <= fs[0]!.t) return [fs[0]!, fs[0]!, 0];
  const last = fs[fs.length - 1]!;
  if (t >= last.t) return [last, last, 0];
  let lo = 0;
  let hi = fs.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (fs[m]!.t <= t) lo = m;
    else hi = m;
  }
  const a = fs[lo]!;
  const b = fs[hi]!;
  return [a, b, b.t === a.t ? 0 : (t - a.t) / (b.t - a.t)];
}

function lerp(
  a: number[][] | null | undefined,
  b: number[][] | null | undefined,
  k: number,
): Landmark[] | null {
  if (!a) return null;
  const src = b && b.length === a.length ? b : a;
  return a.map((p, i) => {
    const q = src[i]!;
    return {
      x: p[0]! + (q[0]! - p[0]!) * k,
      y: p[1]! + (q[1]! - p[1]!) * k,
      z: p[2]! + (q[2]! - p[2]!) * k,
      v: p[3] ?? 1,
    };
  });
}

/** Instructor pose at video time t (linear interpolation). */
export function referencePoseAt(ref: ReferenceTimeline | undefined, t: number): Landmark[] | null {
  const b = ref && bracket(ref, t);
  return b ? lerp(b[0].pose, b[1].pose, b[2]) : null;
}

/** Instructor hand at video time t; prefers the right hand, falls back to the left. */
export function referenceHandAt(ref: ReferenceTimeline | undefined, t: number): Landmark[] | null {
  const b = ref && bracket(ref, t);
  if (!b) return null;
  return lerp(b[0].hands?.right, b[1].hands?.right, b[2]) ?? lerp(b[0].hands?.left, b[1].hands?.left, b[2]);
}
