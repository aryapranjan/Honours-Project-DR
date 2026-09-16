# Collaborative Diminished Reality Study: Project Handoff

Status: authoritative implementation handoff

Last reconciled: 2026-08-26

## Purpose

This document transfers the approved study design and software architecture into
the clean implementation repository. It is the starting point for future Codex
threads and engineering work.

Read this document together with:

- `Docs/Architecture/SystemArchitecture.md`
- `Docs/Architecture/StudySystemArchitecture.drawio`
- `Docs/Study/StudyDesign.md`
- `Docs/Study/DataCollectionInventory.md`
- `Docs/Study/EightPhaseDevelopmentPlan.md`
- `Docs/Decisions/Decisions.md`

When documents appear to conflict, apply this order:

1. `Docs/Decisions/Decisions.md`
2. `Docs/Architecture/SystemArchitecture.md`
3. `Docs/Study/StudyDesign.md`
4. `Docs/Study/EightPhaseDevelopmentPlan.md`
5. Earlier prototypes, chat summaries, or informal notes

Do not silently resolve a remaining ambiguity. Record it as deferred and ask
before implementing behavior that could change the study design.

## Research Objective

The project studies how diminished reality (DR) affects distraction,
collaboration, workload, and task performance during a co-located physical
tangram task.

Two participants are physically present at one fixed study desk. Both wear Meta
Quest 3 headsets:

- The Director sees a private printed target and verbally instructs the Builder.
- The Builder cannot see the target and is the only participant permitted to
  manipulate the physical tangram pieces.
- The Director can see the Builder's construction while it is assembled.
- Communication is verbal only. Pointing, gesturing, and Director contact with
  the pieces are not permitted.

The laptop experimenter application is the sole authoritative controller.

## Experimental Conditions

Each participant pair completes one unscored practice trial followed by six
scored trials. The scored trials cover three DR configurations, with one TV and
one keyboard distractor trial in each configuration:

- `NO_DR`: neither participant receives DR.
- `SYMMETRIC_DR`: both participants receive DR.
- `ASYMMETRIC_DR`: one preassigned participant receives DR.

Director and Builder roles remain fixed within a pair. The asymmetric DR
recipient is counterbalanced between pairs rather than switched within the same
pair. Condition order, distractor order, and puzzle assignment are loaded from a
validated counterbalance schedule.

The independent distractor factor must be reported as:

`distractor type with intended salience levels`

It must not be described as a pure salience manipulation because the TV and
keyboard also differ in identity, size, location, and appearance.

### TV trial

- One fixed TV displays a standardized, muted, high-motion recorded football
  segment.
- The complete TV is the DR target, not only its illuminated pixels.
- The RGB keyboard is off.

### Keyboard trial

- One fixed RGB keyboard runs a standardized slow, low-brightness colour cycle.
- The complete keyboard is the DR target.
- The TV is black or off.

No distractor produces audio.

## Tangram Procedure

- One practice trial uses the same guarded system flow but is excluded from
  analysis.
- Every scored trial has an exact 420-second task time-limit threshold.
- The dashboard stopwatch counts upward from `00:00`.
- The Builder verbally says `submit`.
- The experimenter clicks Submit on the laptop dashboard.
- The experimenter does not tell the pair whether an incorrect submission is
  correct; the standardized response is `Continue`.
- At 420 seconds the dashboard warns visibly and continues counting. Submissions
  remain recordable and are marked as after the time limit.
- A confirmed correct late submission ends as `TIMEOUT` while preserving the
  late correct completion time.
- If no late correct submission occurs, the experimenter may confirm
  `End trial — time limit reached`. The server records `TIMEOUT` plus the
  threshold, actual end elapsed time, and overrun.
- Correct completion, timeout, invalidation, and replacement are stored as
  explicit outcomes.
- A technical invalidation never overwrites the original trial.
- An approved reserve puzzle is linked to the invalid trial.

Puzzle difficulty, exact scoring tolerance, and target-card rendering must be
validated during pilot testing. The 420-second threshold is locked; deployment
configuration must not silently change it.

## Physical Calibration Rig

Six AprilTags define the fixed study geometry:

- Keyboard tags: IDs `1` and `2`
- Confirmed mounted keyboard order from the seated participant view: tag `1`
  on the physical left and tag `2` on the physical right; keyboard `+X` points
  left-to-right from `1` to `2`, and `+Z` points from participants toward the TV
