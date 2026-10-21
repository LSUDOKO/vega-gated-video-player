import type { Gate, RepMetric } from '../../istep/index';
import {
  handOpenness,
  heelLift,
  jointAngle,
  mean,
  meanVisibility,
  verticalPosition,
  wristRotation,
} from '../geometry';
import { jointLandmarks, P } from '../landmarks';
import { PaceFollower } from '../pace';
import { VISIBILITY_THRESHOLD } from '../preprocess';
import type { Frame, GateEval, RunnerContext } from '../types';
import { NO_HAND, NO_PERSON_POSE, pickHand, type Evaluator } from './common';

type RepGate = Extract<Gate, { type: 'rep_count' }>;

const HINTS: Record<RepMetric['kind'], [up: string, down: string]> = {
  hand_openness: ['open your hand wider', 'close your hand into a soft fist'],
  wrist_rotation: ['turn your palm to face the camera', 'turn your hand onto its side'],
  heel_lift: ['rise higher onto your toes', 'lower your heels all the way'],
  vertical_position: ['reach a little higher', 'come all the way back down'],
  joint_angle: ['move a little further', 'come all the way back'],
};

const POSE_METRIC_LANDMARKS: Record<string, readonly number[]> = {
  heel_lift: [P.l_heel, P.r_heel, P.l_foot, P.r_foot, 11, 12, 23, 24],
  vertical_position: [11, 12, 23, 24],
};

/** Reads the metric value for this frame; null when the needed body part is not visible. */
function readMetric(m: RepMetric, f: Frame, ctx: RunnerContext): number | null | 'no_hand' {
  switch (m.kind) {
    case 'hand_openness':
    case 'wrist_rotation': {
      const h = pickHand(f, m.hand, ctx);
      if (!h) return 'no_hand';
      return m.kind === 'hand_openness' ? handOpenness(h.hand) : wristRotation(h.hand);
    }
    default: {
      const pose = f.pose;
      const need = m.kind === 'joint_angle' ? jointLandmarks(m.joint) : POSE_METRIC_LANDMARKS[m.kind]!;
      if (!pose || meanVisibility(pose, need) < VISIBILITY_THRESHOLD) return null;
      if (m.kind === 'joint_angle') return jointAngle(pose, m.joint);
      if (m.kind === 'heel_lift') return heelLift(pose);
      return verticalPosition(pose, m.landmark);
    }
  }
}

/** rep_count: LOW → HIGH → LOW is one quality rep; leaving LOW without reaching HIGH is a partial. */
export function repEvaluator(gate: RepGate, ctx: RunnerContext): Evaluator {
  const { low, high } = gate.range;
  const partialAt = low + 0.4 * (high - low);
  const [upHint, downHint] = HINTS[gate.metric.kind];
  let phase: 'unknown' | 'low' | 'high' = 'unknown';
  let maxSinceLow = -Infinity;
  let cycleStart = 0;
  let highSince = 0;
  let lastPartialTs = -Infinity;
  let reps = 0;
  let partial = 0;
  let durations: number[] = [];
  let pace = gate.paceFollow?.enabled ? new PaceFollower(gate.paceFollow.teacherRepSec) : null;
  let passed = false;

  const learnerRepSec = (ts: number): number | undefined => {
    if (phase === 'unknown') return undefined;
    const elapsed = (ts - cycleStart) / 1000;
    const recent = durations.slice(-3);
    if (!recent.length) return elapsed > 0 ? elapsed : undefined;
    return Math.max(mean(recent) / 1000, elapsed);
  };

  return {
    eval(f): GateEval {
      const base = { progress: Math.min(reps / gate.reps, 1), reps, partialReps: partial };
      if (passed) return { status: 'passed', score: 1, ...base };
      const m = readMetric(gate.metric, f, ctx);
      if (m === null || m === 'no_hand')
        return { status: 'no_person', score: 0, ...base, message: m === null ? NO_PERSON_POSE : NO_HAND };

      if (phase === 'unknown') {
        if (m <= low) {
          phase = 'low';
          cycleStart = f.ts;
          maxSinceLow = m;
        }
      } else if (phase === 'low') {
        if (m >= high) {
          phase = 'high';
          highSince = f.ts;
        } else if (m <= low) {
          if (maxSinceLow >= partialAt) {
            partial++;
            lastPartialTs = f.ts;
          }
          maxSinceLow = m;
        } else maxSinceLow = Math.max(maxSinceLow, m);
      } else if (m <= low) {
        reps++;
        durations.push(f.ts - cycleStart);
        cycleStart = f.ts;
        phase = 'low';
        maxSinceLow = m;
        if (reps >= gate.reps) passed = true;
      }

      const rate = pace?.update(learnerRepSec(f.ts), f.ts);
      let worst: GateEval['worst'];
      if (f.ts - lastPartialTs < 3000) worst = { name: 'range', hint: upHint };
      else if (phase === 'high' && f.ts - highSince > 3000) worst = { name: 'range', hint: downHint };
      return {
        status: passed ? 'passed' : phase === 'unknown' ? 'waiting' : 'progress',
        score: Math.min(reps / gate.reps, 1),
        ...base,
        progress: Math.min(reps / gate.reps, 1),
        reps,
        ...(rate !== undefined ? { playbackRate: rate } : {}),
        ...(worst ? { worst } : {}),
      };
    },
    reset() {
      phase = 'unknown';
      maxSinceLow = -Infinity;
      reps = partial = 0;
      durations = [];
      lastPartialTs = -Infinity;
      pace = gate.paceFollow?.enabled ? new PaceFollower(gate.paceFollow.teacherRepSec) : null;
      passed = false;
    },
    state: () => ({ phase, reps, partial, durations: [...durations] }),
  };
}
