# vega-gated-video-player

**Body-aware video for Fire TV (Vega OS).** A React Native player that pauses a video at timed **gates** and
resumes when live pose or hand landmarks satisfy them — plus `.istep`, an open JSON format for those gates
(like WebVTT, but for movement).

Extracted from [InStep — the video that waits for you](https://github.com/LSUDOKO/InStep). MIT licensed.

```tsx
import { GatedPlayer, createFrameStream, validateTrack } from 'vega-gated-video-player/src/react-native';

const frames$ = createFrameStream(); // push MediaPipe-style landmarks from anywhere
const track = validateTrack(json); // a .istep file (zod-validated)
<GatedPlayer
  source={{ uri }}
  track={track.value}
  frames$={frames$}
  onGateEvent={(e) => console.log(e.type)}
  renderOverlay={(s) => <MyHud state={s} />}
/>;
```

## What's inside

| Path         | What                                                                                                                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/istep`  | `.istep` v1.0 zod schema, types, `validateTrack()` with JSON-path errors. JSON Schema in `schema/`.                                                                                                                           |
| `src/engine` | Pure TypeScript gate engine (no DOM / RN): 7 gate types, One-Euro smoothing, mirroring, sway monitor, deterministic adaptive tolerance, auto-gates from a demonstration, synthetic fixtures. Runs in Node, browsers and Vega. |
| `src/player` | `createGatedPlayer()` — platform-independent timing controller — and `<GatedPlayer>` for Vega (W3C media `VideoPlayer` on a `KeplerVideoSurfaceView`).                                                                        |
| `examples/`  | Seven `.istep` tracks: balance, rehab, sign language, CPR rhythm, kids poses.                                                                                                                                                 |

### Gate types

`pose_match` · `hold_duration` · `rep_count` · `rhythm_bpm` · `hand_sign` · `sequence_order` · `safety_prerequisite`

Safety gates are never loosened or skipped; adaptive tolerance only applies to learning gates and is deterministic.

## Use the engine without a player

```ts
import { createGateRunner, Gate } from 'vega-gated-video-player';
const runner = createGateRunner(Gate.parse(gateJson));
const result = runner.push({ ts: Date.now(), mirrored: false, pose: landmarks33 }); // → { status, progress, worst, … }
```

## Install in a Vega app

```bash
npm install github:LSUDOKO/vega-gated-video-player zod
```

Metro transpiles the TypeScript source. With the RN 0.72 Babel preset, add
`@babel/plugin-transform-logical-assignment-operators` and `@babel/plugin-transform-class-static-block` to
`babel.config.js` (zod 4 uses that syntax).

## Develop

```bash
npm install && npm test && npm run typecheck
```

See `example/App.tsx` for a demo landmark stream that drives the player without a camera.

## Privacy

The player only consumes numbers (normalised landmarks). It never needs camera images.
