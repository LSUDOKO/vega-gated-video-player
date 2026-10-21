/**
 * Synthetic landmark builders for tests and demo landmark streams.
 * Coordinates are image-normalised (y down); "left" is the learner's left, drawn at larger x
 * (an unmirrored front camera).
 */
import type { JointName } from '../istep/index';
import type { DetectedObject, Frame, Landmark } from './types';

type V = { x: number; y: number };
const rot = (d: V, deg: number): V => {
  const r = (deg * Math.PI) / 180;
  return { x: d.x * Math.cos(r) - d.y * Math.sin(r), y: d.x * Math.sin(r) + d.y * Math.cos(r) };
};
const add = (p: V, d: V, k: number): V => ({ x: p.x + d.x * k, y: p.y + d.y * k });
const unit = (a: V, b: V): V => {
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
};

export type PoseSpec = Partial<Record<JointName, number>> & {
  /** horizontal offset of the whole body (for sway) */
  dx?: number;
  /** heel lift in torso lengths (both feet) */
  heelLift?: number;
  /** lift one foot by this many torso lengths */
  footLift?: { left?: number; right?: number };
  /** move both wrists down (+) / up (−) in image units, after arm kinematics */
  wristsDy?: number;
  visibility?: number;
  hidden?: number[];
};

export const TORSO = 0.2;

/** Builds a 33-landmark pose whose joint angles match the spec (defaults: standing, arms down). */
export function makePose(spec: PoseSpec = {}): Landmark[] {
  const a = {
    torso: 0,
    l_shoulder: 15,
    r_shoulder: 15,
    l_elbow: 175,
    r_elbow: 175,
    l_hip: 178,
    r_hip: 178,
    l_knee: 178,
    r_knee: 178,
    l_ankle: 110,
    r_ankle: 110,
    ...spec,
  };
  const pts: V[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5 }));
  const hipMid = { x: 0.5 + (spec.dx ?? 0), y: 0.55 };
  const up = rot({ x: 0, y: -1 }, a.torso);
  const shoulderMid = add(hipMid, up, TORSO);
  const side = rot(up, 90); // points to image +x (learner's left) when upright

  for (const s of [1, -1] as const) {
    const L = s === 1;
    const sh = add(shoulderMid, side, 0.06 * s);
    const hp = add(hipMid, side, 0.045 * s);
    const [iSh, iEl, iWr, iHp, iKn, iAn, iHe, iFt] = L
      ? [11, 13, 15, 23, 25, 27, 29, 31]
      : [12, 14, 16, 24, 26, 28, 30, 32];
    pts[iSh] = sh;
    pts[iHp] = hp;
    // arm: rotate the shoulder→hip direction outward by the shoulder angle, then bend at the elbow
    const down = unit(sh, hp);
    const upperArm = rot(down, -s * (L ? a.l_shoulder : a.r_shoulder));
    const elbow = add(sh, upperArm, 0.13);
    const forearm = rot(upperArm, -s * (180 - (L ? a.l_elbow : a.r_elbow)));
    pts[iEl] = elbow;
    pts[iWr] = add(elbow, forearm, 0.12);
    // leg: rotate hip→shoulder direction by the hip angle, then bend at the knee and ankle
    const toShoulder = unit(hp, sh);
    const thigh = rot(toShoulder, s * (L ? a.l_hip : a.r_hip));
    const knee = add(hp, thigh, 0.19);
    const shin = rot(thigh, -s * (180 - (L ? a.l_knee : a.r_knee)));
    let ankle = add(knee, shin, 0.19);
    const toKnee = unit(ankle, knee);
    let foot = add(ankle, rot(toKnee, s * (L ? a.l_ankle : a.r_ankle)), 0.06);
    const lift = (L ? spec.footLift?.left : spec.footLift?.right) ?? 0;
    ankle = { x: ankle.x, y: ankle.y - lift * TORSO };
    foot = { x: foot.x, y: foot.y - lift * TORSO };
    pts[iKn] = knee;
    pts[iAn] = ankle;
    pts[iFt] = foot;
    pts[iHe] = { x: ankle.x, y: foot.y - (spec.heelLift ?? 0) * TORSO };
    // hand points near the wrist
    for (const i of L ? [17, 19, 21] : [18, 20, 22]) pts[i] = add(pts[iWr]!, forearm, 0.02);
  }
  for (const s of [15, 16]) pts[s] = { x: pts[s]!.x, y: pts[s]!.y + (spec.wristsDy ?? 0) };
  const nose = add(shoulderMid, up, 0.08);
  pts[0] = nose;
  for (let i = 1; i <= 10; i++)
    pts[i] = { x: nose.x + (i <= 3 || i === 7 || i === 9 ? 0.01 : -0.01), y: nose.y - 0.005 };

  const vis = spec.visibility ?? 0.99;
  const hidden = new Set(spec.hidden ?? []);
  return pts.map((p, i) => ({ x: p.x, y: p.y, z: 0, v: hidden.has(i) ? 0.05 : vis }));
}

