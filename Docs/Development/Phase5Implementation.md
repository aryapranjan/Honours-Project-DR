# Phase 5 Six-Tag Calibration Implementation

Status: dev-3 robustness software, Unity, Android build, install, and available-
Quest physical calibration gates passed; repeated/occlusion and two-physical-
Quest pilot gates pending

Last revised: 2026-08-26

## Locked rig contract

- Family: `tagStandard41h12`
- IDs from the seated participant view: keyboard `1` left, `2` right; TV `4` top-left, `5` top-right,
  `6` bottom-right, `3` bottom-left
- Pose-estimation side: `0.0567 m`, measured between the four black/white border
  junctions used as the detector corners. This is five ninths of the measured
  `0.102 m` nine-module printed pattern.
- Keyboard tag-centre separation: nominally `0.40 m`, measured in the final
  room placement
- Origin: midpoint of tags `1` and `2`; `+X` is physical left-to-right from
  tag `1` to tag `2`, `+Y` is room up, and `+Z` points from the seated
  participants toward the TV
- Sampling: one dashboard-triggered six-second attempt on both clients
- TV redundancy: any three of tags `3-6`
- Preliminary final-room TV-tag centre spacing: approximately `1.673 m`
  horizontally and `1.075 m` vertically; seated participant-to-wall distance
  approximately `1.30 m`, all pending pilot remeasurement
- Thresholds: configurable provisional profile `PROVISIONAL_PHASE5_V2`

The prior `0.092 m` prototype size and mistaken `0.112 m` backing-card
measurement are deliberately rejected by the Final Design configuration.

## Implemented

- Embedded reviewed `jp.keijiro.apriltag` `1.0.3` package with its licence and
  Android ARM64 binary checksum gate.
- PCA texture acquisition with timestamp, intrinsics, camera pose, explicit
  texture/intrinsics scaling, asynchronous GPU readback where supported, and a
  transient CPU fallback.
- Detection restricted to IDs `1-6`, calibration-only projected outlines, stale
  pose and implausible sequential-jump rejection, and per-tag stability metrics.
- Researcher outlines are reconstructed from the detected corner rays on a
  camera-facing plane through the tracked tag centre. They therefore show the
  detector evidence without inheriting the unstable single-tag pose rotation.
- The V2 solver removes only isolated position outliers using a conservative
  median/MAD rule, reports every removed observation as rejected, uses a
  quaternion medoid for the reported orientation, and still fails broad or
  sustained positional instability.
- Per-tag rotation RMS remains reported as a diagnostic warning. It is not an
  acceptance failure because the authoritative keyboard and TV room frames are
  solved from tag-centre positions, not the individual tag quaternions.
- Keyboard frame solve, TV frame solve, missing-TV-corner inference, spacing
  residual, TV planarity, rig-relative transforms, and actionable reasons.
- Protocol `1.2.0` `BEGIN_CALIBRATION` / `CALIBRATION_REPORT` messages, strict
  `PROVISIONAL_PHASE5_V2` profile validation, simultaneous server command,
  per-Quest dashboard reports, cross-physical-Quest comparison, and guarded
  trial preparation. An older dev-3 APK reporting V1 is rejected rather than
  being silently mixed with this in-place dev-3 rebuild.
- Raw PCA frames are not included in messages or logs. Reports explicitly carry
  `rawFramesPersisted=false`.

## Automated evidence

Using the pinned Node `24.18.0`, `npm run verify` passes all `40/40` tests,
server/dashboard typechecks, the server TypeScript build, and the Vite dashboard
build. Coverage includes strict calibration schema validation, no frame payload,
physical-plus-simulator deferral, compatible two-physical reports, and
mismatched transforms blocking the start gate.

Unity `6000.0.61f1` imported and compiled the embedded package and all Phase 5
assemblies without C# errors. The Phase 5 Configure and Validate menu commands
both passed against `Assets/Final-Design-Scene.unity`.

The current final-mapping result
`Logs/Phase5FinalMappingEditModeResults-20260826.xml` records `16/16` tests
passed, with none failed or skipped. Its eight Phase 5 tests cover the rig
configuration and TV mapping, stable geometry with noisy per-tag rotation,
isolated position-outlier removal, and sustained positional instability still
failing. The result file SHA-256 is
`85087f7c0d0a897220c08e69807ad376816146ba80a79c08b7bce3cfeecab8eb`.

`Logs/Phase5RobustnessEditModeResults-20260826.xml` remains historical evidence
from before the seated-participant keyboard perspective was finally confirmed.

The earlier final-layout result
`Logs/Phase5EditModeResults-20260825-TVLayout.xml` remains historical evidence
of `13/13` passing tests before the V2 robustness cases were added.

