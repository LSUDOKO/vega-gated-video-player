export const PACE_RATES = [1, 0.75, 0.5] as const;
export const PACE_MIN_CHANGE_MS = 3000;

/** Playback rate for a learner rep duration vs the teacher's (docs/04 §4.3). */
export function paceRate(learnerRepSec: number, teacherRepSec: number): number {
  if (learnerRepSec <= teacherRepSec * 1.25) return 1;
  if (learnerRepSec <= teacherRepSec * 1.75) return 0.75;
  return 0.5;
}

/** Applies the at-most-once-per-3-s hysteresis around paceRate. */
export class PaceFollower {
  rate = 1;
  private lastChange = -Infinity;
  constructor(private teacherRepSec: number) {}
  update(learnerRepSec: number | undefined, nowMs: number): number {
    if (learnerRepSec === undefined) return this.rate;
    const next = paceRate(learnerRepSec, this.teacherRepSec);
    if (next !== this.rate && nowMs - this.lastChange >= PACE_MIN_CHANGE_MS) {
      this.rate = next;
      this.lastChange = nowMs;
    }
    return this.rate;
  }
}
