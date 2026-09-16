# Eight-Phase Development Plan

Status: authoritative engineering sequence

Last reconciled: 2026-08-26

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
  - upward stopwatch and time-limit warning;
  - fault display;
  - media status;
  - on-time and post-limit submission;
  - invalidation;
  - recovery; and
  - export validation.
- Implement simulated Quest clients.
- Make critical commands require guarded confirmation.
- Restore session snapshots after server restart without resuming a stopwatch.

### Exit gate

- Full simulated practice and scored trial
- Browser refresh preserves session
- Server restart restores non-active state
- Active-trial restart enters recovery rather than auto-resume
- Append-only event history is complete
- Dashboard clearly blocks invalid actions

### Implementation record

Phase 3 is implemented in `StudyController/`. The laptop-authoritative Express
and `ws` server, React/Vite dashboard, append-only event store, atomic snapshots,
upward stopwatch with a 420-second threshold, validated master-allocation
selection, simulated Quest clients, linked reserve-trial scheduling, recovery
flow, and CSV export are in place. Automated tests cover a full simulated
practice and scored trial, non-active restart restoration, active-trial
recovery without stopwatch resumption, on-time and post-limit submissions,
manual timeout, event ordering,
snapshots, timing, watchdog behavior, and counterbalance replacement. The
experimenter dashboard was also exercised in a browser through the
practice-trial path, including guard behavior and refresh persistence.

See `Docs/Development/Phase3Implementation.md` for the exact run instructions,
locked Phase 3 workflow, and exit-gate evidence.

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
- Use one-time six-digit enrollment codes to assign temporary `QUEST_A` and
  `QUEST_B` slots, pseudonymous participants, and runtime roles.
- Keep the client persistent in `Final-Design-Scene` with a temporary
  researcher setup panel and an app-owned minimal participant waiting view.
- Permit controller input during researcher setup only; keep trials
  controller-free.
- Use authenticated local `ws://` on the isolated router with a configurable
  advertised address.
- Preserve the last safe DR state for disconnects lasting no more than three
  seconds, apply the authoritative snapshot, and require explicit experimenter
  confirmation before continuation.
- For disconnects lasting more than three seconds, clear DR, restore clear
  passthrough, and enter `TECHNICAL_INVALID`.
- Retain local Quest logs until a valid laptop export and separate
  checksum-gated cleanup action.
- Require an exact approved app build identifier and compatible protocol major
  version.

### Exit gate

- Two simulated or physical clients connect simultaneously
- Runtime role assignment works
- Commands acknowledge exactly once
- Duplicate commands are idempotent
- Reconnection restores authoritative state
- Three-second fault timer is measurable
- Quest logs remain available after disconnect

### Implementation record

The Phase 4 foundation is implemented but the phase is not yet complete. The
StudyController now provides one-time enrollment, authenticated WebSockets,
temporary slot assignment, build/protocol gates, snapshot recovery,
experimenter-confirmed continuation, fault handling, log-status reporting, and
explicit export-gated cleanup. Its verification passes `37/37` tests.

The Unity client now includes the pinned NativeWebSocket dependency, Android
Internet/cleartext configuration for the isolated authenticated local network,
role-neutral enrollment, command validation and idempotency, heartbeat and
reconnect handling, canonical snapshot verification, local JSONL backup
logging, fail-safe passthrough control, and the setup/waiting/fault UI. Unity
project validation passes. The refreshed `Logs/Phase4EditModeResults.xml`
records `8/8` passed with none failed or skipped at
`2026-08-11 06:58:08Z`. The refreshed
`Logs/Phase4PlayModeControllerResults.xml` records `2/2` passed with none failed
or skipped from `2026-08-11 07:31:09Z` to `07:31:10Z`; the suite covers the
transparent camera-clear and mobile right-controller contracts.

Protocol `1.1.0`, schema `1.4.0`, and build ID `cdr-phase4-dev-1` identify this
development foundation. The calibration response is an explicit Phase 4
test-only override; real AprilTag calibration and DR behavior remain Phase 5
and Phase 6.

The Android development build completed successfully at
`2026-08-11 17:36:38 +0930`. The artifact is
`Builds/Android/CollaborativeDR-Phase4.apk`, size `86,101,218` bytes, SHA-256
`15a773ea04925ec882105a9da08ccc718e6ec937222a1091b6dc1ae5343dad46`. The
packaged debug manifest was verified to contain
`horizonos.permission.HEADSET_CAMERA` and `android.permission.INTERNET`, set
`android:usesCleartextTraffic="true"`, and omit
`android:networkSecurityConfig`.

Using `hzdb`, the APK was installed non-destructively on Quest 3 serial
`2G0YC1ZF9Z03HD` under the Wearable Computer Lab profile. The rebuilt app
launched in `240 ms` with no crash signal. A fresh
`hzdb log -n 300 -t Unity -l W` returned no warnings while the app was off-head.
The final Unity validator passed. The server is live at `192.168.1.106:4317` in
`SERVER_READY` with no session before pairing.

