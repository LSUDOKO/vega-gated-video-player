import type { Gate } from '../../istep/index';
import { jointAngle, median, meanVisibility, signalPoint, torsoLength } from '../geometry';
import { VISIBILITY_THRESHOLD } from '../preprocess';
import type { GateEval } from '../types';
import type { Evaluator } from './common';

type RhythmGate = Extract<Gate, { type: 'rhythm_bpm' }>;

const MIN_PEAK_GAP_MS = 300;
/** × torso length. Spec suggested 0.15; real compressions on a cushion travel ~0.1 torso, so lower. */
export const RHYTHM_PROMINENCE = 0.05;
const STALE_MS = 2000;
const LEFT_ARM = [11, 13, 15];
const RIGHT_ARM = [12, 14, 16];

/**
 * rhythm_bpm: online peak detection on the signal (peak = bottom of a press, max image y).
 * A peak is confirmed once the signal falls back by the prominence; bpm = 60 / median of the last 6 intervals.
 */
export function rhythmEvaluator(gate: RhythmGate): Evaluator {
  let seeking: 'peak' | 'trough' = 'peak';
  let lastTrough = Infinity;
  let cand = { v: -Infinity, ts: 0, armsOk: true };
  let trough = Infinity;
  let peaks: number[] = [];
  let good = 0;
  let lastArmsOk = true;
  let passed = false;

  const bpmNow = (): number | undefined => {
    if (peaks.length < 2) return undefined;
    const iv = peaks
      .slice(-7)
      .map((t, i, a) => (i ? t - a[i - 1]! : 0))
      .slice(1);
    return 60000 / median(iv);
  };

  return {
    eval(f): GateEval {
      const base = { progress: Math.min(good / gate.count, 1), reps: good };
      if (passed) return { status: 'passed', score: 1, ...base };
      const pose = f.pose;
      const lv = pose ? meanVisibility(pose, LEFT_ARM) : 0;
      const rv = pose ? meanVisibility(pose, RIGHT_ARM) : 0;
      if (!pose || Math.max(lv, rv) < VISIBILITY_THRESHOLD)
        return { status: 'no_person', score: 0, ...base, message: 'Turn the camera so it sees your arms' };

      const p = signalPoint(pose, gate.signal.landmark);
      const v = gate.signal.axis === 'y' ? p.y : p.x;
      const prom = RHYTHM_PROMINENCE * torsoLength(pose);
      const elbows: number[] = [];
      if (lv >= VISIBILITY_THRESHOLD) elbows.push(jointAngle(pose, 'l_elbow'));
      if (rv >= VISIBILITY_THRESHOLD) elbows.push(jointAngle(pose, 'r_elbow'));
      const armsOk = !gate.armsStraight || elbows.every((e) => e >= gate.armsStraight!.minElbowDeg);

      if (lastTrough === Infinity) lastTrough = v;
      if (seeking === 'peak') {
        if (v > cand.v) cand = { v, ts: f.ts, armsOk };
        else if (cand.v - v >= prom && cand.v - lastTrough >= prom) {
          const prev = peaks[peaks.length - 1];
          if (prev === undefined || cand.ts - prev >= MIN_PEAK_GAP_MS) {
            peaks.push(cand.ts);
            if (peaks.length > 20) peaks = peaks.slice(-20);
            lastArmsOk = cand.armsOk;
            const bpm = bpmNow();
            if (bpm !== undefined && bpm >= gate.bpm.min && bpm <= gate.bpm.max && cand.armsOk) good++;
            if (good >= gate.count) passed = true;
          }
          seeking = 'trough';
          trough = v;
        }
      } else if (v < trough) trough = v;
      else if (v - trough >= prom) {
        lastTrough = trough;
        seeking = 'peak';
        cand = { v, ts: f.ts, armsOk };
      }

      const last = peaks[peaks.length - 1];
      const stale = last === undefined || f.ts - last > STALE_MS;
      const bpm = stale ? undefined : bpmNow();
      let worst: GateEval['worst'];
      if (!lastArmsOk || !armsOk) worst = { name: 'elbows', hint: 'lock your elbows straight' };
      else if (bpm !== undefined && bpm < gate.bpm.min)
        worst = { name: 'tempo', hint: 'push a little faster' };
      else if (bpm !== undefined && bpm > gate.bpm.max) worst = { name: 'tempo', hint: 'slow down a little' };
      return {
        status: passed ? 'passed' : stale ? 'waiting' : 'progress',
        score: Math.min(good / gate.count, 1),
        ...base,
        progress: Math.min(good / gate.count, 1),
        reps: good,
        armsStraight: armsOk,
        ...(bpm !== undefined ? { bpm: Math.round(bpm) } : {}),
        ...(worst ? { worst } : {}),
        ...(stale ? { message: 'Start pushing — follow the beat' } : {}),
      };
    },
    reset() {
      seeking = 'peak';
      lastTrough = Infinity;
      cand = { v: -Infinity, ts: 0, armsOk: true };
      trough = Infinity;
      peaks = [];
      good = 0;
      lastArmsOk = true;
      passed = false;
    },
    state: () => ({ peaks: [...peaks], good }),
  };
}
