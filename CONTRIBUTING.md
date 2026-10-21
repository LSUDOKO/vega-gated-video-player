# Contributing

Issues and pull requests are welcome. Please:

- keep `src/istep` and `src/engine` pure TypeScript (no DOM, no React Native imports);
- add or update vitest tests for any engine change (`npm test`);
- never loosen safety-gate behaviour (safety gates use fixed thresholds from the `.istep` file);
- describe changes to the `.istep` format in the README and the JSON Schema.
