# Collaborative Diminished Reality Study: Project Handoff

Status: authoritative implementation handoff

Last reconciled: 2026-07-20

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
- Every scored trial has a maximum duration of 420 seconds.
- The Builder verbally says `submit`.
- The experimenter clicks Submit on the laptop dashboard.
- The experimenter does not tell the pair whether an incorrect submission is
  correct; the standardized response is `Continue`.
- Correct completion, timeout, invalidation, and replacement are stored as
  explicit outcomes.
- A technical invalidation never overwrites the original trial.
- An approved reserve puzzle is linked to the invalid trial.

Puzzle difficulty, exact scoring tolerance, target-card rendering, and the
seven-minute ceiling must be validated during pilot testing. The implementation
must support configuration rather than hard-coding pilot thresholds.

## Physical Calibration Rig

Six AprilTags define the fixed study geometry:

- Keyboard tags: IDs `1` and `2`
- Keyboard tag centre distance: `0.45 m`
- TV tags: IDs `3`, `4`, `5`, and `6`
- TV tags are mounted around the TV and outside the diminished region
- Physical detectable tag side length used in the previous prototype:
  `0.092 m`

The final room survey, tag transforms, target dimensions, and seating layout are
deferred until the study room is measured.

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
- Local backup event log
- AprilTag calibration and DR rendering adapters

### Network

- Dedicated Wi-Fi router
- Fixed or reserved laptop IP address
- No direct Quest-to-Quest communication
- No Photon or Unity Netcode requirement

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
- The physical tag side length was verified as `0.092 m`.
- The keyboard tag centre distance was later corrected to `0.45 m`.
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

## Immediate Next Step

Begin Phase 1 only:

1. Audit the clean repository and current Unity changes.
2. Confirm PCA operation in `Final-Design-Scene.unity`.
3. Make package versions reproducible.
4. Establish project folders and assembly boundaries.
5. Create a verified Android build.
6. Run the PCA baseline on one physical Quest 3.
7. Tag and document the baseline before Phase 2.

Future Codex instruction:

> Read `Docs/PROJECT_HANDOFF.md` and every linked document. Treat locked
> decisions as authoritative. Begin or continue the named development phase,
> preserve unrelated user changes, and do not infer deferred study decisions.
