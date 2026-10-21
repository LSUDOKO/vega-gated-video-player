import { MIRROR_INDEX } from './landmarks';
import type { Frame } from './types';

export const VISIBILITY_THRESHOLD = 0.5;

/** If the frame came from a mirrored image, swap left/right so "left" is always the learner's left. */
export function normalizeMirroring(f: Frame): Frame {
  if (!f.mirrored) return f;
  return {
    ...f,
    mirrored: false,
    pose: f.pose ? MIRROR_INDEX.map((i) => f.pose![i]!) : f.pose,
    hands: f.hands ? { left: f.hands.right, right: f.hands.left } : f.hands,
    handScores: f.handScores ? { left: f.handScores.right, right: f.handScores.left } : f.handScores,
  };
}