- Keyboard tag centre distance: nominally `0.40 m`, measured centre-to-centre
  in the final room placement
- TV tags: IDs `3`, `4`, `5`, and `6`
- Confirmed final-room order: `4` top-left, `5` top-right, `6` bottom-right,
  and `3` bottom-left
- TV tags are mounted around the TV and outside the diminished region
- Preliminary centre-to-centre spacing is approximately `1.673 m` horizontally
  and `1.075 m` vertically. The approximate seated participant-to-wall distance
  is `1.30 m`; all three values require pilot remeasurement.
- Final printed `tagStandard41h12` detection-corner side length: `0.0567 m`.
  The full nine-module pattern is `0.102 m`; the family detection boundary is
  five modules wide (`0.102 * 5 / 9`).

The preliminary room dimensions above do not replace the final survey. Exact tag
transforms, target dimensions, headset viewing distance, and seating layout remain
deferred until the mounted rig is measured during the physical pilot.

## Software Architecture

### Laptop

- Node.js 24 LTS
- TypeScript
- React and Vite dashboard
- Express HTTP server
- `ws` WebSocket server
- Append-only JSONL authoritative event log
- JSON session configuration and snapshots
- CSV analysis exports
- OBS Studio control for overhead video and participant audio

### Quest

- One identical Unity APK on both Quest 3 headsets
- Role and participant identity assigned at runtime
- Unity `6000.0.61f1`
- Android and IL2CPP
- NativeWebSocket transport
- App-owned minimal setup and waiting view; study trials remain controller-free
- Local backup event log retained until validated export and explicit cleanup
- AprilTag calibration and DR rendering adapters

### Network

- Dedicated Wi-Fi router
- Configurable advertised laptop address, using a reserved local IPv4 address
  once the final value is assigned
- Bearer-authenticated Quest `ws://` transport on the isolated study network
- No direct Quest-to-Quest communication
- No Photon or Unity Netcode requirement

### Phase 4 enrollment and recovery

- The persistent role-neutral Quest client starts with the study scene. A
  temporary researcher setup panel is shown before enrollment.
- The dashboard creates a one-time six-digit code for a temporary `QUEST_A` or
  `QUEST_B` session slot. Redeeming it assigns the pseudonymous participant ID,
  Director or Builder role, session, approved build, and access token.
- Quest controllers may be used to enter setup details. Participants do not use
  controllers during a trial.
- A disconnect lasting no more than three seconds preserves the last safe DR
  state while the laptop remains authoritative. The client must apply and
  validate the authoritative snapshot, after which the experimenter explicitly
  confirms continuation.
- A disconnect lasting more than three seconds enters fail-safe clear
  passthrough, removes DR, and makes the active trial `TECHNICAL_INVALID`.
- The approved Quest build identifier must match exactly. Protocol versions
  must share the same major version.

## Clean Repository Baseline

Implementation repository:

`Unity-Designs/Final-Design/Unity-PassthroughCameraApiSamples`

The repository is based on Meta's official Unity Passthrough Camera API sample.
At handoff time it contains:

- Unity `6000.0.61f1`
- Meta MRUK `85.0.0`
- Unity Inference Engine `2.2.1`
- XR Management `4.5.3`
- OpenXR `1.15.1`
- A user-created `Assets/Final-Design-Scene.unity`
- Existing uncommitted Unity/OpenXR configuration changes that must be reviewed
  and preserved or deliberately replaced

The baseline uses Unity's Built-in Render Pipeline. Do not convert it to URP
without an explicit engineering decision and a full Quest regression test.

`Packages/packages-lock.json` is currently ignored by the upstream sample.
Phase 1 must make dependency locking reproducible for this project.

## Privacy and Data Boundary

The PCA camera is required for on-device AprilTag detection. The default study
implementation must:

- process PCA frames temporarily on the Quest;
- store derived detections, calibration results, and quality metrics;
- not record, transmit, or persist raw Quest PCA frames.

Storing raw PCA imagery requires explicit supervisor and ethics approval and a
documented research need.

The overhead camera and external microphones are intentionally recorded through
OBS. Those recordings are identifiable data and must use consent, restricted
access, encryption, approved retention, and approved University storage.

The encrypted external SSD is temporary capture storage, not the final
authoritative archive.

