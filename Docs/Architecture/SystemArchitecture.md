# Robust Study System Architecture

Status: core architecture locked for implementation (2026-07-15)

The core controller, networking, trial-state, calibration, DR-control, media,
and logging boundaries are locked. Items explicitly marked as deferred remain
configurable deployment adapters and do not authorize implementation
assumptions.

## Architectural Decision

The experimenter laptop is the sole authoritative controller. The two Quest
headsets are command-driven clients and do not communicate directly with one
another. The physical tangram task therefore does not require Photon, Unity
Netcode, or synchronized virtual game objects.

The browser is only a view and control surface. Refreshing or closing Chrome
must not destroy the active session because all authoritative state belongs to
the local Node.js server.

## Technology Baseline

- Laptop runtime: Node.js 24 LTS and TypeScript
- Dashboard: React and Vite, served locally
- HTTP server: Express
- Realtime transport: WebSocket using `ws`
- Quest transport: NativeWebSocket for Unity
- Quest application: Unity 6, C#, Android/IL2CPP
- Media capture: OBS Studio controlled by the laptop server
- Authoritative event store: append-only JSONL
- Analysis exports: CSV
- Configuration and snapshots: JSON
- Network: isolated local router with a fixed laptop IP

## System Boundaries

### Laptop controller

- `ExperimentDashboard`: shows state and exposes guarded experiment commands.
- `StudySessionManager`: owns pair ID, roles, condition order, trial state, and
  recovery state.
- `CounterbalanceScheduler`: loads a pre-generated and validated schedule.
- `CommandCoordinator`: performs prepare/ready/commit command handshakes.
- `AuthoritativeTimer`: owns the seven-minute trial clock.
- `ClockSynchronizer`: estimates each Quest clock offset and round-trip time.
- `ConnectionWatchdog`: evaluates heartbeats and blocks unsafe transitions.
- `EventLogger`: immediately appends all commands, acknowledgements, state
  changes, submissions, faults, and experimenter actions.
- `SnapshotManager`: writes recoverable session state after every transition.
- `ExportValidator`: verifies expected trials and files before closing a
  session.
- `ObsMediaCaptureService`: checks recording readiness, starts/stops capture,
  monitors the overhead camera and audio levels, and records media filenames.
- `QuestionnaireAdapter`: enforces questionnaire completion gates while the
  final participant-facing delivery method remains configurable.

### Quest client, one instance per participant

- `StudyNetworkClient`: connects, authenticates the device, reconnects, and
  exchanges heartbeat messages.
- `CommandValidator`: rejects stale, duplicate, invalid, or out-of-order
  commands.
- `LocalStudyState`: stores the last committed server state version.
- `AprilTagCalibrationManager`: calibrates and reports objective quality data.
- `DiminishedRealityManager`: applies the requested target and DR state.
- `QuestEventLogger`: stores a local backup of received commands and resulting
  state changes.
- `ReadinessReporter`: acknowledges prepared, committed, started, and stopped
  states.

### Physical study layer

- Keyboard AprilTags `1-2`, with a measured centre distance of `0.45 m`
- TV AprilTags `3-6`, arranged around the TV outside the diminished region
- Fixed TV, RGB keyboard, measured reference geometry, and room lighting
- Private printed target card for the Director
- Standardized physical tangram pieces and workspace
- USB overhead workspace camera recorded through OBS Studio
- Two external participant microphones recorded through OBS Studio; the final
  microphone/interface topology is a deferred hardware decision
- Manual MacBook control of the keyboard RGB mode
- HDMI control of the TV stimulus from the MacBook
- Manual physical-state checklist for TV and keyboard state

## Guarded Trial Protocol

1. The server loads the scheduled trial but does not activate it.
2. It sends `PREPARE_TRIAL` with a unique command ID and state version.
3. Each Quest validates the command, applies the requested configuration, and
   replies with `READY`, calibration quality, DR state, app version, and device
   status.
4. The dashboard checks physical distractor state, camera, audio, storage, and
   batteries.
