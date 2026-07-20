# Data Contracts

## Source of truth

The schemas in `../schemas/` are canonical. JSON configuration, snapshots,
messages, JSONL events, and parsed CSV rows must validate before use.

The append-only event log is authoritative. Corrections are new
`EVENT_CORRECTED` records that reference the original event; existing lines are
never modified.

## Timing

Records contain UTC time for alignment and a monotonic millisecond value for
durations. Quest timestamps are related to the laptop clock later through
measured clock offsets.

## CSV

`trial-summary.csv` uses the exact header defined in
`src/csvContract.ts`. Parsed rows validate against
`trial-summary-row.schema.json`.

## Deliberate exclusions

- Raw Quest passthrough frames are not recorded, persisted, or transmitted.
- `distractor_type` records only the scheduled TV or keyboard condition.
- Detailed TV and keyboard playback/device telemetry is not collected.
- Authentication tokens are referenced by secret name and never logged.
- Pilot calibration thresholds remain configurable and are not hard-coded.