## Lessons from the Previous Prototype

The previous keyboard prototype is evidence and reference material, not a module
to copy wholesale.

- Incorrect tag scale and weak camera intrinsics produced approximately
  `0.90 m` estimates for a shorter real separation.
- The previous prototype used `0.092 m`; this value is legacy evidence only.
  A later `0.112 m` reading measured the backing card rather than the AprilTag
  detection boundary. The final printed pattern is `0.102 m` across and the
  correct five-of-nine-module detection side is `0.0567 m`.
- The final-room keyboard tag placement was remeasured at a nominal `0.40 m`
  centre-to-centre on `2026-08-25`, superseding the earlier planned `0.45 m`.
- Typical headset-to-tag distance was approximately `0.30-0.40 m`.
- Outlines aligned better when generated from detected 2D corners projected
  through PCA camera geometry rather than only from a pose-estimated square.
- Calibration failed when sampling rules required too many simultaneous valid
  observations or rejected normal variation too aggressively.
- Legacy `UnityEngine.Input` caused runtime exceptions when the project used
  the new Input System. Study actions must be public commands controlled by the
  laptop, not legacy keyboard polling.
- The most successful keyboard mask edge feather was approximately `0.003 m`.
- Passthrough colour can appear blue. A replacement texture can be calibrated
  with tint, brightness, contrast, and opacity, but cannot perfectly control the
  headset's physical passthrough colour processing.
- DR target offset must be defined in a documented rig coordinate system.
  Ambiguous local axes caused earlier height-adjustment confusion.

Port only code that passes a fresh design review against the generalized
six-tag, two-target architecture.

## Deferred Decisions

These block participant data collection, but do not block the core software
foundation:

- Final room seating
- Surveyed TV, keyboard, tag, and workspace transforms
- Exact microphone models and audio-interface topology
- Questionnaire delivery hardware
- University-approved archive location and retention period
- Authorized research-team access
- Pilot thresholds for calibration, puzzle difficulty, salience, scoring, and
  performance
- Final target-card artwork and whether internal piece boundaries are shown
- Actual reserved laptop IPv4 address used in the study room
- Final approved production APK build identifier

## Current Development Status

- Phase 1 is complete: the clean Unity PCA baseline builds and has been
  verified on a physical Quest 3.
- Phase 2 is complete: the versioned protocol, schemas, state machines, and
  behavioral rules are locked in `StudyController/`.
- Phase 3 is complete: the laptop server, event store, recovery-safe snapshots,
  dashboard, export validation, and simulated Quest clients are implemented and
  verified.
- Phase 4 is in progress: the authenticated enrollment/recovery foundation is
  implemented in the laptop controller and Unity client. The StudyController
  verification passes `37/37`, and Unity validation passes. The refreshed
  `Logs/Phase4EditModeResults.xml` records `8/8` passed with none failed or
  skipped (`2026-08-11 06:58:08Z`). The refreshed
  `Logs/Phase4PlayModeControllerResults.xml` records `2/2` passed with none
  failed or skipped (`2026-08-11 07:31:09Z` to `07:31:10Z`). It covers both
  transparent camera clearing and the mobile right-controller input contract.
- The current Phase 4 development build uses protocol `1.1.0`, schema `1.4.0`,
  and development build ID `cdr-phase4-dev-1`. This is not the final approved
  production build identifier.
- The Android development APK was rebuilt successfully at
  `2026-08-11 17:36:38 +0930` as
  `Builds/Android/CollaborativeDR-Phase4.apk` (`86,101,218` bytes; SHA-256
  `15a773ea04925ec882105a9da08ccc718e6ec937222a1091b6dc1ae5343dad46`).
  Its packaged debug manifest contains `horizonos.permission.HEADSET_CAMERA`
  and `android.permission.INTERNET`, enables
  `android:usesCleartextTraffic="true"`, and contains no
  `android:networkSecurityConfig` attribute.
- A non-destructive `hzdb` install succeeded on Quest 3 serial
  `2G0YC1ZF9Z03HD` under the Wearable Computer Lab profile. A cold launch of the
  rebuilt artifact completed in `240 ms` with no crash signal. A fresh
  `hzdb log -n 300 -t Unity -l W` returned no warnings while the app was
  off-head.
