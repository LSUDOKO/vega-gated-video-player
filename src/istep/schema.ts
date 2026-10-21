import { z } from 'zod';

export const CHANNELS = ['fall_prevention', 'stroke_rehab', 'sign_language', 'cpr', 'kids'] as const;
export const Channel = z.enum(CHANNELS);

/** Angle joints (see docs/04-gate-engine.md §3). */
export const JOINTS = [
  'l_shoulder',
  'r_shoulder',
  'l_elbow',
  'r_elbow',
  'l_hip',
  'r_hip',
  'l_knee',
  'r_knee',
  'l_ankle',
  'r_ankle',
  'torso',
] as const;
export const JointName = z.enum(JOINTS);

export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;
export const HandSelector = z.enum(['left', 'right', 'affected', 'any']);
export const Tracker = z.enum(['pose', 'hands', 'objects']);

/** Landmarks usable as a vertical-position or rhythm signal. */
export const SignalLandmark = z.enum([
  'nose',
  'wrists_mid',
  'l_wrist',
  'r_wrist',
  'hips_mid',
  'heels_mid',
  'l_heel',
  'r_heel',
]);

export const Tolerance = z
  .object({
    angleDeg: z.number().positive().max(90).optional(),
    curl: z.number().positive().max(1).optional(),
  })
  .strict();

const CurlVector = z.tuple([
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
]);

const PoseTarget = z.discriminatedUnion('source', [
  z.object({ source: z.literal('reference'), atSec: z.number().min(0) }),
  z.object({ source: z.literal('angles'), angles: z.partialRecord(JointName, z.number().min(0).max(180)) }),
]);

const HandTarget = z
  .object({
    source: z.literal('reference').optional(),
    atSec: z.number().min(0).optional(),
    curl: CurlVector.optional(),
    spread: z.object({ thumb_index: z.enum(['open', 'closed']) }).optional(),
  })
  .refine((t) => t.curl !== undefined || (t.source === 'reference' && t.atSec !== undefined), {
    message: 'hand target needs "curl" or { source: "reference", atSec }',
  });

const gateBase = {
  id: z.string().min(1).max(64),
  t: z.number().min(0),
  label: z.string().min(1).max(80),
  learning: z.boolean().optional(),
  tolerance: Tolerance.optional(),
  coachAfterSec: z.number().positive().optional(),
  timeoutSec: z.number().positive().optional(),
  fallbackTip: z.string().min(1).max(200),
  rewindTo: z.number().min(0).optional(),
  then: z.enum(['resume', 'loop_segment']).optional(),
};

/**
 * Extra pose conditions that joint angles cannot express from a front camera (InStep extension to v1.0).
 * Values are in torso lengths: heel_lift = mean(foot_index.y − heel.y); foot_lift = other_ankle.y − ankle.y.
 */
export const PoseCondition = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('heel_lift'), min: z.number() }),
  z.object({ kind: z.literal('foot_lift'), foot: z.enum(['left', 'right', 'either']), min: z.number() }),
]);

const poseMatchFields = {
  target: PoseTarget,
  joints: z.array(JointName).min(1),
  conditions: z.array(PoseCondition).optional(),
  minFrames: z.number().int().positive().optional(),
};

const handSignFields = {
  hand: HandSelector.default('any'),
  target: HandTarget,
  minFrames: z.number().int().positive().optional(),
};

export const PoseMatchGate = z.object({ ...gateBase, type: z.literal('pose_match'), ...poseMatchFields });

export const HoldDurationGate = z.object({
  ...gateBase,
  type: z.literal('hold_duration'),
  ...poseMatchFields,
  holdSec: z.number().positive().max(120),
  graceSec: z.number().min(0).max(5).optional(),
});

export const RepMetric = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('joint_angle'), joint: JointName }),
  z.object({ kind: z.literal('hand_openness'), hand: HandSelector.default('any') }),
  z.object({ kind: z.literal('wrist_rotation'), hand: HandSelector.default('any') }),
  z.object({ kind: z.literal('vertical_position'), landmark: SignalLandmark }),
  z.object({ kind: z.literal('heel_lift') }),
]);

export const RepCountGate = z.object({
  ...gateBase,
  type: z.literal('rep_count'),
  metric: RepMetric,
  range: z
    .object({ low: z.number(), high: z.number() })
    .refine((r) => r.low < r.high, { message: 'range.low must be less than range.high' }),
  reps: z.number().int().positive().max(500),
  paceFollow: z.object({ enabled: z.boolean(), teacherRepSec: z.number().positive() }).optional(),
});

