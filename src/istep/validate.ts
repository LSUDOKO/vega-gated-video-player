import type { z } from 'zod';
import { IstepTrack, ReferenceTimeline } from './schema';

export type ValidationError = { path: string; message: string };
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: ValidationError[] };

/** Formats a zod path as a JSON path, e.g. ["gates", 2, "t"] → "gates[2].t". */
export function formatPath(path: readonly PropertyKey[]): string {
  return (
    path.reduce<string>((acc, part) => {
      if (typeof part === 'number') return `${acc}[${part}]`;
      return acc ? `${acc}.${String(part)}` : String(part);
    }, '') || '(root)'
  );
}

function run<T>(schema: z.ZodType<T>, input: unknown): ValidationResult<T> {
  const r = schema.safeParse(input);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, errors: r.error.issues.map((i) => ({ path: formatPath(i.path), message: i.message })) };
}

export const validateTrack = (input: unknown): ValidationResult<IstepTrack> => run(IstepTrack, input);
export const validateReference = (input: unknown): ValidationResult<ReferenceTimeline> =>
  run(ReferenceTimeline, input);

/** Parses JSON text then validates; JSON syntax errors are reported at the root. */
export function validateTrackText(text: string): ValidationResult<IstepTrack> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [{ path: '(root)', message: `invalid JSON: ${(e as Error).message}` }] };
  }
  return validateTrack(data);
}

/** Effective gate settings after applying track defaults (docs/04 §7). */
export function effectiveGateSettings(track: IstepTrack, gate: IstepTrack['gates'][number]) {
  return {
    coachAfterSec: gate.coachAfterSec ?? track.defaults?.coachAfterSec ?? 6,
    timeoutSec: gate.timeoutSec ?? track.defaults?.timeoutSec ?? 45,
    learning: gate.type === 'safety_prerequisite' ? false : (gate.learning ?? true),
    tolerance: { angleDeg: 20, curl: 0.3, ...track.defaults?.tolerance, ...gate.tolerance },
  };
}