The right-controller fault had two causes: `OVRInputModule` did not permit
mobile activation, and `RightControllerAnchor` contained no controller object.
The scene now places the official Meta Core v85 `OVRControllerPrefab` under the
right anchor, explicitly assigns `RTouch`, assigns its child `OVRRayHelper`, and
uses `PrimaryIndexTrigger` for setup selection. The setup controller is active
only during `Setup`, `Enrolling`, `Connecting`, and `Synchronizing`; trial
states remain controller-free.

Meta Core v85 `OVRRaycaster` leaves `RaycastResult.worldNormal` at zero. The
optional cursor in `OVRRayHelper` used that zero normal and produced
`Look rotation viewing vector is zero` every frame. The final configuration
disables the cursor GameObject and nulls `Cursor` and `CursorFill`, while
retaining the `Renderer` beam, hover, and `PrimaryIndexTrigger` selection. The
build validator requires a non-null `Renderer` and null cursor references.

On-device capture exposed stereo bands caused by `CenterEyeAnchor` using
`CameraClearFlags.Nothing`. The camera now uses
`CameraClearFlags.SolidColor` with transparent colour for the passthrough
underlay. A runtime guard, build configure/validation path, and PlayMode
regression assertion protect the fix. The follow-up screencap shows clean
stereo UI with no bands. Passthrough is protected and therefore black in normal
screencaps. `hzdb metacam` is available and worked. On the immediately preceding
controller build (SHA-256
`938ede286080e882bb292faca12087b6b0950af31a565350e8e117c29f70462d`),
`Logs/Phase4Device/phase4-controller-fix-metacam.png` shows the right Touch
model, white beam, and cursor over the setup keypad. Trigger input changed the
address to `5888` and produced the six-digit pairing validation status. This is
positive physical evidence for the controller model, ray, and setup-input path.

Phase 4 remains open. Physical-plus-simulator enrollment, reconnect, snapshot
recovery, explicit experimenter continuation, and fault injection are still
pending. The final cursor-suppressed build did pass its on-head controller gate
on `2026-08-12`: the Unity activity was focused, the right controller was
`CONNECTED_ACTIVE` with positional tracking, the white beam and clear
passthrough were visible, and trigger interaction cleared the four-character
pairing field. The resulting state is captured in
`Logs/Phase4Device/phase4-controller-final-trigger-confirmed.png` (SHA-256
`f41722e860bba6c6bc25b8ed623401317800feba2a6e0f2a6c5df0f784f6b8a0`). A
700-line Unity warning query and broader filtered scan found no controller,
EventSystem, null-reference, or `Look rotation` warning. The two-physical-Quest
exit gate must still be repeated when the second device is available. Before
release freeze, record the actual reserved IPv4 address, assign the final
approved production build ID, and reconcile the pinned NativeWebSocket
package's upstream licence declarations.

## Phase 5: Six-Tag Detection, Rig Calibration, and Quality Reporting

Schedule: Weeks 7-8

### Objectives

- Generalize the earlier keyboard detector into a robust room-rig subsystem.
- Produce objective calibration quality rather than a boolean result.

### Work

- Integrate the reviewed AprilTag library for Android ARM64.
- Define tag configuration assets for IDs `1-6`.
- Lock the mounted keyboard order from the seated participant view as tag `1`
  on the physical left and tag `2` on the physical right, with keyboard `+X`
  pointing left-to-right from `1` to `2` and `+Z` pointing from participants
  toward the TV.
- Use detection-corner tag size `0.0567 m`, measured between the black/white
  border junctions of the final printed `tagStandard41h12` set. It is five
  ninths of the measured `0.102 m` printed pattern; do not use the backing card
  or a legacy prototype measurement for pose estimation.
- Use PCA intrinsics, extrinsics, timestamp, and camera pose.
- Handle supported PCA resolution and aspect-ratio changes explicitly.
- Expose structured tag observations.
- Prefer detected-corner projection for visual debug outlines.
- Implement temporal filtering without hiding real movement.
- Reject implausible jumps and stale poses.
- Reject only isolated positional outliers using a conservative robust rule;
  keep broad or sustained position instability as a blocking failure.
- Retain per-tag rotation RMS as a diagnostic warning rather than a calibration
  gate because the authoritative room frames are solved from tag-centre
  positions.
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
- Keyboard measured geometry is consistent with the final-room nominal `0.40 m`
- TV solve remains stable during brief loss of one tag
- Repeated calibrations are consistent within pilot tolerance
- Failed calibration produces an actionable reason
- Both Quests report compatible rig transforms

### Implementation record

The Phase 5 software path and the available-Quest derived-calibration gate are
implemented, but the full physical exit gate is not yet complete. The reviewed
AprilTag package is embedded at version `1.0.3` with its
Android ARM64 binary checksum validated. Unity contains a six-tag PCA
observation source, temporal quality filtering, keyboard/TV rig solver,
three-of-four TV redundancy, calibration-only outlines, structured failure
reasons, and derived-only reporting. The tag family is `tagStandard41h12` and
the locked detector-corner side is `0.0567 m`. The
`PROVISIONAL_PHASE5_V2` profile adds conservative median/MAD isolated-position
outlier rejection, quaternion-medoid reporting, camera-facing corner-ray
outlines, and non-blocking rotation diagnostics while preserving blocking
position and geometry gates.

