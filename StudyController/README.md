# Collaborative DR Study Controller

This folder contains the laptop-authoritative controller through the Phase 7
implementation path. Phase 8 room and device validation is still open.

## Scope

Included:

- canonical JSON Schemas and TypeScript contract types;
- an Express server and `ws` gateway;
- the authoritative session manager and upward stopwatch with a 420-second
  threshold;
- append-only JSONL events and atomic JSON snapshots;
- pre-generated counterbalance-plan selection and reserve-trial scheduling;
- restart recovery that never resumes an interrupted stopwatch;
- validated CSV trial-summary export;
- OBS WebSocket v5 camera, microphone, track, storage, recording, and preview
  checks when enabled;
- one MKV per trial with a pseudonymous filename and SHA-256 artifact manifest;
- pre-study, post-trial, post-condition, and final questionnaire completion
  gates when enabled;
- a React/Vite experimenter dashboard;
- authenticated physical Quest enrollment into temporary `QUEST_A` and
  `QUEST_B` session slots;
- slot-selective simulated Quest clients, including one-physical/one-simulator
  testing;
- exact approved-build and compatible protocol-major gates;
- hashed bearer-token authentication for Quest WebSockets;
- canonical, SHA-256-verified state snapshots and explicit short-reconnect
  continuation;
- automatic technical invalidation when a disconnect exceeds 3000 ms;
- export-gated, explicit Quest backup-log cleanup;
- simultaneous six-second calibration commands for both Quest slots;
- strict derived-only six-tag calibration reports and a guarded start gate;
- physical cross-Quest rig-transform compatibility checks;
- profile-driven TV and keyboard replacement masks, currently using white
  placeholders with new-room placement blocked until survey;
- explicit DR `Prepare`, `Show`, `Hide`, `Reveal`, and state-report commands;
- an environment-gated researcher preview that is unavailable during trials;
- clear-passthrough fail-safe behavior and actual-versus-requested DR reports;
- laptop and Quest state-transition rules;
- duplicate, stale-command, reconnect, and submission rules;
- late-submission recording with late correct finishes classified as `TIMEOUT`;
- validated example records; and
- unit and integration tests.

Still pending physical and study approval gates:

- new-room tag survey and TV/keyboard mask recalibration before enabling DR;
- real OBS recording playback and left/right participant audio verification;
- two-Quest pilot, performance and fault runs, ethics/storage decisions, and
  release freeze.

## Requirements

- Node.js 24 LTS
- npm 11

Use the pinned Node version:

```sh
nvm use
npm install
```

## Run the controller

For development:

```sh
npm run dev
```

Open `http://127.0.0.1:5173`. The Vite dashboard proxies to the authoritative
server on port `4317`.

For the production-style local build:

```sh
npm run build
npm start
```

Open `http://127.0.0.1:4317`.

The production server listens on all interfaces by default and displays its
detected LAN address in the dashboard. The default data root is `.study-data/`.
Override deployment values without changing code:

```sh
STUDY_DATA_ROOT=/approved/capture/path \
COUNTERBALANCE_PLAN=/approved/master-plan.json \
ADVERTISED_HOST=192.168.1.20 \
APPROVED_QUEST_BUILD_ID=cdr-phase8-final \
DR_PREVIEW_ENABLED=true \
npm start
```

For the room pilot, configure OBS WebSocket 5.3+ and four form links. Keep the
OBS password out of checked-in files. With two transmitters and one receiver,
configure the receiver for separate left/right output, add it as one stereo
OBS audio input, and route it to one stereo recording track. Match the source
name, track, and participant channel assignments to the active hardware and
OBS scene/profile:

```sh
STUDY_DATA_ROOT=/approved/encrypted-ssd/cdr \
COUNTERBALANCE_PLAN=/approved/master-plan.json \
OBS_ENABLED=true \
OBS_URL=ws://127.0.0.1:4455 \
OBS_PASSWORD='<local-password>' \
OBS_CAMERA_SOURCE='Overhead Camera' \
OBS_AUDIO_MODE=STEREO_RECEIVER \
OBS_RECEIVER_SOURCE='Participant Receiver' \
OBS_RECEIVER_TRACK=2 \
OBS_PARTICIPANT_A_CHANNEL=LEFT \
OBS_PARTICIPANT_B_CHANNEL=RIGHT \
QUESTIONNAIRE_GATE_ENABLED=true \
FORM_PRE_STUDY_URL='<approved-form-url>' \
FORM_POST_TRIAL_URL='<approved-form-url>' \
FORM_POST_CONDITION_URL='<approved-form-url>' \
FORM_POST_SESSION_URL='<approved-form-url>' \
npm start
```

