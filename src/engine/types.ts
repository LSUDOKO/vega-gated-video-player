import type { Finger, Gate, JointName, ReferenceTimeline, Tolerance } from '../istep/index';

export type Landmark = { x: number; y: number; z: number; v?: number };

export type DetectedObject = {
  label: string;
  score: number;
  box: [x: number, y: number, w: number, h: number];
};

export type Frame = {
  /** ms, sender clock */
  ts: number;
  /** 33 MediaPipe Pose landmarks, normalised 0..1 */
  pose?: Landmark[] | null;
  /** 21 MediaPipe Hand landmarks per hand, anatomical left/right */
  hands?: { left?: Landmark[] | null; right?: Landmark[] | null };
  /** hand detection confidence, used by hand: "any" */
  handScores?: { left?: number; right?: number };
  objects?: DetectedObject[];
  /** true if left/right labels come from a mirrored image and must be swapped */
  mirrored: boolean;
};

export type GateStatus = 'waiting' | 'progress' | 'passed' | 'blocked_safety' | 'no_person';

export type FingerError = { finger: Finger; delta: number; hint: 'curl' | 'extend' };

export interface GateEval {
  status: GateStatus;
  /** 0..1 (hold %, reps/target, matched frames %, sequence step) */
  progress: number;
  /** 0..1 overall closeness */
  score: number;
  /** signed degrees (user − target) */
  jointErrors?: Partial<Record<JointName, number>>;
  fingerErrors?: FingerError[];
  /** single most important fix (for HUD + coach) */
  worst?: { name: string; hint: string };
  reps?: number;
  partialReps?: number;
  bpm?: number;
  holdSec?: number;
  step?: number;
  /** pace-follow playback rate suggestion (rep_count with paceFollow) */
  playbackRate?: number;
  /** safety_prerequisite: per-check pass/fail */
  checks?: { kind: string; ok: boolean; message?: string }[];
  armsStraight?: boolean;
  /** short HUD text, e.g. "Step into view" */
  message?: string;
}

export type RunnerContext = {
  reference?: ReferenceTimeline;
  affectedHand?: 'left' | 'right';
  /** effective tolerance after adaptive adjustment; ignored for safety gates */
  tolerance?: Tolerance;
  /** One-Euro smoothing of landmarks (default true) */
  smoothing?: boolean;
};

export interface GateRunner {
  push(frame: Frame): GateEval;
  reset(): void;
  readonly state: unknown;
  readonly gate: Gate;
}
