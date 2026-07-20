# Eight-Phase Development Plan

Status: authoritative engineering sequence

Last reconciled: 2026-07-20

Target duration: 14 weeks

This sequence supersedes earlier informal phase ordering. It follows the locked
architecture by establishing data contracts and authoritative control before
connecting calibration, DR, and media adapters.

No phase is complete until its exit gate passes.

## Phase 1: Clean PCA Baseline and Reproducible Build

Schedule: Week 1

### Objectives

- Establish the clean official Meta PCA repository as the implementation base.
- Preserve and review current user-created Unity configuration changes.
- Lock editor and package versions.
- Verify the complete Android build and one-headset PCA runtime.

### Work

- Audit current Git status and classify every existing modification.
- Preserve `Assets/Final-Design-Scene.unity`.
- Confirm Unity `6000.0.61f1`.
- Record MRUK, OpenXR, XR Management, and Inference Engine versions.
- Stop ignoring `Packages/packages-lock.json` or implement an equivalent
  reviewed dependency-locking policy.
- Create project folders for:
  - study core;
  - protocol;
  - networking;
  - calibration;
  - DR;
  - telemetry;
  - editor/build tooling;
  - tests; and
  - study configuration.
- Define assembly boundaries without altering Meta sample assemblies.
- Confirm Android, ARM64, IL2CPP, OpenXR, passthrough, and headset-camera
  permission.
- Build an APK in batch mode.
- Install and launch through the repository's Quest tooling.
- Verify PCA permission, texture acquisition, timestamp, intrinsics, and pose on
  one Quest 3.
- Record a baseline tag or commit.

### Exit gate

- Clean, documented Git state
- Reproducible package resolution
- Zero C# compile errors
- Successful Android APK
- PCA frame received on a physical Quest
- No continuous runtime exceptions
- Baseline build instructions recorded

## Phase 2: Protocol, State Machine, and Data Contracts

Schedule: Week 2

### Objectives

- Define behavior before building distributed components.
- Make every command, state transition, and data record versioned.

### Work

- Define protocol versioning.
- Define roles, conditions, distractors, targets, and trial outcomes.
- Define laptop states:
  - `SERVER_READY`;
  - `SESSION_SETUP`;
  - `PREFLIGHT`;
  - `CALIBRATION`;
  - `BLOCKED`;
  - `TRIAL_PREPARED`;
  - `TRIAL_COMMITTED`;
  - `TRIAL_ACTIVE`;
  - `TRIAL_STOPPING`;
  - `POST_TRIAL`;
  - `CONDITION_REVIEW`;
  - `SESSION_COMPLETE`; and
  - `RECOVERY_REQUIRED`.
- Define Quest local states.
- Define message envelopes containing:
  - protocol version;
  - session ID;
  - trial ID;
  - command ID;
  - state version;
  - sender;
  - target;
  - timestamp; and
  - payload.
- Define `PREPARE_TRIAL`, `READY`, `COMMIT_START`, `STARTED`, `SUBMIT`,
  `STOP_TRIAL`, `STOPPED`, `FAULT`, `HEARTBEAT`, and `STATE_SNAPSHOT`.
- Define idempotency, stale-command rejection, and reconnect rules.
- Define append-only event schemas.
- Define JSON configuration and CSV export schemas.
- Add schema validation and unit tests.

### Exit gate

- Protocol and state diagrams reviewed
- JSON schemas or equivalent typed contracts committed
- Invalid transitions rejected by tests
- Duplicate and stale command behavior tested
- Example session log validates successfully

### Implementation record

The Phase 2 implementation is in `StudyController/`. It contains protocol
`1.0.0` JSON Schemas, TypeScript contract types, deterministic laptop and Quest
state machines, protocol rules, diagrams, and validated examples. The Node.js
24 typecheck and all 18 focused tests pass. The commit containing this record is
the Phase 2 lock-in point.

## Phase 3: Laptop Server, Event Store, and Dashboard Foundation

Schedule: Weeks 3-4

### Objectives

- Create the authoritative system before connecting real headsets.
- Ensure browser refresh cannot destroy the session.

### Work

