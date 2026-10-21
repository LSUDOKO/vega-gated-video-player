import {
  createGateRunner,
  createSafetyMonitor,
  nextTolerance,
  toleranceFactor,
  type Frame,
  type GateEval,
  type GateRunner,
  type SafetyMonitor,
} from '../engine/index';
import {
  effectiveGateSettings,
  type Gate,
  type IstepTrack,
  type ReferenceTimeline,
} from '../istep/index';

/** The platform video player, as seen by the controller (W3C media on Vega, HTMLVideoElement on web). */
export interface MediaAdapter {
  play(): void;
  pause(): void;
  seek(sec: number): void;
  currentTime(): number;
  /** Returns false if playback-rate changes are unsupported (the controller then keeps 1×). */
  setRate?(rate: number): boolean;
  setMuted?(muted: boolean): void;
}

export type Phase =
  'ready' | 'playing' | 'gate' | 'passing' | 'paused' | 'safety_stop' | 'camera_lost' | 'ended';

export type Participant = { peerId: string; role: 'host' | 'guest'; name?: string };

export type PlayerEvent =
  | { type: 'gate_start'; gate: Gate }
  | { type: 'gate_passed'; gate: Gate; ms: number }
  | { type: 'gate_stuck'; gate: Gate; eval: GateEval; attempts: number }
  | { type: 'gate_skipped'; gate: Gate }
  | { type: 'safety_stop'; reason: 'sway'; peerId: string }
  | { type: 'camera_lost' }
  | { type: 'resumed'; from: Phase }
  | { type: 'ended'; summary: SessionSummary };

export type GateAttempt = {
  gateId: string;
  type: string;
  msToPass: number | null;
  coached: boolean;
  passed: boolean;
};

export type SessionSummary = {
  startedAt: number;
  endedAt: number;
  gatesPassed: number;
  gatesTotal: number;
  reps: number;
  bestHoldSec: number;
  avgBpm: number | null;
  swayStops: number;
  coachTips: number;
  easierMode: boolean;
  attempts: GateAttempt[];
};

export type Snapshot = {
  phase: Phase;
  /** phase to return to after a pause / safety stop / camera loss */
  resumeTo: Phase | null;
  gateIndex: number;
  gate: Gate | null;
  /** latest evaluation per participant for the current gate */
  evals: Record<string, GateEval>;
  participants: Participant[];
  /** seconds since the current gate started */
  gateSec: number;
  canSkip: boolean;
  easier: boolean;
  playbackRate: number;
  /** ms left on the 3-2-1 countdown after the camera comes back */
  countdownMs: number;
  /** after a sway stop: the learner must be stable for 2 s, then press OK */
  stableForResume: boolean;
};

export type ControllerOptions = {
  track: IstepTrack;
  media: MediaAdapter;
  now: () => number;
  reference?: ReferenceTimeline;
  affectedHand?: 'left' | 'right';
  /** passes per gate type in the learner's last 3 sessions (adaptive tolerance) */
  recentPasses?: Record<string, number>;
  onEvent?: (e: PlayerEvent) => void;
};

export const GATE_EPSILON = 0.05;
export const PASS_FEEDBACK_MS = 400;
export const CAMERA_LOST_MS = 2000;
export const COUNTDOWN_MS = 3000;
export const TOGETHER_WINDOW_MS = 5000;

/**
 * Owns gate timing for one lesson. Pure TypeScript: the UI calls `tick()` every ≤ 100 ms and `pushFrame()`
 * for every landmarks frame, and renders `snapshot()`. Safety gates are never skipped or loosened.
 */