- The right-controller setup failure came from two independent defects:
  `OVRInputModule` mobile activation was false, and `RightControllerAnchor` was
  empty. The scene now contains Meta Core v85 `OVRControllerPrefab` under that
  anchor, explicitly assigned to `RTouch`, with its child `OVRRayHelper`
  assigned. `PrimaryIndexTrigger` is the setup click. The controller is active
  only in `Setup`, `Enrolling`, `Connecting`, and `Synchronizing`.
- Meta Core v85 `OVRRaycaster` leaves `RaycastResult.worldNormal` at zero. The
  optional `OVRRayHelper` cursor attempted to orient from that zero vector and
  emitted `Look rotation viewing vector is zero` every frame. The build now
  disables the cursor GameObject and clears `Cursor` and `CursorFill`, while
  retaining the `Renderer` beam, UI hover, and `PrimaryIndexTrigger` input. The
  validator requires a non-null `Renderer` and null cursor references, and the
  final Unity validation passes.
- The initial stereo capture exposed a passthrough-underlay composition defect:
  `CenterEyeAnchor` used `CameraClearFlags.Nothing`. It now uses
  `CameraClearFlags.SolidColor` with transparent colour, enforced by a runtime
  guard, build configuration/validation, and a PlayMode regression assertion.
  The follow-up screencap shows clean stereo UI without the previous bands.
- Quest protected-content capture renders passthrough black in ordinary
  screencaps, but `hzdb metacam` is available and worked. On the immediately
  preceding controller build (SHA-256
  `938ede286080e882bb292faca12087b6b0950af31a565350e8e117c29f70462d`),
  `Logs/Phase4Device/phase4-controller-fix-metacam.png` shows the physical right
  Touch model, white beam, and cursor over the setup keypad. The UI changed to
  address `5888` and displayed the six-digit pairing validation status. This
  verifies the physical model/ray and trigger-driven setup-input path.
- The final cursor-suppressed APK passed its on-head controller check on
  `2026-08-12`. The Unity activity was focused, and `hzdb device controllers`
  reported the right controller `CONNECTED_ACTIVE`, at `100%` battery, with
  positional tracking. `Logs/Phase4Device/phase4-controller-final-on-head-active.png`
  shows clear passthrough and the cursor-free white beam. Trigger interaction
  then cleared the four-character pairing field, conclusively exercising the
  ray-trigger UI path; the resulting state is captured in
  `Logs/Phase4Device/phase4-controller-final-trigger-confirmed.png` (SHA-256
  `f41722e860bba6c6bc25b8ed623401317800feba2a6e0f2a6c5df0f784f6b8a0`). A
  700-line Unity warning query and a broader filtered warning scan found no
  controller, EventSystem, null-reference, or `Look rotation` warning. The
  final on-head controller gate is therefore passed.
- The server is live at `192.168.1.106:4317` and reports `SERVER_READY` with no
  session before pairing. Physical-plus-simulator pairing, reconnect/snapshot
  recovery, explicit continuation, and fault injection remain pending.
  Simultaneous testing on two physical headsets will follow when the expected
  second device is available.

- Phase 5 implementation is complete and physical validation is in progress.
  The locked tag family is
  `tagStandard41h12`, IDs are `1-6`, and the detection-corner side is
  `0.0567 m`, derived from the ruler-measured `0.102 m` nine-module pattern.
  The old `0.092 m` prototype and `0.112 m` backing-card values are not used.
- Unity now contains the PCA AprilTag observation source, six-tag solver,
  temporal/stale-pose rejection, three-of-four TV redundancy, calibration-only
  outlines, objective quality metrics, and derived-only report payload. Raw PCA
  frames remain transient and are not persisted or transmitted.
- The `PROVISIONAL_PHASE5_V2` robustness profile conservatively rejects only
  isolated position outliers, keeps broad or sustained position instability as
  a blocking failure, and treats per-tag rotation RMS as a retained diagnostic
  warning. This is valid because authoritative keyboard and TV frames use tag
  centres rather than individual tag rotations. Researcher outlines use the
  detected corner rays on a camera-facing plane through each tracked centre.
- The Phase 5 artifact used protocol `1.2.0` and build ID
  `cdr-phase5-dev-3`. The active Phase 6 controller now uses protocol `1.3.0`,
  build ID `cdr-phase6-dev-1`, and DR profile `PHASE6_TEST_V1`. Verification
  passes `41/41` tests, retains the exact Phase 5 V2 calibration gate, adds the
  DR lifecycle/state-report simulation, and builds both server and dashboard.
