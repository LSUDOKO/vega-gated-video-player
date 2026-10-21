import type { Gate } from '../../istep/index';
import type { Frame, GateEval, RunnerContext } from '../types';
import { NO_PERSON_POSE, type Evaluator } from './common';
import { createPoseCheck, poseEval } from './pose';

type PoseMatchLike = Extract<Gate, { type: 'pose_match' } | { type: 'hold_duration' }>;
type PoseStepLike = Pick<PoseMatchLike, 'target' | 'joints' | 'conditions' | 'minFrames' | 'tolerance'>;

const angleTol = (g: PoseStepLike, ctx: RunnerContext) =>
  ctx.tolerance?.angleDeg ?? g.tolerance?.angleDeg ?? 20;

/** pose_match: pass after `minFrames` consecutive matched frames. */
export function poseMatchEvaluator(gate: PoseStepLike, ctx: RunnerContext): Evaluator {
  const check = createPoseCheck(
    { target: gate.target, joints: gate.joints, conditions: gate.conditions, angleDeg: angleTol(gate, ctx) },
    ctx,
  );
  const minFrames = gate.minFrames ?? 8;
  let streak = 0;
  let passed = false;
  return {
    eval(f: Frame): GateEval {
      if (passed) return { status: 'passed', progress: 1, score: 1 };
      const c = check(f.pose);
      if (!c.visible)
        return { status: 'no_person', progress: streak / minFrames, score: 0, message: NO_PERSON_POSE };
      streak = c.matched ? streak + 1 : 0;
      if (streak >= minFrames) passed = true;
      return {
        status: passed ? 'passed' : c.matched ? 'progress' : 'waiting',
        progress: Math.min(streak / minFrames, 1),
        ...poseEval(c),
      };
    },
    reset() {
      streak = 0;
      passed = false;
    },
    state: () => ({ streak, passed }),
  };
}

/** hold_duration: accumulate matched time; gaps ≤ graceSec pause the timer, longer gaps reset it. */
export function holdEvaluator(gate: Extract<Gate, { type: 'hold_duration' }>, ctx: RunnerContext): Evaluator {
  const check = createPoseCheck(
    { target: gate.target, joints: gate.joints, conditions: gate.conditions, angleDeg: angleTol(gate, ctx) },
    ctx,
  );
  const holdMs = gate.holdSec * 1000;
  const graceMs = (gate.graceSec ?? 0.4) * 1000;
  let heldMs = 0;
  let prevTs: number | null = null;
  let prevMatched = false;
  let unmatchedSince: number | null = null;
  let passed = false;
  const out = (status: GateEval['status'], extra: Partial<GateEval> = {}): GateEval => ({
    status,
    progress: Math.min(heldMs / holdMs, 1),
    score: 0,
    holdSec: Math.round(heldMs / 100) / 10,
    ...extra,
  });
  return {
    eval(f) {
      if (passed) return out('passed', { score: 1 });
      const c = check(f.pose);
      if (!c.visible) {
        prevTs = null; // freeze: the gap is neither counted nor treated as a wobble
        prevMatched = false;
        return out('no_person', { message: NO_PERSON_POSE });
      }
      if (c.matched) {
        if (prevMatched && prevTs !== null) heldMs += f.ts - prevTs;
        unmatchedSince = null;
        if (heldMs >= holdMs) passed = true;
      } else {
        unmatchedSince ??= f.ts;
        if (f.ts - unmatchedSince > graceMs) heldMs = 0;
      }
      prevTs = f.ts;
      prevMatched = c.matched;
      const status = passed ? 'passed' : c.matched ? 'progress' : heldMs > 0 ? 'progress' : 'waiting';
      return out(status, poseEval(c));
    },
    reset() {
      heldMs = 0;
      prevTs = null;
      prevMatched = false;
      unmatchedSince = null;
      passed = false;
    },
    state: () => ({ heldMs, passed }),
  };
}