- Create the Node.js 24 TypeScript workspace.
- Implement Express and static dashboard serving.
- Implement the `ws` gateway.
- Implement:
  - `StudySessionManager`;
  - `AuthoritativeTimer`;
  - `EventLogger`;
  - `SnapshotManager`;
  - `ConnectionWatchdog`;
  - `ClockSynchronizer`;
  - `CounterbalanceScheduler`;
  - `ExportValidator`; and
  - `CommandCoordinator`.
- Create a React/Vite dashboard with:
  - session setup;
  - device status;
  - preflight;
  - calibration status;
  - trial control;
  - timer;
  - fault display;
  - media status;
  - submission;
  - invalidation;
  - recovery; and
  - export validation.
- Implement simulated Quest clients.
- Make critical commands require guarded confirmation.
- Restore session snapshots after server restart without resuming a timer.

### Exit gate

- Full simulated practice and scored trial
- Browser refresh preserves session
- Server restart restores non-active state
- Active-trial restart enters recovery rather than auto-resume
- Append-only event history is complete
- Dashboard clearly blocks invalid actions

## Phase 4: Unity Quest Client and Reliable Networking

Schedule: Weeks 5-6

### Objectives

- Connect the same Unity APK as two role-assigned clients.
- Make network faults visible and recoverable.

### Work

- Add NativeWebSocket.
- Add Android Internet permission.
- Implement:
  - `StudyNetworkClient`;
  - `CommandValidator`;
  - `LocalStudyState`;
  - `QuestEventLogger`;
  - `ReadinessReporter`;
  - `ClockSyncClient`; and
  - development-only status UI.
- Support runtime Director or Builder assignment.
- Implement authentication using session/device enrollment rather than a
  hard-coded role.
- Implement heartbeat, reconnect, exponential backoff, and snapshot recovery.
- Persist a local backup event log.
- Reject incompatible protocol and app versions.
- Implement development simulators for delay, packet duplication, and
  disconnection.

### Exit gate

- Two simulated or physical clients connect simultaneously
- Runtime role assignment works
- Commands acknowledge exactly once
- Duplicate commands are idempotent
- Reconnection restores authoritative state
- Three-second fault timer is measurable
- Quest logs remain available after disconnect

## Phase 5: Six-Tag Detection, Rig Calibration, and Quality Reporting

Schedule: Weeks 7-8

### Objectives

- Generalize the earlier keyboard detector into a robust room-rig subsystem.
- Produce objective calibration quality rather than a boolean result.

### Work

- Integrate the reviewed AprilTag library for Android ARM64.
- Define tag configuration assets for IDs `1-6`.
- Use physical tag size `0.092 m` unless remeasurement changes the configured
  value before pilot lock.
- Use PCA intrinsics, extrinsics, timestamp, and camera pose.
- Handle supported PCA resolution and aspect-ratio changes explicitly.
- Expose structured tag observations.
- Prefer detected-corner projection for visual debug outlines.
- Implement temporal filtering without hiding real movement.
- Reject implausible jumps and stale poses.
- Implement:
  - two-tag keyboard rig solve;
  - four-tag TV rig solve;
  - TV redundancy with a pilot-approved minimum visible set;
  - residual and stability metrics;
  - calibration attempts;
  - quality result;
  - failure reasons; and
  - rig-relative target transforms.
- Send calibration reports to the laptop start gate.
- Store only derived observations, not raw PCA frames.

### Exit gate

- Tag outlines visually align on-device
- Keyboard measured geometry is consistent with `0.45 m`
- TV solve remains stable during brief loss of one tag
- Repeated calibrations are consistent within pilot tolerance
- Failed calibration produces an actionable reason
- Both Quests report compatible rig transforms

## Phase 6: Generic DR Targets and Visual Calibration

Schedule: Weeks 9-10

### Objectives

- Replace keyboard-specific mask logic with configurable TV and keyboard targets.
- Make DR state explicit and laptop-controlled.

### Work

- Create target-profile assets containing:
  - target ID;
  - rig-relative transform;
  - dimensions;
  - replacement texture or mesh;
  - material;
  - feather;
  - brightness;
  - contrast;
  - tint;
  - opacity; and
  - profile version.