- Unity `6000.0.61f1` now compiles the Phase 5 assemblies without C# errors;
  Phase 5 Configure and Validate both pass. The current final-mapping result
  `Logs/Phase5FinalMappingEditModeResults-20260826.xml` records `16/16` passed
  with none failed or skipped (SHA-256
  `85087f7c0d0a897220c08e69807ad376816146ba80a79c08b7bce3cfeecab8eb`).
- The earlier `cdr-phase5-dev-1` Android IL2CPP development APK built at
  `2026-08-14 22:56:47 +0930` as
  `Builds/Android/CollaborativeDR-Phase5-dev1-045m.apk` (`78,459,099` bytes;
  SHA-256
  `7c21794b7a45891efdc0696bb6e530cadcedc7bdac3f75d9a2b185c1ac85df62`).
  That APK contains the superseded `0.45 m` keyboard geometry and remains
  historical evidence only.
- The superseded `cdr-phase5-dev-2` Android IL2CPP development APK built at
  `2026-08-25 16:17:31 +0930` as
  `Builds/Android/CollaborativeDR-Phase5-dev2-0112m.apk` (`82,189,424` bytes;
  SHA-256
  `ae0154f5e3a0b284b021b13e84c7ecece0387a091a89bcfe2845840837d51e3b`).
  It used the mistaken `0.112 m` backing-card reading and is historical evidence
  only.
- At the user's direction, the robustness update remains
  `cdr-phase5-dev-3`; no dev-4 identifier was created. The current Android
  IL2CPP development APK built at `2026-08-26 15:39:39 +0930` as
  `Builds/Android/CollaborativeDR-Phase5.apk` (`102,390,591` bytes; SHA-256
  `803c96541818c75575ead0e94dd5bfb921543955689f5107eff347bed512bb50`).
  It embeds `PROVISIONAL_PHASE5_V2`, the corrected `0.0567 m`
  detector-corner size, confirmed `0.40 m` keyboard geometry, participant-view
  keyboard order `1` left and `2` right, and the confirmed TV corner order.
  Generated ARM64 IL2CPP code contains those same defaults. The artifact hash
  and profile distinguish this in-place rebuild from earlier dev-3 APKs. It is
  ARM64-only, packages `libAprilTag.so`, retains the headset-camera and internet
  permissions, and permits the approved local cleartext `ws://` connection.
- A non-destructive `hzdb app install --replace --grant-permissions` of the
  current dev3/V2 APK succeeded on Quest 3 serial `2G0YC1ZF9Z03HD` without clearing
  its app data. The installed `base.apk` was pulled back and exactly matched the
  `102,390,591`-byte approved host artifact by SHA-256. The headset-camera permission is
  granted. A server-free launch plus Unity-warning and broad package-specific
  crash/ANR scans found no matching signal.
- The corrected build then produced a non-simulated `QUEST_A` calibration
  `PASS` on `2026-08-26` (authoritative event sequence `480`, attempt
  `4af20b64-a330-449e-b8fb-f321305a2599`). All IDs `1-6` were observed, with
  `151` accepted and two robustly rejected observations, `0.391986 m` keyboard
  spacing, `0.008014 m` spacing residual, and `0.001548 m` TV-planarity RMS.
  Tag `1` was at negative X, tag `2` at positive X, the TV was at positive Z,
  and its frame quaternion was near identity. There were no failure reasons;
  the tag `5` rotation warning remained diagnostic as designed, and raw PCA
  frames were not persisted. A heartbeat timeout occurred only after the
  passed report was recorded and therefore does not invalidate it.
- `QUEST_B` was simulated for that attempt, so the server correctly marked
  cross-headset compatibility `DEFERRED`. This is not evidence for the required
  two-physical-Quest gate.
- The recorded Quest clock mismatch does not block the immediate functional
  calibration test, but it must be corrected before formal timestamped Phase 5
  evidence collection.
- The available-Quest detection and derived-geometry gate is passed. Phase 5 is
  not formally complete until outline alignment is confirmed, repeated and
  three-of-four-TV-tag pilot attempts support threshold lock, and the
  two-physical-Quest transform gate is repeated when the second headset arrives.

