// The demo's promise, checked through the real controller: a watching learner never passes a gate (the video
// waits), a performing learner passes every gate and the lesson ends.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createGatedPlayer, validateTrack, type IstepTrack } from '../src/index';
import { learnerFrame, type LearnerMode } from './sim';

const load = (name: string): IstepTrack => {
  const v = validateTrack(
    JSON.parse(readFileSync(new URL(`../examples/${name}.istep`, import.meta.url), 'utf8')),
  );
  if (!v.ok) throw new Error(JSON.stringify(v.errors));
  return v.value;
};

function simulate(track: IstepTrack, mode: (gateIndex: number) => LearnerMode, limitSec: number) {
  let clock = 0;
  const media = { t: 0, playing: false };
  const events: string[] = [];
  const c = createGatedPlayer({
    track,
    now: () => clock,
    media: {
      play: () => void (media.playing = true),
      pause: () => void (media.playing = false),
      seek: (s) => void (media.t = s),
      currentTime: () => media.t,
    },
    onEvent: (e) => events.push(e.type),
  });
  c.join({ peerId: 'host', role: 'host' });
  c.start();
  let gateIndex = -1;
  let gateSince = 0;
  for (; clock < limitSec * 1000; clock += 33) {
    if (media.playing) media.t = Math.min(track.video.durationSec, media.t + 0.033);
    const s = c.snapshot();
    if (s.phase === 'ended') break;
    if (s.gateIndex !== gateIndex) [gateIndex, gateSince] = [s.gateIndex, clock];
    const gate = s.phase === 'gate' && s.gate ? s.gate : null;
    c.pushFrame('host', learnerFrame(mode(s.gateIndex), gate, gate ? clock - gateSince : null, clock));
    c.tick();
  }
  return { snap: c.snapshot(), events };
}

describe.each(['fall-heel-raise', 'asl-fingerspell-abc'])('%s', (name) => {
  const track = load(name);

  it('waits at the first gate while the learner only watches', () => {
    const { snap, events } = simulate(track, () => 'watch', track.gates[0]!.t + 30);
    expect(snap.phase).toBe('gate');
    expect(snap.gateIndex).toBe(0);
    expect(events).not.toContain('gate_passed');
    expect(events).not.toContain('safety_stop');
  });

  it('passes every gate and ends when the learner performs', () => {
    const { snap, events } = simulate(track, () => 'perform', 400);
    expect(snap.phase).toBe('ended');
    expect(events.filter((e) => e === 'gate_passed')).toHaveLength(track.gates.length);
    expect(events).not.toContain('safety_stop');
  });

  it('every gate waits while the learner watches', () => {
    for (let k = 0; k < track.gates.length; k++) {
      const stuck = simulate(track, (i) => (i < k ? 'perform' : 'watch'), 400);
      expect(stuck.snap.gateIndex, `gate ${track.gates[k]!.id}`).toBe(k);
      expect(stuck.snap.phase).toBe('gate');
    }
  });
});
