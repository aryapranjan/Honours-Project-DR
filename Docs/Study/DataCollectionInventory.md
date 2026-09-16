# Data Collection Inventory

Status: implementation data contract; retention details remain ethics-dependent

Last reconciled: 2026-08-26

## Data Principles

- The MacBook owns the authoritative study timeline.
- Every record uses pseudonymous identifiers.
- Participant names never appear in study filenames or paths.
- Identifiable administration data is stored separately.
- Raw Quest PCA camera frames are processed temporarily and discarded.
- Overhead video and participant audio are intentionally recorded and treated
  as identifiable data.
- The encrypted SSD is temporary capture storage.
- The final authoritative archive must use approved University storage.
- Data collection must be limited to variables justified by the protocol.

## Identifier Model

Every record should include the identifiers relevant to its scope:

- `study_id`
- `protocol_version`
- `session_id`
- `pair_id`
- `participant_id`
- `device_id`
- `device_slot`
- `role`
- `trial_id`
- `condition`
- `distractor_type`
- `puzzle_id`
- `app_version`
- `timestamp_utc`
- `timestamp_monotonic`

Names, email addresses, consent signatures, and the pseudonym lookup table are
not part of the experimental dataset.

## 1. Participant Administration

Storage class: directly identifiable, separate restricted location

Collect only when required:

- participant name;
- contact details;
- consent status and date;
- withdrawal code;
- pseudonym mapping; and
- compensation status.

Do not place this information in Unity, OBS, dashboard, or analysis filenames.

## 2. Pre-Study Participant Information

Storage class: pseudonymous, potentially identifying in combination

Candidate variables:

- age range;
- gender if justified and optional where appropriate;
- handedness;
- corrected or uncorrected vision;
- hearing requirements;
- prior VR/MR experience;
- prior tangram experience;
- primary language or English proficiency;
- pair familiarity; and
- prior susceptibility to VR discomfort.

The final list requires supervisor and ethics approval. Avoid unnecessary free
text.

## 3. Laptop Session and Trial Events

Authority: laptop server

Format: append-only JSONL

Collect:

- session creation and closure;
- loaded schedule version and hash;
- randomization seed;
- role assignment;
- asymmetric recipient;
- ordered trial definition;
- state-machine transition;
- experimenter action;
- command ID and state version;
- trial preparation time;
- committed start time;
- actual start time;
- submission attempt number, runtime decision, elapsed time, and
  `afterTimeLimit` flag;
- 420-second time-limit threshold event;
- experimenter-confirmed timeout end time and overrun;
- correct post-limit completion flag and late correct completion time;
- completion;
- invalidation;
- abort;
- reserve-puzzle link;
- standardized feedback event;
- annotation; and
- snapshot path and checksum.

The event history is immutable. Corrections are new events referencing the
original event.

## 4. Quest PCA Camera

Authority: local Quest processing only

Temporarily process:

- camera frame;
- camera timestamp;
- image resolution;
- camera selection;
- intrinsics;
- extrinsics;
- exposure metadata where available; and
- camera pose associated with the image.

Default persistence:

- no raw frame;
- no screenshot;
- no video;
- no camera image sent over WebSocket;
- no image written to Quest or laptop storage.

Only derived tag and calibration data are retained. Any future raw-image
collection requires a protocol amendment and explicit ethics approval.

## 5. AprilTag Observation Data

Authority: Quest

Processing rate during calibration: configurable, initially approximately
`10 Hz` for one six-second attempt

Format: transient on-headset observations; aggregate derived report in the
Quest backup log and laptop authoritative event log

Temporarily process:

- tag ID;
- camera frame timestamp;
- four image-space corner coordinates;
- estimated world position;
- estimated world rotation;
- pose age;
- observation accepted or rejected;
- rejection reason;
- and image resolution.

Persist or transmit only:

- expected and observed tag IDs;
- accepted and rejected counts;
- per-tag accepted/rejected counts;
- per-tag position and rotation RMS;
- aggregate rig transforms, geometry residuals, warnings, and failure reasons;
- attempt timing, camera side, and image resolution; and
- an explicit `rawFramesPersisted=false` privacy marker.

Individual image-space corners, per-frame world poses, raw pixels, confidence,
and reprojection data are not written to the Quest or laptop logs. The reviewed
detector does not expose a calibrated confidence or reprojection-error value, so
the implementation does not invent one.