5. The server sends `COMMIT_START` containing a synchronized future start time.
6. Both Quests acknowledge the committed state.
7. The server starts the authoritative timer and writes `TRIAL_STARTED`.
8. Submission, completion, timeout, protocol deviations, and faults are logged
   as immutable events.
9. The server stops both clients and validates expected data before allowing the
   next trial.

No trial can start unless both Quest clients are connected, calibrated, running
the approved app version, and reporting the expected DR state.

The unscored practice trial uses the same guarded protocol. It is identified as
`PRACTICE`, excluded from analysis exports, and completed before the first
scored condition block.

## Failure Policy

- Failures are never hidden or silently corrected.
- A critical fault before a trial leaves the system in `BLOCKED`.
- A critical fault during a trial transitions it to `TECHNICAL_INVALID`.
- An invalid trial is retained in the event history and never overwritten.
- A reserve puzzle is used for an approved replacement trial.
- Restarting the server restores the latest snapshot but never automatically
  resumes an active timer.
- Duplicate commands are idempotent and return the original result.
- Reconnected clients receive the full current state snapshot before accepting
  new commands.

Critical faults include loss of a required headset, calibration outside the
pilot-defined tolerance, wrong DR state, recording failure, server storage
failure, incompatible app version, or unrecoverable clock synchronization.
A critical network, calibration, or DR-state fault persisting for more than
three seconds invalidates the active trial and requires a reserve puzzle.

## Authoritative Data Layout

```text
StudyData/
  Pair-P012/
    session-config.json
    schedule.json
    authoritative-events.jsonl
    trial-summary.csv
    director-quest-events.jsonl
    builder-quest-events.jsonl
    audio/
    overhead-video/
    questionnaires/
    checksums.txt
```

Participant names must not appear in the study data path. Media remains outside
the WebSocket command channel. Audio and video are aligned using authoritative
trial markers and clock-offset records.

## Experimental Configuration

The software supports three DR configurations:

- `NO_DR`: neither participant receives DR.
- `SYMMETRIC_DR`: both participants receive DR.
- `ASYMMETRIC_DR`: one preassigned participant receives DR.

Each configuration contains two distractor-type trials and is represented as a
block:

- High-salience TV trial: the TV plays one standardized muted, high-motion
  football segment while the keyboard RGB lighting is off.
- Low-salience keyboard trial: the keyboard runs one standardized slow,
  low-brightness colour cycle while the TV is black or off.

Only one distractor is active per trial. Because TV and keyboard also differ in
object identity, location, size, and appearance, the independent factor is
reported as `distractor type with intended salience levels`, not salience alone.
Pilot and post-trial ratings verify the perceived salience difference.

## Locked Deployment Decisions

- The MacBook is the sole authoritative controller.
- Both Quests run the same APK and receive roles at runtime.
- The MacBook, both Quests, and no unrelated clients use a dedicated Wi-Fi
  network. The laptop has a reserved local IP; Ethernet is not required.
- The Builder verbally says `submit`; the experimenter records the submission
  through the dashboard.
- The MacBook drives the TV over HDMI.
- OBS Studio captures the overhead camera and external microphones to a
  configurable encrypted SSD capture path.
- The keyboard RGB effect is changed manually from the MacBook and confirmed
  in the preflight checklist.

## Deferred Deployment Decisions

These do not block core implementation, but each blocks participant data
collection until resolved:

- Exact microphone models and whether they use one dual-channel interface or
  two independent USB devices
- Participant questionnaire delivery hardware
- Final room seating and surveyed TV/keyboard/tag transforms
- University-approved authoritative archive location, authorized research-team
  access, retention period, and SSD transfer/erasure procedure
- Pilot-derived calibration, salience, and puzzle-difficulty thresholds

## Implementation Order

1. Message schema, trial states, and append-only logger
2. Laptop server and dashboard preflight screen
3. Unity WebSocket client and connection simulator
4. Prepare/ready/commit trial handshake
5. Calibration and DR controller adapters
6. Counterbalanced schedule loader
7. Submission, timeout, fault, and recovery paths
8. OBS media control, markers, and configurable questionnaire workflow
9. Two-Quest soak testing and deliberate fault injection
10. Pilot-specific calibration thresholds and final validation
