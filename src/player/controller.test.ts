import { chair, frame, makeHand, makePose } from '../engine/fixtures';
import type { Frame } from '../engine/index';
import { IstepTrack } from '../istep/index';
import { describe, expect, it } from 'vitest';
import { createGatedPlayer, type PlayerEvent } from './controller';

const FALL =
  'Use exercises prescribed or approved by your physiotherapist. Stop if you feel pain, dizziness or unsteadiness.';

function makeTrack(gates: unknown[], extra: object = {}) {
  return IstepTrack.parse({
    istep: '1.0',
    id: 't',
    title: 'Test',
    channel: 'kids',
    language: 'en-US',
    video: { src: 'v.mp4', durationSec: 20 },
    tracking: ['pose', 'hands', 'objects'],
    camera: { view: 'front', hint: 'x' },
    defaults: { coachAfterSec: 6, timeoutSec: 10 },
    gates,
    ...extra,
  });
}

const kneeGate = {
  id: 'knee',
  t: 2,
  type: 'pose_match',
  label: 'Bend your knees',
  target: { source: 'angles', angles: { l_knee: 120, r_knee: 120 } },
  joints: ['l_knee', 'r_knee'],
  tolerance: { angleDeg: 15 },
  minFrames: 5,
  fallbackTip: 'Bend your knees.',
};

/** Simulated world: a fake player + clock; frames are generated per participant every 33 ms. */
function world(
  track: ReturnType<typeof makeTrack>,
  opts: { recentPasses?: Record<string, number>; rateSupported?: boolean } = {},
) {
  let clock = 1_000_000;
  const media = {
    t: 0,
    playing: false,
    rate: 1,
    muted: false,
    seeks: [] as number[],
    play() {
      this.playing = true;
    },
    pause() {
      this.playing = false;
    },
    seek(x: number) {
      this.t = x;
      this.seeks.push(x);
    },
    currentTime(): number {
      return this.t;
    },
    setRate(r: number) {
      if (opts.rateSupported === false) return false;
      this.rate = r;
      return true;
    },
    setMuted(m: boolean) {
      this.muted = m;
    },
  };
  const events: PlayerEvent[] = [];
  const player = createGatedPlayer({
    track,
    media,
    now: () => clock,
    onEvent: (e) => events.push(e),
    ...(opts.recentPasses ? { recentPasses: opts.recentPasses } : {}),
  });
  const run = (ms: number, frames: Record<string, ((ts: number) => Frame) | null>) => {
    for (let i = 0; i < ms / 33; i++) {
      clock += 33;
      if (media.playing) media.t += 0.033 * media.rate;
      for (const [peer, f] of Object.entries(frames)) if (f) player.pushFrame(peer, f(clock));
      player.tick();
    }
  };
  return { player, media, events, run, types: () => events.map((e) => e.type) };
}

const standing = (ts: number) => frame(ts, { pose: makePose() });
const bent = (ts: number) => frame(ts, { pose: makePose({ l_knee: 120, r_knee: 120 }) });

describe('gate timing', () => {
  it('pauses exactly at the gate and resumes only after the gate passes', () => {
    const w = world(makeTrack([kneeGate]));
    w.player.join({ peerId: 'h', role: 'host' });
    w.player.start();
    w.run(2500, { h: standing });
    expect(w.player.snapshot().phase).toBe('gate');
    expect(w.media.playing).toBe(false);
    expect(w.media.t).toBe(2); // landed exactly on gate.t
    expect(w.types()).toEqual(['gate_start']);
    w.run(3000, { h: standing }); // still wrong → still waiting
    expect(w.player.snapshot().phase).toBe('gate');
    w.run(800, { h: bent }); // One-Euro smoothing settles within ~0.5 s
    expect(w.types()).toContain('gate_passed');
    w.run(500, { h: bent });
    expect(w.player.snapshot().phase).toBe('playing');
    expect(w.media.playing).toBe(true);
  });

  it('play/pause never bypasses a gate', () => {
    const w = world(makeTrack([kneeGate]));
    w.player.join({ peerId: 'h', role: 'host' });
    w.player.start();
    w.run(2500, { h: standing });
    w.player.control('toggle_pause');
    expect(w.player.snapshot().phase).toBe('paused');
    w.player.control('play');
    expect(w.player.snapshot().phase).toBe('gate');
    expect(w.media.playing).toBe(false);
  });

  it('plays to the end and emits a summary', () => {
    const w = world(makeTrack([kneeGate]));
    w.player.join({ peerId: 'h', role: 'host' });
    w.player.start();
    w.run(2500, { h: bent });
    w.run(20_000, { h: bent });
    const ended = w.events.find((e) => e.type === 'ended');
    expect(ended && ended.type === 'ended' && ended.summary).toMatchObject({
      gatesPassed: 1,
      gatesTotal: 1,
      swayStops: 0,
    });
    expect(w.player.snapshot().phase).toBe('ended');
  });
});