export function createGatedPlayer(o: ControllerOptions) {
  const { track, media, now } = o;
  const gates = track.gates;
  const swayCfg = track.safety?.swayStop;

  let phase: Phase = 'ready';
  let resumeTo: Phase | null = null;
  let gi = 0; // next/current gate index
  let gateStart = 0;
  let passingUntil = 0;
  let countdownUntil = 0;
  let rate = 1;
  let looped = false;
  const participants = new Map<
    string,
    Participant & {
      lastFrame: number;
      runner: GateRunner | null;
      monitor: SafetyMonitor | null;
      passedAt: number | null;
      eval: GateEval | null;
    }
  >();
  const failedAttempts = new Map<string, number>();
  let coachedThisAttempt = false;
  let nextCoachAt = 0;

  const summary = {
    startedAt: 0,
    reps: 0,
    bestHoldSec: 0,
    bpms: [] as number[],
    swayStops: 0,
    coachTips: 0,
    easierMode: false,
    attempts: [] as GateAttempt[],
  };

  const emit = (e: PlayerEvent) => o.onEvent?.(e);
  const settings = (g: Gate) => effectiveGateSettings(track, g);

  function makeRunner(g: Gate): GateRunner {
    const s = settings(g);
    const history = {
      failedAttempts: failedAttempts.get(g.id) ?? 0,
      recentPasses: o.recentPasses?.[g.type] ?? 0,
    };
    if (s.learning && toleranceFactor(history) > 1) summary.easierMode = true;
    return createGateRunner(g, {
      tolerance: nextTolerance(s.tolerance, history, s.learning),
      ...(o.reference ? { reference: o.reference } : {}),
      ...(o.affectedHand ? { affectedHand: o.affectedHand } : {}),
    });
  }

  function enterGate() {
    const g = gates[gi]!;
    media.pause();
    media.seek(g.t);
    phase = 'gate';
    gateStart = now();
    coachedThisAttempt = false;
    looped = false;
    nextCoachAt = gateStart + settings(g).coachAfterSec * 1000;
    for (const p of participants.values()) {
      p.runner = makeRunner(g);
      p.passedAt = null;
      p.eval = null;
    }
    emit({ type: 'gate_start', gate: g });
    if (g.then === 'loop_segment' && g.rewindTo !== undefined) {
      media.seek(g.rewindTo);
      media.play();
    }
  }

  function finishGate(passed: boolean) {
    const g = gates[gi]!;
    const ms = now() - gateStart;
    summary.attempts.push({
      gateId: g.id,
      type: g.type,
      msToPass: passed ? ms : null,
      coached: coachedThisAttempt,
      passed,
    });
    const host = [...participants.values()].find((p) => p.role === 'host')?.eval;
    if (host) {
      if (g.type === 'rep_count' || g.type === 'rhythm_bpm') summary.reps += host.reps ?? 0;
      if (host.holdSec !== undefined) summary.bestHoldSec = Math.max(summary.bestHoldSec, host.holdSec);
    }
    setRate(1);
    media.setMuted?.(false);
    if (passed) emit({ type: 'gate_passed', gate: g, ms });
    else emit({ type: 'gate_skipped', gate: g });
    gi++;
  }

  function setRate(r: number) {
    if (r === rate) return;
    if (media.setRate?.(r)) rate = r;
  }

  function resumePlayback() {
    phase = 'playing';
    media.seek(gates[gi - 1]?.t ?? media.currentTime());
    media.play();
  }

  function allPassed(): boolean {
    const ps = [...participants.values()];
    if (ps.length === 0) return false;
    const times = ps.map((p) => p.passedAt);
    if (times.some((t) => t === null)) return false;
    return Math.max(...(times as number[])) - Math.min(...(times as number[])) <= TOGETHER_WINDOW_MS;
  }

  const api = {
    /** Starts playback from the beginning (after the camera check). */
    start() {
      summary.startedAt = now();
      for (const p of participants.values()) p.lastFrame = now();
      phase = 'playing';
      gi = 0;
      media.seek(0);
      media.play();
    },

    join(p: Participant) {
      participants.set(p.peerId, {
        ...p,
        lastFrame: now(),
        runner: phase === 'gate' ? makeRunner(gates[gi]!) : null,
        monitor: swayCfg ? createSafetyMonitor(swayCfg) : null,
        passedAt: null,
        eval: null,
      });
    },

    leave(peerId: string) {
      participants.delete(peerId);
    },

    pushFrame(peerId: string, frame: Frame) {
      const p = participants.get(peerId);
      if (!p) return;
      p.lastFrame = now();
      if (phase === 'ended' || phase === 'ready') return;

      // Lesson-wide sway stop runs during playback and gates, for every participant.
      if (p.monitor && (phase === 'playing' || phase === 'gate' || phase === 'safety_stop')) {
        const s = p.monitor.push(frame);
        if (s.stop && phase !== 'safety_stop') {
          resumeTo = phase;
          phase = 'safety_stop';
          media.pause();
          summary.swayStops++;
          emit({ type: 'safety_stop', reason: 'sway', peerId });
          return;
        }
      }
      if (phase !== 'gate' || !p.runner) return;
      const e = p.runner.push(frame);
      p.eval = e;
      if (e.playbackRate !== undefined && p.role === 'host') setRate(e.playbackRate);
      if (e.bpm !== undefined && p.role === 'host') summary.bpms.push(e.bpm);
      if (e.status === 'passed' && p.passedAt === null) p.passedAt = now();
      // Together mode: a pass older than the window must be repeated.
      for (const q of participants.values())
        if (q.passedAt !== null && now() - q.passedAt > TOGETHER_WINDOW_MS && !allPassed()) {
          q.passedAt = null;
          q.runner = makeRunner(gates[gi]!);
        }
      if (allPassed()) {
        phase = 'passing';
        passingUntil = now() + PASS_FEEDBACK_MS;
        finishGate(true);
      }
    },

    /** Call every ≤ 100 ms. */
    tick() {
      const t = now();
      if (phase === 'ended' || phase === 'ready') return;

      // Camera lost: no frames from the host for 2 s → pause. Never keep playing without camera data.
      const host = [...participants.values()].find((p) => p.role === 'host');
      const lost = !host || t - host.lastFrame > CAMERA_LOST_MS;
      if (lost && phase !== 'camera_lost' && phase !== 'paused') {
        if (phase === 'passing') media.seek(gates[gi - 1]!.t); // the gate is done; resume after it
        if (phase !== 'safety_stop') resumeTo = phase === 'passing' ? 'playing' : phase;
        phase = 'camera_lost';
        countdownUntil = 0;
        media.pause();
        emit({ type: 'camera_lost' });
        return;
      }
      if (phase === 'camera_lost') {
        if (lost) countdownUntil = 0;
        else if (!countdownUntil) countdownUntil = t + COUNTDOWN_MS;
        else if (t >= countdownUntil) {
          const from = phase;
          phase = resumeTo ?? 'playing';
          resumeTo = null;
          countdownUntil = 0;
          if (phase === 'playing') media.play();
          else if (phase === 'gate') {
            gateStart = t; // the clock restarts; progress is kept by the runners
            nextCoachAt = t + settings(gates[gi]!).coachAfterSec * 1000;
            if (gates[gi]!.then === 'loop_segment') media.play();
          } else if (phase === 'safety_stop') media.pause();
          emit({ type: 'resumed', from });
        }
        return;
      }

      if (phase === 'passing' && t >= passingUntil) resumePlayback();

      if (phase === 'playing') {
        const g = gates[gi];
        const ct = media.currentTime();
        if (g && ct >= g.t - GATE_EPSILON) enterGate();
        else if (!g && ct >= track.video.durationSec - 0.1) api.end();
        return;
      }

      if (phase === 'gate') {
        const g = gates[gi]!;
        if (
          g.then === 'loop_segment' &&
          g.rewindTo !== undefined &&
          media.currentTime() >= g.t - GATE_EPSILON
        ) {
          media.seek(g.rewindTo);
          if (!looped) media.setMuted?.(true); // muted after the first loop
          looped = true;
          media.play();
        }
        if (t >= nextCoachAt) {
          const hostEval = host?.eval;
          const attempts = (failedAttempts.get(g.id) ?? 0) + 1;
          failedAttempts.set(g.id, attempts);
          coachedThisAttempt = true;
          summary.coachTips++;
          nextCoachAt = t + settings(g).coachAfterSec * 1000 * 2;
          emit({
            type: 'gate_stuck',
            gate: g,
            eval: hostEval ?? { status: 'waiting', progress: 0, score: 0 },
            attempts,
          });
          // Learning gates get a deterministic, slightly easier tolerance after a stuck attempt.
          if (settings(g).learning)
            for (const p of participants.values())
              if (p.eval?.status !== 'progress') {
                p.runner = makeRunner(g);
                p.passedAt = null;
              }
        }
      }
    },

    /** Remote keys, companion gestures and voice commands. Nothing here bypasses a gate. */
    control(action: 'toggle_pause' | 'play' | 'pause' | 'repeat' | 'easier' | 'next' | 'ok') {
      const g = gates[gi];
      switch (action) {
        case 'pause':
        case 'play':
        case 'toggle_pause': {
          const wantPause = action === 'pause' || (action === 'toggle_pause' && phase !== 'paused');
          if (wantPause && (phase === 'playing' || phase === 'gate')) {
            resumeTo = phase;
            phase = 'paused';
            media.pause();
          } else if (!wantPause && phase === 'paused') {
            phase = resumeTo ?? 'playing';
            resumeTo = null;
            if (phase === 'playing' || (phase === 'gate' && g?.then === 'loop_segment')) media.play();
            emit({ type: 'resumed', from: 'paused' });
          }
          return;
        }
        case 'repeat': {
          if (phase !== 'gate' && phase !== 'playing') return;
          const target =
            phase === 'gate' && g ? (g.rewindTo ?? gates[gi - 1]?.t ?? 0) : (gates[gi - 1]?.t ?? 0);
          phase = 'playing';
          setRate(1);
          media.setMuted?.(false);
          media.seek(target);
          media.play();
          return;
        }
        case 'next': {
          if (phase !== 'gate' || !g || !api.snapshot().canSkip) return;
          finishGate(false);
          resumePlayback();
          return;
        }
        case 'easier': {
          if (phase !== 'gate' || !g || !settings(g).learning) return;
          failedAttempts.set(g.id, Math.min(3, (failedAttempts.get(g.id) ?? 0) + 1));
          for (const p of participants.values()) {
            p.runner = makeRunner(g);
            p.passedAt = null;
          }
          return;
        }
        case 'ok': {
          if (phase !== 'safety_stop') return;
          const stable = [...participants.values()].every((p) => !p.monitor || p.monitor.isStableForResume());
          if (!stable) return;
          const back = resumeTo ?? 'playing';
          phase = back;
          resumeTo = null;
          if (back === 'playing' || (back === 'gate' && g?.then === 'loop_segment')) media.play();
          if (back === 'gate') nextCoachAt = now() + settings(g!).coachAfterSec * 1000;
          emit({ type: 'resumed', from: 'safety_stop' });
          return;
        }
      }
    },

    /** Ends the lesson (video end, or the learner exits) and emits the summary. */
    end(): SessionSummary {
      if (phase !== 'ended') {
        phase = 'ended';
        media.pause();
      }
      const s: SessionSummary = {
        startedAt: summary.startedAt,
        endedAt: now(),
        gatesPassed: summary.attempts.filter((a) => a.passed).length,
        gatesTotal: gates.length,
        reps: summary.reps,
        bestHoldSec: summary.bestHoldSec,
        avgBpm: summary.bpms.length
          ? Math.round(summary.bpms.reduce((a, b) => a + b, 0) / summary.bpms.length)
          : null,
        swayStops: summary.swayStops,
        coachTips: summary.coachTips,
        easierMode: summary.easierMode,
        attempts: summary.attempts,
      };
      emit({ type: 'ended', summary: s });
      return s;
    },

    snapshot(): Snapshot {
      const g =
        gates[gi] && (phase === 'gate' || phase === 'passing' || resumeTo === 'gate') ? gates[gi]! : null;
      const t = now();
      const gateSec = g ? (t - gateStart) / 1000 : 0;
      return {
        phase,
        resumeTo,
        gateIndex: gi,
        gate: phase === 'passing' ? (gates[gi - 1] ?? null) : g,
        evals: Object.fromEntries(
          [...participants.values()].filter((p) => p.eval).map((p) => [p.peerId, p.eval!]),
        ),
        participants: [...participants.values()].map(({ peerId, role, name }) => ({
          peerId,
          role,
          ...(name ? { name } : {}),
        })),
        gateSec,
        canSkip: !!g && g.type !== 'safety_prerequisite' && gateSec >= settings(g).timeoutSec,
        easier:
          !!g &&
          settings(g).learning &&
          toleranceFactor({
            failedAttempts: failedAttempts.get(g.id) ?? 0,
            recentPasses: o.recentPasses?.[g.type] ?? 0,
          }) > 1,
        playbackRate: rate,
        countdownMs: countdownUntil ? Math.max(0, countdownUntil - t) : 0,
        stableForResume:
          phase === 'safety_stop' &&
          [...participants.values()].every((p) => !p.monitor || p.monitor.isStableForResume()),
      };
    },
  };
  return api;
}
export type GatedPlayer = ReturnType<typeof createGatedPlayer>;