Under `PROVISIONAL_PHASE5_V2`, conservatively filtered isolated position
outliers remain visible in the rejected counts and warnings. Per-tag rotation
RMS remains stored as a diagnostic quality measure; it is not by itself a
calibration failure because the authoritative room frames use tag-centre
positions. Broad or sustained positional instability remains a failure.

## 6. Calibration Attempts and Results

Authority: Quest result, accepted by laptop start gate

Format: one JSON document per attempt plus event references

Collect:

- rig type;
- expected tag IDs;
- observed tag IDs;
- tag family and locked detection-corner side length (`0.0567 m`);
- expected tag geometry version;
- attempt start and end;
- sample count;
- accepted sample count;
- rejected sample count;
- per-tag visibility;
- estimated rig transform;
- measured inter-tag distances;
- translation residual;
- rotation residual;
- stability over time;
- quality result;
- tolerance profile version;
- success or failure;
- failure reason; and
- final target transform used by DR.

Failed attempts are retained.

The Phase 4 networking artifact could report an explicitly labelled test-only
calibration override. Protocol `1.2.0` now records measured derived Phase 5
reports separately. Any manual override remains reasoned and distinguishable
from a measured passing attempt, and must not be analysed as calibration or DR
quality evidence.

## 7. Headset Pose and Orientation Proxy

Authority: Quest

Recommended rate: approximately `10 Hz`

Collect:

- headset world position;
- headset world rotation;
- tracking validity;
- angle from head forward to TV;
- angle from head forward to keyboard;
- approximate TV-in-field-of-view flag;
- approximate keyboard-in-field-of-view flag;
- distance to TV and keyboard; and
- rig calibration version.

This is head orientation, not eye gaze. Do not derive or report gaze claims.

## 8. DR State and Rendering

Authority: laptop request with Quest acknowledgement

Collect:

- intended target;
- intended recipient;
- requested visibility;
- command ID;
- request time;
- application time;
- acknowledgement time;
- actual local state;
- target profile version;
- calibration transform version;
- target dimensions;
- local offset and rotation;
- texture or model asset ID;
- feather value;
- brightness;
- contrast;
- tint;
- opacity;
- shader version;
- render failure;
- target tracking loss;
- state mismatch; and
- measured command-to-application latency.

Material settings must be configuration data, not unexplained inspector state.

## 9. Quest Application Health

Authority: Quest

Recommended rate: approximately `1 Hz`, plus immediate fault events

Collect where supported:

- app version;
- approved build identifier and match result;
- protocol version;
- Unity version;
- headset model;
- Horizon OS version;
- battery level;
- thermal state;
- frame rate;
- dropped frames;
- memory usage;
- PCA availability;
- calibration validity;
- WebSocket state;
- assigned temporary device slot;
- assigned participant ID and role;
- heartbeat sequence;
- current authoritative state version;
- current trial ID;
- current DR state;
- exception;
- fatal error;
- local log-write status;
- local log record count, size, and SHA-256 checksum;
- snapshot hash validation result; and
- whether continuation is awaiting explicit experimenter confirmation.

Do not collect controller or hand skeleton telemetry unless later justified.

## 10. WebSocket and Clock Synchronization

Authority: laptop

Format: network JSONL, with critical events duplicated in the authoritative log

Collect:

- one-time enrollment-code creation and redemption result, without recording
  the code itself;
- assigned temporary `QUEST_A` or `QUEST_B` slot;
- advertised server endpoint;
- connection and disconnection;
- device authentication result, without recording the access token;
- protocol negotiation;
- exact app-build compatibility result;
- heartbeat send and receive;
- command send and receive;
- acknowledgement;
- sequence number;
- state version;
- round-trip time;
- estimated clock offset;
- offset uncertainty;
- duplicate command;
- stale command;
- rejected command and reason;
- reconnect;
- snapshot synchronization;
- snapshot checksum validation;
- experimenter continuation confirmation;
- fault duration; and
- three-second invalidation trigger.

Do not log secrets or unnecessary full payload copies.

### Quest local-log lifecycle

The Quest backup log is not deleted on enrollment, reconnect, or trial end. For
each headset, retain and report:

- session ID and temporary device slot;
- whether a local log is retained;
- record count;
- SHA-256 checksum;
- laptop export-validation status;
- cleanup eligibility;
- explicit cleanup command ID and time; and
- cleanup acknowledgement or failure reason.

