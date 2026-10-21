import type { Tolerance } from '../istep/index';
import type { GateEval } from './types';

export type AttemptHistory = {
  /** attempts on this gate in this session that reached coachAfterSec */
  failedAttempts: number;
  /** passes of this gate type in the learner's last 3 sessions */
  recentPasses: number;
};

export const TOLERANCE_MIN_FACTOR = 0.85;
export const TOLERANCE_MAX_FACTOR = 1.3;

/** Deterministic adaptive factor (docs/04 §6). */
export function toleranceFactor(history: AttemptHistory): number {
  const f = 1 + 0.1 * Math.min(history.failedAttempts, 3) - 0.05 * Math.min(history.recentPasses, 3);
  return Math.min(TOLERANCE_MAX_FACTOR, Math.max(TOLERANCE_MIN_FACTOR, f));
}

/** Adapted tolerance for learning gates only; never touches safety values or bpm ranges. */
export function nextTolerance(base: Tolerance, history: AttemptHistory, learning: boolean): Tolerance {
  if (!learning) return base;
  const k = toleranceFactor(history);
  return {
    ...(base.angleDeg !== undefined ? { angleDeg: round(base.angleDeg * k) } : {}),
    ...(base.curl !== undefined ? { curl: round(base.curl * k) } : {}),
  };
}

const round = (x: number) => Math.round(x * 1000) / 1000;

/** Stable key for the coach cache, e.g. "l_knee:-20..-10", "middle:curl", "tempo:push a little faster". */
export function errorBucket(e: GateEval): string {
  if (e.fingerErrors?.length) {
    const w = e.fingerErrors[0]!;
    return `${w.finger}:${w.hint}`;
  }
  if (e.worst && e.jointErrors && e.worst.name in e.jointErrors) {
    const err = e.jointErrors[e.worst.name as keyof typeof e.jointErrors]!;
    const lo = Math.floor(err / 10) * 10;
    return `${e.worst.name}:${lo}..${lo + 10}`;
  }
  if (e.worst) return `${e.worst.name}:${e.worst.hint}`;
  return e.message ? `msg:${e.message}` : e.status;
}
