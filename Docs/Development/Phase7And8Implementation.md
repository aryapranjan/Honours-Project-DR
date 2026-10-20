# Phase 7 and 8 software preparation

Status: room-independent implementation verified on 2026-10-06; physical exit
gates and release freeze remain open.

New-room pilot update, 2026-10-21: the two DR profiles use provisional white
placements derived from the supplied photos and measurements. Preparing DR
still requires a passing fresh six-tag calibration. The one-Quest,
no-microphone test sequence is in
[NewRoomTestReadiness.md](NewRoomTestReadiness.md).

## Implemented controller path

- The existing practice, six scored trials, counterbalancing, verbal submission,
  420-second threshold, reserve-puzzle replacement, JSONL, and CSV paths remain
  in place.
- Optional OBS WebSocket v5 control checks the overhead source and JPEG preview,
  both participant channels of one stereo receiver input and its assigned OBS
  track, live meter levels,
  clipping, silence, free storage, and recording state. The check runs during
  preflight and again before starting a trial. A recording starts before the
  Quest start command and stops at the trial outcome. A failed stop marks an
  otherwise successful scored trial technically invalid and raises an OBS fault.
- OBS writes MKV into the pseudonymous session `media/` directory. The
  controller renames each file to `<pair>_<trial>.mkv`, records size and SHA-256,
  and checks the file again during export validation. If the server restarts
  while OBS is still recording, the dashboard requires a guarded stop-and-save
  recovery before the interrupted trial can be resolved.
- Manual completion gates cover both participants' pre-study form, each scored
  or replacement post-trial form, each condition block form, and the final form.
  Only submission confirmation is logged; answers stay in the approved form
  system. Confirmations survive a controller restart.
- Export validation writes `trial-summary.csv` and `artifact-manifest.json`.
  The manifest covers session config, schedule, workflow policy, authoritative
  events, CSV, and any OBS media. It is regenerated after session closure, so its event hash
  includes `SESSION_CLOSED`. Missing or changed media invalidates the export.
  A manifest or pointer-write failure raises an export fault and leaves closure
  incomplete. The dashboard marks a successful closure and rejects a duplicate
  close.
- The default development configuration uses simulated media and has form gates
  disabled. The dashboard labels that mode. It is unsuitable for participant
  capture. Each session stores its required media and form modes plus hashes of
  its OBS capture layout and configured form links in `workflow-policy.json`;
  a restart with a changed layout, mode, or form link is rejected.

The controller requires OBS WebSocket support for `SetRecordDirectory` (v5.3+).
The OBS protocol source used for the integration is the [official OBS WebSocket
protocol](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md).
The two-transmitter, one-receiver configuration follows the [DJI Mic 2 stereo
mode description](https://www.dji.com/mic-2/faq) as an example: separate
transmitters can occupy left and right output channels. The exact hardware
model and participant-to-channel mapping still need pilot confirmation. The
controller also supports separate OBS inputs if the final receiver exposes
them that way.

## Room-independent verification

`StudyController/npm run verify` passed on 2026-10-06 with Node 24: 45/45 tests,
server typecheck/build, and dashboard typecheck/build. The added tests run a
complete simulated practice plus six-scored-trial questionnaire workflow,
including a restart and final export; a mock OBS WebSocket handshake and
recording, including stop-and-save after a server restart; microphone
silence/clipping, missing stereo channels, changed channel mappings on restart,
and low-storage checks; checksum
tampering; and a scored trial invalidated by a recording failure. Earlier tests
also cover duplicate/stale commands, recovery, disconnect timing, calibration
compatibility, DR state reports, timeout, and reserve trials.

These are software and mock-device results. A mock MKV proves file handling and
checksums, not that OBS recorded camera frames or two audio streams.

## Operator setup for the later room pilot

1. Put the laptop data root on approved encrypted capture storage. Use the
   approved master counterbalance plan, never the checked-in simulation plan.
2. Configure OBS WebSocket with a local password, one overhead camera source,
   one stereo receiver input carrying the two transmitters on separate channels,
   MKV recording, and an enabled stereo audio track. Supply the four approved form URLs.
   Set `OBS_ENABLED=true` and `QUESTIONNAIRE_GATE_ENABLED=true`; the exact
   variables are in [StudyController/README.md](../../StudyController/README.md).
3. During preflight, inspect the overhead preview and ask both participants to
   speak at normal volume. Resolve silence, clipping, missing track routing,
   or storage warnings before confirmation. The preview is available only from
   the laptop's loopback address and is not saved as an artifact.
4. Run a short pilot recording and play the actual MKV. Confirm the overhead
   view, separate left/right participant audio, transmitter-to-participant
   mapping, sync against trial markers, and
   pseudonymous filename. The WebSocket checks alone cannot prove these.
5. Verify each form submission in Google Forms before pressing its participant
   completion button. Store identifiable consent separately from study data.
6. After export validation, inspect the CSV, JSONL, MKV files, and final
   manifest. Preserve Quest backup logs until the approved laptop export is
   validated; cleanup is a separate guarded action before session closure.

## Phase 8 fault and release gates

| Scenario | Software evidence now | Required room or device evidence |
| --- | --- | --- |
| Wi-Fi loss, restart, stale or duplicate commands | Existing networking/recovery tests | Two-Quest interruption and recovery run |
| Calibration mismatch and wrong DR state | Existing report and state-gate tests | Fresh six-tag survey, TV tag occlusion, both-eye mask inspection |
| OBS failure, missing stereo channel, silent/clipping microphones, low capture storage | Mock OBS and controller tests | Real OBS and two-transmitter pilot recordings |
| Low battery, thermal warning, HDMI loss, wrong keyboard state | Guarded manual preflight and fault workflow only | Deliberate physical fault trials and classification review |
| Frame rate, latency, alignment, media sync | No new physical evidence | Two-Quest soak and measurement log |

The new room needs fresh scans, photos, tag survey, seating and sight-line
measurements, then recalibration of all six tag positions and both DR masks.
Keep `tagStandard41h12`, IDs 1–6, and the current tag-size configuration. The
old room transforms and Phase 6 mask dimensions are historical pilot values,
not placements for the new room.

The release cannot be frozen until the approved questionnaires and their
versions, participant schedule, puzzle set, target profiles, both-headset APK,
operator manual, University storage/retention decisions, ethics conditions,
and physical pilot thresholds are recorded together. No APK or pilot release
was frozen by this software work.
