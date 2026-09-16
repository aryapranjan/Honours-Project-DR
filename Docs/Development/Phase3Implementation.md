# Phase 3: Laptop Server, Event Store, and Dashboard Foundation

Status: implemented and exit gates verified

Verification date: 2026-08-06

## Outcome

Phase 3 establishes the laptop as the sole authoritative study controller. The
browser is a refresh-safe experimenter view, and simulated Quest clients
exercise the same WebSocket command path that the real Unity clients will use
in Phase 4.

The implementation is in `StudyController/`.

## Locked Phase 3 workflow

- Pair IDs use `PAIR-001` style identifiers.
- Participant slots use pseudonymous IDs such as `P001-A` and `P001-B`.
- Director and Builder are role assignments and are stored separately from
  participant IDs.
- A validated master counterbalance plan is selected by pair ID, then copied
  into a session-specific configuration and schedule.
- The practice trial is `NO_DR` with the `KEYBOARD` distractor.
- The experimenter uses one `Record submission` control.
- An incorrect submission records the attempt and requires the standardized
  spoken response `Continue`; the same authoritative stopwatch remains running.
- A correct submission requires confirmation and ends the trial.
- The authoritative stopwatch counts upward from `00:00`. At `07:00` it shows
  a red warning and keeps running.
- Submissions remain recordable after `07:00` and are logged with
  `afterTimeLimit=true` and their actual elapsed time.
- A confirmed correct late submission ends as `TIMEOUT` and records the late
  correct completion time. The guarded `End trial — time limit reached` action
  remains available when no late correct submission occurs.
- Calibration override, technical invalidation, withdrawal, experimenter abort,
  recovery resolution, and session closure require a factual reason.
- Starting a prepared trial requires confirmation.
- A server restart during a committed, active, or stopping trial never resumes
  the stopwatch. It enters `RECOVERY_REQUIRED`.
- A technical invalidation of a scored trial schedules a linked reserve trial.
- Real Quest networking, AprilTag calibration, DR rendering, and OBS are not
  simulated as production-ready integrations in this phase.

## Implemented components

The Node.js 24 TypeScript server provides:

- `StudySessionManager`;
- `AuthoritativeTimer`;
- `EventLogger`;
- `SnapshotManager`;
- `ConnectionWatchdog`;
- `ClockSynchronizer`;
- `CounterbalanceScheduler`;
- `ExportValidator`;
- `CommandCoordinator`;
- Express REST routes;
- a `ws` gateway for dashboards and Quest clients; and
- simulated Director and Builder Quest clients.

The React/Vite dashboard provides session setup, device state, preflight,
simulated calibration, trial preparation and start, the authoritative stopwatch,
submission decisions, invalidation, withdrawal, recovery, faults, and export
validation.

## Persistence and recovery

The server writes data below a configurable study-data root:

```text
active-session.json
PAIR-001/
  session-config.json
  schedule.json
  authoritative-events.jsonl
  trial-summary.csv
  snapshots/
    latest.json
    state-000001.json
    ...
```

Event writes are serialized, appended, and synchronized to disk. Snapshots and
the active-session pointer use temporary files followed by atomic rename.
Existing pair directories are rejected rather than overwritten.

On restart, a non-active state is restored from the latest validated snapshot.
An interrupted committed or active trial enters recovery with the stopwatch
stopped. The experimenter must record one of:

- `TECHNICAL_INVALID`;
- `PARTICIPANT_WITHDRAWAL`; or
- `EXPERIMENTER_ABORTED`.

## Run

From `StudyController/`:

```sh
nvm use
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

For a production-style local run:

```sh
npm run build
npm start
```

Open `http://127.0.0.1:4317`.

The default checked-in counterbalance plan is explicitly simulation-only. Use
`COUNTERBALANCE_PLAN` to provide the approved master plan before participant
data collection.

## Exit-gate evidence

- Simulated practice trial: passed.
- Simulated scored trial: passed.
- Multiple submissions with an incorrect attempt continuing the stopwatch:
  passed.
- Upward stopwatch, 420-second warning, post-threshold incorrect and correct
  submissions, late-correct `TIMEOUT` classification, guarded manual timeout,
  and frozen actual end elapsed time: passed.
- Browser refresh preserving server state: passed.
- Non-active server restart restoration: passed.
- Active-trial restart entering recovery without stopwatch resumption: passed.
- Contiguous append-only event history: passed.
- Preflight and calibration controls blocking invalid advancement: passed.
- Guarded start and correct-submission confirmation dialogs: passed.
- The prior practice-flow browser check reported no console errors.
- The current stopwatch UI typecheck and production build passed; a fresh live
  visual rerun was unavailable in this tool session.
- Node/server and React/dashboard typechecks: passed.
- Production server and dashboard builds: passed.
- Automated tests: see the current `npm run verify` result.

## Phase boundary

Phase 3 is a simulation foundation, not approval to collect participant data.
Before live collection, later phases must connect and validate the real Unity
clients, AprilTag calibration, DR targets, OBS media, questionnaires, the
production counterbalance plan, and the remaining pilot and ethics decisions.