Cleanup is a separate experimenter action. It is permitted only after the
laptop has validated the session export and the expected checksum/status agrees
with the headset report.

## 11. Distractor Condition

Authority: scheduled trial definition with experimenter preflight confirmation

Collect only:

- scheduled `distractor_type`; and
- one preflight result confirming that the scheduled distractor condition was
  set before the trial.

Do not collect detailed TV playback telemetry, stimulus checksums, HDMI state,
keyboard profile telemetry, brightness telemetry, cycle-speed telemetry, or
continuous TV/keyboard device-state data.

## 12. OBS and Overhead Video

Authority: OBS controlled by laptop

Recommended baseline: `1920x1080`, 30 FPS

Recommended container: MKV, optionally remuxed to MP4

Collect:

- top-down tangram workspace;
- physical pieces;
- participant hands where necessary;
- trial marker or synchronized timeline;
- recording start and stop;
- file path;
- duration;
- frame rate;
- dropped frames;
- encoder status;
- camera identifier;
- recording failure; and
- final-arrangement frame reference.

Frame the camera to avoid participant faces where practical.

## 13. External Participant Audio

Authority: OBS/audio subsystem

Recommended baseline: `48 kHz`, isolated channels

Collect:

- Director microphone channel;
- Builder microphone channel;
- recording start and stop;
- device/interface ID;
- channel-to-role mapping;
- sample rate and bit depth;
- file path;
- duration;
- peak level;
- RMS level;
- clipping;
- sustained silence;
- dropout;
- disconnect; and
- media synchronization markers.

The exact audio interface remains deferred. Voice is identifiable data.

## 14. Submission and Tangram Scoring

Authority: experimenter at runtime, validated by post-hoc scoring

Collect:

- Builder verbal-submission event;
- experimenter Submit event;
- submission number;
- elapsed time;
- whether the 420-second threshold was reached;
- actual timeout-button elapsed time and experimenter response overrun;
- runtime correctness decision;
- standardized `Continue` event;
- final outcome;
- final overhead frame;
- all pieces present;
- per-piece identity;
- per-piece position error;
- per-piece rotation error;
- flip error;
- overall objective correctness;
- rater ID;
- rater confidence;
- second-rater result for the reliability subset; and
- adjudication result.

## 15. Questionnaires

Authority: questionnaire adapter and approved participant device

### Pre-study

- approved demographic variables;
- VR experience;
- tangram experience;
- pair familiarity; and
- baseline discomfort where required.

### Post-trial

- distractor noticeability;
- perceived distraction;
- task difficulty;
- communication difficulty;
- confidence;
- DR realism when applicable;
- DR stability when applicable; and
- visual discomfort.

### Post-condition

- NASA-TLX;
- trust in DR;
- perceived coordination;
- usefulness or disruption; and
- condition-specific comments where approved.

### Post-session

- condition preference;
- overall DR assessment;
- simulator discomfort;
- open comments; and
- withdrawal or data-use confirmation where required.

Questionnaire hardware, exact wording, and timing remain deferred.

## 16. Optional Local Transcription

Status: optional post-processing, not on the critical trial path

Potential derived data:

- timestamped transcript;
- speaker role;
- speech turn;
- speaking duration;
- clarification question;
- correction or repair sequence;
- interruption;
- overlap;
- inaudible segment;
- model confidence;
- transcription model and version; and
- manual correction state.

Original audio remains authoritative. Whisper or another model must run under
the approved data-handling plan. Do not send identifiable audio to an
unapproved cloud service.

## 17. Data Integrity and Export

Authority: laptop export validator

For every expected artifact collect:

- relative path;
- media or data type;
- trial ID;
- creation time;
- file size;
- duration where applicable;
- SHA-256 checksum;
- expected or optional status;
- present or missing status;
- source module;
- validation result;
- SSD copy result;
- archive transfer result; and
- retention/disposal status.

Analysis exports should include:

- `trial-summary.csv`
- `participant-questionnaires.csv`
- `calibration-summary.csv`
- `network-summary.csv`
- `media-manifest.csv`
- `scoring.csv`

Raw event JSONL remains the source of truth. CSV files are reproducible derived
exports.

### Phase 4 development artifact evidence

