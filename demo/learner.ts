/**
 * What the synthetic learner does for a gate, as an engine Frame. Shared by `pnpm demo-learner` (live, over the
 * relay) and `pnpm dryrun-lessons` (offline, straight into the gate engine).
 */
import type { Frame } from '../src/engine/index';
import { chair, makeHand, makePose, type PoseSpec } from '../src/engine/fixtures';

/** Pose per gate id (built-in lessons). Anything unknown: stand still. */
const POSES: Record<string, PoseSpec> = {
  // kids-forest-walk-v1
  tree: { l_shoulder: 165, r_shoulder: 165, l_elbow: 165, r_elbow: 165 },
  mouse: { l_knee: 90, r_knee: 90 },
  flamingo: { torso: 0, footLift: { left: 0.15 } },
  wave: { r_shoulder: 130 },
  // fall-prevention
  stand: { torso: 0, l_knee: 175, r_knee: 175 },
  'final-hold': { torso: 0, l_knee: 175, r_knee: 175, heelLift: 0.07 },
  'right-up': { torso: 0, footLift: { right: 0.12 } },
  'left-up': { torso: 0, footLift: { left: 0.12 } },
};
/** Finger curls per hand-sign gate id / sequence letter: [thumb, index, middle, ring, pinky]. */
const SIGNS: Record<string, [number, number, number, number, number]> = {
  a: [0.2, 1, 1, 1, 1],
  b: [0.8, 0, 0, 0, 0],
  c: [0.3, 0.5, 0.5, 0.5, 0.5],
  l: [0, 0, 1, 1, 1],
  y: [0, 1, 1, 1, 0],
  ily: [0, 0, 1, 1, 0],
};
const SEQUENCES: Record<string, string[]> = { cab: ['c', 'a', 'b'] };

export type GateRef = { id: string; type: string };

/**
 * Frame at time `now` (ms) for `gate`; `tMs` is how long the learner has been performing it (negative or null
 * while still "thinking", i.e. standing still).
 */
export function behaviourFrame(gate: GateRef | null, tMs: number | null, now: number): Frame {
  const sway = Math.sin(now / 900) * 0.004; // a little natural movement
  let poseSpec: PoseSpec = { dx: sway, visibility: 0.95 };
  let hands: Frame['hands'];
  if (gate && tMs !== null && tMs >= 0) {
    const t = tMs;
    const id = gate.id;
    if (POSES[id]) poseSpec = { ...poseSpec, ...POSES[id] };
    switch (gate.type) {
      case 'rep_count':
        if (id.includes('open')) {
          // hand open/close, one rep every 1.5 s (both hands, so "affected" resolves either way)
          const c = 0.5 + 0.5 * Math.sin((2 * Math.PI * t) / 1500);
          hands = { left: makeHand({ curl: [c, c, c, c, c] }), right: makeHand({ curl: [c, c, c, c, c] }) };
        } else {
          // heel raises, one rep every 2.4 s
          poseSpec = { ...poseSpec, torso: 0, heelLift: 0.04 + 0.04 * Math.sin((2 * Math.PI * t) / 2400) };
        }
        break;
      case 'rhythm_bpm':
        // CPR compressions at 110/min with straight arms: wrists move up and down
        poseSpec = {
          ...poseSpec,
          l_elbow: 175,
          r_elbow: 175,
          wristsDy: 0.025 * Math.sin((2 * Math.PI * 110 * t) / 60000),
        };
        break;
      case 'hand_sign':
        if (SIGNS[id]) hands = { right: makeHand({ curl: SIGNS[id] }) };
        break;
      case 'sequence_order': {
        const seq = SEQUENCES[id];
        if (seq) {
          const letter = seq[Math.floor(t / 2500) % seq.length]!;
          hands = { right: makeHand({ curl: SIGNS[letter]! }) };
        }
        break;
      }
      default:
        break;
    }
  }
  // hands are always in view (relaxed), so hand lessons pass the camera check and "no hands" never triggers
  if (!hands) hands = { right: makeHand({ curl: [0.2, 0.15, 0.15, 0.15, 0.15] }) };
  return {
    ts: now,
    mirrored: false,
    pose: makePose(poseSpec),
    objects: [chair()], // a chair beside the hips, for the fall-prevention safety check
    ...(hands ? { hands, handScores: { left: hands.left ? 0.9 : 0, right: hands.right ? 0.9 : 0 } } : {}),
  };
}
