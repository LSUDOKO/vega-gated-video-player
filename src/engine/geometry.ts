import type { Finger, JointName, SignalLandmark } from '../istep/index';
import { FINGER_INDICES, JOINT_TRIPLETS, P } from './landmarks';
import type { Landmark } from './types';

type Pt = { x: number; y: number; z?: number };

const RAD = 180 / Math.PI;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function mid(a: Landmark, b: Landmark): Landmark {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2, v: Math.min(a.v ?? 1, b.v ?? 1) };
}

/** Angle at b in degrees (0..180). 2D by default; MediaPipe z is noisy. */
export function angle(a: Pt, b: Pt, c: Pt, useZ = false): number {
  const z = useZ && a.z !== undefined && b.z !== undefined && c.z !== undefined;
  const v1 = [a.x - b.x, a.y - b.y, z ? a.z! - b.z! : 0];
  const v2 = [c.x - b.x, c.y - b.y, z ? c.z! - b.z! : 0];
  const dot = v1[0]! * v2[0]! + v1[1]! * v2[1]! + v1[2]! * v2[2]!;
  const n = Math.hypot(...v1) * Math.hypot(...v2);
  if (n === 0) return 0;
  return Math.acos(clamp(dot / n, -1, 1)) * RAD;
}

export const shoulderMid = (pose: Landmark[]) => mid(pose[P.l_shoulder]!, pose[P.r_shoulder]!);
export const hipMid = (pose: Landmark[]) => mid(pose[P.l_hip]!, pose[P.r_hip]!);

/** Shoulder-mid to hip-mid distance; the unit for pose distances. */
export function torsoLength(pose: Landmark[]): number {
  return Math.max(dist(shoulderMid(pose), hipMid(pose)), 1e-6);
}

/** Torso lean vs vertical in degrees (0 = upright). */
export function torsoAngle(pose: Landmark[]): number {
  const s = shoulderMid(pose);
  const h = hipMid(pose);
  return angle({ x: s.x, y: s.y }, { x: h.x, y: h.y }, { x: h.x, y: h.y - 1 });
}

export function jointAngle(pose: Landmark[], j: JointName): number {
  if (j === 'torso') return torsoAngle(pose);
  const [a, b, c] = JOINT_TRIPLETS[j];
  return angle(pose[a]!, pose[b]!, pose[c]!);
}

export function meanVisibility(pose: Landmark[], idx: readonly number[]): number {
  if (idx.length === 0) return 1;
  let s = 0;
  for (const i of idx) s += pose[i]?.v ?? 0;
  return s / idx.length;
}

/** Mean (foot_index.y − heel.y) over both feet ÷ torso length; positive when heels are raised. */
export function heelLift(pose: Landmark[]): number {
  const l = pose[P.l_foot]!.y - pose[P.l_heel]!.y;
  const r = pose[P.r_foot]!.y - pose[P.r_heel]!.y;
  return (l + r) / 2 / torsoLength(pose);
}

/** How far `foot` ankle is above the other ankle ÷ torso length. */
export function footLift(pose: Landmark[], foot: 'left' | 'right'): number {
  const [me, other] = foot === 'left' ? [P.l_ankle, P.r_ankle] : [P.r_ankle, P.l_ankle];
  return (pose[other]!.y - pose[me]!.y) / torsoLength(pose);
}

export function signalPoint(pose: Landmark[], name: SignalLandmark): Landmark {
  switch (name) {
    case 'nose':
      return pose[P.nose]!;
    case 'wrists_mid':
      return mid(pose[P.l_wrist]!, pose[P.r_wrist]!);
    case 'l_wrist':
      return pose[P.l_wrist]!;
    case 'r_wrist':
      return pose[P.r_wrist]!;
    case 'hips_mid':
      return hipMid(pose);
    case 'heels_mid':
      return mid(pose[P.l_heel]!, pose[P.r_heel]!);
    case 'l_heel':
      return pose[P.l_heel]!;
    case 'r_heel':
      return pose[P.r_heel]!;
  }
}

/** Height of a landmark above the hip midpoint, in torso lengths. */
export function verticalPosition(pose: Landmark[], name: SignalLandmark): number {
  return (hipMid(pose).y - signalPoint(pose, name).y) / torsoLength(pose);
}

/** Wrist (0) to middle-finger MCP (9): the unit for hand distances. */
export function palmSize(hand: Landmark[]): number {
  return Math.max(dist(hand[0]!, hand[9]!), 1e-6);
}

/**
 * Finger curl 0 (extended) .. 1 (curled), order [thumb, index, middle, ring, pinky].
 * Fingers: mean of PIP + DIP angles; thumb: mean of CMC + MCP angles, own range (/90).
 */
export function fingerCurls(hand: Landmark[]): [number, number, number, number, number] {
  const out = (Object.keys(FINGER_INDICES) as Finger[]).map((f) => {
    const [a, b, c, d] = FINGER_INDICES[f];
    if (f === 'thumb') {
      const m = (angle(hand[1]!, hand[2]!, hand[3]!) + angle(hand[2]!, hand[3]!, hand[4]!)) / 2;
      return clamp((180 - m) / 90, 0, 1);
    }
    const m = (angle(hand[a]!, hand[b]!, hand[c]!) + angle(hand[b]!, hand[c]!, hand[d]!)) / 2;
    return clamp((180 - m) / 120, 0, 1);
  });
  return out as [number, number, number, number, number];
}

/** Mean fingertip-to-wrist distance ÷ palm size, mapped from [0.9, 2.0] to 0..1. */
export function handOpenness(hand: Landmark[]): number {
  const palm = palmSize(hand);
  const tips = [4, 8, 12, 16, 20].map((i) => dist(hand[i]!, hand[0]!) / palm);
  const m = tips.reduce((a, b) => a + b, 0) / tips.length;
  return clamp((m - 0.9) / (2.0 - 0.9), 0, 1);
}

/**
 * Forearm rotation proxy 0..1: on-screen length of the index-MCP→pinky-MCP knuckle line relative to
 * its 3D length (in-plane rotation invariant). 1 = palm (or back) facing the camera, ~0 = hand edge-on.
 */
export function wristRotation(hand: Landmark[]): number {
  const a = hand[5]!;
  const b = hand[17]!;
  const flat = Math.hypot(a.x - b.x, a.y - b.y);
  const len = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  return len === 0 ? 0 : clamp(flat / len, 0, 1);
}

/** Thumb tip to index tip ÷ palm size. */
export function thumbIndexSpread(hand: Landmark[]): number {
  return dist(hand[4]!, hand[8]!) / palmSize(hand);
}

export function mean(xs: readonly number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function stdDev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}
