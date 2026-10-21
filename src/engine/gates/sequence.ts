import type { Gate } from '../../istep/index';
import type { GateEval, RunnerContext } from '../types';
import type { Evaluator } from './common';
import { handSignEvaluator } from './handSign';
import { poseMatchEvaluator } from './poseGates';

type SequenceGate = Extract<Gate, { type: 'sequence_order' }>;

/** sequence_order: only the current step is evaluated, so out-of-order shapes never advance. */
export function sequenceEvaluator(gate: SequenceGate, ctx: RunnerContext): Evaluator {
  const steps = gate.steps.map((s) => {
    const stepCtx: RunnerContext = { ...ctx, tolerance: { ...s.tolerance, ...ctx.tolerance } };
    return s.type === 'hand_sign' ? handSignEvaluator(s, stepCtx) : poseMatchEvaluator(s, stepCtx);
  });
  const windowMs = (gate.stepWindowSec ?? 6) * 1000;
  let step = 0;
  let stepStart: number | null = null;
  return {
    eval(f): GateEval {
      const n = steps.length;
      if (step >= n) return { status: 'passed', progress: 1, score: 1, step: n };
      stepStart ??= f.ts;
      const e = steps[step]!.eval(f);
      const label = gate.steps[step]!.label;
      if (e.status === 'passed') {
        step++;
        stepStart = f.ts;
        if (step >= n) return { status: 'passed', progress: 1, score: 1, step: n };
        return {
          status: 'progress',
          progress: step / n,
          score: e.score,
          step,
          message: `Now: ${gate.steps[step]!.label}`,
        };
      }
      const slow = f.ts - stepStart > windowMs;
      return {
        ...e,
        status:
          e.status === 'no_person'
            ? 'no_person'
            : step > 0 || e.status === 'progress'
              ? 'progress'
              : 'waiting',
        progress: (step + e.progress) / n,
        step,
        message: e.message ?? (slow ? `Take your time — ${label}` : label),
      };
    },
    reset() {
      steps.forEach((s) => s.reset());
      step = 0;
      stepStart = null;
    },
    state: () => ({ step }),
  };
}
