# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-10-24

Docs, demo and tooling release. The library code (`src/`) is unchanged from 0.1.0.

### Added

- Live web demo in `demo/`: `createGatedPlayer()` driving an HTML `<video>` through a `MediaAdapter`, with a
  simulated learner (watch / perform), skeleton view, gate status and event log. Two lessons: heel raises and
  fingerspelling, with their videos in `demo/media/`.
- `demo/sim.test.ts`: checks through the real controller that a watching learner never passes a gate and a
  performing learner passes every gate of both lessons.
- `npm run demo:build` (esbuild) and `npm run demo:serve` (a dependency-free static server with HTTP Range support).
- GitHub Pages workflow (`.github/workflows/pages.yml`) that builds and deploys the demo.
- README: screenshots and Vega Virtual Device recordings, `.istep` reference with a gate-type table, API
  reference, architecture diagram, Vega notes, privacy, roadmap.
- Community files: `CHANGELOG.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue and pull request templates,
  `.editorconfig`.
- `package.json`: `homepage`, `bugs`, `author`, `engines` (Node ≥ 20).

### Changed

- CI also type-checks and builds the demo; `npm run typecheck` now covers `demo/`.
- `example/App.tsx` uses an HTTPS video URL (the Vega media player plays HTTPS sources only).

## [0.1.0] - 2026-10-21

First release, submitted with InStep to the hackathon.

### Added

- `.istep` v1.0: zod schema and types, `validateTrack()` / `validateTrackText()` with JSON-path errors, JSON Schema
  in `schema/`, seven example tracks.
- Pure TypeScript gate engine: `pose_match`, `hold_duration`, `rep_count`, `rhythm_bpm`, `hand_sign`,
  `sequence_order`, `safety_prerequisite`; One-Euro smoothing, mirroring, sway monitor, deterministic adaptive
  tolerance, auto-gates from a demonstration, synthetic fixtures.
- `createGatedPlayer()`: platform-independent timing controller (gates, loop segments, coaching events, camera
  loss, sway stop, together mode, session summary).
- `<GatedPlayer>` for Vega (W3C media `VideoPlayer` on a `KeplerVideoSurfaceView`) and `createFrameStream()`.
- `example/App.tsx`, vitest suite, CI (type-check and tests).

[0.2.0]: https://github.com/LSUDOKO/vega-gated-video-player/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/LSUDOKO/vega-gated-video-player/releases/tag/v0.1.0