- Phase 6 software implementation is complete for physical placement testing.
  Unity now has shared, texture-ready TV and keyboard target profiles, one
  calibrated mask manager, explicit Prepare/Show/Hide/Reveal behavior, debug
  bounds, actual-state reporting, a 72 FPS pilot report, and clear-passthrough
  fault handling. `NO_DR` creates no visible replacement geometry.
- The current white TV mask is `1.18 x 1.075 m`, with its centre shifted
  `0.025 m` toward the tag-5/tag-6 side so only the participant-right edge gains
  `0.05 m`; it remains offset `-0.31 m` toward participants. The keyboard's
  physical `0.29 x 0.095 m` footprint plus the approved 1 cm padding gives a
  `0.31 x 0.115 m` open-bottom cover. Its top is centred `0.0375 m` above the
  desk and four side faces extend down to the desk to hide the keyboard's
  physical thickness from angled views. Feathering stays inside the TV/top
  edges and at the keyboard skirt's desk contact.
- The researcher preview is feature-gated by `DR_PREVIEW_ENABLED=true`, appears
  only during calibration, and is rejected during trials. It is omitted from
  the normal study server unless explicitly enabled for placement testing.
- Unity Phase 6 configuration compiled and serialized successfully. The latest
  Unity EditMode result is `21/21` passed in
  `Logs/Phase6FineTuningEditModeResults-20260902.xml`, including calibrated TV
  composition, the participant-right-only extension, the runtime open-bottom
  keyboard cover, and the `NO_DR` no-geometry invariant.
- The fine-tuned `Builds/Android/CollaborativeDR-Phase6.apk` built at
  `2026-09-02 14:08:38 +0930` (`77,701,790` bytes; SHA-256
  `1d4e2982f22695f5f3685b6a52291548c0e3d4804ee51dc613dc9352fbc693da`).
  It installed successfully and non-destructively through `hzdb` on Quest 3
  `2G0YC1ZF9Z03HD`; existing app data was retained. A clean off-head cold launch
  completed in `228 ms`, and the eight-second `hzdb` scan found no fatal
  exception, ANR, native crash, or package-attributable crash. The required
  headset-camera and Internet permissions are present and headset-camera access
  is granted. Meta Home resumes when the off-head wake interval ends, so on-head
  visual confirmation remains pending.
- Phase 6 is not physically closed: the APK must be installed and both targets
  checked on-head for coverage, both-eye artifacts, head-motion stability, and
  sustained 72 FPS. The second physical Quest repeat and final photographed
  wall/desk appearance tuning remain pending.

The Phase 4 calibration result was an explicitly labelled test-only override
used to exercise the networking handshake. Phase 5 now carries real derived
six-tag calibration reports, and Phase 6 consumes the accepted rig transforms
for white pilot masks. Final visual appearance remains a physical-pilot task.

See:

- `Docs/Development/Phase1Baseline.md`
- `Docs/Development/Phase3Implementation.md`
- `Docs/Development/Phase5Implementation.md`
- `Docs/Development/Phase6Implementation.md`

## Immediate Next Step

Complete the Phase 6 one-Quest placement pilot while retaining the remaining
Phase 5 evidence gates:

1. Build/install `cdr-phase6-dev-1` through `hzdb`, calibrate, then use the
   guarded preview to inspect TV and keyboard Prepare/Show/Reveal/Hide states.
2. Record mask coverage, both-eye appearance, head-motion stability, and the
   provisional sustained 72 FPS result. Repeat the physical Quest as Director
   and Builder with the simulator occupying only the other slot.
3. Confirm and record calibration-outline alignment; repeat stability and the
   three-of-four-TV-tag test. Fix the known clock issue before formal timestamped
   evidence capture.
4. Repeat calibration compatibility and mask placement with two physical Quest
   headsets when the
   second device becomes available. Do not close Phase 5 from simulator
   evidence.

Continue all install, launch, log, screenshot, and recovery work through the
repository's `hzdb` workflow. Do not use a destructive uninstall while a local
backup log may still require export.

Do not add OBS automation or participant data collection yet; those remain
Phase 7 work. Do not treat the current white masks or one-Quest/simulator run as
final visual or two-headset validation.

Future Codex instruction:

> Read `Docs/PROJECT_HANDOFF.md` and every linked document. Treat locked
> decisions as authoritative. Begin or continue the named development phase,
> preserve unrelated user changes, and do not infer deferred study decisions.
