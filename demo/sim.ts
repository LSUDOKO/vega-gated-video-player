/**
 * The demo's simulated learner. "perform" reuses InStep's synthetic learner (learner.ts, copied from the InStep
 * monorepo); "watch" is someone just watching: leaning back with bent knees, hands down, no chair beside them.
 * Neither mode uses a camera. Both produce plain landmark numbers, exactly what a pose tracker would send.
 */
import { makePose } from '../src/engine/fixtures';
import type { Frame } from '../src/index';
import { behaviourFrame, type GateRef } from './learner';

export type LearnerMode = 'watch' | 'perform';

export function watchFrame(now: number): Frame {
  const sway = Math.sin(now / 900) * 0.004;
  return {
    ts: now,
    mirrored: false,
    pose: makePose({ dx: sway, torso: 10, l_knee: 140, r_knee: 140, visibility: 0.95 }),
    objects: [],
  };
}

/** `tMs`: how long the learner has been performing the current gate (null = not started). */
export function learnerFrame(
  mode: LearnerMode,
  gate: GateRef | null,
  tMs: number | null,
  now: number,
): Frame {
  return mode === 'perform' ? behaviourFrame(gate, tMs, now) : watchFrame(now);
}
