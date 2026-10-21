import type { Gate } from '../istep/index';
import { FrameSmoother } from './filter';
import type { Evaluator } from './gates/common';
import { handSignEvaluator } from './gates/handSign';
import { holdEvaluator, poseMatchEvaluator } from './gates/poseGates';
import { repEvaluator } from './gates/rep';
import { rhythmEvaluator } from './gates/rhythm';
import { safetyEvaluator } from './gates/safety';
import { sequenceEvaluator } from './gates/sequence';
import { normalizeMirroring } from './preprocess';
import type { Frame, GateRunner, RunnerContext } from './types';

function makeEvaluator(gate: Gate, ctx: RunnerContext): Evaluator {
  switch (gate.type) {
    case 'pose_match':
      return poseMatchEvaluator(gate, ctx);
    case 'hold_duration':
      return holdEvaluator(gate, ctx);
    case 'rep_count':
      return repEvaluator(gate, ctx);
    case 'rhythm_bpm':
      return rhythmEvaluator(gate);
    case 'hand_sign':
      return handSignEvaluator(gate, ctx);
    case 'sequence_order':
      return sequenceEvaluator(gate, ctx);
    case 'safety_prerequisite':
      // Safety gates never use adaptive tolerance.
      return safetyEvaluator(gate);
  }
}

/**
 * Creates a stateful runner for one gate. Each pushed frame is mirror-normalised and One-Euro smoothed,
 * then evaluated. All timing uses frame timestamps (sender clock), so runs are deterministic.
 */
export function createGateRunner(gate: Gate, ctx: RunnerContext = {}): GateRunner {
  // Rhythm needs ~2 Hz motion through the filter, so it uses a higher cutoff (less lag).
  const makeSmoother = () =>
    gate.type === 'rhythm_bpm' ? new FrameSmoother(4.0, 0.05) : new FrameSmoother();
  let smoother = makeSmoother();
  const smooth = ctx.smoothing !== false;
  const evaluator = makeEvaluator(
    gate,
    gate.type === 'safety_prerequisite' ? { ...ctx, tolerance: undefined } : ctx,
  );
  return {
    gate,
    push(frame: Frame) {
      const f = normalizeMirroring(frame);
      return evaluator.eval(smooth ? smoother.apply(f) : f);
    },
    reset() {
      smoother = makeSmoother();
      evaluator.reset();
    },
    get state() {
      return evaluator.state();
    },
  };
}
