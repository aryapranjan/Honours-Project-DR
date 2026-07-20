# Study Controller Contracts

This folder contains the Phase 2 protocol and data contracts for the
Collaborative Diminished Reality study.

## Scope

Included:

- canonical JSON Schemas;
- TypeScript contract types;
- laptop and Quest state-transition rules;
- duplicate, stale-command, reconnect, and submission rules;
- validated example records; and
- focused contract tests.

Not included until later phases:

- HTTP or WebSocket servers;
- the React dashboard;
- Unity networking;
- AprilTag detection or calibration;
- diminished-reality rendering;
- OBS control; or
- participant data collection.

## Requirements

- Node.js 24 LTS
- npm

## Validation

```sh
npm install
npm run check
```

JSON Schema is the cross-platform source of truth. TypeScript types in `src/`
provide a small implementation-facing view of those contracts. Unity C# models
will be added with the Quest networking client rather than maintained
prematurely in Phase 2.

Files under `examples/` demonstrate valid contracts. They are not a production
counterbalance schedule, role allocation, asymmetric-recipient allocation, or
puzzle assignment. The practice-trial values are study decisions:
`NO_DR` with the `KEYBOARD` distractor.