- Implement `DiminishedRealityManager`.
- Implement explicit `Prepare`, `Show`, `Hide`, `Reveal`, and `ReportState`.
- Remove automatic mask appearance after calibration.
- Prevent participant controller shortcuts in study builds.
- Implement TV and keyboard profiles.
- Use prior keyboard feather `0.003 m` as an initial value, not an immutable
  final setting.
- Define target offsets in named rig coordinates.
- Add visual debug mode for target bounds and axes.
- Test z-fighting, one-eye artifacts, pose stability, and frame rate.
- Record requested and actual DR states.

### Exit gate

- Both targets align with their physical objects
- DR remains stable during normal head movement
- No-DR state contains no replacement geometry
- Laptop state and Quest state agree
- No uncontrolled local toggle exists
- Quest performance meets the pilot threshold

## Phase 7: Trial Workflow, Stimuli, OBS, Questionnaires, and Export

Schedule: Weeks 11-12

### Objectives

- Integrate the study modules into one guarded, auditable workflow.

### Work

- Implement validated schedule loading.
- Implement one practice and six scored-trial definitions.
- Implement role and asymmetric-recipient counterbalancing.
- Add one manual preflight confirmation that the scheduled distractor
  condition is correctly set.
- Do not collect detailed TV playback or keyboard device-state telemetry.
- Integrate OBS WebSocket control.
- Add overhead camera preview and recording readiness.
- Add two-channel audio readiness, level, clipping, and silence checks.
- Generate media filenames from pseudonymous IDs.
- Add Builder verbal-submission workflow.
- Add timeout, incorrect submission, invalidation, and reserve-puzzle paths.
- Add questionnaire completion gates and configurable delivery adapter.
- Implement artifact manifest and checksums.
- Generate validated CSV exports from JSONL.
- Keep optional Whisper transcription out of the live trial path.

### Exit gate

- One complete mock session runs from the dashboard
- Correct TV and keyboard state is enforced
- OBS media starts, stops, and names files correctly
- Both participant audio channels are present
- Submission and timeout behavior is correct
- Invalid trials link to replacements
- Exports account for every expected trial and artifact

## Phase 8: Fault Injection, Pilot, Validation, and Release Freeze

Schedule: Weeks 13-14

### Objectives

- Test the complete system under realistic failure and study conditions.
- Freeze a reproducible release only after pilot evidence.

### Work

- Conduct two-Quest soak tests.
- Deliberately test:
  - Wi-Fi interruption;
  - server restart;
  - Quest restart;
  - stale and duplicate commands;
  - calibration degradation;
  - one TV tag occluded;
  - wrong DR state;
  - OBS failure;
  - microphone silence or clipping;
  - storage-full behavior;
  - low battery;
  - thermal warning;
  - HDMI loss; and
  - incorrect keyboard confirmation.
- Finalize room seating and survey.
- Pilot puzzle difficulty and timeouts.
- Pilot salience manipulation checks.
- Pilot scoring tolerances and rater agreement.
- Measure frame rate, network latency, calibration error, DR alignment, and
  media synchronization.
- Finalize questionnaires and operator instructions.
- Complete University storage and retention decisions.
- Freeze:
  - Unity APK;
  - server and dashboard;
  - protocol version;
  - schedule version;
  - target profiles;
  - puzzle set;
  - stimulus assets;
  - questionnaire versions; and
  - operator manual.

### Exit gate

- Complete dyad session runs without developer intervention
- All deliberate faults are visible and correctly classified
- No silent data loss
- Main data and media manifests validate
- Pilot thresholds are documented
- Ethics and storage requirements are resolved
- Same frozen APK runs on both Quests
- Release artifacts and source revision are archived

## Timeline

| Week | Phase |
|---|---|
| 1 | Clean PCA baseline |
| 2 | Protocol and data contracts |
| 3-4 | Laptop server and dashboard |
| 5-6 | Quest networking client |
| 7-8 | Six-tag calibration |
| 9-10 | Generic DR targets |
| 11-12 | Study workflow and media |
| 13-14 | Pilot, hardening, and freeze |

## Scope Protection

The following must not delay the core path:

- automatic tangram computer vision;
- cloud transcription;
- sophisticated experiment analytics dashboards;
- participant-facing Quest UI;
- automated keyboard hardware control;
- extra distractor types; and
- new networking frameworks.

They may be revisited only after the Phase 7 exit gate.
