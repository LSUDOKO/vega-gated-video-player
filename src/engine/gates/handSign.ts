import { FINGERS, type Gate, type SequenceStep } from '../../istep/index';
import { fingerCurls, thumbIndexSpread } from '../geometry';
import { fingerHint } from '../hints';
import { referenceHandAt } from '../reference';
import type { FingerError, GateEval, RunnerContext } from '../types';
import { NO_HAND, pickHand, type Evaluator } from './common';

type HandSignLike = Pick<Extract<Gate, { type: 'hand_sign' }>, 'hand' | 'target' | 'minFrames' | 'tolerance'>;

export const SPREAD_OPEN = 0.6;

export function handSignEvaluator(
  gate: HandSignLike | Extract<SequenceStep, { type: 'hand_sign' }>,
  ctx: RunnerContext,
): Evaluator {
  const tol = ctx.tolerance?.curl ?? gate.tolerance?.curl ?? 0.3;
  const minFrames = gate.minFrames ?? 10;
  let target: number[] | null = gate.target.curl ?? null;
  const resolveTarget = () => {
    if (!target && gate.target.atSec !== undefined) {
      const ref = referenceHandAt(ctx.reference, gate.target.atSec);
      if (ref) target = fingerCurls(ref);
    }
    return target;
  };
  let streak = 0;
  let passed = false;
  return {
    eval(f): GateEval {
      if (passed) return { status: 'passed', progress: 1, score: 1 };
      const picked = pickHand(f, gate.hand ?? 'any', ctx);
      const t = resolveTarget();
      if (!picked || !t)
        return { status: 'no_person', progress: streak / minFrames, score: 0, message: NO_HAND };
      const curls = fingerCurls(picked.hand);
      const errors: FingerError[] = [];
      let penalty = 0;
      FINGERS.forEach((finger, i) => {
        const delta = curls[i]! - t[i]!;
        penalty += Math.min(Math.abs(delta) / (2 * tol), 1);
        if (Math.abs(delta) > tol)
          errors.push({ finger, delta: round(delta), hint: delta > 0 ? 'extend' : 'curl' });
      });
      const spread = gate.target.spread?.thumb_index;
      if (spread && !errors.some((e) => e.finger === 'thumb')) {
        const s = thumbIndexSpread(picked.hand);
        const ok = spread === 'open' ? s > SPREAD_OPEN : s <= SPREAD_OPEN;
        if (!ok)
          errors.push({
            finger: 'thumb',
            delta: round(SPREAD_OPEN - s),
            hint: spread === 'open' ? 'extend' : 'curl',
          });
      }
      errors.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
      const matched = errors.length === 0;
      streak = matched ? streak + 1 : 0;
      if (streak >= minFrames) passed = true;
      const worst = errors[0];
      return {
        status: passed ? 'passed' : matched ? 'progress' : 'waiting',
        progress: Math.min(streak / minFrames, 1),
        score: 1 - penalty / FINGERS.length,
        fingerErrors: errors,
        ...(worst ? { worst: { name: worst.finger, hint: fingerHint(worst.finger, worst.hint) } } : {}),
      };
    },
    reset() {
      streak = 0;
      passed = false;
    },
    state: () => ({ streak, passed }),
  };
}

const round = (x: number) => Math.round(x * 100) / 100;
