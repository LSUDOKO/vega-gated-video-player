import type { SwayStop } from '../istep/index';
import { SwayTracker } from './sway';
import type { Frame } from './types';

export const SWAY_TRIGGER_MS = 300;
export const RESUME_STABLE_MS = 2000;

export type SafetyMonitorResult = {
  stop: boolean;
  reason?: 'sway';
  sway: number;
  /** ms the learner has been continuously below the sway limit (for the 2 s resume check) */
  stableMs: number;
};

/**
 * Lesson-wide sway stop (docs/04 §5). Runs on every frame regardless of the current gate.
 * Thresholds come only from the .istep file.
 */
export function createSafetyMonitor(cfg: SwayStop) {
  const tracker = new SwayTracker(cfg.windowSec * 1000);
  let aboveSince: number | null = null;
  let belowSince: number | null = null;
  let last = { sway: 0, stableMs: 0 };
  return {
    push(f: Frame): SafetyMonitorResult {
      if (!cfg.enabled || !f.pose) return { stop: false, ...last };
      const { sway } = tracker.push(f.ts, f.pose);
      if (sway > cfg.maxLateralSway) {
        aboveSince ??= f.ts;
        belowSince = null;
      } else {
        aboveSince = null;
        belowSince ??= f.ts;
      }
      last = { sway, stableMs: belowSince === null ? 0 : f.ts - belowSince };
      const stop = aboveSince !== null && f.ts - aboveSince >= SWAY_TRIGGER_MS;
      return stop ? { stop, reason: 'sway', ...last } : { stop, ...last };
    },
    /** true once the learner has been stable for 2 s (required, with OK, to resume after a sway stop). */
    isStableForResume(): boolean {
      return last.stableMs >= RESUME_STABLE_MS;
    },
    reset() {
      tracker.reset();
      aboveSince = belowSince = null;
      last = { sway: 0, stableMs: 0 };
    },
  };
}
export type SafetyMonitor = ReturnType<typeof createSafetyMonitor>;
