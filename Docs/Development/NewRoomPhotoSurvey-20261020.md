# New-room photo survey — 2026-10-20

This is a provisional geometry record for a one-Quest white-mask pilot, not a
six-tag on-device calibration or approval for participant trials.

## Evidence supplied

- The researcher confirmed normal seated **eye-to-TV-wall distance = 1.50 m**
  and **TV front surface to wall = 0.29 m**.
- The researcher confirmed the TV and keyboard placements relative to their
  tags are unchanged from the former room. The former room's Unity/world
  transforms are not used.
- The supplied layout screenshot gives TV tag-centre separation of **1.673 m**
  horizontally and **1.075 m** vertically. Viewed from the seats: `4` top-left,
  `5` top-right, `6` bottom-right, `3` bottom-left.
- `IMG_2295.jpeg`–`IMG_2297.jpeg` show the four TV tags on the wall around the
  same TV and tags `1` and `2` flanking the keyboard. `IMG_2298.jpeg` shows the
  keyboard/tag arrangement with a tape measure. The photos were provided in
  chat; copies are not stored in this repository.

## Provisional white-mask placement

The Quest's fresh Phase 5 calibration derives the actual six tag poses and the
TV frame in the new room at runtime. No former-room scene/world transform is
entered in the profiles. The white masks are local to those calibrated frames.

| Target | Local frame and provisional geometry | Basis |
| --- | --- | --- |
| TV | TV-tag frame, wall plane at local `(0.015, 0.020, 0) m`; `1.52 x 0.90 m` white quad | Prior `1.18 m` front-plane width and approximately `0.68 m` TV body height estimated from the front photo, projected to the wall by `1.50 / (1.50 - 0.29) = 1.23967`, then padded for a first coverage test |
| Keyboard | Midpoint/axes of tags `1` and `2`; desk-plane quad at `(0, 0, 0) m`, rotated `-90°` around X; `0.55 x 0.35 m` | Researcher confirmed unchanged keyboard/tag relationship; the broad footprint remains provisional for oblique viewing |

The TV plane is on the newly photographed tag wall, with no old `+0.07 m`
recess or old `+0.034 m` lateral correction. The small `+0.015 m` horizontal
and `+0.020 m` vertical offsets are provisional photo-based centring. At the
confirmed viewing distance, the estimated TV body projects to approximately
`1.463 x 0.843 m` on that wall; the white quad adds about `0.03 m` per side.
Its outside edges remain inside the printed TV tags using the supplied
`1.673 x 1.075 m` tag-centre rectangle and `0.102 m` printed pattern width.
These are photo-derived estimates, not direct TV body measurements. A flat wall
plane cannot perfectly match a TV protruding 0.29 m over arbitrary eye
positions. The white surface is not the final natural-looking wall/desk
replacement.

## Required on-head checks

1. Run a fresh six-second calibration in the final mounted arrangement. Save
   the report with all observed IDs, measured `1`–`2` separation, TV planarity,
   and six tag transforms. Do not infer those poses from the phone photos.
2. At both normal seated viewpoints, preview each target's debug bounds and
   white mask. Check both eyes, normal head turns, and leaning/oblique views.
   Record whether the mask misses any TV/keyboard edge or covers unrelated
   workspace; adjust the local quad after this observation.
3. Verify `NO_DR` leaves clear passthrough, and that a failed calibration does
   not prepare a mask. Keep OBS simulated and questionnaire gates disabled while
   the stereo receiver is unavailable.

The one-Quest pilot is partial. Two physical Quests, the real camera/receiver
recording, appearance matching, and room scans remain later gates.
