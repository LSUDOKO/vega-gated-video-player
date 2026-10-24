/**
 * Live web demo: the platform-independent controller (createGatedPlayer) driving an HTMLVideoElement, fed by a
 * simulated learner. Same controller and gate engine as the Vega <GatedPlayer>; only the MediaAdapter differs.
 */
import abcJson from '../examples/asl-fingerspell-abc.istep';
import heelJson from '../examples/fall-heel-raise.istep';
import {
  HAND_EDGES,
  POSE_EDGES,
  createGatedPlayer,
  validateTrack,
  type Frame,
  type Gate,
  type GateEval,
  type GatedPlayer,
  type Landmark,
  type MediaAdapter,
  type Phase,
  type PlayerEvent,
  type Snapshot,
} from '../src/index';
import { learnerFrame, type LearnerMode } from './sim';

const PEER = 'learner';
const ACCENT: Record<string, string> = { fall_prevention: '#5FC6FF', sign_language: '#AE97FF' };
const LESSONS = [
  { id: 'heel', name: 'Heel raises', video: 'media/fall-heel-raise.mp4', json: heelJson },
  { id: 'abc', name: 'Fingerspelling', video: 'media/asl-fingerspell-abc.mp4', json: abcJson },
].map((l) => {
  const v = validateTrack(l.json);
  if (!v.ok) throw new Error(`${l.id}: ${v.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`);
  return { ...l, track: v.value };
});
type Lesson = (typeof LESSONS)[number];

const PHASE_LABEL: Record<Phase, string> = {
  ready: 'Ready',
  playing: 'Playing',
  gate: 'Waiting for the learner',
  passing: 'Gate passed',
  paused: 'Paused',
  safety_stop: 'Safety stop',
  camera_lost: 'Camera lost',
  ended: 'Lesson complete',
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = $<HTMLVideoElement>('video');
const canvas = $<HTMLCanvasElement>('skeleton');
const ctx2d = canvas.getContext('2d')!;
const now = () => performance.now();

let lesson: Lesson = LESSONS[0]!;
let mode: LearnerMode = 'watch';
let userMuted = false;
let tip: string | null = null;
let s: {
  ctl: GatedPlayer;
  timer: ReturnType<typeof setInterval>;
  gateSince: number;
  performSince: number;
} | null = null;

const media: MediaAdapter = {
  play: () => void video.play().catch(() => undefined), // pause→seek→play races reject with AbortError
  pause: () => video.pause(),
  seek: (sec) => {
    video.currentTime = sec;
  },
  currentTime: () => video.currentTime,
  setRate: (r) => {
    video.playbackRate = r;
    return true;
  },
  setMuted: (m) => {
    video.muted = m || userMuted;
  },
};

function onEvent(e: PlayerEvent) {
  const t = video.currentTime.toFixed(1);
  let text: string;
  switch (e.type) {
    case 'gate_start':
      if (s) s.gateSince = now();
      tip = null;
      text = e.gate.label;
      break;
    case 'gate_passed':
      text = `${e.gate.label} · ${(e.ms / 1000).toFixed(1)} s`;
      break;
    case 'gate_stuck':
      tip = e.gate.fallbackTip;
      text = `tip: ${e.gate.fallbackTip}`;
      break;
    case 'gate_skipped':
      text = e.gate.label;
      break;
    case 'ended':
      text = [
        `${e.summary.gatesPassed} / ${e.summary.gatesTotal} gates passed`,
        e.summary.reps ? `${e.summary.reps} reps` : '',
        e.summary.bestHoldSec ? `best hold ${e.summary.bestHoldSec.toFixed(1)} s` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      break;
    case 'safety_stop':
      text = 'sway above the lesson limit';
      break;
    case 'resumed':
      text = `from ${e.from}`;
      break;
    default:
      text = '';
  }
  const li = document.createElement('li');
  li.className = `ev ev-${e.type}`;
  li.innerHTML = `<span class="ev-t">${t}s</span><code></code><span class="ev-x"></span>`;
  li.querySelector('code')!.textContent = e.type;
  li.querySelector('.ev-x')!.textContent = text;
  $('log').prepend(li);
}

function stop() {
  if (s) clearInterval(s.timer);
  s = null;
}

function start() {
  stop();
  $('log').replaceChildren();
  tip = null;
  const ctl = createGatedPlayer({ track: lesson.track, media, now, onEvent });
  ctl.join({ peerId: PEER, role: 'host', name: 'Simulated learner' });
  const t = now();
  s = { ctl, gateSince: t, performSince: t, timer: setInterval(step, 33) };
  ctl.start();
  $('start').textContent = 'Restart';
}

function step() {
  if (!s) return;
  const t = now();
  const before = s.ctl.snapshot();
  const gate = before.phase === 'gate' ? before.gate : null;
  const tMs = gate && mode === 'perform' ? t - Math.max(s.gateSince, s.performSince) : null;
  const frame = learnerFrame(mode, gate, tMs, t);
  s.ctl.pushFrame(PEER, frame);
  s.ctl.tick();
  const snap = s.ctl.snapshot();
  render(snap, frame);
  if (snap.phase === 'ended') stop();
}

function selectLesson(l: Lesson) {
  stop();
  lesson = l;
  video.src = l.video;
  video.load();
  document.documentElement.style.setProperty('--accent', ACCENT[l.track.channel] ?? '#5FC6FF');
  $('disclaimer').textContent = l.track.disclaimer ?? '';
  $('lesson-meta').textContent =
    `${l.track.title} · ${l.track.gates.length} gates · ${[...new Set(l.track.gates.map((g) => g.type))].join(', ')}`;
  $('start').textContent = 'Start lesson';
  $('log').replaceChildren();
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-lesson]'))
    b.setAttribute('aria-pressed', String(b.dataset.lesson === l.id));
  renderTimeline(null);
  renderIdle();
}

function setMode(m: LearnerMode) {
  if (s && m === 'perform' && mode !== 'perform') s.performSince = now();
  mode = m;
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-mode]'))
    b.setAttribute('aria-pressed', String(b.dataset.mode === m));
  $('learner-caption').textContent =
    m === 'watch'
      ? 'Watching: leaning back with bent knees, hands down, no chair beside them. Gates stay closed.'
      : 'Performing: doing what each gate asks, as synthetic landmarks.';
}