describe('camera lost', () => {
  it('pauses within 2 s of no frames and resumes after a 3-2-1 countdown', () => {
    const w = world(makeTrack([kneeGate]));
    w.player.join({ peerId: 'h', role: 'host' });
    w.player.start();
    w.run(500, { h: standing });
    w.run(2100, { h: null });
    expect(w.player.snapshot().phase).toBe('camera_lost');
    expect(w.media.playing).toBe(false);
    w.run(1000, { h: standing });
    expect(w.player.snapshot().countdownMs).toBeGreaterThan(0);
    expect(w.player.snapshot().phase).toBe('camera_lost');
    w.run(2200, { h: standing });
    expect(w.player.snapshot().phase).not.toBe('camera_lost');
    expect(w.types()).toEqual(expect.arrayContaining(['camera_lost', 'resumed']));
    // video reached the gate (t = 2) during the 2 s without frames, so we return to the gate, still paused
    expect(w.player.snapshot().phase).toBe('gate');
    expect(w.media.playing).toBe(false);
  });
});

describe('sway stop', () => {
  const track = makeTrack([kneeGate], {
    safety: { swayStop: { enabled: true, maxLateralSway: 0.06, windowSec: 1.5 } },
  });
  const sway = (ts: number) => frame(ts, { pose: makePose({ dx: 0.04 * Math.sin(ts / 120) }) });
  it('pauses on deliberate sway; resumes only with OK after 2 s of stability', () => {
    const w = world(track);
    w.player.join({ peerId: 'h', role: 'host' });
    w.player.start();
    w.run(300, { h: standing });
    w.run(1500, { h: sway });
    expect(w.player.snapshot().phase).toBe('safety_stop');
    expect(w.media.playing).toBe(false);
    w.player.control('ok'); // not yet stable
    expect(w.player.snapshot().phase).toBe('safety_stop');
    w.player.control('play'); // play cannot resume a safety stop
    expect(w.player.snapshot().phase).toBe('safety_stop');
    w.run(3600, { h: standing });
    expect(w.player.snapshot().stableForResume).toBe(true);
    w.player.control('ok');
    expect(w.player.snapshot().phase).toBe('playing');
    expect(w.player.end().swayStops).toBe(1);
  });
  it('normal standing does not trigger it', () => {
    const w = world(track);
    w.player.join({ peerId: 'h', role: 'host' });
    w.player.start();
    w.run(1800, { h: (ts) => frame(ts, { pose: makePose({ dx: 0.004 * Math.sin(ts / 300) }) }) });
    expect(w.types()).not.toContain('safety_stop');
  });
});

describe('skip, repeat, coach and adaptive tolerance', () => {
  it('skip is only possible after timeoutSec, and never on safety gates', () => {
    const safety = {
      id: 'chair',
      t: 1,
      type: 'safety_prerequisite',
      label: 'Chair',
      minFrames: 3,
      fallbackTip: 'Chair.',
      checks: [{ kind: 'object_near', object: 'chair', near: 'hips', maxDistance: 0.35, minScore: 0.5 }],
    };
    const w = world(
      makeTrack([safety, { ...kneeGate, t: 4 }], { channel: 'fall_prevention', disclaimer: FALL }),
    );
    w.player.join({ peerId: 'h', role: 'host' });
    w.player.start();
    w.run(1500, { h: standing });
    w.run(12_000, { h: standing });
    expect(w.player.snapshot()).toMatchObject({ phase: 'gate', canSkip: false });
    w.player.control('next');
    expect(w.player.snapshot().gate?.id).toBe('chair');
    w.player.control('easier'); // safety gates never get easier
    expect(w.player.snapshot().easier).toBe(false);
    w.run(500, { h: (ts) => frame(ts, { pose: makePose(), objects: [chair()] }) });
    w.run(3000, { h: standing });
    expect(w.player.snapshot().gate?.id).toBe('knee');
    w.run(5000, { h: standing });
    expect(w.player.snapshot().canSkip).toBe(false);
    w.run(6000, { h: standing });
    expect(w.player.snapshot().canSkip).toBe(true);
    w.player.control('next');
    expect(w.types()).toContain('gate_skipped');
    const s = w.player.end();
    expect(s.attempts.map((a) => [a.gateId, a.passed])).toEqual([
      ['chair', true],
      ['knee', false],
    ]);
  });

  it('emits gate_stuck after coachAfterSec and loosens learning-gate tolerance', () => {
    const w = world(makeTrack([kneeGate]));
    w.player.join({ peerId: 'h', role: 'host' });
    w.player.start();
    w.run(2500, { h: standing });
    expect(w.player.snapshot().easier).toBe(false);
    w.run(6500, { h: standing });
    const stuck = w.events.find((e) => e.type === 'gate_stuck');
    expect(stuck && stuck.type === 'gate_stuck' && stuck.attempts).toBe(1);
    expect(w.player.snapshot().easier).toBe(true);
    // 120° ± 15° fails at 137°, but passes once tolerance is 16.5°
    w.run(1200, { h: (ts) => frame(ts, { pose: makePose({ l_knee: 136, r_knee: 136 }) }) });
    expect(w.types()).toContain('gate_passed');
    const s = w.player.end();
    expect(s).toMatchObject({ coachTips: 1, easierMode: true });
    expect(s.attempts[0]).toMatchObject({ coached: true, passed: true });
  });

  it('repeat rewinds to rewindTo and the gate triggers again', () => {
    const w = world(makeTrack([{ ...kneeGate, rewindTo: 0.5 }]));
    w.player.join({ peerId: 'h', role: 'host' });
    w.player.start();
    w.run(2500, { h: standing });
    w.player.control('repeat');
    expect(w.media.t).toBe(0.5);
    expect(w.player.snapshot().phase).toBe('playing');
    w.run(2000, { h: standing });
    expect(w.types().filter((t) => t === 'gate_start')).toHaveLength(2);
  });
});

