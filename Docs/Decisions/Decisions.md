# Locked and Deferred Decisions

Status: authoritative decision register

Last reconciled: 2026-08-26

This register distinguishes approved study decisions from implementation
defaults and unresolved deployment choices.

## Locked Study Decisions

### Participants and roles

- Two participants are physically present in the same room and each wears a
  Quest 3.
- One participant is the Director and one is the Builder.
- Roles are randomly assigned and remain fixed within the pair.
- The Director receives a private printed target card.
- The Builder cannot see the target.
- The Director can see the Builder's construction.
- Only the Builder manipulates the tangram pieces.
- Communication is verbal only.
- Pointing and hand gestures are not permitted.
- The Builder says `submit`; the experimenter clicks Submit.

### Trial structure

- One unscored practice trial precedes scored trials.
- The practice trial uses the normal guarded trial workflow.
- The practice trial uses `NO_DR` with the keyboard distractor.
- The task time-limit threshold is exactly 420 seconds.
- The experimenter dashboard displays an authoritative stopwatch that counts
  upward from `00:00`.
- An incorrect submission is recorded as an attempt, the experimenter says
  only `Continue`, and the authoritative stopwatch keeps running.
- Multiple submissions are permitted before and after the 420-second threshold
  until a correct submission or an experimenter-confirmed timeout ends the
  trial.
- At 420 seconds the dashboard shows a red `Time limit reached` warning. The
  server does not automatically stop the trial. Later submissions remain
  recordable with their attempt number, decision, elapsed time, and
  `afterTimeLimit=true`.
- A correct submission before 420 seconds ends as `COMPLETED`.
- A correct submission at or after 420 seconds ends as `TIMEOUT` while also
  recording `completedAfterTimeLimit=true` and the late correct completion time.
- If no late correct submission occurs, the experimenter may confirm
  `End trial — time limit reached`. The outcome is `TIMEOUT`; the threshold,
  actual end elapsed time, and overrun are logged.
- Every pair completes all three DR configurations.
- Each DR configuration contains one TV trial and one keyboard trial.
- This produces six scored trials per pair before replacement trials.
- Condition, distractor, and puzzle order are counterbalanced.
- Technical failures are retained and linked to reserve-puzzle replacements.
- Short ratings are collected after every scored trial.
- NASA-TLX, trust, and coordination ratings are collected after each condition
  block.
- A final questionnaire and interview follow the scored blocks.

### DR configurations

- `NO_DR`: neither participant receives DR.
- `SYMMETRIC_DR`: both participants receive DR.
- `ASYMMETRIC_DR`: one preassigned participant receives DR.
- The asymmetric recipient is counterbalanced between pairs.
- The recipient is not switched within a pair.

### Distractors

- The high-intended-salience distractor is a fixed TV.
- The TV plays one standardized muted high-motion football recording.
- The low-intended-salience distractor is a fixed RGB keyboard.
- The keyboard uses one standardized slow, low-brightness colour cycle.
- Only one distractor is active in a trial.
- In TV trials the keyboard lighting is off.
- In keyboard trials the TV is black or off.
- Neither distractor produces audio.
- The factor is named `distractor type with intended salience levels`.
- The complete physical TV and complete physical keyboard are DR targets.

### Calibration

- The keyboard uses AprilTag IDs `1` and `2`.
- Keyboard tag centre distance is nominally `0.40 m`, measured centre-to-centre
  in the final room placement.