// ---------- rendering ----------

function metric(g: Gate, e: GateEval | undefined): string {
  switch (g.type) {
    case 'rep_count':
      return `${e?.reps ?? 0} / ${g.reps} reps`;
    case 'hold_duration':
      return `${(e?.holdSec ?? 0).toFixed(1)} / ${g.holdSec} s held`;
    case 'sequence_order':
      return `${e?.step ?? 0} / ${g.steps.length} signs`;
    case 'safety_prerequisite':
      return `${(e?.checks ?? []).filter((c) => c.ok).length} / ${g.checks.length} checks`;
    case 'rhythm_bpm':
      return e?.bpm ? `${Math.round(e.bpm)} / min` : 'finding the rhythm';
    default:
      return `${Math.round((e?.progress ?? 0) * 100)}% matched`;
  }
}

function setRing(el: HTMLElement, p: number) {
  el.style.setProperty('--p', String(Math.max(0, Math.min(1, p))));
}

function render(snap: Snapshot, frame: Frame) {
  const e = snap.evals[PEER];
  const phase = $('phase');
  phase.textContent = PHASE_LABEL[snap.phase];
  phase.dataset.phase = snap.phase;
  $('hud').dataset.phase = snap.phase;

  const g = snap.gate;
  const progress = snap.phase === 'passing' ? 1 : (e?.progress ?? 0);
  $('hud-label').textContent = g ? g.label : lesson.track.title;
  setRing($('hud-ring'), g ? progress : 0);
  setRing($('gate-ring'), g ? progress : 0);
  $('gate-index').textContent = g
    ? `Gate ${snap.phase === 'passing' ? snap.gateIndex : snap.gateIndex + 1} of ${lesson.track.gates.length}`
    : snap.phase === 'ended'
      ? 'All gates done'
      : `Next: gate ${Math.min(snap.gateIndex + 1, lesson.track.gates.length)} of ${lesson.track.gates.length}`;
  $('gate-type').textContent = g ? g.type : '';
  $('gate-label').textContent = g ? g.label : snap.phase === 'ended' ? 'Lesson complete' : 'Video is playing';
  $('gate-metric').textContent = g ? metric(g, snap.phase === 'passing' ? undefined : e) : '';
  if (g && snap.phase === 'passing') $('gate-metric').textContent = 'passed';
  $('gate-wait').textContent = snap.phase === 'gate' ? `${snap.gateSec.toFixed(1)} s waiting` : '';
  const hint = snap.phase === 'gate' ? (e?.message ?? e?.worst?.hint ?? '') : '';
  $('gate-hint').textContent = hint;
  $('gate-tip').textContent = snap.phase === 'gate' && tip ? `Tip from the .istep file: ${tip}` : '';

  const checks = $('gate-checks');
  checks.replaceChildren(
    ...(snap.phase === 'gate' && g?.type === 'safety_prerequisite' ? (e?.checks ?? []) : []).map((c) => {
      const li = document.createElement('li');
      li.dataset.ok = String(c.ok);
      li.textContent = `${c.kind.replaceAll('_', ' ')}${c.ok ? '' : c.message ? ` · ${c.message}` : ''}`;
      return li;
    }),
  );
  renderTimeline(snap);
  draw(frame, snap.phase === 'passing' || e?.status === 'passed');
}

