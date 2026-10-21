import type { Gate, HandSelector } from '../../istep/index';
import type { Frame, GateEval, Landmark, RunnerContext } from '../types';

export interface Evaluator {
  eval(f: Frame): GateEval;
  reset(): void;
  state(): unknown;
}

export type EvaluatorFactory = (gate: Gate, ctx: RunnerContext) => Evaluator;

export function pickHand(
  f: Frame,
  sel: HandSelector,
  ctx: RunnerContext,
): { hand: Landmark[]; side: 'left' | 'right' } | null {
  const left = f.hands?.left ?? null;
  const right = f.hands?.right ?? null;
  const want = sel === 'affected' ? ctx.affectedHand : sel === 'any' ? undefined : sel;
  if (want === 'left') return left ? { hand: left, side: 'left' } : null;
  if (want === 'right') return right ? { hand: right, side: 'right' } : null;
  if (left && right) {
    const ls = f.handScores?.left ?? 0;
    const rs = f.handScores?.right ?? 0;
    return ls > rs ? { hand: left, side: 'left' } : { hand: right, side: 'right' };
  }
  if (right) return { hand: right, side: 'right' };
  if (left) return { hand: left, side: 'left' };
  return null;
}

export const NO_PERSON_POSE = 'Step into view so I can see you';
export const NO_HAND = 'Show your hand to the camera';