export const RhythmBpmGate = z.object({
  ...gateBase,
  type: z.literal('rhythm_bpm'),
  signal: z.object({ landmark: SignalLandmark, axis: z.enum(['x', 'y']) }),
  bpm: z
    .object({ min: z.number().positive(), max: z.number().positive() })
    .refine((b) => b.min < b.max, { message: 'bpm.min must be less than bpm.max' }),
  count: z.number().int().positive().max(500),
  armsStraight: z.object({ minElbowDeg: z.number().min(90).max(180) }).optional(),
  metronomeBpm: z.number().positive().optional(),
});

export const HandSignGate = z.object({ ...gateBase, type: z.literal('hand_sign'), ...handSignFields });

export const SequenceStep = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hand_sign'),
    label: z.string().min(1),
    tolerance: Tolerance.optional(),
    ...handSignFields,
  }),
  z.object({
    type: z.literal('pose_match'),
    label: z.string().min(1),
    tolerance: Tolerance.optional(),
    ...poseMatchFields,
  }),
]);

export const SequenceOrderGate = z.object({
  ...gateBase,
  type: z.literal('sequence_order'),
  steps: z.array(SequenceStep).min(2).max(12),
  stepWindowSec: z.number().positive().optional(),
});

export const SafetyCheck = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('object_near'),
    object: z.string().min(1),
    near: z.enum(['hips', 'hands']).default('hips'),
    maxDistance: z.number().positive().max(1),
    minScore: z.number().min(0).max(1),
    allowAlternatives: z.boolean().optional(),
  }),
  z.object({ kind: z.literal('full_body_visible') }),
  z.object({ kind: z.literal('upper_body_visible') }),
  z.object({ kind: z.literal('hands_visible'), count: z.union([z.literal(1), z.literal(2)]).default(1) }),
  z.object({
    kind: z.literal('stable'),
    maxLateralSway: z.number().positive(),
    windowSec: z.number().positive(),
  }),
]);

export const SafetyPrerequisiteGate = z.object({
  ...gateBase,
  type: z.literal('safety_prerequisite'),
  learning: z.literal(false, { message: 'safety_prerequisite gates can never be learning gates' }).optional(),
  checks: z.array(SafetyCheck).min(1),
  minFrames: z.number().int().positive().optional(),
});

export const GATE_TYPES = [
  'pose_match',
  'hold_duration',
  'rep_count',
  'rhythm_bpm',
  'hand_sign',
  'sequence_order',
  'safety_prerequisite',
] as const;

export const Gate = z.discriminatedUnion('type', [
  PoseMatchGate,
  HoldDurationGate,
  RepCountGate,
  RhythmBpmGate,
  HandSignGate,
  SequenceOrderGate,
  SafetyPrerequisiteGate,
]);

export const SwayStop = z.object({
  enabled: z.boolean(),
  maxLateralSway: z.number().positive(),
  windowSec: z.number().positive(),
});

/** Channels whose disclaimer may never be empty (AGENTS.md §3). */
export const DISCLAIMER_REQUIRED: readonly string[] = [
  'fall_prevention',
  'stroke_rehab',
  'sign_language',
  'cpr',
];
export const CPR_DISCLAIMER_PHRASE = 'does not measure compression depth';

const handsNeeded = (g: z.infer<typeof Gate>): boolean =>
  g.type === 'hand_sign' ||
  (g.type === 'rep_count' && (g.metric.kind === 'hand_openness' || g.metric.kind === 'wrist_rotation')) ||
  (g.type === 'sequence_order' && g.steps.some((s) => s.type === 'hand_sign')) ||
  (g.type === 'safety_prerequisite' && g.checks.some((c) => c.kind === 'hands_visible'));

const objectsNeeded = (g: z.infer<typeof Gate>): boolean =>
  g.type === 'safety_prerequisite' && g.checks.some((c) => c.kind === 'object_near');

