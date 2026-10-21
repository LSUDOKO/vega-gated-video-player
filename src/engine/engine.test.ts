import { Gate as GateSchema, IstepTrack, type Gate } from '../istep/index';
import { describe, expect, it } from 'vitest';
import { chair, frame, makeHand, makePose, stream } from './fixtures';
import { angle, fingerCurls, jointAngle } from './geometry';
import { paceRate, PaceFollower } from './pace';
import { normalizeMirroring } from './preprocess';
import { createGateRunner } from './runner';
import { createSafetyMonitor } from './safetyMonitor';
import { errorBucket, nextTolerance, toleranceFactor } from './tolerance';
import type { GateEval, RunnerContext } from './types';

const gate = (g: unknown): Gate => GateSchema.parse(g);
const raw: RunnerContext = { smoothing: false };
const FPS = 30;
const dt = 1000 / FPS;

function run(g: Gate, frames: ReturnType<typeof frame>[], ctx: RunnerContext = raw): GateEval[] {
  const r = createGateRunner(g, ctx);
  return frames.map((f) => r.push(f));
}
const firstPass = (evals: GateEval[]) => evals.findIndex((e) => e.status === 'passed');

const base = { id: 'g', t: 1, label: 'x', fallbackTip: 'tip' };

describe('1. angle helper', () => {
  it.each([
    [{ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }, 90],
    [{ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, 180],
    [{ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }, 45],
  ])('angle %#', (a, b, c, deg) => expect(angle(a, b, c)).toBeCloseTo(deg, 0.5));
  it('uses z only when asked', () => {
    const a = { x: 1, y: 0, z: 0 };
    const b = { x: 0, y: 0, z: 0 };
    const c = { x: 0, y: 0, z: 1 };
    expect(angle(a, b, c)).toBe(0); // degenerate in 2D
    expect(angle(a, b, c, true)).toBeCloseTo(90, 1);
  });
  it('fixture joints round-trip', () => {
    const p = makePose({ l_knee: 140, r_elbow: 95, torso: 12 });
    expect(jointAngle(p, 'l_knee')).toBeCloseTo(140, 1);
    expect(jointAngle(p, 'r_elbow')).toBeCloseTo(95, 1);
    expect(jointAngle(p, 'torso')).toBeCloseTo(12, 1);
  });
});

describe('2. mirroring', () => {
  it('swaps left/right pose landmarks, hands and scores', () => {
    const pose = makePose({ l_knee: 120 });
    const left = makeHand({ curl: [1, 1, 1, 1, 1] });
    const f = normalizeMirroring(
      frame(0, { pose, mirrored: true, hands: { left, right: null }, handScores: { left: 0.9 } }),
    );
    expect(jointAngle(f.pose!, 'r_knee')).toBeCloseTo(120, 1);
    expect(jointAngle(f.pose!, 'l_knee')).toBeCloseTo(178, 1);
    expect(f.hands?.right).toBe(left);
    expect(f.hands?.left).toBeNull();
    expect(f.handScores?.right).toBe(0.9);
    expect(f.mirrored).toBe(false);
  });
  it('leaves unmirrored frames alone', () => {
    const f = frame(0, { pose: makePose() });
    expect(normalizeMirroring(f)).toBe(f);
  });
});

const kneeGate = gate({
  ...base,
  type: 'pose_match',
  target: { source: 'angles', angles: { l_knee: 120, r_knee: 120 } },
  joints: ['l_knee', 'r_knee'],
  tolerance: { angleDeg: 15 },
  minFrames: 8,
});

describe('3. pose_match', () => {
  it('passes after exactly minFrames matched frames', () => {
    const ev = run(
      kneeGate,
      stream(1, FPS, (ts) => frame(ts, { pose: makePose({ l_knee: 118, r_knee: 125 }) })),
    );
    expect(firstPass(ev)).toBe(7);
    expect(ev[6]!.status).toBe('progress');
    expect(ev[6]!.progress).toBeCloseTo(7 / 8);
  });
  it('resets the streak on a mismatch', () => {
    const good = (ts: number) => frame(ts, { pose: makePose({ l_knee: 120, r_knee: 120 }) });
    const bad = (ts: number) => frame(ts, { pose: makePose({ l_knee: 175, r_knee: 120 }) });
    const frames = [
      ...[0, 1, 2, 3, 4, 5].map((i) => good(i * dt)),
      bad(6 * dt),
      ...stream(1, FPS, good, 7 * dt),
    ];
    const ev = run(kneeGate, frames);
    expect(ev[6]!.status).toBe('waiting');
    expect(firstPass(ev)).toBe(7 + 7);
  });
  it('identifies the worst joint and the sign of its error', () => {
    const [e] = run(kneeGate, [frame(0, { pose: makePose({ l_knee: 175, r_knee: 128 }) })]);
    expect(e!.worst?.name).toBe('l_knee');
    expect(e!.worst?.hint).toBe('bend your left knee more');
    expect(e!.jointErrors?.l_knee).toBeCloseTo(55, 0);
    const [e2] = run(kneeGate, [frame(0, { pose: makePose({ l_knee: 120, r_knee: 90 }) })]);
    expect(e2!.worst).toEqual({ name: 'r_knee', hint: 'straighten your right knee' });
    expect(e2!.jointErrors?.r_knee).toBeLessThan(0);
  });
  it('reads targets from the reference timeline', () => {
    const ref = makePose({ l_knee: 100, r_knee: 100 }).map(
      (p) => [p.x, p.y, p.z, p.v ?? 1] as [number, number, number, number],
    );
    const g = gate({
      ...base,
      type: 'pose_match',
      target: { source: 'reference', atSec: 1 },
      joints: ['l_knee'],
      minFrames: 2,
    });
    const ctx: RunnerContext = {
      ...raw,
      reference: {
        fps: 15,
        tracking: ['pose'],
        frames: [
          { t: 0, pose: ref },
          { t: 2, pose: ref },
        ],
      },
    };
    const ev = run(
      g,
      stream(0.2, FPS, (ts) => frame(ts, { pose: makePose({ l_knee: 105 }) })),
      ctx,
    );
    expect(firstPass(ev)).toBe(1);
  });
  it('applies pose conditions (heel lift)', () => {
    const g = gate({
      ...base,
      type: 'pose_match',
      target: { source: 'angles', angles: { torso: 0 } },
      joints: ['torso'],
      conditions: [{ kind: 'heel_lift', min: 0.05 }],
      minFrames: 2,
    });
    const [flat] = run(g, [frame(0, { pose: makePose() })]);
    expect(flat!.status).toBe('waiting');
    expect(flat!.worst?.name).toBe('heel_lift');
    expect(
      firstPass(
        run(
          g,
          stream(0.2, FPS, (ts) => frame(ts, { pose: makePose({ heelLift: 0.07 }) })),
        ),
      ),
    ).toBe(1);
  });
  it('works through the One-Euro smoother', () => {
    const ev = run(
      kneeGate,
      stream(1, FPS, (ts) => frame(ts, { pose: makePose({ l_knee: 120, r_knee: 120 }) })),
      {},
    );
    expect(firstPass(ev)).toBe(7);
  });
});

const holdGate = gate({
  ...base,
  type: 'hold_duration',
  target: { source: 'angles', angles: { l_knee: 120 } },
  joints: ['l_knee'],
  tolerance: { angleDeg: 15 },
  holdSec: 3,
  graceSec: 0.4,
});
const holdOk = (ts: number) => frame(ts, { pose: makePose({ l_knee: 120 }) });
const holdBad = (ts: number) => frame(ts, { pose: makePose({ l_knee: 175 }) });

describe('4. hold_duration', () => {
  it('passes at exactly the hold time', () => {
    const frames = stream(4, 10, holdOk); // 100 ms steps
    const ev = run(holdGate, frames);
    expect(firstPass(ev)).toBe(30); // held 3000 ms at t = 3000
    expect(ev[29]!.holdSec).toBeCloseTo(2.9);
  });
  it('a wobble shorter than graceSec pauses the timer', () => {
    const frames = [
      ...stream(1, 10, holdOk), // 0..900: held 900
      ...stream(0.3, 10, holdBad, 1000), // 1000..1200 wobble (300 ms < 400 grace)
      ...stream(3, 10, holdOk, 1300),
    ];
    const ev = run(holdGate, frames);
    expect(ev[12]!.holdSec).toBeCloseTo(0.9); // paused, not reset
    expect(frames[firstPass(ev)]!.ts).toBe(1300 + 2100);
  });
  it('a wobble longer than graceSec resets the timer', () => {
    const frames = [
      ...stream(1, 10, holdOk),
      ...stream(0.6, 10, holdBad, 1000),
      ...stream(4, 10, holdOk, 1600),
    ];
    const ev = run(holdGate, frames);
    expect(ev[15]!.holdSec).toBe(0);
    expect(frames[firstPass(ev)]!.ts).toBe(1600 + 3000);
  });
});

const openness = (m: number) => {
  // curls that map monotonically to openness
  const c = 1 - m;
  return makeHand({ curl: [c, c, c, c, c] });
};
const repGate = (extra: object = {}) =>
  gate({
    ...base,
    type: 'rep_count',
    metric: { kind: 'hand_openness', hand: 'any' },
    range: { low: 0.25, high: 0.75 },
    reps: 3,
    ...extra,
  });

describe('5. rep_count', () => {
  const seq = (values: number[], stepMs = 100) =>
    values.map((v, i) => frame(i * stepMs, { hands: { right: openness(v) } }));
  it('counts only full-range reps and reports partials', () => {
    const r = createGateRunner(repGate(), raw);
    const vals = [0, 1, 0, 0.55, 0, 1, 0];
    let last: GateEval | undefined;
    for (const f of seq(vals)) last = r.push(f);
    expect(last!.reps).toBe(2);
    expect(last!.partialReps).toBe(1);
    expect(last!.worst?.hint).toBe('open your hand wider');
  });
  it('hysteresis: jitter around the high threshold does not double count', () => {
    const ev = run(repGate(), seq([0, 1, 0.7, 1, 0.7, 1, 0]));
    expect(ev.at(-1)!.reps).toBe(1);
  });
  it('passes at the target', () => {
    const ev = run(repGate(), seq([0, 1, 0, 1, 0, 1, 0]));
    expect(ev.at(-1)!.status).toBe('passed');
    expect(firstPass(ev)).toBe(6);
  });
  it('reports no_person when the hand disappears', () => {
    const [e] = run(repGate(), [frame(0, {})]);
    expect(e!.status).toBe('no_person');
  });
  it('pace-follow: rate selection thresholds', () => {
    expect(paceRate(2.0, 2)).toBe(1);
    expect(paceRate(2.5, 2)).toBe(1);
    expect(paceRate(3.4, 2)).toBe(0.75);
    expect(paceRate(5, 2)).toBe(0.5);
  });
  it('pace-follow: changes at most once per 3 s', () => {
    const p = new PaceFollower(2);
    expect(p.update(5, 0)).toBe(0.5);
    expect(p.update(2, 1000)).toBe(0.5); // too soon
    expect(p.update(2, 3100)).toBe(1);
    expect(p.update(undefined, 9000)).toBe(1);
  });
  it('pace-follow: slow learner gets a slower video', () => {
    const g = repGate({ reps: 10, paceFollow: { enabled: true, teacherRepSec: 1 } });
    const ev = run(g, seq([0, 0.5, 1, 0.5, 0, 0.5, 1, 0.5, 0, 0.5, 1, 0.5, 0, 0.5, 1, 0.5, 0], 500)); // 2 s per rep
    expect(ev.at(-1)!.playbackRate).toBe(0.5);
  });
  it('heel_lift metric counts heel raises', () => {
    const g = gate({
      ...base,
      type: 'rep_count',
      metric: { kind: 'heel_lift' },
      range: { low: 0.02, high: 0.06 },
      reps: 2,
    });
    const hs = [0, 0.08, 0, 0.08, 0];
    const ev = run(
      g,
      hs.map((h, i) => frame(i * 300, { pose: makePose({ heelLift: h }) })),
    );
    expect(ev.at(-1)!.status).toBe('passed');
  });
  it('joint_angle, vertical_position and wrist_rotation metrics read values', () => {
    const ja = gate({
      ...base,
      type: 'rep_count',
      metric: { kind: 'joint_angle', joint: 'r_elbow' },
      range: { low: 100, high: 160 },
      reps: 1,
    });
    expect(
      run(
        ja,
        [90, 170, 90].map((a, i) => frame(i * 300, { pose: makePose({ r_elbow: a }) })),
      ).at(-1)!.status,
    ).toBe('passed');
    const vp = gate({
      ...base,
      type: 'rep_count',
      metric: { kind: 'vertical_position', landmark: 'r_wrist' },
      range: { low: 0, high: 1.5 },
      reps: 1,
    });
    expect(
      run(
        vp,
        [10, 175, 10].map((a, i) => frame(i * 300, { pose: makePose({ r_shoulder: a, r_elbow: 178 }) })),
      ).at(-1)!.status,
    ).toBe('passed');
    const wr = gate({
      ...base,
      type: 'rep_count',
      metric: { kind: 'wrist_rotation', hand: 'right' },
      range: { low: 0.4, high: 0.9 },
      reps: 1,
    });
    expect(
      run(
        wr,
        [80, 0, 80].map((d, i) => frame(i * 300, { hands: { right: makeHand({ turnDeg: d }) } })),
      ).at(-1)!.status,
    ).toBe('passed');
  });
});

const cprGate = gate({
  ...base,
  type: 'rhythm_bpm',
  signal: { landmark: 'wrists_mid', axis: 'y' },
  bpm: { min: 100, max: 120 },
  count: 10,
  armsStraight: { minElbowDeg: 160 },
});
const compressions = (bpm: number, seconds: number, elbow = 175) =>
  stream(seconds, FPS, (ts) =>
    frame(ts, {
      pose: makePose({
        l_shoulder: 70,
        r_shoulder: 70,
        l_elbow: elbow,
        r_elbow: elbow,
        wristsDy: 0.025 * Math.sin((2 * Math.PI * bpm * ts) / 60000),
      }),
    }),
  );

describe('6. rhythm_bpm', () => {
  it('110 bpm sine → bpm 110 ± 3 and counts compressions', () => {
    const ev = run(cprGate, compressions(110, 4), {});
    const withBpm = ev.filter((e) => e.bpm !== undefined);
    expect(withBpm.at(-1)!.bpm).toBeGreaterThanOrEqual(107);
    expect(withBpm.at(-1)!.bpm).toBeLessThanOrEqual(113);
    expect(ev.at(-1)!.reps).toBeGreaterThanOrEqual(5);
  });
  it('passes after `count` good compressions', () => {
    const ev = run(cprGate, compressions(110, 8), {});
    expect(firstPass(ev)).toBeGreaterThan(0);
  });
  it('80 bpm is not counted and asks to go faster', () => {
    const ev = run(cprGate, compressions(80, 6), {});
    expect(ev.at(-1)!.reps).toBe(0);
    expect(ev.filter((e) => e.worst?.hint === 'push a little faster').length).toBeGreaterThan(0);
  });
  it('bent elbows are not counted', () => {
    const ev = run(cprGate, compressions(110, 6, 120), {});
    expect(ev.at(-1)!.reps).toBe(0);
    expect(ev.at(-1)!.worst?.hint).toBe('lock your elbows straight');
  });
  it('no arms visible → no_person', () => {
    const [e] = run(cprGate, [frame(0, { pose: makePose({ hidden: [11, 12, 13, 14, 15, 16] }) })]);
    expect(e!.status).toBe('no_person');
  });
});

const ily = gate({
  ...base,
  type: 'hand_sign',
  hand: 'any',
  target: { curl: [0, 0, 1, 1, 0], spread: { thumb_index: 'open' } },
  minFrames: 10,
});

describe('7. hand_sign', () => {
  it('I love you passes after minFrames', () => {
    const ev = run(
      ily,
      stream(1, FPS, (ts) =>
        frame(ts, { hands: { right: makeHand({ curl: [0.05, 0.1, 0.95, 0.9, 0.05] }) } }),
      ),
    );
    expect(firstPass(ev)).toBe(9);
  });
  it('middle finger extended → fingerErrors = middle, hint curl', () => {
    const [e] = run(ily, [frame(0, { hands: { right: makeHand({ curl: [0, 0, 0, 1, 0] }) } })]);
    expect(e!.fingerErrors).toEqual([{ finger: 'middle', delta: -1, hint: 'curl' }]);
    expect(e!.worst).toEqual({ name: 'middle', hint: 'curl your middle finger down' });
    expect(errorBucket(e!)).toBe('middle:curl');
  });
  it('a curled finger that should be up → extend', () => {
    const [e] = run(ily, [frame(0, { hands: { left: makeHand({ curl: [0, 0, 1, 1, 1] }) } })]);
    expect(e!.fingerErrors?.[0]).toMatchObject({ finger: 'pinky', hint: 'extend' });
  });
  it('picks the hand with the higher score for hand:any', () => {
    const f = frame(0, {
      hands: { left: makeHand({ curl: [0, 0, 1, 1, 0] }), right: makeHand({ curl: [1, 1, 1, 1, 1] }) },
      handScores: { left: 0.95, right: 0.6 },
    });
    expect(run(ily, [f])[0]!.fingerErrors).toEqual([]);
  });
  it('closed spread target fails when thumb and index are apart', () => {
    const g = gate({
      ...base,
      type: 'hand_sign',
      target: { curl: [0, 0, 0, 0, 0], spread: { thumb_index: 'closed' } },
    });
    const [e] = run(g, [frame(0, { hands: { right: makeHand() } })]);
    expect(e!.fingerErrors?.[0]).toMatchObject({ finger: 'thumb', hint: 'curl' });
  });
  it('respects a fixed hand and the affected hand', () => {
    const g = gate({ ...base, type: 'hand_sign', hand: 'affected', target: { curl: [0, 0, 1, 1, 0] } });
    const f = frame(0, { hands: { right: makeHand({ curl: [0, 0, 1, 1, 0] }) } });
    expect(run(g, [f], { ...raw, affectedHand: 'left' })[0]!.status).toBe('no_person');
    expect(run(g, [f], { ...raw, affectedHand: 'right' })[0]!.status).toBe('progress');
  });
  it('reads curl targets from the reference', () => {
    const h = makeHand({ curl: [0, 0, 1, 1, 0] }).map((p) => [p.x, p.y, p.z] as [number, number, number]);
    const g = gate({ ...base, type: 'hand_sign', target: { source: 'reference', atSec: 0 }, minFrames: 1 });
    const ctx: RunnerContext = {
      ...raw,
      reference: { fps: 15, tracking: ['hands'], frames: [{ t: 0, hands: { right: h } }] },
    };
    expect(
      run(g, [frame(0, { hands: { right: makeHand({ curl: [0, 0, 1, 1, 0] }) } })], ctx)[0]!.status,
    ).toBe('passed');
  });
  it('curl helper matches the fixture', () => {
    expect(
      fingerCurls(makeHand({ curl: [0.5, 0.2, 0.4, 0.6, 0.8] })).map((c) => Math.round(c * 10) / 10),
    ).toEqual([0.5, 0.2, 0.4, 0.6, 0.8]);
  });
});

const C: [number, number, number, number, number] = [0.3, 0.5, 0.5, 0.5, 0.5];
const A: [number, number, number, number, number] = [0.2, 1, 1, 1, 1];
const B: [number, number, number, number, number] = [0.8, 0, 0, 0, 0];
const cab = gate({
  ...base,
  type: 'sequence_order',
  steps: [
    { type: 'hand_sign', label: 'C', target: { curl: C }, minFrames: 3 },
    { type: 'hand_sign', label: 'A', target: { curl: A }, minFrames: 3 },
    { type: 'hand_sign', label: 'B', target: { curl: B }, minFrames: 3 },
  ],
});
const sign = (curl: [number, number, number, number, number]) => (ts: number) =>
  frame(ts, { hands: { right: makeHand({ curl }) } });

describe('8. sequence_order', () => {
  it('passes when steps are done in order', () => {
    const frames = [
      ...stream(0.2, FPS, sign(C)),
      ...stream(0.2, FPS, sign(A), 200),
      ...stream(0.2, FPS, sign(B), 400),
    ];
    const ev = run(cab, frames);
    expect(ev.at(-1)!.status).toBe('passed');
    expect(ev.find((e) => e.step === 1)?.message).toBe('Now: A');
  });
  it('out-of-order shapes do not advance', () => {
    const frames = [...stream(0.3, FPS, sign(B)), ...stream(0.3, FPS, sign(A), 300)];
    const ev = run(cab, frames);
    expect(ev.every((e) => (e.step ?? 0) === 0)).toBe(true);
    expect(ev.at(-1)!.status).toBe('waiting');
  });
  it('mentions taking time after the step window', () => {
    const ev = run(cab, stream(7, 5, sign(B)));
    expect(ev.at(-1)!.message).toMatch(/Take your time/);
  });
});

const chairGate = gate({
  ...base,
  type: 'safety_prerequisite',
  checks: [
    { kind: 'object_near', object: 'chair', near: 'hips', maxDistance: 0.35, minScore: 0.5 },
    { kind: 'full_body_visible' },
    { kind: 'stable', maxLateralSway: 0.04, windowSec: 1.0 },
  ],
  minFrames: 15,
});

describe('9. safety_prerequisite', () => {
  it('no chair → blocked_safety with a message', () => {
    const ev = run(
      chairGate,
      stream(2, FPS, (ts) => frame(ts, { pose: makePose(), objects: [] })),
    );
    expect(ev.at(-1)!.status).toBe('blocked_safety');
    expect(ev.at(-1)!.message).toBe("I can't see a chair next to you");
    expect(ev.at(-1)!.checks?.find((c) => c.kind === 'object_near')?.ok).toBe(false);
  });
  it('chair far away → blocked', () => {
    const ev = run(
      chairGate,
      stream(2, FPS, (ts) => frame(ts, { pose: makePose(), objects: [chair(0.6)] })),
    );
    expect(ev.at(-1)!.status).toBe('blocked_safety');
  });
  it('low-confidence chair → blocked', () => {
    const ev = run(
      chairGate,
      stream(2, FPS, (ts) => frame(ts, { pose: makePose(), objects: [chair(0.12, 0.3)] })),
    );
    expect(ev.at(-1)!.status).toBe('blocked_safety');
  });
  it('chair near + stable + full body → pass', () => {
    const ev = run(
      chairGate,
      stream(2, FPS, (ts) => frame(ts, { pose: makePose(), objects: [chair()] })),
    );
    expect(ev.at(-1)!.status).toBe('passed');
  });
  it('a far chair that overlaps the hand counts', () => {
    const pose = makePose({ l_shoulder: 60 });
    const w = pose[15]!;
    const obj = {
      label: 'chair',
      score: 0.9,
      box: [w.x - 0.05, w.y - 0.05, 0.3, 0.3] as [number, number, number, number],
    };
    const ev = run(
      chairGate,
      stream(2, FPS, (ts) => frame(ts, { pose, objects: [obj] })),
    );
    expect(ev.at(-1)!.status).toBe('passed');
  });
  it('swaying blocks the stable check', () => {
    const ev = run(
      chairGate,
      stream(2, FPS, (ts) =>
        frame(ts, { pose: makePose({ dx: 0.03 * Math.sin(ts / 100) }), objects: [chair()] }),
      ),
    );
    expect(ev.at(-1)!.status).toBe('blocked_safety');
    expect(ev.at(-1)!.message).toBe('Stand still for a moment');
  });
  it('feet out of frame fails full_body_visible', () => {
    const ev = run(chairGate, [frame(0, { pose: makePose({ hidden: [27, 28] }), objects: [chair()] })]);
    expect(ev[0]!.checks?.find((c) => c.kind === 'full_body_visible')?.ok).toBe(false);
  });
  it('upper_body_visible and hands_visible checks', () => {
    const g = gate({
      ...base,
      type: 'safety_prerequisite',
      checks: [{ kind: 'upper_body_visible' }, { kind: 'hands_visible', count: 2 }],
      minFrames: 1,
    });
    expect(
      run(g, [frame(0, { pose: makePose(), hands: { left: makeHand(), right: makeHand() } })])[0]!.status,
    ).toBe('passed');
    expect(run(g, [frame(0, { pose: makePose(), hands: { left: makeHand() } })])[0]!.message).toBe(
      'Show both hands to the camera',
    );
  });
  it('no pose → no_person', () => {
    expect(run(chairGate, [frame(0, {})])[0]!.status).toBe('no_person');
  });
  it('learning can never be true (schema)', () => {
    expect(
      GateSchema.safeParse({
        ...base,
        type: 'safety_prerequisite',
        learning: true,
        checks: [{ kind: 'full_body_visible' }],
      }).success,
    ).toBe(false);
  });
  it('ignores adaptive tolerance passed in the context', () => {
    const r = createGateRunner(chairGate, { ...raw, tolerance: { angleDeg: 90 } });
    expect(r.push(frame(0, { pose: makePose(), objects: [] })).status).toBe('blocked_safety');
  });
});

describe('10. sway stop monitor', () => {
  const cfg = { enabled: true, maxLateralSway: 0.06, windowSec: 1.5 };
  it('triggers on oscillation above the limit', () => {
    const m = createSafetyMonitor(cfg);
    const out = stream(2, FPS, (ts) => frame(ts, { pose: makePose({ dx: 0.04 * Math.sin(ts / 120) }) })).map(
      (f) => m.push(f),
    );
    expect(out.some((o) => o.stop && o.reason === 'sway')).toBe(true);
    expect(m.isStableForResume()).toBe(false);
  });
  it('does not trigger on small natural sway', () => {
    const m = createSafetyMonitor(cfg);
    const out = stream(4, FPS, (ts) => frame(ts, { pose: makePose({ dx: 0.004 * Math.sin(ts / 300) }) })).map(
      (f) => m.push(f),
    );
    expect(out.some((o) => o.stop)).toBe(false);
    expect(m.isStableForResume()).toBe(true);
  });
  it('is inert when disabled or without a pose', () => {
    const m = createSafetyMonitor({ ...cfg, enabled: false });
    expect(m.push(frame(0, { pose: makePose({ dx: 0.3 }) })).stop).toBe(false);
    const m2 = createSafetyMonitor(cfg);
    expect(m2.push(frame(0, {})).stop).toBe(false);
    m2.reset();
  });
});

describe('11. adaptive tolerance', () => {
  const tol = { angleDeg: 20, curl: 0.3 };
  it('loosens up to +30% with failed attempts', () => {
    expect(nextTolerance(tol, { failedAttempts: 1, recentPasses: 0 }, true)).toEqual({
      angleDeg: 22,
      curl: 0.33,
    });
    expect(nextTolerance(tol, { failedAttempts: 10, recentPasses: 0 }, true).angleDeg).toBe(26);
  });
  it('tightens up to −15% with recent passes and clamps', () => {
    expect(toleranceFactor({ failedAttempts: 0, recentPasses: 9 })).toBe(0.85);
    expect(toleranceFactor({ failedAttempts: 9, recentPasses: 0 })).toBe(1.3);
    expect(toleranceFactor({ failedAttempts: 2, recentPasses: 2 })).toBeCloseTo(1.1);
  });
  it('never applies when learning=false', () => {
    expect(nextTolerance(tol, { failedAttempts: 10, recentPasses: 0 }, false)).toBe(tol);
  });
  it('error buckets are stable', () => {
    expect(
      errorBucket({
        status: 'waiting',
        progress: 0,
        score: 0,
        jointErrors: { l_knee: -14 },
        worst: { name: 'l_knee', hint: 'x' },
      }),
    ).toBe('l_knee:-20..-10');
    expect(
      errorBucket({
        status: 'waiting',
        progress: 0,
        score: 0,
        worst: { name: 'tempo', hint: 'push a little faster' },
      }),
    ).toBe('tempo:push a little faster');
    expect(errorBucket({ status: 'no_person', progress: 0, score: 0, message: 'Step into view' })).toBe(
      'msg:Step into view',
    );
    expect(errorBucket({ status: 'waiting', progress: 0, score: 0 })).toBe('waiting');
  });
});

describe('12. no_person freezes timers without resetting', () => {
  it('hold timer', () => {
    const frames = [
      ...stream(1, 10, holdOk),
      ...stream(2, 10, (ts) => frame(ts, {}), 1000),
      ...stream(3, 10, holdOk, 3000),
    ];
    const ev = run(holdGate, frames);
    expect(ev[15]!.status).toBe('no_person');
    expect(ev[15]!.holdSec).toBeCloseTo(0.9);
    expect(frames[firstPass(ev)]!.ts).toBe(3000 + 2100);
  });
  it('pose_match streak', () => {
    const good = (ts: number) => frame(ts, { pose: makePose({ l_knee: 120, r_knee: 120 }) });
    const frames = [
      ...stream(0.2, FPS, good),
      frame(300, {}),
      frame(330, { pose: makePose({ hidden: [25, 26, 27, 28, 23, 24] }) }),
      ...stream(0.2, FPS, good, 400),
    ];
    const ev = run(kneeGate, frames);
    expect(ev[6]!.status).toBe('no_person');
    expect(firstPass(ev)).toBe(6 + 2 + 1); // 6 matched, 2 no_person (frozen), 2 more matched
  });
});

describe('13. performance', () => {
  it('evaluates 10,000 frames in < 2 s', () => {
    const r = createGateRunner(holdGate);
    const poses = [makePose({ l_knee: 120 }), makePose({ l_knee: 150 })];
    const t0 = performance.now();
    for (let i = 0; i < 10_000; i++) r.push(frame(i * dt, { pose: poses[i % 2] }));
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

describe('runner and example tracks', () => {
  it('every gate in every example track builds a runner', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const dir = new URL('../../examples/', import.meta.url);
    for (const f of readdirSync(dir)) {
      const track = IstepTrack.parse(JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
      for (const g of track.gates) {
        const r = createGateRunner(g);
        expect(r.push(frame(0, { pose: makePose(), hands: { right: makeHand() } })).status).toBeTypeOf(
          'string',
        );
        r.reset();
        expect(r.state).toBeDefined();
        expect(r.gate).toBe(g);
      }
    }
  });
});
