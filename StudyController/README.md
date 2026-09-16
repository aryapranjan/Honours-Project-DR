# Collaborative DR Study Controller

This folder contains the Phase 2 contracts, Phase 3 laptop-authoritative
controller, Phase 4 Quest-networking foundation, Phase 5 calibration path, and
Phase 6 diminished-reality control/reporting path for the Collaborative
Diminished Reality study.

## Scope

Included:

- canonical JSON Schemas and TypeScript contract types;
- an Express server and `ws` gateway;
- the authoritative session manager and upward stopwatch with a 420-second
  threshold;
- append-only JSONL events and atomic JSON snapshots;
- pre-generated counterbalance-plan selection and reserve-trial scheduling;
- restart recovery that never resumes an interrupted stopwatch;
- validated CSV trial-summary export;
- a React/Vite experimenter dashboard;
- authenticated physical Quest enrollment into temporary `QUEST_A` and
  `QUEST_B` session slots;
- slot-selective simulated Quest clients, including one-physical/one-simulator
  testing;
- exact approved-build and compatible protocol-major gates;
- hashed bearer-token authentication for Quest WebSockets;
- canonical, SHA-256-verified state snapshots and explicit short-reconnect
  continuation;
- automatic technical invalidation when a disconnect exceeds 3000 ms;
- export-gated, explicit Quest backup-log cleanup;
- simultaneous six-second calibration commands for both Quest slots;
- strict derived-only six-tag calibration reports and a guarded start gate;
- physical cross-Quest rig-transform compatibility checks;
- calibrated, profile-driven TV and keyboard replacement masks;
- explicit DR `Prepare`, `Show`, `Hide`, `Reveal`, and state-report commands;
- an environment-gated researcher preview that is unavailable during trials;
- clear-passthrough fail-safe behavior and actual-versus-requested DR reports;
- laptop and Quest state-transition rules;
- duplicate, stale-command, reconnect, and submission rules;
- late-submission recording with late correct finishes classified as `TIMEOUT`;
- validated example records; and
- unit and integration tests.

Not included until later phases:

- final photographed wall/desk replacement textures and pilot tuning;
- OBS control and real media readiness;
- questionnaires; or
- participant data collection.

## Requirements

- Node.js 24 LTS
- npm 11

Use the pinned Node version:

```sh
nvm use
npm install
```

## Run the controller

For development:

```sh
npm run dev
```

Open `http://127.0.0.1:5173`. The Vite dashboard proxies to the authoritative
server on port `4317`.

For the production-style local build:

```sh
npm run build
npm start
```

Open `http://127.0.0.1:4317`.

The production server listens on all interfaces by default and displays its
detected LAN address in the dashboard. The default data root is `.study-data/`.
Override deployment values without changing code:

```sh
STUDY_DATA_ROOT=/approved/capture/path \
COUNTERBALANCE_PLAN=/approved/master-plan.json \
ADVERTISED_HOST=192.168.1.20 \
APPROVED_QUEST_BUILD_ID=cdr-phase6-dev-1 \
DR_PREVIEW_ENABLED=true \
npm start
```

`ADVERTISED_HOST` is the MacBook address reachable from the dedicated study
Wi-Fi. The default approved Quest build is `cdr-phase6-dev-1`; use the exact ID
compiled into the approved APK. `DR_PREVIEW_ENABLED=true` exposes the
researcher-only placement panel during calibration; omit it for study runs.

After creating a session, issue a six-digit pairing code for one temporary slot
from the dashboard and redeem it on that Quest. A code is slot-specific,
single-use, and expires after five minutes. Pairing produces an access token
that is sent only in the Quest WebSocket `Authorization: Bearer` header. Tokens
are process-local and only their SHA-256 hashes are retained by the server; a
server restart therefore requires re-enrollment.

For hybrid testing, pair the physical headset into one slot, then start the
simulator only for the other slot from the dashboard.

The checked-in
`examples/counterbalance-plan.example.json` is for simulation only. It is not a
production allocation plan and must not be used for participant data
collection.

## Verify

```sh
npm run verify
```

This runs the Node and dashboard typechecks, the complete test suite, and both
production builds.

## Session data

Each pseudonymous pair receives its own directory containing:

- `session-config.json`;
- `schedule.json`;
- `authoritative-events.jsonl`;
- versioned snapshots plus `snapshots/latest.json`; and
- `trial-summary.csv` after export validation.

Existing pair directories are never overwritten. Raw Quest passthrough frames
are not recorded, persisted, or transmitted.

JSON Schema remains the cross-platform source of truth. Protocol `1.3.0` and
schema `1.4.0` define the laptop/Quest boundary; see
[`docs/protocol.md`](docs/protocol.md) for enrollment, recovery, and local-log
lifecycle details.