describe('loop segment and pace-follow', () => {
  const rep = {
    id: 'reps',
    t: 6,
    type: 'rep_count',
    label: 'Open and close',
    rewindTo: 4,
    then: 'loop_segment',
    metric: { kind: 'hand_openness', hand: 'any' },
    range: { low: 0.25, high: 0.75 },
    reps: 3,
    paceFollow: { enabled: true, teacherRepSec: 1 },
    fallbackTip: 'Open and close.',
  };
  const hand = (open: boolean) => (ts: number) =>
    frame(ts, { hands: { right: makeHand({ curl: open ? [0, 0, 0, 0, 0] : [1, 1, 1, 1, 1] }) } });

  it('loops [rewindTo, t] muted after the first loop while waiting', () => {
    const w = world(makeTrack([rep], { tracking: ['hands'] }));
    w.player.join({ peerId: 'h', role: 'host' });
    w.player.start();
    w.run(6200, { h: hand(false) });
    expect(w.player.snapshot().phase).toBe('gate');
    expect(w.media.playing).toBe(true);
    w.run(2200, { h: hand(false) });
    expect(w.media.seeks.filter((s) => s === 4).length).toBeGreaterThanOrEqual(2);
    expect(w.media.muted).toBe(true);
    expect(w.media.t).toBeLessThan(6 + 0.1);
  });

  it('slows the video for a slow learner and restores 1× after the gate', () => {
    const w = world(makeTrack([rep], { tracking: ['hands'] }));
    w.player.join({ peerId: 'h', role: 'host' });
    w.player.start();
    w.run(6200, { h: hand(false) });
    for (let i = 0; i < 3; i++) {
      w.run(1500, { h: hand(true) });
      w.run(1500, { h: hand(false) });
    }
    expect(w.events.some((e) => e.type === 'gate_passed')).toBe(true);
    expect(w.media.rate).toBe(1);
    expect(w.player.end().reps).toBe(3);
  });

  it('keeps 1× when the platform cannot change rate', () => {
    const w = world(makeTrack([rep], { tracking: ['hands'] }), { rateSupported: false });
    w.player.join({ peerId: 'h', role: 'host' });
    w.player.start();
    w.run(6200, { h: hand(false) });
    w.run(4000, { h: hand(true) });
    expect(w.player.snapshot().playbackRate).toBe(1);
  });
});

describe('Together mode', () => {
  const ily = {
    id: 'ily',
    t: 1,
    type: 'hand_sign',
    label: 'ILY',
    target: { curl: [0, 0, 1, 1, 0] },
    minFrames: 3,
    fallbackTip: 'ILY.',
  };
  const sign = (ok: boolean) => (ts: number) =>
    frame(ts, { hands: { right: makeHand({ curl: ok ? [0, 0, 1, 1, 0] : [0, 0, 0, 0, 0] }) } });
  const track = makeTrack([ily], { tracking: ['hands'] });

  it('waits for both people', () => {
    const w = world(track);
    w.player.join({ peerId: 'h', role: 'host' });
    w.player.join({ peerId: 'g', role: 'guest', name: 'Tom' });
    w.player.start();
    w.run(1200, { h: sign(false), g: sign(false) });
    w.run(1000, { h: sign(true), g: sign(false) });
    expect(w.types()).not.toContain('gate_passed');
    expect(Object.keys(w.player.snapshot().evals).sort()).toEqual(['g', 'h']);
    w.run(500, { h: sign(true), g: sign(true) });
    expect(w.types()).toContain('gate_passed');
  });

  it('a pass older than 5 s must be repeated', () => {
    const w = world(track);
    w.player.join({ peerId: 'h', role: 'host' });
    w.player.join({ peerId: 'g', role: 'guest' });
    w.player.start();
    w.run(1200, { h: sign(true), g: sign(false) });
    w.run(6000, { h: sign(false), g: sign(false) });
    w.run(300, { h: sign(false), g: sign(true) });
    expect(w.types()).not.toContain('gate_passed');
    w.run(300, { h: sign(true), g: sign(true) });
    expect(w.types()).toContain('gate_passed');
  });

  it('a guest leaving does not block the host', () => {
    const w = world(track);
    w.player.join({ peerId: 'h', role: 'host' });
    w.player.join({ peerId: 'g', role: 'guest' });
    w.player.start();
    w.run(1200, { h: sign(false), g: sign(false) });
    w.player.leave('g');
    w.run(300, { h: sign(true) });
    expect(w.types()).toContain('gate_passed');
  });
});