export type HandSpec = {
  /** [thumb, index, middle, ring, pinky], 0 = extended, 1 = curled */
  curl?: [number, number, number, number, number];
  /** rotate the hand about the vertical axis, degrees (wrist turn) */
  turnDeg?: number;
  at?: V;
};

const BASE_ANGLES = { thumb: -55, index: -12, middle: 0, ring: 12, pinky: 24 }; // degrees from "up"
const SEGMENTS = { thumb: [0.045, 0.04, 0.035, 0.03], other: [0.1, 0.045, 0.03, 0.025] };

/** Builds a 21-landmark hand with the given finger curls (palm facing camera, fingers up). */
export function makeHand(spec: HandSpec = {}): Landmark[] {
  const curl = spec.curl ?? [0, 0, 0, 0, 0];
  const wrist = spec.at ?? { x: 0.5, y: 0.7 };
  const pts: V[] = Array.from({ length: 21 }, () => wrist);
  (['thumb', 'index', 'middle', 'ring', 'pinky'] as const).forEach((f, fi) => {
    const base = 1 + fi * 4;
    let d = rot({ x: 0, y: -1 }, BASE_ANGLES[f]);
    const seg = f === 'thumb' ? SEGMENTS.thumb : SEGMENTS.other;
    const bendPer = f === 'thumb' ? 90 : 120;
    const fold = f === 'thumb' ? 1 : -1; // thumb folds across the palm towards +x
    let p = add(wrist, d, seg[0]!);
    pts[base] = p;
    for (let j = 1; j < 4; j++) {
      // joint j: thumb bends at points 2 and 3; fingers bend at PIP (6) and DIP (7)
      const bends = f === 'thumb' ? j >= 2 : j >= 2;
      if (bends) d = rot(d, fold * curl[fi]! * bendPer);
      p = add(p, d, seg[j]!);
      pts[base + j] = p;
    }
  });
  const turn = ((spec.turnDeg ?? 0) * Math.PI) / 180;
  return pts.map((p) => {
    const rx = p.x - wrist.x;
    return { x: wrist.x + rx * Math.cos(turn), y: p.y, z: rx * Math.sin(turn) };
  });
}

/** A chair detection beside the learner's hips (default: within reach). */
export function chair(offsetX = 0.12, score = 0.8): DetectedObject {
  return { label: 'chair', score, box: [0.5 + offsetX - 0.1, 0.45, 0.2, 0.35] };
}

export function frame(ts: number, parts: Partial<Omit<Frame, 'ts'>> = {}): Frame {
  return { ts, mirrored: false, ...parts };
}

/** Repeats a frame builder at a fixed fps for `seconds`, starting at t0 (ms). */
export function stream(
  seconds: number,
  fps: number,
  build: (ts: number, i: number) => Frame,
  t0 = 0,
): Frame[] {
  const n = Math.round(seconds * fps);
  return Array.from({ length: n }, (_, i) => build(t0 + (i * 1000) / fps, i));
}
