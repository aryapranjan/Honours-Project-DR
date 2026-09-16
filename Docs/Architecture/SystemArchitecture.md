# Robust Study System Architecture

Status: core architecture locked for implementation

Last reconciled: 2026-08-14

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
- Network: isolated local router, bearer-authenticated Quest `ws://`, and a
  configurable advertised laptop address; the deployment IPv4 address will be
  reserved once its actual value is confirmed

## System Boundaries

### Laptop controller

- `ExperimentDashboard`: shows state and exposes guarded experiment commands.
- `StudySessionManager`: owns pair ID, roles, condition order, trial state, and
  recovery state.
- `CounterbalanceScheduler`: loads a pre-generated and validated schedule.
- `CommandCoordinator`: performs prepare/ready/commit command handshakes.
- `AuthoritativeTimer`: owns the upward stopwatch, 420-second threshold, and
  frozen end elapsed time.
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

- `StudyNetworkClient`: redeems one-time enrollment, authenticates the device,
  reconnects, exchanges heartbeat messages, and applies authoritative
  snapshots.
- `CommandValidator`: rejects stale, duplicate, invalid, or out-of-order
  commands.
- `LocalStudyState`: stores the last committed server state version.
- `AprilTagCalibrationManager`: calibrates and reports objective quality data.
- `DiminishedRealityManager`: applies the requested target and DR state.
- `QuestEventLogger`: stores a local backup of received commands and resulting
  state changes.
- `ReadinessReporter`: acknowledges prepared, committed, started, and stopped
  states.
- `HeadsetStudyView`: provides the temporary researcher setup panel, minimal
  app-owned participant waiting view, development overlay, and fail-safe fault
  view. Controller input is setup-only.
- `PassthroughSafetyController`: preserves the last safe DR state during a
  recoverable short disconnect and restores clear passthrough when a fault
  exceeds the allowed window.

### Phase 4 enrollment and connection boundary

1. The dashboard generates a one-time six-digit code for temporary session slot
   `QUEST_A` or `QUEST_B`.
2. A researcher enters the advertised server address and code on the Quest.
3. The enrollment response assigns the pseudonymous participant, role, slot,
   session, protocol, exact approved build, authenticated access token, and
   WebSocket endpoint.
4. The access token authenticates the local `ws://` connection. Codes and
   tokens are not written to study logs.
5. Temporary slot identity is session-scoped; either physical headset may be
   assigned to either participant without rebuilding the APK.

Both clients must share the protocol major version and exactly match the
approved build identifier. The active `cdr-phase6-dev-1` identifier is for
development and physical pilot testing only.

### Physical study layer

- Keyboard AprilTags `1-2`, with tag `1` physically left and tag `2` physically
  right from the seated participant view, and a nominal measured centre
  distance of `0.40 m`; keyboard `+X` points left-to-right from `1` to `2`, and
  `+Z` points from participants toward the TV
- TV AprilTags `3-6`, arranged as `4` top-left, `5` top-right, `6`
  bottom-right, and `3` bottom-left outside the diminished region
- Preliminary TV-tag centre rectangle approximately `1.673 m × 1.075 m`, with
  an approximate seated participant-to-wall distance of `1.30 m`; pilot
  remeasurement remains required
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
7. The server starts the authoritative stopwatch at `00:00` and writes
   `TRIAL_STARTED`.
8. Every submission is logged with its attempt number, decision, elapsed time,
   and whether it occurred after the threshold.
9. At 420 seconds, the server logs `TIME_LIMIT_REACHED` and warns the
   experimenter without automatically stopping the trial.
10. A correct late submission stops as `TIMEOUT` and preserves its late
    completion time. If none occurs, the experimenter may confirm the manual
    timeout action. The server freezes the stopwatch and stops both clients.
11. The server validates expected data before allowing the next trial.

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
  resumes an active stopwatch.
- Duplicate commands are idempotent and return the original result.
- A disconnect lasting no more than three seconds preserves the last safe local
  DR state while the authoritative laptop stopwatch continues. The Quest must
  validate and apply the full current snapshot, and the experimenter must
  explicitly confirm continuation before new trial commands are accepted.
- A critical disconnect lasting more than three seconds restores clear
  passthrough, removes DR, and transitions the active trial to
  `TECHNICAL_INVALID`.

Critical faults include loss of a required headset, calibration outside the
pilot-defined tolerance, wrong DR state, recording failure, server storage
failure, incompatible app version, or unrecoverable clock synchronization.
A critical calibration or DR-state fault persisting for more than three seconds
also invalidates the active trial and requires a reserve puzzle.

Quest backup logs survive disconnect and reconnection. They are retained until
the laptop export validator reports a valid session export, then may be removed
only by a separate explicit cleanup command whose reported checksum/status
matches the expected manifest.

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
  network. Bearer-authenticated Quest `ws://` is acceptable; Ethernet is not
  required.
- The server address is configurable and displayed to the researcher. The
  laptop uses a reserved IPv4 address when the final study value is assigned.
- The same persistent Quest client uses one-time six-digit enrollment and
  temporary `QUEST_A`/`QUEST_B` slots to receive participant and role identity.
- Controllers are allowed for researcher setup only. Trials are controller-free
  and use a minimal app-owned waiting view before start.
- A compatible protocol major and exact approved APK build ID are required.
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
- Actual reserved laptop IPv4 address
- Final approved production APK build identifier
- Resolution of the pinned NativeWebSocket package's upstream licence metadata
  before release freeze