StudyController protocol `1.2.0` commands both slots in one six-second attempt,
records strict per-Quest reports, compares two physical rig-relative TV
transforms, marks physical-plus-simulator comparison as `DEFERRED`, and blocks
trial preparation on failure. The pinned Node 24 verification passes `40/40`
tests and both production builds. Unity `6000.0.61f1` compilation and the Phase
5 configuration/validation commands pass. The refreshed Unity EditMode result
`Logs/Phase5FinalMappingEditModeResults-20260826.xml` records `16/16` passed with
none failed or skipped (SHA-256
`85087f7c0d0a897220c08e69807ad376816146ba80a79c08b7bce3cfeecab8eb`).
The earlier `cdr-phase5-dev-1` Android IL2CPP build
passed and is preserved as
`Builds/Android/CollaborativeDR-Phase5-dev1-045m.apk` (`78,459,099`
bytes; SHA-256
`7c21794b7a45891efdc0696bb6e530cadcedc7bdac3f75d9a2b185c1ac85df62`).
That superseded `0.45 m` APK was installed non-destructively on the available
Quest 3. Its `186 ms` cold launch produced no package-specific Java, ANR, or
native crash signal. The superseded `cdr-phase5-dev-2` APK is preserved as
`Builds/Android/CollaborativeDR-Phase5-dev2-0112m.apk` (`82,189,424` bytes;
SHA-256
`ae0154f5e3a0b284b021b13e84c7ecece0387a091a89bcfe2845840837d51e3b`), but it
used the mistaken `0.112 m` backing-card measurement. The current
`cdr-phase5-dev-3` APK was rebuilt in place, without creating dev-4, for the
corrected `0.0567 m` detector-corner size, final-room `0.40 m` keyboard
geometry, participant-view keyboard order `1` left and `2` right, confirmed TV
corner order, and V2 robustness profile. It is
`Builds/Android/CollaborativeDR-Phase5.apk` (`102,390,591` bytes; SHA-256
`803c96541818c75575ead0e94dd5bfb921543955689f5107eff347bed512bb50`). It was
installed non-destructively on the available Quest 3; the installed APK
was pulled back and matched the approved host artifact exactly by size and
SHA-256. Generated ARM64 IL2CPP code contains the same final keyboard and TV
defaults. The strict V2 report contract prevents an older dev-3/V1 APK from
being silently mixed with this build. A server-free launch plus Unity-warning
and broad package-specific crash/ANR scans found no matching signal, and the
headset-camera permission is granted. The corrected build subsequently produced
a real `QUEST_A` `PASS` report on `2026-08-26`, observing all IDs `1-6` with
`151` accepted and two robustly rejected observations. Keyboard spacing was
`0.391986 m` with an `0.008014 m` residual; TV-planarity RMS was `0.001548 m`.
The recovered axes place tag `1` at negative X, tag `2` at positive X, and the
TV at positive Z with a near-identity frame rotation. No failure reasons were
reported and raw frames were not persisted. The recorded Quest clock mismatch
does not block this functional test, but it must be corrected before formal
timestamped evidence capture. Because the other report was simulated,
cross-headset compatibility was correctly `DEFERRED`. Visual outline
confirmation, repeated and three-of-four-TV-tag pilot attempts, and the later
two-physical-Quest compatibility gate remain required before Phase 5 can be
closed.

See `Docs/Development/Phase5Implementation.md` for the exact implementation and
remaining physical test sequence.

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

### Implementation status — 2026-09-01

The generic Phase 6 software path is implemented. Unity contains shared
profile assets, calibrated TV/keyboard placement, a texture-ready feathered
unlit mask, explicit lifecycle commands, actual-state reports, debug bounds,
and clear-passthrough fail-safe behavior. Protocol `1.3.0` and build
`cdr-phase6-dev-1` add a researcher preview that is disabled by default and
unavailable during trials. Controller verification passes `41/41`; Unity
The latest Phase 6 EditMode verification passes `21/21`, including the
perspective-compensated recessed TV plane and enlarged keyboard desk plane.

The software implementation does not close the physical exit gate. The white
pilot masks must still be installed and inspected on the Quest for coverage,
both-eye artifacts, head-motion stability, and sustained 72 FPS. Photographed
wall/desk appearance tuning and the two-physical-Quest repeat remain pending.
See `Docs/Development/Phase6Implementation.md`.

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
- Add guarded manual timeout, on-time and post-limit submission, invalidation,
  and reserve-puzzle paths.
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
- participant-facing Quest UI beyond the locked minimal waiting and safety
  views;
- automated keyboard hardware control;
- extra distractor types; and
- new networking frameworks.

They may be revisited only after the Phase 7 exit gate.
