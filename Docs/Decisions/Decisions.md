# Locked and Deferred Decisions

Status: authoritative decision register

Last reconciled: 2026-07-20

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
- Each scored trial has a 420-second maximum.
- An incorrect submission is recorded as an attempt, the experimenter says
  only `Continue`, and the authoritative timer keeps running.
- Multiple submissions are permitted until correct completion or timeout.
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
- Keyboard tag centre distance is `0.45 m`.
- The TV uses AprilTag IDs `3-6`.
- TV tags are placed around the TV and outside the DR replacement region.
- Six total tags form the fixed room calibration rig.
- The previous physical tag side length was `0.092 m`.
- TV, keyboard, desk, and tags remain fixed during data collection.

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

### Failure handling

- A trial cannot start unless both Quests and required recording systems are
  ready.
- Failures are visible and logged.
- A critical network, calibration, or DR-state fault lasting more than three
  seconds invalidates the active trial.
- A critical disconnect lasting no more than three seconds may continue only
  after the Quest applies the authoritative state snapshot.
- Invalid trials are never overwritten.
- Server restart never automatically resumes an active timer.
- Duplicate commands are idempotent.
- Reconnected clients receive the authoritative state snapshot.

### Media and data

- A USB overhead camera is connected to the MacBook and controlled by OBS.
- Two external participant microphones are recorded by OBS.
- The external encrypted SSD is used as configurable capture storage.
- Participant names do not appear in study-data paths or filenames.
- Audio and video are synchronized to laptop trial markers.

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
- The laptop uses a reserved local IP.
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
