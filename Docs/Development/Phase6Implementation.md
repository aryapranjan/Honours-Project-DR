# Phase 6 Implementation — Generic Diminished-Reality Targets

## Status

The Phase 6 software path is implemented for one physical Quest plus the
existing slot simulator. It is not the final visual treatment and it is not a
release freeze. Physical placement, head-motion stability, one-eye artifacts,
and sustained on-head performance still require the room pilot. The later
second-Quest gate must repeat the same checks on both physical headsets.

## Locked pilot geometry

All positions are derived from the accepted Phase 5 calibration; no scene-space
coordinates are hand-entered per headset.

| Target | Rig anchor | Final outer mask | Local placement | Feather |
| --- | --- | --- | --- | --- |
| TV | centre and axes of TV tags 3–6 | `1.18 x 1.075 m` | `X=+0.025 m`, `Z=-0.31 m` toward participants | `0.005 m` inside edge |
| Keyboard | keyboard rig from tags 1–2 | `0.31 x 0.115 x 0.0375 m` open-bottom cover | centred, top at `Y=0.0375 m`, horizontal | `0.003 m` inside top edge and desk-contact skirt |

The TV pilot showed a small uncovered area on participant-right. Its original
left edge is preserved while the tag-5/tag-6 side is extended by `0.05 m`; the
corresponding `0.025 m` centre shift produces the new `1.18 m` width. The
keyboard itself is `0.29 x 0.095 m`; the final cover includes the approved
`0.01 m` footprint padding on every edge. It now has a top and four vertical
faces extending down to the desk, rather than a single floating plane, so its
`0.0375 m` physical thickness is covered from oblique viewing angles. Both masks
currently use a full-opacity white unlit material. The profiles already accept
a replacement texture, tint, brightness, contrast, opacity, and material, so
photographed wall/desk content can be added later without changing the
lifecycle or calibration code.

## Runtime behavior

`DiminishedRealityManager` owns one lazy-created target mesh and applies the
selected flat-quad or open-bottom-cover profile in the calibrated room frame.
It implements:

- `Prepare`: resolve and configure the target but keep it invisible;
- `Show`: reveal it only after the authoritative trial start;
- `Hide`: remove and clear it at trial end;
- `Reveal`: hide the mask while retaining its prepared placement for
  researcher inspection;
- `SetDebugBounds`: show a researcher-only outline and centre mark; and
- `EnterFailSafe`: remove all replacement geometry and restore clear
  passthrough.

`NO_DR` never creates visible replacement geometry. Participant controllers do
not expose any DR shortcut. Requested state, actual state, calibration identity,
profile version, visibility, debug state, and provisional frame-rate evidence
are returned to the laptop.

Protocol `1.3.0`, build `cdr-phase6-dev-1`, and profile `PHASE6_TEST_V1` form the
compatibility gate. A `READY` response is rejected when calibration is not
accepted, the DR profile differs, preparation fails, or actual and requested
states disagree.

## Researcher preview

Start the controller with `DR_PREVIEW_ENABLED=true` to add the Phase 6 placement
panel during pilot testing. The panel is absent by default, is accepted only in
the laptop `CALIBRATION` state, and is rejected during active trials. It supports
target selection, Prepare, Show, Hide, Reveal, debug bounds, and state reports.

For the one-Quest pilot, enroll the physical Quest in one temporary slot and run
the simulator in the other. Test the physical headset once as Director and once
as Builder. Do not treat the simulator as evidence for the two-physical-Quest
compatibility gate.

## Automated evidence

- StudyController `npm run verify`: `41/41` tests passed; server and dashboard
  production builds passed.
- Unity EditMode: `21/21` tests passed in
  `Logs/Phase6FineTuningEditModeResults-20260902.xml`, including calibrated TV
  composition, the participant-right-only extension, the runtime open-bottom
  keyboard cover, and the `NO_DR` no-geometry invariant.
- Unity Phase 6 configuration compiled and serialized the profiles, material,
  manager, safety reference, and final study scene successfully.
- The fine-tuned ARM64 Android development APK built at
  `2026-09-02 14:08:38 +0930` as
  `Builds/Android/CollaborativeDR-Phase6.apk` (`77,701,790` bytes; SHA-256
  `1d4e2982f22695f5f3685b6a52291548c0e3d4804ee51dc613dc9352fbc693da`).
  A non-destructive `hzdb app install --replace --grant-permissions` succeeded
  on Quest 3 serial `2G0YC1ZF9Z03HD`, preserving existing app data. A clean
  off-head cold launch completed in `228 ms`; the eight-second `hzdb` crash scan
  found no fatal exception, ANR, native crash, or package-attributable crash.
  Headset-camera and Internet permissions are present, and headset-camera access
  is granted. On-head focus and visual placement remain the next physical
  checks.

## Remaining physical exit gates

1. Put the Quest on, confirm the installed app focuses without a crash, and
   inspect the initial setup/waiting view.
2. Run a fresh six-tag calibration in the final room arrangement.
3. Preview TV and keyboard separately: Prepare, debug bounds, Show, Reveal, and
   Hide. Confirm the white mask covers only the intended object area.
4. Repeat while moving the head normally and check both eyes for drift,
   z-fighting, holes, or incorrect orientation.
5. Keep each target visible long enough for the dashboard to evaluate the
   provisional 72 FPS gate.
6. Run practice `NO_DR`, symmetric DR, and both asymmetric-recipient paths with
   the physical Quest assigned to each role in separate runs.
7. Repeat placement and cross-headset agreement with two physical Quests when
   the second device is available.
8. Replace the white pilot material with approved wall/desk appearance settings
   and lock those values only after the physical visual pilot.
