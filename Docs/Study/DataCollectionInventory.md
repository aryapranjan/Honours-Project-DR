# Data Collection Inventory

Status: implementation data contract; retention details remain ethics-dependent

Last reconciled: 2026-07-16

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
- submission time;
- timeout;
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

Recommended rate: detector rate, initially up to approximately `20 Hz`

Format: local JSONL backup and selected telemetry to laptop

Collect:

- tag ID;
- camera frame timestamp;
- four image-space corner coordinates;
- estimated world position;
- estimated world rotation;
- decision margin or available confidence measure;
- reprojection error;
- pose age;
- observation accepted or rejected;
- rejection reason;
- image resolution;
- intrinsics version;
- camera pose version; and
- processing duration.

Do not assume a confidence value exists if the AprilTag library does not expose
one. The schema should permit null values with an explicit reason.

## 6. Calibration Attempts and Results

Authority: Quest result, accepted by laptop start gate

Format: one JSON document per attempt plus event references

Collect:

- rig type;
- expected tag IDs;
- observed tag IDs;
- tag side length;
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
- reprojection residual;
- stability over time;
- quality result;
- tolerance profile version;
- success or failure;
- failure reason; and
- final target transform used by DR.

Failed attempts are retained.

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
- heartbeat sequence;
- current authoritative state version;
- current trial ID;
- current DR state;
- exception;
- fatal error; and
- local log-write status.

Do not collect controller or hand skeleton telemetry unless later justified.

## 10. WebSocket and Clock Synchronization

Authority: laptop

Format: network JSONL, with critical events duplicated in the authoritative log

Collect:

- connection and disconnection;
- device authentication;
- protocol negotiation;
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
- fault duration; and
- three-second invalidation trigger.

Do not log secrets or unnecessary full payload copies.

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
