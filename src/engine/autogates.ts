import type { Channel, Gate, JointName, ReferenceTimeline } from '../istep/index';
import { fingerCurls, handOpenness, jointAngle, mean, meanVisibility } from './geometry';
import { jointLandmarks } from './landmarks';
import type { Landmark } from './types';

/**
 * Deterministic auto-gates from an instructor's reference timeline (docs/06 §3.3).
 * 1. per-frame angular speed of the joints that matter for the channel (fastest joint)
 * 2. still segments: speed < 20 °/s for ≥ 0.6 s → candidate at the segment middle
 * 3. merge candidates < 2 s apart, keep at most 8
 * 4. gate type by channel (fall: safety check first + holds; rehab: one rep gate over the periodic part;
 *    sign: hand shapes; CPR: placement + rhythm; kids: poses). Labels are templates (AI may rewrite them).
 */
export const STILL_DEG_PER_SEC = 20;
export const STILL_MIN_SEC = 0.6;
export const MERGE_SEC = 2;
export const MAX_GATES = 8;

const POSE_JOINTS: JointName[] = [
  'l_knee',
  'r_knee',
  'l_hip',
  'r_hip',
  'l_elbow',
  'r_elbow',
  'l_shoulder',
  'r_shoulder',
  'torso',
];

type Sample = { t: number; values: number[] | null };

const toPose = (p: number[][]): Landmark[] => p.map(([x, y, z, v]) => ({ x: x!, y: y!, z: z!, v: v ?? 1 }));
const toHand = (h: number[][]): Landmark[] => h.map(([x, y, z]) => ({ x: x!, y: y!, z: z!, v: 1 }));
const handOf = (f: ReferenceTimeline['frames'][number]) => f.hands?.right ?? f.hands?.left ?? null;

/** The signal per frame: joint angles (pose channels) or finger curls ×120 (degree-like) for hands. */
function samples(ref: ReferenceTimeline, channel: Channel): Sample[] {
  const hands = channel === 'sign_language' || channel === 'stroke_rehab';
  return ref.frames.map((f) => {
    if (hands) {
      const h = handOf(f);
      return { t: f.t, values: h ? fingerCurls(toHand(h)).map((c) => c * 120) : null };
    }
    if (!f.pose) return { t: f.t, values: null };
    const pose = toPose(f.pose);
    const joints = POSE_JOINTS.filter((j) => meanVisibility(pose, jointLandmarks(j)) >= 0.5);
    if (joints.length < 3) return { t: f.t, values: null };
    return { t: f.t, values: POSE_JOINTS.map((j) => (joints.includes(j) ? jointAngle(pose, j) : NaN)) };
  });
}

/**
 * Angular speed between consecutive frames (°/s): the FASTEST joint, not the mean — averaging over nine joints
 * hides a single moving knee (spec said "mean"; changed after tests showed missed movements).
 */
function speeds(s: Sample[]): { t: number; v: number | null }[] {
  return s.map((cur, i) => {
    const prev = s[i - 1];
    if (!prev || !cur.values || !prev.values || cur.t <= prev.t) return { t: cur.t, v: null };
    const d = cur.values.map((x, k) => Math.abs(x - prev.values![k]!)).filter((x) => Number.isFinite(x));
    return { t: cur.t, v: d.length ? Math.max(...d) / (cur.t - prev.t) : null };
  });
}

/** Middles of still segments (seconds). */
export function stillMoments(ref: ReferenceTimeline, channel: Channel): number[] {
  const sp = speeds(samples(ref, channel));
  const out: number[] = [];
  let start: number | null = null;
  const close = (end: number) => {
    if (start !== null && end - start >= STILL_MIN_SEC) out.push(Math.round(((start + end) / 2) * 10) / 10);
    start = null;
  };
  for (const { t, v } of sp) {
    if (v !== null && v < STILL_DEG_PER_SEC) start ??= t;
    else close(t);
  }
  close(sp.at(-1)?.t ?? 0);
  // merge close candidates (keep the earlier), cap the count
  const merged: number[] = [];
  for (const t of out) if (!merged.length || t - merged.at(-1)! >= MERGE_SEC) merged.push(t);
  return merged.slice(0, MAX_GATES);
}

/** Dominant period (s) of a signal by autocorrelation, searching 0.6–6 s. */
export function dominantPeriod(values: number[], fps: number): { period: number; strength: number } | null {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < fps * 2) return null;
  const m = mean(v);
  const c = v.map((x) => x - m);
  const energy = c.reduce((a, x) => a + x * x, 0) || 1;
  let best = { lag: 0, r: 0 };
  for (let lag = Math.round(0.6 * fps); lag <= Math.min(6 * fps, c.length / 2); lag++) {
    let r = 0;
    for (let i = 0; i + lag < c.length; i++) r += c[i]! * c[i + lag]!;
    r /= energy;
    if (r > best.r) best = { lag, r };
  }
  return best.lag ? { period: best.lag / fps, strength: best.r } : null;
}