export const IstepTrack = z
  .looseObject({
    istep: z.literal('1.0'),
    id: z.string().min(1).max(80),
    title: z.string().min(1).max(120),
    channel: Channel,
    language: z.string().min(2).max(16),
    video: z.object({ src: z.string().min(1), durationSec: z.number().positive() }),
    tracking: z.array(Tracker).min(1),
    camera: z.object({ view: z.enum(['front', 'side', 'hands']), hint: z.string().min(1) }),
    disclaimer: z.string().optional(),
    reference: z.object({ src: z.string().min(1) }).optional(),
    safety: z.object({ swayStop: SwayStop.optional() }).optional(),
    defaults: z
      .object({
        tolerance: Tolerance.optional(),
        coachAfterSec: z.number().positive().optional(),
        timeoutSec: z.number().positive().optional(),
      })
      .optional(),
    gates: z.array(Gate),
    credits: z.object({ creator: z.string().min(1), license: z.string().min(1) }).optional(),
  })
  .superRefine((track, ctx) => {
    const seen = new Set<string>();
    track.gates.forEach((g, i) => {
      if (seen.has(g.id))
        ctx.addIssue({ code: 'custom', path: ['gates', i, 'id'], message: `duplicate gate id "${g.id}"` });
      seen.add(g.id);
      if (g.t > track.video.durationSec)
        ctx.addIssue({
          code: 'custom',
          path: ['gates', i, 't'],
          message: `t=${g.t} is after video end (${track.video.durationSec}s)`,
        });
      const prev = track.gates[i - 1];
      if (prev && g.t < prev.t)
        ctx.addIssue({
          code: 'custom',
          path: ['gates', i, 't'],
          message: `gates must be sorted by t (${g.t} < ${prev.t})`,
        });
      if (g.rewindTo !== undefined && g.rewindTo > g.t)
        ctx.addIssue({ code: 'custom', path: ['gates', i, 'rewindTo'], message: 'rewindTo must be ≤ t' });
      if (g.then === 'loop_segment' && g.rewindTo === undefined)
        ctx.addIssue({
          code: 'custom',
          path: ['gates', i, 'rewindTo'],
          message: 'loop_segment needs rewindTo',
        });
      if (handsNeeded(g) && !track.tracking.includes('hands'))
        ctx.addIssue({ code: 'custom', path: ['gates', i], message: 'gate needs "hands" in tracking' });
      if (objectsNeeded(g) && !track.tracking.includes('objects'))
        ctx.addIssue({ code: 'custom', path: ['gates', i], message: 'gate needs "objects" in tracking' });
    });
    if (DISCLAIMER_REQUIRED.includes(track.channel) && !track.disclaimer?.trim())
      ctx.addIssue({
        code: 'custom',
        path: ['disclaimer'],
        message: `channel "${track.channel}" requires a disclaimer`,
      });
    if (track.channel === 'cpr' && !track.disclaimer?.toLowerCase().includes(CPR_DISCLAIMER_PHRASE))
      ctx.addIssue({
        code: 'custom',
        path: ['disclaimer'],
        message: `cpr disclaimer must contain "${CPR_DISCLAIMER_PHRASE}"`,
      });
  });

/** Instructor landmark timeline produced by Creator Studio (docs/03 §4). */
const PosePoint = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const HandPoint = z.tuple([z.number(), z.number(), z.number()]);
export const ReferenceTimeline = z.object({
  fps: z.number().positive(),
  tracking: z.array(Tracker),
  frames: z.array(
    z.object({
      t: z.number().min(0),
      pose: z.array(PosePoint).length(33).nullable().optional(),
      hands: z
        .object({
          left: z.array(HandPoint).length(21).nullable().optional(),
          right: z.array(HandPoint).length(21).nullable().optional(),
        })
        .optional(),
    }),
  ),
});

export type IstepTrack = z.infer<typeof IstepTrack>;
export type Gate = z.infer<typeof Gate>;
export type GateType = Gate['type'];
export type SequenceStep = z.infer<typeof SequenceStep>;
export type SafetyCheck = z.infer<typeof SafetyCheck>;
export type Tolerance = z.infer<typeof Tolerance>;
export type PoseCondition = z.infer<typeof PoseCondition>;
export type JointName = z.infer<typeof JointName>;
export type Finger = (typeof FINGERS)[number];
export type HandSelector = z.infer<typeof HandSelector>;
export type RepMetric = z.infer<typeof RepMetric>;
export type SignalLandmark = z.infer<typeof SignalLandmark>;
export type SwayStop = z.infer<typeof SwayStop>;
export type Channel = z.infer<typeof Channel>;
export type ReferenceTimeline = z.infer<typeof ReferenceTimeline>;