function renderTimeline(snap: Snapshot | null) {
  const dur = lesson.track.video.durationSec;
  const bar = $('timeline');
  if (bar.dataset.lesson !== lesson.id) {
    bar.dataset.lesson = lesson.id;
    bar.replaceChildren(
      Object.assign(document.createElement('div'), { className: 'tl-fill', id: 'tl-fill' }),
      ...lesson.track.gates.map((g, i) => {
        const m = document.createElement('span');
        m.className = 'tl-gate';
        m.style.left = `${(g.t / dur) * 100}%`;
        m.title = `${g.t}s · ${g.label}`;
        m.dataset.i = String(i);
        return m;
      }),
    );
  }
  $('tl-fill').style.width = `${Math.min(100, (video.currentTime / dur) * 100)}%`;
  for (const m of bar.querySelectorAll<HTMLElement>('.tl-gate')) {
    const i = Number(m.dataset.i);
    const done = snap ? i < snap.gateIndex : false;
    m.dataset.state = done ? 'done' : snap && i === snap.gateIndex && snap.phase === 'gate' ? 'now' : 'todo';
  }
  $('clock').textContent = `${video.currentTime.toFixed(1)} / ${dur} s`;
}

function renderIdle() {
  const t = now();
  draw(learnerFrame(mode, null, null, t), false);
  $('phase').textContent = 'Press Start';
  $('phase').dataset.phase = 'ready';
  $('hud').dataset.phase = 'ready';
  $('hud-label').textContent = lesson.track.title;
  for (const id of ['hud-ring', 'gate-ring']) setRing($(id), 0);
  $('gate-index').textContent = `${lesson.track.gates.length} gates`;
  $('gate-type').textContent = '';
  $('gate-label').textContent = 'Not started';
  for (const id of ['gate-metric', 'gate-wait', 'gate-hint', 'gate-tip']) $(id).textContent = '';
  $('gate-checks').replaceChildren();
}

function draw(f: Frame, passed: boolean) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const c = ctx2d;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const color = passed ? '#49DE78' : accent;
  const hands = lesson.track.camera.view === 'hands';
  // square region of the normalised image to show
  const [x0, y0, size] = hands ? [0.28, 0.36, 0.44] : [0.1, 0.18, 0.84];
  const k = Math.min(w, h) / size;
  const ox = (w - size * k) / 2;
  const oy = (h - size * k) / 2;
  const P = (p: { x: number; y: number }) => [ox + (p.x - x0) * k, oy + (p.y - y0) * k] as const;

  // floor
  if (!hands) {
    c.fillStyle = '#18263F';
    c.fillRect(0, P({ x: 0, y: 0.96 })[1], w, h);
  }
  for (const o of hands ? [] : (f.objects ?? [])) {
    const [bx, by] = P({ x: o.box[0], y: o.box[1] });
    c.strokeStyle = '#B5B8F1';
    c.setLineDash([6, 5]);
    c.lineWidth = 1.5;
    c.strokeRect(bx, by, o.box[2] * k, o.box[3] * k);
    c.setLineDash([]);
    c.fillStyle = '#B5B8F1';
    c.font = '600 12px Inter, system-ui, sans-serif';
    c.fillText(`${o.label} ${Math.round(o.score * 100)}%`, bx, by + o.box[3] * k + 16);
  }
  const bones = (pts: Landmark[], edges: [number, number][], width: number, r: number) => {
    c.strokeStyle = color;
    c.lineWidth = width;
    c.lineCap = 'round';
    for (const [a, b] of edges) {
      const pa = pts[a];
      const pb = pts[b];
      if (!pa || !pb) continue;
      c.beginPath();
      c.moveTo(...P(pa));
      c.lineTo(...P(pb));
      c.stroke();
    }
    c.fillStyle = '#F5F6FE';
    for (const p of pts) {
      c.beginPath();
      c.arc(...P(p), r, 0, Math.PI * 2);
      c.fill();
    }
  };
  if (hands) {
    const hs = [f.hands?.right, f.hands?.left].filter((x): x is Landmark[] => !!x);
    for (const hp of hs) bones(hp, HAND_EDGES, 5, 4);
    if (!hs.length) {
      c.fillStyle = '#A1A6C1';
      c.font = '500 14px Inter, system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText('Hands down, out of view', w / 2, h / 2);
      c.textAlign = 'start';
    }
  } else if (f.pose) {
    bones(f.pose, POSE_EDGES, 5, 3.5);
    const nose = f.pose[0];
    if (nose) {
      c.strokeStyle = color;
      c.lineWidth = 4;
      c.beginPath();
      c.arc(...P(nose), 0.035 * k, 0, Math.PI * 2);
      c.stroke();
    }
  }
}

// ---------- wiring ----------

$('start').addEventListener('click', start);
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-lesson]'))
  b.addEventListener('click', () => selectLesson(LESSONS.find((l) => l.id === b.dataset.lesson)!));
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-mode]'))
  b.addEventListener('click', () => setMode(b.dataset.mode as LearnerMode));
$('sound').addEventListener('click', () => {
  userMuted = !userMuted;
  video.muted = userMuted;
  $('sound').setAttribute('aria-pressed', String(!userMuted));
  $('sound').textContent = userMuted ? 'Sound off' : 'Sound on';
});
video.addEventListener('ended', () => {
  if (s && s.ctl.snapshot().phase !== 'ended') s.ctl.end();
});
selectLesson(lesson);
setMode('watch');
// idle preview animation until a lesson starts
setInterval(() => {
  if (!s && !$('log').childElementCount) draw(learnerFrame(mode, null, null, now()), false);
}, 50);
