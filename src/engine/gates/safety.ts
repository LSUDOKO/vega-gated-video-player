import type { Gate, SafetyCheck } from '../../istep/index';
import { dist, hipMid, meanVisibility } from '../geometry';
import { P } from '../landmarks';
import { VISIBILITY_THRESHOLD } from '../preprocess';
import { SwayTracker } from '../sway';
import type { DetectedObject, Frame, GateEval, Landmark } from '../types';
import { NO_PERSON_POSE, type Evaluator } from './common';

type SafetyGate = Extract<Gate, { type: 'safety_prerequisite' }>;

const FULL_BODY = [0, 11, 12, 23, 24, 27, 28];
const ALTERNATIVES: Record<string, string[]> = { chair: ['couch', 'bench'] };

const visibleInFrame = (pose: Landmark[], idx: number[]) =>
  idx.every((i) => {
    const p = pose[i]!;
    return (p.v ?? 0) >= VISIBILITY_THRESHOLD && p.x >= 0.02 && p.x <= 0.98 && p.y >= 0.02 && p.y <= 0.98;
  });

const inBox = (p: { x: number; y: number }, [x, y, w, h]: DetectedObject['box']) =>
  p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;

type Check = (f: Frame) => { ok: boolean; message?: string };

function objectNear(c: Extract<SafetyCheck, { kind: 'object_near' }>): Check {
  const labels = [c.object, ...(c.allowAlternatives ? (ALTERNATIVES[c.object] ?? []) : [])];
  const message = `I can't see a ${c.object} next to you`;
  return (f) => {
    const pose = f.pose;
    if (!pose) return { ok: false, message };
    const anchor =
      c.near === 'hands'
        ? {
            x: (pose[P.l_wrist]!.x + pose[P.r_wrist]!.x) / 2,
            y: (pose[P.l_wrist]!.y + pose[P.r_wrist]!.y) / 2,
          }
        : hipMid(pose);
    const handPts = [pose[P.l_wrist]!, pose[P.r_wrist]!, f.hands?.left?.[0], f.hands?.right?.[0]].filter(
      (p): p is Landmark => !!p && (p.v ?? 1) >= VISIBILITY_THRESHOLD,
    );
    const ok = (f.objects ?? []).some((o) => {
      if (!labels.includes(o.label) || o.score < c.minScore) return false;
      const [x, y, w, h] = o.box;
      const centre = { x: x + w / 2, y: y + h / 2 };
      return dist(centre, anchor) <= c.maxDistance || handPts.some((p) => inBox(p, o.box));
    });
    return ok ? { ok } : { ok, message };
  };
}

function makeCheck(c: SafetyCheck): Check {
  switch (c.kind) {
    case 'object_near':
      return objectNear(c);
    case 'full_body_visible':
      return (f) =>
        f.pose && visibleInFrame(f.pose, FULL_BODY)
          ? { ok: true }
          : { ok: false, message: 'Step back so I can see all of you' };
    case 'upper_body_visible':
      return (f) => {
        const pose = f.pose;
        const ok =
          !!pose &&
          meanVisibility(pose, [0, 11, 12]) >= VISIBILITY_THRESHOLD &&
          (visibleInFrame(pose, [13, 15]) || visibleInFrame(pose, [14, 16]));
        return ok ? { ok } : { ok, message: 'Turn so I can see your arms and shoulders' };
      };
    case 'hands_visible':
      return (f) => {
        const n = (f.hands?.left ? 1 : 0) + (f.hands?.right ? 1 : 0);
        return n >= c.count
          ? { ok: true }
          : {
              ok: false,
              message: c.count === 2 ? 'Show both hands to the camera' : 'Show your hand to the camera',
            };
      };
    case 'stable': {
      const tracker = new SwayTracker(c.windowSec * 1000);
      return (f) => {
        if (!f.pose) return { ok: false, message: 'Stand still for a moment' };
        const s = tracker.push(f.ts, f.pose);
        return s.filled && s.sway <= c.maxLateralSway
          ? { ok: true }
          : { ok: false, message: 'Stand still for a moment' };
      };
    }
  }
}

/**
 * safety_prerequisite: every check must pass on the same frame for `minFrames` consecutive frames.
 * Thresholds come only from the file — never from adaptive tolerance.
 */
export function safetyEvaluator(gate: SafetyGate): Evaluator {
  const minFrames = gate.minFrames ?? 15;
  let checks = gate.checks.map(makeCheck);
  let streak = 0;
  let passed = false;
  return {
    eval(f): GateEval {
      if (passed) return { status: 'passed', progress: 1, score: 1 };
      const needsPose = gate.checks.some((c) => c.kind !== 'hands_visible');
      if (needsPose && !f.pose) {
        streak = 0;
        return { status: 'no_person', progress: 0, score: 0, message: NO_PERSON_POSE };
      }
      const results = checks.map((run, i) => ({ kind: gate.checks[i]!.kind, ...run(f) }));
      const okCount = results.filter((r) => r.ok).length;
      const allOk = okCount === results.length;
      streak = allOk ? streak + 1 : 0;
      if (streak >= minFrames) passed = true;
      const firstFail = results.find((r) => !r.ok);
      return {
        status: passed ? 'passed' : allOk ? 'progress' : 'blocked_safety',
        progress: allOk ? Math.min(streak / minFrames, 1) : 0,
        score: okCount / results.length,
        checks: results,
        ...(firstFail?.message
          ? { message: firstFail.message, worst: { name: firstFail.kind, hint: firstFail.message } }
          : {}),
      };
    },
    reset() {
      checks = gate.checks.map(makeCheck);
      streak = 0;
      passed = false;
    },
    state: () => ({ streak, passed }),
  };
}