The current non-production Android artifact was built at
`2026-08-11 17:36:38 +0930` as
`Builds/Android/CollaborativeDR-Phase4.apk`, size `86,101,218` bytes, SHA-256
`15a773ea04925ec882105a9da08ccc718e6ec937222a1091b6dc1ae5343dad46`. Its
packaged debug manifest was verified to include the headset-camera and Internet
permissions, permit cleartext for the isolated authenticated study network, and
omit `android:networkSecurityConfig`.

The APK was installed non-destructively via `hzdb` on Quest 3 serial
`2G0YC1ZF9Z03HD` under the Wearable Computer Lab profile. The rebuilt app
launched in `240 ms` with no crash signal. A 300-line Unity warning query
returned no warnings while the app was off-head. These are engineering
verification records, not participant data.

The right-controller repair enables Android `OVRInputModule` activation and
adds the Meta Core v85 right-controller/ray prefab under
`RightControllerAnchor`, with `RTouch`, child `OVRRayHelper`, and
`PrimaryIndexTrigger` configured explicitly. The object is active only during
setup, enrollment, connection, and synchronization. Automated verification is
`8/8` EditMode plus `2/2` in
`Logs/Phase4PlayModeControllerResults.xml`. On the immediately preceding build
(SHA-256
`938ede286080e882bb292faca12087b6b0950af31a565350e8e117c29f70462d`),
`Logs/Phase4Device/phase4-controller-fix-metacam.png` physically shows the right
Touch model, white beam, and cursor over the setup keypad. The address changed
to `5888` and six-digit pairing validation status appeared, verifying
trigger-driven setup input. Controller events are not added to the participant
dataset.

The optional `OVRRayHelper` cursor is disabled because Meta Core v85
`OVRRaycaster` leaves `RaycastResult.worldNormal` zero, which otherwise produces
`Look rotation viewing vector is zero` continuously. `Cursor` and `CursorFill`
are null; the validated non-null `Renderer` continues to provide the beam and
hover interaction. This is engineering configuration evidence, not a collected
participant variable.

After changing `CenterEyeAnchor` from `CameraClearFlags.Nothing` to transparent
`CameraClearFlags.SolidColor`, the post-fix screencap shows clean stereo UI with
no bands. Passthrough is protected and appears black in an ordinary screencap;
`hzdb metacam` itself is available and provided the physical controller evidence
described above.

This checksum identifies only the Phase 4 development artifact.
Physical-plus-simulator pairing and reconnect/recovery evidence, and the
two-physical-headset exit gate, remain pending. The final cursor-suppressed APK
passed its on-head controller check on `2026-08-12`: clear passthrough and the
white beam were visible, the right controller was `CONNECTED_ACTIVE` with
positional tracking, and trigger input cleared the four-character pairing field.
`Logs/Phase4Device/phase4-controller-final-trigger-confirmed.png` records the
result (SHA-256
`f41722e860bba6c6bc25b8ed623401317800feba2a6e0f2a6c5df0f784f6b8a0`). Unity
and filtered device warning scans found no controller, EventSystem,
null-reference, or `Look rotation` warning. This is engineering verification,
not participant data, and no controller-event variable is added to collection.
The final approved production APK requires its own manifest entry and checksum
after release freeze.

## Recommended Session Layout

```text
StudyData/
  Pair-P012/
    session-config.json
    schedule.json
    authoritative-events.jsonl
    snapshots/
    quests/
      director-events.jsonl
      builder-events.jsonl
      calibration/
      telemetry/
    media/
      overhead/
      audio/
    questionnaires/
    scoring/
    exports/
    manifest.json
    checksums.sha256
```

## Ethics and Governance Requirements

Before participant collection, document:

- lawful and ethical collection purpose;
- participant consent for voice and overhead video;
- who can access identifiable data;
- temporary SSD controls;
- approved University archive;
- retention period;
- withdrawal handling;
- data sharing restrictions;
- destruction procedure; and
- whether any derived transcript will be retained.

References:

- Meta Passthrough Camera API overview:
  https://developers.meta.com/horizon/documentation/unity/unity-pca-overview/
- University of Adelaide data-management planning:
  https://www.adelaide.edu.au/technology/research/research-data/research-data-planner/about-data-management-plans
- NHMRC National Statement on Ethical Conduct in Human Research:
  https://www.nhmrc.gov.au/research-policy/ethics/national-statement-ethical-conduct-human-research
