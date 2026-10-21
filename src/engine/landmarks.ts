import type { JointName } from '../istep/index';

/** MediaPipe Pose landmark indices. */
export const P = {
  nose: 0,
  l_shoulder: 11,
  r_shoulder: 12,
  l_elbow: 13,
  r_elbow: 14,
  l_wrist: 15,
  r_wrist: 16,
  l_hip: 23,
  r_hip: 24,
  l_knee: 25,
  r_knee: 26,
  l_ankle: 27,
  r_ankle: 28,
  l_heel: 29,
  r_heel: 30,
  l_foot: 31,
  r_foot: 32,
} as const;

/** Joint angle triplets (a, vertex b, c). `torso` is special-cased. */
export const JOINT_TRIPLETS: Record<Exclude<JointName, 'torso'>, [number, number, number]> = {
  l_shoulder: [13, 11, 23],
  r_shoulder: [14, 12, 24],
  l_elbow: [11, 13, 15],
  r_elbow: [12, 14, 16],
  l_hip: [11, 23, 25],
  r_hip: [12, 24, 26],
  l_knee: [23, 25, 27],
  r_knee: [24, 26, 28],
  l_ankle: [25, 27, 31],
  r_ankle: [26, 28, 32],
};

export const TORSO_LANDMARKS = [11, 12, 23, 24] as const;

/** Landmarks a joint depends on (for visibility checks). */
export function jointLandmarks(j: JointName): readonly number[] {
  return j === 'torso' ? TORSO_LANDMARKS : JOINT_TRIPLETS[j];
}

/** Pairs of left/right pose indices (MediaPipe Pose topology). */
const MIRROR_PAIRS: [number, number][] = [
  [1, 4],
  [2, 5],
  [3, 6],
  [7, 8],
  [9, 10],
  [11, 12],
  [13, 14],
  [15, 16],
  [17, 18],
  [19, 20],
  [21, 22],
  [23, 24],
  [25, 26],
  [27, 28],
  [29, 30],
  [31, 32],
];
export const MIRROR_INDEX: number[] = Array.from({ length: 33 }, (_, i) => i);
for (const [a, b] of MIRROR_PAIRS) {
  MIRROR_INDEX[a] = b;
  MIRROR_INDEX[b] = a;
}

/** Skeleton edges for drawing. */
export const POSE_EDGES: [number, number][] = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [27, 29],
  [29, 31],
  [27, 31],
  [24, 26],
  [26, 28],
  [28, 30],
  [30, 32],
  [28, 32],
];

/** MediaPipe Hand indices per finger: [mcp/cmc, pip/mcp, dip/ip, tip]. Thumb: CMC 1, MCP 2, IP 3, tip 4. */
export const FINGER_INDICES = {
  thumb: [1, 2, 3, 4],
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20],
} as const;

export const HAND_EDGES: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
];

/** Joints shown on the learner skeleton per joint name (for limb colouring). */
export const JOINT_EDGES: Record<JointName, [number, number][]> = {
  l_shoulder: [[11, 13]],
  r_shoulder: [[12, 14]],
  l_elbow: [[13, 15]],
  r_elbow: [[14, 16]],
  l_hip: [[11, 23]],
  r_hip: [[12, 24]],
  l_knee: [
    [23, 25],
    [25, 27],
  ],
  r_knee: [
    [24, 26],
    [26, 28],
  ],
  l_ankle: [[27, 31]],
  r_ankle: [[28, 32]],
  torso: [
    [11, 12],
    [23, 24],
    [11, 23],
    [12, 24],
  ],
};