const SAFETY_CHAIR: Gate = {
  id: 'chair',
  t: 2,
  type: 'safety_prerequisite',
  label: 'Stand next to a sturdy chair',
  checks: [
    { kind: 'object_near', object: 'chair', near: 'hips', maxDistance: 0.35, minScore: 0.5 },
    { kind: 'full_body_visible' },
    { kind: 'stable', maxLateralSway: 0.04, windowSec: 1 },
  ],
  minFrames: 15,
  fallbackTip: 'Place a sturdy chair beside you and rest one hand on its back.',
};

export type AutoGateInput = { reference: ReferenceTimeline; channel: Channel; durationSec: number };

export function autoGates({ reference, channel, durationSec }: AutoGateInput): Gate[] {
  const clampT = (t: number) => Math.min(Math.max(0, Math.round(t * 10) / 10), durationSec);
  const stills = stillMoments(reference, channel);
  const gates: Gate[] = [];
  const id = (prefix: string, i: number) => `${prefix}${i + 1}`;

  switch (channel) {
    case 'fall_prevention': {
      gates.push({ ...SAFETY_CHAIR, t: clampT(Math.min(2, durationSec)) });
      stills
        .filter((t) => t > 2.5)
        .slice(0, MAX_GATES - 1)
        .forEach((t, i) =>
          gates.push({
            id: id('hold', i),
            t: clampT(t),
            type: 'hold_duration',
            label: i === 0 ? 'Copy this position and hold' : 'Hold this position',
            target: { source: 'reference', atSec: clampT(t) },
            joints: ['l_knee', 'r_knee', 'l_hip', 'r_hip', 'torso'],
            holdSec: 2,
            graceSec: 0.4,
            fallbackTip: 'Copy the position on screen and keep a hand on your chair.',
          }),
        );
      break;
    }
    case 'stroke_rehab': {
      const open = reference.frames.map((f) => {
        const h = handOf(f);
        return h ? handOpenness(toHand(h)) : NaN;
      });
      const p = dominantPeriod(open, reference.fps);
      const end = reference.frames.at(-1)?.t ?? durationSec;
      const start = reference.frames.find((f) => handOf(f))?.t ?? 0;
      gates.push({
        id: 'reps',
        t: clampT(end - 0.5),
        type: 'rep_count',
        label: 'Open and close your hand',
        metric: { kind: 'hand_openness', hand: 'affected' },
        range: { low: 0.25, high: 0.75 },
        reps: 10,
        ...(p && p.strength > 0.3
          ? { paceFollow: { enabled: true, teacherRepSec: Math.round(p.period * 10) / 10 } }
          : {}),
        rewindTo: clampT(start),
        then: 'loop_segment',
        fallbackTip: 'Open your fingers as wide as you comfortably can, then make a soft fist.',
      });
      break;
    }
    case 'sign_language':
      stills.forEach((t, i) =>
        gates.push({
          id: id('sign', i),
          t: clampT(t),
          type: 'hand_sign',
          label: 'Copy this hand shape',
          hand: 'any',
          target: { source: 'reference', atSec: clampT(t) },
          minFrames: 10,
          fallbackTip: 'Look closely at each finger and copy the shape one finger at a time.',
        }),
      );
      break;
    case 'cpr':
      gates.push(
        {
          id: 'placement',
          t: clampT(Math.min(2, durationSec)),
          type: 'safety_prerequisite',
          label: 'Kneel beside a firm cushion',
          checks: [{ kind: 'upper_body_visible' }],
          minFrames: 10,
          fallbackTip: 'Turn the camera to your side so it can see your shoulders, arms and hands.',
        },
        {
          id: 'rhythm',
          t: clampT(Math.min(durationSec, Math.max(4, durationSec / 2))),
          type: 'rhythm_bpm',
          label: 'Push hard and fast — follow the beat',
          signal: { landmark: 'wrists_mid', axis: 'y' },
          bpm: { min: 100, max: 120 },
          count: 30,
          armsStraight: { minElbowDeg: 160 },
          metronomeBpm: 110,
          fallbackTip: 'Lock your elbows and let your shoulders do the work.',
        },
      );
      break;
    case 'kids':
      stills.forEach((t, i) =>
        gates.push({
          id: id('pose', i),
          t: clampT(t),
          type: 'pose_match',
          label: 'Copy this pose!',
          target: { source: 'reference', atSec: clampT(t) },
          joints: ['l_shoulder', 'r_shoulder', 'l_elbow', 'r_elbow', 'l_knee', 'r_knee'],
          tolerance: { angleDeg: 30 },
          minFrames: 8,
          fallbackTip: 'Look at the screen and copy the shape with your whole body!',
        }),
      );
      break;
  }
  // sorted, unique times
  gates.sort((a, b) => a.t - b.t);
  return gates.filter((g, i) => i === 0 || g.t > gates[i - 1]!.t);
}
