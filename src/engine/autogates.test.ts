import { Gate as GateSchema, IstepTrack, type ReferenceTimeline } from '../istep/index';
import { describe, expect, it } from 'vitest';
import { autoGates, dominantPeriod, stillMoments } from './autogates';
import { makeHand, makePose } from './fixtures';

const FPS = 15;
const lerp = (a: number, b: number, k: number) => a + (b - a) * Math.min(1, Math.max(0, k));

/** knee angle over time: still 175 → move → still 120 (4–6 s) → move → still 175 (7–9.5 s) → move → still 100 (10.5–13 s) */
function kneeAt(t: number) {
  if (t < 3) return 175;
  if (t < 4) return lerp(175, 120, t - 3);
  if (t < 6) return 120;
  if (t < 7) return lerp(120, 175, t - 6);
  if (t < 9.5) return 175;
  if (t < 10.5) return lerp(175, 100, t - 9.5);
  return 100;
}

const poseRef = (seconds = 13): ReferenceTimeline => ({
  fps: FPS,
  tracking: ['pose'],
  frames: Array.from({ length: seconds * FPS }, (_, i) => {
    const t = i / FPS;
    const k = kneeAt(t);
    return {
      t,
      pose: makePose({ l_knee: k, r_knee: k }).map(
        (p) => [p.x, p.y, p.z, p.v ?? 1] as [number, number, number, number],
      ),
    };
  }),
});

const handRef = (seconds: number, curlAt: (t: number) => number): ReferenceTimeline => ({
  fps: FPS,
  tracking: ['hands'],
  frames: Array.from({ length: seconds * FPS }, (_, i) => {
    const t = i / FPS;
    const c = curlAt(t);
    return {
      t,
      hands: {
        right: makeHand({ curl: [c, c, c, c, c] }).map((p) => [p.x, p.y, p.z] as [number, number, number]),
      },
    };
  }),
});

function validTrack(channel: string, gates: unknown[], durationSec: number) {
  const disclaimer =
    {
      fall_prevention:
        'Use exercises prescribed or approved by your physiotherapist. Stop if you feel pain, dizziness or unsteadiness.',
      cpr: 'Practice aid for rhythm and straight arms only. It does not measure compression depth and is not certification. Take a certified CPR course.',
    }[channel] ?? 'Practice aid.';
  return IstepTrack.safeParse({
    istep: '1.0',
    id: 'x',
    title: 'x',
    channel,
    language: 'en-US',
    video: { src: 'v.mp4', durationSec },
    tracking:
      channel === 'sign_language' || channel === 'stroke_rehab'
        ? ['hands']
        : channel === 'fall_prevention'
          ? ['pose', 'objects']
          : ['pose'],
    camera: { view: 'front', hint: 'x' },
    disclaimer,
    gates,
  });
}

describe('auto-gates', () => {
  it('finds still segments and merges/limits them', () => {
    const s = stillMoments(poseRef(), 'kids');
    // stills: 0–3 (mid 1.5), 4–6 (5), 7–9.5 (8.25), 10.5–13 (11.75)
    expect(s.length).toBe(4);
    expect(s[1]).toBeCloseTo(5, 0);
    expect(s[2]).toBeCloseTo(8.2, 0);
  });

  it('fall prevention: chair safety gate first, then holds at stills after it', () => {
    const g = autoGates({ reference: poseRef(), channel: 'fall_prevention', durationSec: 13 });
    expect(g[0]).toMatchObject({ type: 'safety_prerequisite', t: 2 });
    expect(g.slice(1).every((x) => x.type === 'hold_duration')).toBe(true);
    expect(g.length).toBeGreaterThanOrEqual(3); // ≥ 2 sensible gates besides safety (AC)
    expect(validTrack('fall_prevention', g, 13).success).toBe(true);
  });

  it('kids: pose gates that validate', () => {
    const g = autoGates({ reference: poseRef(), channel: 'kids', durationSec: 13 });
    expect(g.every((x) => x.type === 'pose_match')).toBe(true);
    expect(validTrack('kids', g, 13).success).toBe(true);
  });

  it('sign language: a hand_sign gate per held shape, curl target from the reference', () => {
    const ref = handRef(10, (t) => (t < 3 ? 0 : t < 4 ? t - 3 : t < 7 ? 1 : 0));
    const g = autoGates({ reference: ref, channel: 'sign_language', durationSec: 10 });
    expect(g.length).toBeGreaterThanOrEqual(2);
    expect(g.every((x) => x.type === 'hand_sign' && x.target.source === 'reference')).toBe(true);
    expect(validTrack('sign_language', g, 10).success).toBe(true);
  });

  it('rehab: one looping rep gate with pace-follow from the detected period', () => {
    const ref = handRef(12, (t) => 0.5 + 0.5 * Math.sin((2 * Math.PI * t) / 2)); // 2 s per rep
    const g = autoGates({ reference: ref, channel: 'stroke_rehab', durationSec: 12 });
    expect(g).toHaveLength(1);
    const r = g[0]!;
    expect(r.type).toBe('rep_count');
    if (r.type === 'rep_count') expect(r.paceFollow?.teacherRepSec).toBeCloseTo(2, 0);
    expect(validTrack('stroke_rehab', g, 12).success).toBe(true);
  });

  it('cpr: placement check then rhythm gate', () => {
    const g = autoGates({ reference: poseRef(), channel: 'cpr', durationSec: 13 });
    expect(g.map((x) => x.type)).toEqual(['safety_prerequisite', 'rhythm_bpm']);
    expect(validTrack('cpr', g, 13).success).toBe(true);
  });

  it('every generated gate passes the schema; times stay inside the video', () => {
    for (const channel of ['fall_prevention', 'kids', 'cpr'] as const)
      for (const g of autoGates({ reference: poseRef(), channel, durationSec: 6 })) {
        expect(GateSchema.safeParse(g).success).toBe(true);
        expect(g.t).toBeLessThanOrEqual(6);
      }
  });

  it('period detection', () => {
    const v = Array.from({ length: 150 }, (_, i) => Math.sin((2 * Math.PI * i) / 30));
    expect(dominantPeriod(v, 15)?.period).toBeCloseTo(2, 1);
    expect(dominantPeriod([1, 2], 15)).toBeNull();
  });
});
