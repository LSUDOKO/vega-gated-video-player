import type { JointName, PoseCondition } from '../../istep/index';
import { footLift, heelLift, jointAngle, meanVisibility } from '../geometry';
import { jointHint } from '../hints';
import { P, jointLandmarks } from '../landmarks';
import { VISIBILITY_THRESHOLD } from '../preprocess';
import { referencePoseAt } from '../reference';
import type { GateEval, Landmark, RunnerContext } from '../types';

export type PoseSpec = {
  target:
    { source: 'reference'; atSec: number } | { source: 'angles'; angles: Partial<Record<JointName, number>> };
  joints: JointName[];
  conditions?: PoseCondition[] | undefined;
  angleDeg: number;
};

export type PoseCheck = {
  visible: boolean;
  matched: boolean;
  score: number;
  jointErrors: Partial<Record<JointName, number>>;
  worst?: { name: string; hint: string };
};

const CONDITION_LANDMARKS: Record<PoseCondition['kind'], number[]> = {
  heel_lift: [P.l_heel, P.r_heel, P.l_foot, P.r_foot, 11, 12, 23, 24],
  foot_lift: [P.l_ankle, P.r_ankle, 11, 12, 23, 24],
};

function conditionCheck(pose: Landmark[], c: PoseCondition): { ok: boolean; hint: string } {
  if (c.kind === 'heel_lift') return { ok: heelLift(pose) >= c.min, hint: 'rise higher onto your toes' };
  if (c.foot === 'either') {
    const ok = Math.max(footLift(pose, 'left'), footLift(pose, 'right')) >= c.min;
    return { ok, hint: 'lift one foot a little off the floor' };
  }
  return { ok: footLift(pose, c.foot) >= c.min, hint: `lift your ${c.foot} foot a little higher` };
}

/** Builds a per-frame pose comparator (shared by pose_match, hold_duration and sequence steps). */
export function createPoseCheck(
  spec: PoseSpec,
  ctx: RunnerContext,
): (pose: Landmark[] | null | undefined) => PoseCheck {
  let targets: Partial<Record<JointName, number>> | null = null;
  const resolveTargets = () => {
    if (targets) return targets;
    if (spec.target.source === 'angles') targets = spec.target.angles;
    else {
      const ref = referencePoseAt(ctx.reference, spec.target.atSec);
      targets = {};
      if (ref) for (const j of spec.joints) targets[j] = jointAngle(ref, j);
    }
    return targets;
  };
  const needed = [
    ...new Set([
      ...spec.joints.flatMap((j) => jointLandmarks(j)),
      ...(spec.conditions ?? []).flatMap((c) => CONDITION_LANDMARKS[c.kind]),
    ]),
  ];
  const tol = spec.angleDeg;

  return (pose) => {
    if (!pose || meanVisibility(pose, needed) < VISIBILITY_THRESHOLD)
      return { visible: false, matched: false, score: 0, jointErrors: {} };
    const t = resolveTargets();
    const jointErrors: Partial<Record<JointName, number>> = {};
    let worstRatio = 0;
    let worst: PoseCheck['worst'];
    let penalty = 0;
    let n = 0;
    let allOk = true;
    for (const j of spec.joints) {
      const target = t[j];
      if (target === undefined) continue;
      const err = jointAngle(pose, j) - target;
      jointErrors[j] = Math.round(err * 10) / 10;
      const ratio = Math.abs(err) / tol;
      if (ratio > 1) allOk = false;
      penalty += Math.min(Math.abs(err) / (2 * tol), 1);
      n++;
      if (ratio > worstRatio && ratio > 1) {
        worstRatio = ratio;
        worst = { name: j, hint: jointHint(j, err) };
      }
    }
    let score = n ? 1 - penalty / n : 1;
    for (const c of spec.conditions ?? []) {
      const r = conditionCheck(pose, c);
      if (!r.ok) {
        allOk = false;
        score *= 0.7;
        worst = { name: c.kind, hint: r.hint };
      }
    }
    return { visible: true, matched: allOk, score, jointErrors, worst };
  };
}

export function poseEval(check: PoseCheck): Pick<GateEval, 'score' | 'jointErrors' | 'worst'> {
  return {
    score: check.score,
    jointErrors: check.jointErrors,
    ...(check.worst ? { worst: check.worst } : {}),
  };
}
