# Data Contracts

## Source of truth

The schemas in `../schemas/` are canonical. JSON configuration, snapshots,
messages, JSONL events, and parsed CSV rows must validate before use.

Schema version `1.4.0` retains the Phase 3 upward-stopwatch and post-limit
submission fields and the Phase 4 enrollment, server-connection,
live-reconnect, local-log, and authenticated message contracts. Wire protocol
`1.2.0` added the Phase 5 six-tag calibration command/report contract. Wire
protocol `1.3.0` adds the Phase 6 DR profile, lifecycle, state-report, and
guarded preview fields while retaining `trialDurationSeconds=420` as the
task-performance threshold.

The append-only event log is authoritative. Corrections are new
`EVENT_CORRECTED` records that reference the original event; existing lines are
never modified.

## Allocation and identity

- Pair IDs use `PAIR-001` style pseudonyms.
- Participant IDs use `P001-A` and `P001-B` style pseudonyms.
- Participant ID, participant slot, device ID, and study role are distinct
  values.
- `QUEST_A` and `QUEST_B` are temporary session slots, not permanent physical
  headset identities.
- The server selects a validated allocation from the master counterbalance plan
  by pair ID.
- It persists a session-specific config and schedule checksum before trials
  begin.
- The checked-in Phase 3 counterbalance plan is simulation-only.

## Timing

Records contain UTC time for alignment and a monotonic millisecond value for
durations. Quest timestamps are related to the laptop clock later through
measured clock offsets.

`TRIAL_STARTED` records `timeLimitMs=420000`. `TIME_LIMIT_REACHED` records when
the server first observes the threshold. All submissions remain append-only
records; post-limit attempts carry `afterTimeLimit=true`. A correct late attempt
keeps the analytical outcome as `TIMEOUT` and populates
`late_correct_completion_ms` in `trial-summary.csv`.

`TRIAL_OUTCOME_RECORDED.elapsedMs` and `duration_ms` retain the actual stop time.
The 420-second threshold remains the primary task-performance limit; post-limit
completion time is a separate secondary measure.

## CSV

`trial-summary.csv` uses the exact header defined in
`src/csvContract.ts`. Parsed rows validate against
`trial-summary-row.schema.json`.

Practice, technically invalid, protocol-invalid, withdrawal, and experimenter
abort records are retained but exported with `include_in_analysis=false`.

## Calibration reports

`CALIBRATION_REPORT` stores only derived values: accepted/rejected observation
counts, per-tag stability, keyboard-spacing residual, TV planarity, rig-relative
poses, failure reasons, and warnings. The contract fixes the family to
`tagStandard41h12`, the detection-corner side to `0.0567 m`, and
`rawFramesPersisted` to `false`. The laptop stores each device report and a
separate physical cross-Quest comparison; a simulator comparison is explicitly
`DEFERRED`.

## Diminished-reality reports

DR reports contain the requested action and target, profile version, prepared
and visible flags, actual state, calibration attempt/status, debug visibility,
state-match result, and provisional frame-rate evidence. They contain no raw
passthrough image data. A report is rejected if its profile or requested action
does not match the authoritative command, or if a `SHOW` acknowledgement has no
visible mask. Preview reports are diagnostic and remain outside participant
trial data.

## Deliberate exclusions

- Raw Quest passthrough frames are not recorded, persisted, or transmitted.
- `distractor_type` records only the scheduled TV or keyboard condition.
- Authentication tokens are referenced by secret name and never logged.
- Pairing responses expose a bearer token once; the running server stores only
  its SHA-256 hash.
- A targeted state snapshot is hashed from recursively key-sorted canonical
  JSON. Array order is preserved. `snapshotHash` covers only the nested
  `snapshot` object.
- Quest backup-log reports contain only the pseudonymous session ID, retention
  flag, record count, and optional SHA-256 digest. Cleanup is a separate command
  allowed only after a valid laptop export.
- Pilot calibration thresholds use the named provisional profile
  `PROVISIONAL_PHASE5_V2` and remain configurable until the physical pilot.
  Isolated positional outliers rejected by the robust filter remain visible in
  rejected counts and warnings. Per-tag rotation RMS remains a diagnostic
  metric; position, geometry, sample sufficiency, pose age, and cross-headset
  compatibility retain their blocking gates.