Use an approved private way to supply secrets; the command above documents the
variable names. `OBS_ENABLED` and `QUESTIONNAIRE_GATE_ENABLED` default to false
for development. The dashboard labels that mode as a development
configuration. It must not be used for participant capture. The controller
stores these modes plus hashes of the OBS capture layout and configured form
links when a session is created; set the approved configuration before creating
it. A restart with a changed layout, mode, or form link is rejected. An OBS
recording interrupted by a server restart must be
stopped and saved through dashboard recovery before the trial is resolved. The
controller requires MKV output. In `STEREO_RECEIVER` mode it checks both live
input channels and the assigned OBS track, but a pilot recording must confirm
that the saved MKV preserves left/right separation and that each transmitter
belongs to the intended participant. The channel assignments above are defaults
until this is checked. `OBS_AUDIO_MODE=SEPARATE_INPUTS` retains support for two
independent OBS inputs using `OBS_MIC_A_SOURCE`, `OBS_MIC_B_SOURCE`,
`OBS_MIC_A_TRACK`, and `OBS_MIC_B_TRACK`; those tracks must differ. The operator
still needs to play a pilot file and confirm the actual video and participant
audio before study collection. The dashboard records form
completion confirmations, not Google Form answers. See
[`Docs/Development/Phase7And8Implementation.md`](../Docs/Development/Phase7And8Implementation.md)
for gates and fault coverage.

`ADVERTISED_HOST` is the MacBook address reachable from the dedicated study
Wi-Fi. The default approved Quest build is `cdr-phase8-final`; use the
exact ID compiled into the Phase 8 final APK. `DR_PREVIEW_ENABLED=true` exposes
the researcher-only placement panel during calibration. The photographed
new-room setup has provisional white TV and keyboard masks for a one-Quest
pilot; run fresh six-tag calibration before preparing either target.

The offline, one-Quest new-room dry run is in
[`Docs/Development/NewRoomTestReadiness.md`](../Docs/Development/NewRoomTestReadiness.md).

After creating a session, issue a six-digit pairing code for one temporary slot
from the dashboard and redeem it on that Quest. A code is slot-specific,
single-use, and expires after five minutes. Pairing produces an access token
that is sent only in the Quest WebSocket `Authorization: Bearer` header. Tokens
are process-local and only their SHA-256 hashes are retained by the server; a
server restart therefore requires re-enrollment.

For hybrid testing, pair the physical headset into one slot, then start the
simulator only for the other slot from the dashboard.

The checked-in
`examples/counterbalance-plan.example.json` is for simulation only. It is not a
production allocation plan and must not be used for participant data
collection.

## Verify

```sh
npm run verify
```

This runs the Node and dashboard typechecks, the complete test suite, and both
production builds.

## Session data

Each pseudonymous pair receives its own directory containing:

- `session-config.json`;
- `schedule.json`;
- `workflow-policy.json` (the session's fixed OBS/form-gate modes);
- `authoritative-events.jsonl`;
- versioned snapshots plus `snapshots/latest.json`; and
- `trial-summary.csv` after export validation.
- `media/PAIR-001_<trial>.mkv` for OBS-enabled recorded trials; and
- `artifact-manifest.json` with file sizes and SHA-256 checksums after export
  validation, finalized after session closure.

Existing pair directories are never overwritten. Raw Quest passthrough frames
are not recorded, persisted, or transmitted.

JSON Schema remains the cross-platform source of truth. Protocol `1.3.0` and
schema `1.4.0` define the laptop/Quest boundary; see
[`docs/protocol.md`](docs/protocol.md) for enrollment, recovery, and local-log
lifecycle details.
