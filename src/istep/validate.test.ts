import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  effectiveGateSettings,
  formatPath,
  validateReference,
  validateTrack,
  validateTrackText,
} from './index';

const dir = (d: string) => new URL(d === 'invalid' ? '../../test-fixtures/invalid/' : `../../${d}/`, import.meta.url);
const load = (d: string, f: string) => readFileSync(new URL(f, dir(d)), 'utf8');

describe('examples', () => {
  const files = readdirSync(dir('examples')).filter((f) => f.endsWith('.istep'));
  it('ships all 7 example tracks', () => expect(files).toHaveLength(7));
  it.each(files)('%s is valid', (f) => {
    const r = validateTrackText(load('examples', f));
    expect(r.ok ? [] : r.errors).toEqual([]);
  });
});

describe('invalid files fail with path-specific errors', () => {
  const cases: [string, string, RegExp][] = [
    ['unsorted-gates.istep', 'gates[1].t', /sorted/],
    ['duplicate-ids.istep', 'gates[2].id', /duplicate/],
    ['safety-learning-true.istep', 'gates[0].learning', /never be learning/],
    ['cpr-no-disclaimer.istep', 'disclaimer', /requires a disclaimer|compression depth/],
    ['unknown-gate-type.istep', 'gates[0].type', /.+/],
  ];
  it.each(cases)('%s → %s', (f, path, msg) => {
    const r = validateTrackText(load('invalid', f));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const hit = r.errors.find((e) => e.path === path);
    expect(hit, JSON.stringify(r.errors)).toBeDefined();
    expect(hit!.message).toMatch(msg);
  });
});

describe('rules', () => {
  const base = () => JSON.parse(load('examples', 'fall-heel-raise.istep'));

  it('rejects bad JSON', () => {
    const r = validateTrackText('{nope');
    expect(r.ok).toBe(false);
  });
  it('rejects gate after video end', () => {
    const t = base();
    t.gates[3].t = 99;
    expect(validateTrack(t).ok).toBe(false);
  });
  it('rejects wrong version', () => {
    const t = base();
    t.istep = '2.0';
    expect(validateTrack(t).ok).toBe(false);
  });
  it('allows unknown top-level fields', () => {
    const t = { ...base(), futureField: { x: 1 } };
    expect(validateTrack(t).ok).toBe(true);
  });
  it('requires rewindTo for loop_segment and rewindTo ≤ t', () => {
    const t = base();
    delete t.gates[2].rewindTo;
    expect(validateTrack(t).ok).toBe(false);
    const u = base();
    u.gates[2].rewindTo = 50;
    expect(validateTrack(u).ok).toBe(false);
  });
  it('requires hands/objects in tracking when gates need them', () => {
    const t = base();
    t.tracking = ['pose'];
    const r = validateTrack(t);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.message).toMatch(/objects/);
  });
  it('requires a disclaimer for fall prevention', () => {
    const t = base();
    t.disclaimer = '  ';
    expect(validateTrack(t).ok).toBe(false);
  });
  it('rejects range.low ≥ range.high', () => {
    const t = base();
    t.gates[2].range = { low: 0.5, high: 0.1 };
    expect(validateTrack(t).ok).toBe(false);
  });
  it('hand target needs curl or reference', () => {
    const t = JSON.parse(load('examples', 'asl-i-love-you.istep'));
    t.gates[0].target = { spread: { thumb_index: 'open' } };
    expect(validateTrack(t).ok).toBe(false);
    t.gates[0].target = { source: 'reference', atSec: 7 };
    expect(validateTrack(t).ok).toBe(true);
  });
  it('effective settings: safety gates are never learning; defaults merge', () => {
    const t = base();
    const r = validateTrack(t);
    if (!r.ok) throw new Error('fixture');
    expect(effectiveGateSettings(r.value, r.value.gates[0]!).learning).toBe(false);
    const s = effectiveGateSettings(r.value, r.value.gates[1]!);
    expect(s).toMatchObject({
      learning: true,
      coachAfterSec: 6,
      timeoutSec: 45,
      tolerance: { angleDeg: 15, curl: 0.3 },
    });
  });
  it('formats paths', () => {
    expect(formatPath(['gates', 2, 't'])).toBe('gates[2].t');
    expect(formatPath([])).toBe('(root)');
  });
});

describe('reference timeline', () => {
  it('validates shape', () => {
    const pose = Array.from({ length: 33 }, () => [0.5, 0.5, 0, 1]);
    expect(validateReference({ fps: 15, tracking: ['pose'], frames: [{ t: 0, pose }] }).ok).toBe(true);
    expect(
      validateReference({ fps: 15, tracking: ['pose'], frames: [{ t: 0, pose: pose.slice(1) }] }).ok,
    ).toBe(false);
  });
});