## Phase 4 Implementation Status

The authenticated laptop and Unity networking foundation is implemented. The
StudyController verification passes `37/37`, and Unity project validation
passes. The refreshed `Logs/Phase4EditModeResults.xml` records `8/8` passed,
none failed or skipped, at `2026-08-11 06:58:08Z`. The refreshed
`Logs/Phase4PlayModeControllerResults.xml` records `2/2` passed, none failed or
skipped, from `2026-08-11 07:31:09Z` to `07:31:10Z`. It covers the transparent
camera-clear and mobile right-controller regression assertions. Protocol
`1.1.0`, schema `1.4.0`, and development build ID `cdr-phase4-dev-1` identify
the verified Phase 4 artifact. The Phase 5 calibration artifact used protocol
`1.2.0` and build `cdr-phase5-dev-3`. The active Phase 6 implementation uses
protocol `1.3.0`, schema `1.4.0`, development build ID
`cdr-phase6-dev-1`, and DR profile `PHASE6_TEST_V1`.

The Phase 4 readiness/calibration response was deliberately marked as a
test-only override. Protocol `1.2.0` replaced it with strict six-tag calibration
commands and derived reports. Protocol `1.3.0` consumes those accepted
calibration transforms through the Phase 6 profile-driven mask manager and
reports requested versus actual DR state.

The Android development artifact built successfully at
`2026-08-11 17:36:38 +0930` as
`Builds/Android/CollaborativeDR-Phase4.apk`, size
`86,101,218` bytes, SHA-256
`15a773ea04925ec882105a9da08ccc718e6ec937222a1091b6dc1ae5343dad46`. Its
packaged debug manifest contains `horizonos.permission.HEADSET_CAMERA` and
`android.permission.INTERNET`, sets `android:usesCleartextTraffic="true"`, and
does not declare `android:networkSecurityConfig`.

The APK was installed non-destructively through `hzdb` on Quest 3 serial
`2G0YC1ZF9Z03HD` under the Wearable Computer Lab profile. The rebuilt app
launched in `240 ms` with no crash signal. A fresh
`hzdb log -n 300 -t Unity -l W` returned no warnings while the app was off-head.
The final Unity validator passed. The server at `192.168.1.106:4317` reports
`SERVER_READY` with no session before pairing.

The right-controller input invariant is also explicit. `OVRInputModule` permits
mobile activation. The official Meta Core v85 `OVRControllerPrefab` is under
`RightControllerAnchor`, set to `RTouch`, with its child `OVRRayHelper`
assigned; `PrimaryIndexTrigger` activates setup UI controls. The controller is
active only during `Setup`, `Enrolling`, `Connecting`, and `Synchronizing`, and
is absent from trial interaction.

The ray-helper invariant accounts for a Meta Core v85 limitation:
`OVRRaycaster` leaves `RaycastResult.worldNormal` zero. Enabling the optional
`OVRRayHelper` cursor therefore caused a per-frame
`Look rotation viewing vector is zero` warning. The cursor GameObject is
disabled and `Cursor`/`CursorFill` are null, while the non-null `Renderer` beam,
UI hover, and `PrimaryIndexTrigger` remain active. Build validation enforces
those references.

The passthrough composition invariant is now explicit: `CenterEyeAnchor` uses
`CameraClearFlags.SolidColor` with transparent colour, not
`CameraClearFlags.Nothing`. The runtime safety controller, build configuration,
build validator, and PlayMode regression test enforce it. A post-fix screencap
shows clean stereo UI without bands. Passthrough is protected content and
appears black in ordinary screencaps. `hzdb metacam` is available and worked.
On the immediately preceding controller artifact (SHA-256
`938ede286080e882bb292faca12087b6b0950af31a565350e8e117c29f70462d`),
`Logs/Phase4Device/phase4-controller-fix-metacam.png` shows the right Touch
model, white beam, cursor over the keypad, address value `5888`, and six-digit
pairing validation state. That capture verifies the physical model/ray and
trigger-driven setup-input path.

Phase 4 is not complete. Physical-plus-simulator pairing and reconnect/recovery
testing remain pending, including authoritative snapshot application, explicit
experimenter continuation, and deliberate fault injection. The
final cursor-suppressed APK did pass its on-head controller check on
`2026-08-12`. `UnityPlayerGameActivity` was focused; the right controller was
`CONNECTED_ACTIVE`, at `100%` battery, with positional tracking; the cursor-free
white beam and clear passthrough were visible; and trigger input cleared the
four-character pairing field. The final state is captured in
`Logs/Phase4Device/phase4-controller-final-trigger-confirmed.png` (SHA-256
`f41722e860bba6c6bc25b8ed623401317800feba2a6e0f2a6c5df0f784f6b8a0`). Unity
and filtered device warning scans found no controller, EventSystem,
null-reference, or `Look rotation` warning. The two-physical-headset exit gate
remains open until the second Quest is available. Installation, launch, logs,
screenshots, and recovery work continue through the repository's `hzdb`
workflow.

## Implementation Order

1. Message schema, trial states, and append-only logger
2. Laptop server and dashboard preflight screen
3. Unity WebSocket client and connection simulator
4. Prepare/ready/commit trial handshake
5. Calibration and DR controller adapters
6. Counterbalanced schedule loader
7. On-time submission, post-limit submission, timeout, fault, and recovery paths
8. OBS media control, markers, and configurable questionnaire workflow
9. Two-Quest soak testing and deliberate fault injection
10. Pilot-specific calibration thresholds and final validation