- The TV uses AprilTag IDs `3-6`.
- TV tags are placed around the TV and outside the DR replacement region.
- Six total tags form the fixed room calibration rig.
- The final printed tags use family `tagStandard41h12`, IDs `1-6`.
- The pose-estimation tag side is `0.0567 m`, measured between the black/white
  border junctions (the detector's four corner locations). The printed pattern
  is `0.102 m` across; `tagStandard41h12` uses a five-module detection width
  within its nine-module printed pattern (`0.102 * 5 / 9`).
- The previous `0.092 m` prototype value and the mistaken `0.112 m` backing-card
  measurement are superseded and must not be used by the Final Design runtime.
- From the seated participant view, the confirmed mounted keyboard layout is
  tag `1` on the physical left and tag `2` on the physical right. The rig origin
  is their midpoint; `+X` points physically left-to-right from tag `1` to tag
  `2`, `+Y` is physical room up, and `+Z` points from the seated participants
  toward the TV. This supersedes the temporary opposite-side interpretation
  recorded during Phase 5 testing.
- TV tag order follows the confirmed final-room placement: `4` top-left, `5`
  top-right, `6` bottom-right, and `3` bottom-left. Calibration may remain valid
  with any three of the four TV tags.
- Preliminary centre-to-centre TV-tag spacing is approximately `1.673 m`
  horizontally (`4-5` and `3-6`) and `1.075 m` vertically (`3-4` and `5-6`).
  The approximate seated participant-to-wall distance is `1.30 m`; these room
  measurements must be rechecked during the physical pilot before threshold
  freeze.
- Calibration is one dashboard-triggered six-second attempt collected by both
  headsets. Detection outlines and quality metrics are calibration-only; the
  participant waiting view returns after the attempt.
- The current provisional algorithm profile is `PROVISIONAL_PHASE5_V2`.
  Isolated position outliers may be rejected using a conservative median/MAD
  rule, with rejected counts and warnings preserved. Broad or sustained
  position instability, insufficient samples, spacing, planarity, stale-pose,
  and cross-headset disagreements remain blocking failures.
- Per-tag rotation RMS is retained in the report as a diagnostic warning but is
  not itself a calibration failure. The authoritative keyboard and TV room
  frames are constructed from tag-centre positions and do not consume the
  individual tag quaternions.
- Researcher calibration outlines use detected corner rays on a camera-facing
  plane through the tracked tag centre, so visual feedback is not rotated by a
  noisy single-tag pose estimate.
- Thresholds remain configurable and provisional until locked from physical
  pilot measurements. One-Quest validation is permitted now, but the Phase 5
  exit gate still requires a later two-physical-Quest compatibility check.
- TV, keyboard, desk, and tags remain fixed during data collection.

### Phase 6 diminished-reality targets

- Phase 6 uses one generic, profile-driven DR manager for both targets. Both
  Quests use the same geometry and appearance profile; per-headset adjustment
  is diagnostic only and is not silently retained for study trials.
- The pilot appearance is a full-opacity white, unlit, texture-ready mask. No
  dynamic Quest-camera texture capture is used. Photographed wall/desk
  materials will be added and locked after the physical visual pilot.
- The current TV pilot intentionally tests a recessed wall replacement plane.
  The panel-to-wall depth is `0.29 m`, the approximate viewing distance to the
  wall is `1.30 m`, and visual tuning places the plane another `0.07 m` behind
  the tag plane. The provisional perspective factor is therefore
  `1.37 / (1.30 - 0.29)`. The rounded mask is `1.60 x 1.46 m`, at local
  `X=+0.034 m`, `Z=+0.07 m`. This remains experimental because participant head
  movement may expose parallax. The `0.005 m` feather is inside the edge.
- The keyboard pilot uses one oversized horizontal `0.55 x 0.35 m` plane at the
  calibrated desk surface (`Y=0 m`). Its larger footprint covers the raised-key
  silhouette seen from oblique angles. No box or vertical faces remain. The
  `0.005 m` feather is inside the outer edge.
- Prepare resolves the target but keeps it invisible; Show occurs only with
  the authoritative trial start; Hide occurs at trial end or fault; Reveal is
  researcher-only before a trial. `NO_DR` has no visible replacement geometry.
- Researcher preview controls and debug bounds are explicitly feature-gated,
  available only during calibration, and omitted from normal study operation.
  Participant controllers expose no DR toggle.
- The provisional performance gate is sustained `72 FPS` and remains subject
  to the physical pilot. Phase 6 development identity is protocol `1.3.0`, APK
  build `cdr-phase6-dev-1`, and profile `PHASE6_TEST_V1`.

### Control architecture

- The MacBook is the sole authoritative controller.
- The browser is a dashboard, not the owner of session state.
- Both Quests run the same APK.
- Quest roles are assigned by the laptop at runtime.
- The Quests do not communicate directly.
- The physical task does not require Photon or Unity Netcode.
- A dedicated Wi-Fi router is used.
- Ethernet is not required.
- The MacBook drives the TV over HDMI.
- The experimenter manually changes and confirms the keyboard lighting state.

### Software stack

- Unity editor version is `6000.0.61f1`.
- Laptop runtime is Node.js 24 LTS with TypeScript.
- Dashboard uses React and Vite.
- HTTP server uses Express.
- Realtime laptop transport uses `ws`.
- Unity uses NativeWebSocket.
- OBS Studio is the approved media-capture controller.
- The authoritative event store is append-only JSONL.
- Analysis exports use CSV.
- Configuration and snapshots use JSON.

### Phase 4 Quest enrollment and operation

- One persistent, role-neutral Quest client runs in `Final-Design-Scene`; a
  temporary researcher setup panel is available before a headset is enrolled.
- The dashboard generates a one-time six-digit enrollment code for a temporary
  `QUEST_A` or `QUEST_B` session slot.
- Enrollment assigns the session, pseudonymous participant identifier,
  Director or Builder role, temporary device slot, and authenticated access.
  Slot labels do not permanently identify a physical headset.
- Quest controllers may be used during researcher setup only. Participants do
  not use controllers during the study trial.
- Before a trial, participants see an app-owned minimal waiting view. Network
  address, device identity, role, version, heartbeat, and faults are restricted
  to the researcher/development overlay.
- Local `ws://` is accepted only on the isolated study router and requires
  authenticated enrollment. The server advertises a configurable address; the
  actual reserved IPv4 address is not yet locked.
- Both Quests must use the exact approved APK build identifier and a compatible
  protocol major version. The current `cdr-phase6-dev-1` value is a development
  identifier, not the approved production identifier.
- The V2 robustness APK deliberately retains `cdr-phase5-dev-3` at the user's
  direction; no dev-4 identifier is created. During this in-place development
  iteration, the exact approved APK SHA-256 and calibration profile must also
  match. An older dev-3/V1 report is rejected by the server.
- There is one physical Quest 3 available for current testing. Initial
  verification may use it with one simulator; two-headset physical verification
  is required when the expected second Quest becomes available.

Implementation evidence, not a locked production artifact: the current
development APK was built successfully at `2026-08-11 17:36:38 +0930` as
`Builds/Android/CollaborativeDR-Phase4.apk` (`86,101,218` bytes;
SHA-256
`15a773ea04925ec882105a9da08ccc718e6ec937222a1091b6dc1ae5343dad46`). Its
packaged debug manifest has the required headset-camera and Internet
permissions, permits cleartext for the isolated authenticated local network,
and does not declare `android:networkSecurityConfig`. A non-destructive `hzdb`
install succeeded on Quest 3 `2G0YC1ZF9Z03HD` under the Wearable Computer Lab
profile. The rebuilt app launched in `240 ms` with no crash signal. A fresh
`hzdb log -n 300 -t Unity -l W` returned no warnings while the app was off-head.
Final Unity validation and the `8/8` EditMode UI run passed.

Android controller input requires `OVRInputModule` mobile activation. The
right-controller implementation uses the official Meta Core v85
`OVRControllerPrefab` under `RightControllerAnchor`, explicitly selects
`RTouch`, assigns the prefab's child `OVRRayHelper`, and maps setup clicks to
`PrimaryIndexTrigger`. It is active only in `Setup`, `Enrolling`, `Connecting`,
and `Synchronizing`, preserving the controller-free trial decision. The
refreshed `Logs/Phase4PlayModeControllerResults.xml` records `2/2` passed, none
failed or skipped, from `2026-08-11 07:31:09Z` to `07:31:10Z`.

Meta Core v85 `OVRRaycaster` does not populate `RaycastResult.worldNormal`, so
the optional `OVRRayHelper` cursor produced a per-frame
`Look rotation viewing vector is zero` warning. The final controller build
disables the cursor GameObject and clears the helper's `Cursor` and
`CursorFill` references. It retains the non-null `Renderer` beam, UI hover, and
`PrimaryIndexTrigger` input. Build validation requires that exact invariant.

The passthrough underlay requires `CenterEyeAnchor` to use
`CameraClearFlags.SolidColor` with transparent colour rather than
`CameraClearFlags.Nothing`. Runtime guarding, build configuration/validation,
and PlayMode regression coverage enforce this. The corrected screencap contains
clean stereo UI and no bands, but protected passthrough remains black in an
ordinary screencap. `hzdb metacam` is available and worked. On the immediately
preceding controller build (SHA-256
`938ede286080e882bb292faca12087b6b0950af31a565350e8e117c29f70462d`),
`Logs/Phase4Device/phase4-controller-fix-metacam.png` shows the right Touch
model, white beam, and cursor over the setup keypad. Trigger-driven interaction
changed the address to `5888` and produced the six-digit pairing validation
status. The physical controller model, ray, and setup-input path therefore
passed on that build. This artifact is not the final approved production build.

The server is available at `192.168.1.106:4317` in `SERVER_READY` state with no
session before pairing. Physical-plus-simulator enrollment and recovery remain
unverified, as does the later two-physical-Quest exit gate. The final
cursor-suppressed APK passed its on-head controller check on `2026-08-12`:
`UnityPlayerGameActivity` was focused; the right controller was
`CONNECTED_ACTIVE`, at `100%` battery, with positional tracking; clear
passthrough and the white beam were visible; and trigger interaction cleared the
four-character pairing field. The final state is recorded in
`Logs/Phase4Device/phase4-controller-final-trigger-confirmed.png` (SHA-256
`f41722e860bba6c6bc25b8ed623401317800feba2a6e0f2a6c5df0f784f6b8a0`). Unity
and filtered device warning scans found no controller, EventSystem,
null-reference, or `Look rotation` warning. The setup controller remains
researcher-only; this evidence does not change participant interaction or add
controller events to the study dataset.

### Failure handling

- A trial cannot start unless both Quests and required recording systems are
  ready.
- Failures are visible and logged.
- A critical disconnect lasting no more than three seconds preserves the last
  safe local DR state while the authoritative laptop stopwatch continues.
- After that short disconnect, the Quest must apply and validate the
  authoritative snapshot and the experimenter must explicitly confirm
  continuation. Reconnection never silently continues the trial.
- A critical network, calibration, or DR-state fault lasting more than three
  seconds clears DR, restores clear passthrough, and makes the active trial
  `TECHNICAL_INVALID`.
- Invalid trials are never overwritten.
- Server restart never automatically resumes an active stopwatch.
- Duplicate commands are idempotent.
- Reconnected clients receive the authoritative state snapshot.

### Media and data

- A USB overhead camera is connected to the MacBook and controlled by OBS.
- Two external participant microphones are recorded by OBS.
- The external encrypted SSD is used as configurable capture storage.
- Participant names do not appear in study-data paths or filenames.
- Audio and video are synchronized to laptop trial markers.
- Each Quest retains its local backup log until the laptop validates the
  session export. Deletion requires a separate explicit cleanup action and a
  matching checksum/status confirmation; enrollment or reconnection never
  deletes the log.

### Phase 3 operator workflow

- Pair identifiers use the form `PAIR-001`.
- Participant slot identifiers use the form `P001-A` and `P001-B`.
- Participant identifiers and Director/Builder role assignments are distinct
  fields.
- A pre-generated, validated master counterbalance plan is selected by pair ID.
- The selected allocation is persisted as a session-specific configuration and
  schedule before the trial workflow begins.
- The dashboard presents one submission action followed by an experimenter
  decision: incorrect and `Continue`, or confirmed correct and end trial.
- At the 420-second threshold the dashboard retains `Record late submission`
  alongside the guarded `End trial — time limit reached` action; crossing the
  threshold alone does not stop the server trial.
- Calibration override, invalidation, participant withdrawal, experimenter
  abort, recovery resolution, and session closure require a recorded reason.
- Starting a prepared trial requires confirmation.
- Recovery after server interruption never resumes an active stopwatch.
- Recovery is classified as technical invalidation, participant withdrawal, or
  experimenter abort.
- A technically invalid scored trial receives a linked reserve trial; the
  invalid trial remains in the event history and is excluded from analysis.
- Phase 3 uses simulated Quest, calibration, and media readiness adapters. Real
  Unity networking begins in Phase 4 and real media integration remains in
  Phase 7.

## Implementation Defaults Requiring No Study Redesign

These defaults may be adjusted during engineering or pilot testing while
preserving the study design:

- PCA images are processed on-device and discarded after detection.
- Raw PCA images are not persisted or transmitted.
- Derived AprilTag observations are recorded at the detector rate.
- Head orientation telemetry is sampled at approximately `10 Hz`.
- System-health telemetry is sampled at approximately `1 Hz`.
- The overhead camera records approximately `1080p30`.
- External audio records at `48 kHz` with isolated participant channels.
- OBS records MKV for interruption safety and may remux to MP4.
- The server exposes a configurable advertised address. Deployment uses a
  reserved local IPv4 address once its actual value is confirmed.
- Each command contains a session ID, trial ID, command ID, state version, and
  protocol version.
- Protocol versioning begins at `1.0.0`; peers must share the same major
  version.
- JSON Schema is the canonical cross-platform contract format.
- Pair and trial IDs are human-readable pseudonymous identifiers. Session,
  command, and event IDs are UUIDs.
- Quests use configurable device IDs and secret references; access tokens are
  never written to study configuration or logs.
- Calibration status is `NOT_RUN`, `PASS`, `FAIL`, or `OVERRIDDEN`; an override
  requires an experimenter reason.
- Records use UTC timestamps for alignment and monotonic milliseconds for
  duration measurement.
- All timestamps are related to the laptop authoritative clock through measured
  Quest clock offsets.
- Phase 4 uses an explicitly labeled test-only calibration override to exercise
  networking. It is not evidence of real AprilTag calibration or DR rendering.

## Deferred Decisions

Do not infer these values during implementation:

- Final seating arrangement and participant sight lines
- Exact room geometry and surveyed transforms
- Exact TV and keyboard replacement mesh dimensions
- Exact microphone models
- One dual-channel interface versus two independent USB microphones
- Questionnaire delivery devices
- Exact participant sample size and power-analysis result
- University-approved archive destination
- Retention and erasure periods
- Final list of personnel authorized to access identifiable recordings
- Calibration acceptance thresholds
- Puzzle difficulty bands
- Exact final-placement scoring tolerance
- Whether target cards show internal piece boundaries
- Final salience thresholds
- Actual reserved laptop IPv4 address
- Final approved production APK build identifier
- Resolution of the pinned NativeWebSocket package's upstream licence metadata
  before release freeze

## Explicitly Out of Scope for the Core Build

- Raw Quest-camera video recording
- Eye tracking on Quest 3
- Automatic inference that head direction equals eye gaze
- Cloud processing of participant media
- Quest-to-Quest multiplayer networking
- Automatic computer-vision tangram scoring before the manual scoring workflow
  is validated
- Whisper transcription as a dependency of trial execution
- Participant control through virtual Quest buttons

Optional transcription and automated scoring can be added after the core study
workflow is stable and only with the required ethics and validation updates.
