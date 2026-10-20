# Phase 6 Implementation — Generic Diminished-Reality Targets

New-room update, 2026-10-20: the first white-placeholder build
`cdr-newroom-white-dev-1` blocked DR pending survey. The researcher then
provided new-room photos, confirmed unchanged target-to-tag relationships,
`1.50 m` eye-to-wall distance and `0.29 m` TV protrusion. The profiles now hold
provisional white-mask geometry for a one-Quest pilot. The former pilot used
`cdr-newroom-white-dev-2`; the current Phase 8 final APK uses
`cdr-phase8-final`. `Phase6Build` does not restore former-room geometry
or photo textures. See the [photo survey](NewRoomPhotoSurvey-20261020.md) and
[new-room test readiness](NewRoomTestReadiness.md) for geometry and APK evidence.

## Status

The Phase 6 software path is implemented for one physical Quest plus the
existing slot simulator. It is not the final visual treatment and it is not a
release freeze. Physical placement, head-motion stability, one-eye artifacts,
and sustained on-head performance still require the room pilot. The later
second-Quest gate must repeat the same checks on both physical headsets.

## Historical pilot geometry from the former room

All positions are derived from the accepted Phase 5 calibration; no scene-space
coordinates are hand-entered per headset.

| Target | Rig anchor | Final outer mask | Local placement | Feather |
| --- | --- | --- | --- | --- |
| TV | centre and axes of TV tags 3–6 | `1.60 x 1.46 m` experimental recessed wall plane | `X=+0.034 m`, `Z=+0.07 m` behind tag plane | `0.005 m` inside edge |
| Keyboard | keyboard rig from tags 1–2 | `0.55 x 0.35 m` desk plane | centred, `Y=0 m`, horizontal | `0.005 m` inside edge |

The former-room geometry was an explicit physical-pilot experiment. The TV
panel was estimated `0.29 m` in front of the wall and seated viewing distance
to the wall was approximately `1.30 m`. The mask was empirically recessed
another `0.07 m` behind the tag plane, so its
perspective factor is `1.37 / (1.30 - 0.29)`. This converts the previous
`1.18 x 1.075 m` front-plane coverage to the rounded `1.60 x 1.46 m` plane and
its `0.025 m` centre shift to `0.034 m`. This is expected to match only near the
nominated viewing position and must be checked for head-motion parallax. The
keyboard remains a single plane on the desk. Its oversized `0.55 x 0.35 m`
footprint provides substantial coverage around the raised-key silhouette at
oblique participant viewing angles without reintroducing box geometry. Both
masks use full-opacity unlit, photo-derived wall/desk textures with the same
inside-edge feathering. The shared shader receives each target's texture via
a material property block. Profile texture, tint, brightness and contrast
adjustments survive the configuration/build step. No scan meshes or runtime
camera capture were added. See [surface material provenance and tuning](Phase6SurfaceMaterials.md).

## Runtime behavior

`DiminishedRealityManager` owns one lazy-created flat target mesh and applies
the selected profile in the calibrated room frame. It implements:

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
- Unity EditMode: `24/24` tests passed in
  `Logs/Phase6SurfaceFinalEditModeResults-20260916.xml`. In addition to the
  geometry and `NO_DR` invariants, the suite verifies separate wall/desk asset
  binding, Android texture import settings, target switching, white fallback,
  and preservation of pilot colour settings across rebuilds.
- Unity Phase 6 configuration compiled and serialized the two texture references,
  profiles, material, manager, safety reference, and final study scene.
- The photo-textured ARM64 Android development APK built successfully at
  `2026-09-16 17:47:13 +0930` as
  `Builds/Android/CollaborativeDR-Phase6.apk` (`101,653,342` bytes; SHA-256
  `f3043a25c26002c0a7c6ec70526dafc72d2183b8cf7a60cbefb6fb2f174d3860`).
  It installed non-destructively on Quest 3 serial `2G0YC1ZF9Z03HD`, preserving
  app data and granting required runtime permissions. An off-head cold launch
  completed in `199 ms`; the eight-second `hzdb` crash scan found no fatal
  exception, ANR, native crash, or package-attributable crash. Off-head focus
  remained with Horizon's clear activity, so visual validation still requires
  the researcher to wear the headset.

## Remaining physical exit gates

1. Put the Quest on, confirm the installed app focuses, and inspect the initial
   setup/waiting view. Installation and the off-head crash gate already pass.
2. Run a fresh six-tag calibration in the final room arrangement.
3. Preview TV and keyboard separately: Prepare, debug bounds, Show, Reveal, and
   Hide. Confirm the textured mask covers only the intended object area.
4. Repeat while moving the head normally and check both eyes for drift,
   z-fighting, holes, or incorrect orientation.
5. Keep each target visible long enough for the dashboard to evaluate the
   provisional 72 FPS gate.
6. Run practice `NO_DR`, symmetric DR, and both asymmetric-recipient paths with
   the physical Quest assigned to each role in separate runs.
7. Repeat placement and cross-headset agreement with two physical Quests when
   the second device is available.
8. Match each texture's brightness and tint to live passthrough under the final
   room lighting, then lock the shared appearance settings after the physical
   visual pilot. Do not reduce opacity to hide seams: it reveals the distractor.