The earlier `cdr-phase5-dev-1` Android IL2CPP development build completed at
`2026-08-14 22:56:47 +0930`. The historical artifact is preserved as
`Builds/Android/CollaborativeDR-Phase5-dev1-045m.apk` (`78,459,099` bytes;
SHA-256
`7c21794b7a45891efdc0696bb6e530cadcedc7bdac3f75d9a2b185c1ac85df62`).
That artifact contains the superseded `0.45 m` keyboard contract and is not the
current Phase 5 test APK.

The superseded `cdr-phase5-dev-2` build is preserved as
`Builds/Android/CollaborativeDR-Phase5-dev2-0112m.apk` (`82,189,424` bytes;
SHA-256
`ae0154f5e3a0b284b021b13e84c7ecece0387a091a89bcfe2845840837d51e3b`).
It used the mistaken `0.112 m` backing-card measurement and is historical
evidence only.

At the user's direction, the robustness update was rebuilt in place under the
existing `cdr-phase5-dev-3` identifier rather than creating dev-4. The current
Android IL2CPP development build completed at `2026-08-26 15:39:39 +0930` as
`Builds/Android/CollaborativeDR-Phase5.apk` (`102,390,591` bytes; SHA-256
`803c96541818c75575ead0e94dd5bfb921543955689f5107eff347bed512bb50`).
Its metadata contains both `cdr-phase5-dev-3` and
`PROVISIONAL_PHASE5_V2`. It packages the corrected `0.0567 m`
detector-corner size, final-room `0.40 m` keyboard contract, participant-view
keyboard order `1` left and `2` right, `+X` from `1` to `2`, `+Z` from the
participants toward the TV, confirmed TV mapping, robust position filter, and
rotation-independent researcher outlines. Generated ARM64 IL2CPP code records
the same keyboard defaults and TV order `4` top-left, `5` top-right, `6`
bottom-right, `3` bottom-left.
The exact SHA-256 and V2 profile—not the reused development ID alone—identify
this approved test artifact. The APK is ARM64-only, contains
`lib/arm64-v8a/libAprilTag.so`, retains
`horizonos.permission.HEADSET_CAMERA` and `android.permission.INTERNET`, and
sets `android:usesCleartextTraffic="true"` for the approved local `ws://`
study connection.

A non-destructive `hzdb app install --replace --grant-permissions` of the current
dev3/V2 APK succeeded on Quest 3 `2G0YC1ZF9Z03HD` while preserving the app data
directory. Pulling the installed `base.apk` back from the headset produced the
same `102,390,591`-byte size and SHA-256 as the approved host artifact. The
headset-camera permission is granted. A server-free launch was issued, and the
subsequent Unity warning query and broad package-specific crash/ANR scan returned
no matching signal. This is not an on-head visual or camera gate. The recorded Quest clock mismatch
does not block the immediate functional calibration test, but it must be
corrected before formal timestamped evidence collection.

## Available-Quest physical validation

The corrected dev3/V2 build produced a real, non-simulated `PASS` report from
`QUEST_A` on `2026-08-26` (server event sequence `480`, attempt
`4af20b64-a330-449e-b8fb-f321305a2599`). It observed all six required IDs and
accepted `151` observations while the robust filter rejected two isolated tag
`3` position outliers. No blocking failure reason was reported, and
`rawFramesPersisted` remained `false`.

The measured keyboard spacing was `0.391986 m`, with an `0.008014 m` residual
from the nominal `0.40 m`. TV planarity RMS was `0.001548 m`. The recovered
coordinate frame confirms the corrected contract: tag `1` was at
`x=-0.195993 m`, tag `2` at `x=+0.195993 m`, and the TV-frame centre was at
`z=+0.722843 m`. The TV-frame quaternion
`(-0.002259, 0.015988, -0.004128, 0.999861)` is near identity rather than the
superseded approximately 180-degree flip.

The only report warnings were the required provisional-threshold reminder, two
rejected tag `3` outliers, and tag `5` rotation RMS. The tag `5` warning is
diagnostic under V2; its centre-position RMS was `0.005094 m`, and the room
frames are centre-derived. A later Quest heartbeat timeout moved the dashboard
to `BLOCKED` after the report had already passed; it does not invalidate this
calibration attempt. `QUEST_B` was simulated, so the server correctly recorded
the cross-headset compatibility result as `DEFERRED` rather than treating it as
two-physical-Quest evidence.

## Remaining exit gates

1. Confirm and record visual alignment of the calibration-only tag outlines;
   the derived on-head detection and geometry gate is passed.
2. Repeat attempts and the three-of-four-TV-tag case before locking pilot
   thresholds.
3. With the second Quest, demonstrate compatible physical rig transforms.

Phase 5 must remain open until these gates pass.
