# Phase 8 final APK: one-Quest white-mask test

Status, 2026-10-21: the photographed setup and confirmed measurements now have
provisional white-mask placements. Local software checks and an Android build
are complete; no new-room Quest, camera, OBS, or two-headset pilot has run. The
Phase 8 final name identifies the APK we will refine; it does not mark
participant collection, a physical Phase 8 exit, or release freeze. See the
[photo survey](NewRoomPhotoSurvey-20261020.md) for inputs and geometry.

## What is ready

- TV and keyboard profiles retain former photo assets for reference but render
  the shader's plain white fallback. They now hold provisional new-room local
  geometry, so TV/keyboard DR can prepare **after** a passing fresh calibration.
  A failed calibration still blocks them. No prior room world transform is used.
- The Unity configure/build command no longer writes old mask geometry or
  textures back into the profiles. The approved build ID is
  `cdr-phase8-final`; its stable output path is
  `Builds/Android/CollaborativeDR-Phase8-Final.apk`. Rebuilds for room tuning
  use this path. Install the same APK checksum on both headsets.
- The StudyController build and mock integration suite pass 45/45 tests under
  Node `24.18.0`.
  Unity compiled the changed scripts, the **Collaborative DR > Phase 6 >
  Validate DR Masks** step passed within the build command. The Phase 8 final
  APK built on 2026-10-21. Its size is `101,650,245` bytes and SHA-256 is
  `f165d039b08a006ce2a4df3a7b2a175a35571ce3fd3c4bc03e5c4748acb61704`.
  The APK metadata contains `cdr-phase8-final` and the ARM64 AprilTag library.
  The former new-room pilot APKs were replaced by this stable artifact.
  Unity EditMode tests and on-head checks have not yet run.
- The pinned tag family, IDs, and detection-corner side remain
  `tagStandard41h12`, `1–6`, and `0.0567 m`. The researcher confirmed the
  TV/keyboard-to-tag relationships remain the same, TV tag-centre spacing is
  `1.673 x 1.075 m`, seated eyes are `1.50 m` from the TV wall, and the TV
  front projects `0.29 m` from that wall.

## Manual test sequence on the lab Wi-Fi

1. **Check the prepared APK.** Confirm the APK path above exists and its
   SHA-256 matches the value in this document:
   `shasum -a 256 Builds/Android/CollaborativeDR-Phase8-Final.apk`.
   If Unity sources change afterward, rebuild in Unity `6000.0.61f1` through
   **Collaborative DR > Phase 8 > Build Final APK**. Record the new checksum
   and install that exact APK on each Quest used for the pilot.
2. **Check the headset over USB.** Use Node `24.18.0` (`nvm use` in
   `StudyController/`) for the local commands. Put the Quest 3/3S in developer mode,
   connect it by cable, and accept its USB debugging prompt. Meta's CLI was
   cached on this MacBook and its offline help was checked. From the project
   root, run:

   ```sh
   npx --offline -y @meta-quest/hzdb device list
   npx --offline -y @meta-quest/hzdb app install -r -g Builds/Android/CollaborativeDR-Phase8-Final.apk
   npx --offline -y @meta-quest/hzdb app launch com.samples.passthroughcamera --wait-for-idle --verify
   ```

   `-r` replaces the app while retaining its data. Do not uninstall or clear
   app data while a Quest backup log may still need export. Note the device ID,
   install result, and any crash or permission error.
3. **Put the MacBook and Quest on the same lab LAN.** Find the MacBook's current
   lab Wi-Fi IPv4 address and confirm the headset can reach it; do not reuse a
   previous room's address. Internet access is not required for the local
   controller, but Wi-Fi client isolation can block Quest-to-Mac traffic.
   From `StudyController/`, start an isolated dry run with the already built
   files and the example counterbalance plan:

   ```sh
   STUDY_DATA_ROOT=/private/tmp/cdr-phase8-dryrun \
   HOST=0.0.0.0 ADVERTISED_HOST='<current-MacBook-lab-IPv4>' PORT=4317 \
   APPROVED_QUEST_BUILD_ID=cdr-phase8-final \
   OBS_ENABLED=false QUESTIONNAIRE_GATE_ENABLED=false DR_PREVIEW_ENABLED=true \
   npm start
   ```

   Open `http://127.0.0.1:4317` on the MacBook. Confirm the dashboard shows
   the current LAN address, approved build ID, and **simulated media**. This
   configuration is for a dry run only; it does not record the USB camera or
   complete Google Forms.
4. **Check one-Quest networking.** Create a test pair, issue a pairing code for
   `QUEST_A`, and enter the MacBook LAN address and code in the headset. Start
   the built-in simulator only for `QUEST_B`. Confirm both slots connect, the
   physical headset is labeled physical, and a disconnect/reconnect produces
   the guarded recovery behavior. Do not interpret the simulator as second
   physical headset evidence.
5. **Calibrate the mounted new-room tags.** Mount the printed IDs with
   keyboard `1` left / `2` right and TV `4` top-left, `5` top-right, `6`
   bottom-right, `3` bottom-left from the seated view. Trigger a six-second
   calibration attempt from each normal seat and save the report. Check all six
   observed IDs, accepted/rejected observations, measured `1`–`2` spacing,
   TV planarity, and fresh rig-relative tag transforms. The nominal `0.40 m`
   keyboard spacing still needs this live confirmation. If the tags are not
   fixed, test recognition only; do not accept a spatial result.
6. **Preview the white masks.** Only after a passing calibration, use the
   researcher DR preview in the `CALIBRATION` state. Prepare TV, show debug
   bounds, show the white plane, then Reveal and Hide. Repeat for keyboard.
   Inspect both eyes, each seat, modest leaning/head turns, TV sides, keyboard
   edges, and any wall-tag coverage. Record the direction and approximate size
   of misses or spill so the profile can be adjusted. `NO_DR` must remain clear.
   A failed calibration must still prevent either white mask from preparing;
   do not override it merely to force a visual result.
7. **Check the overhead USB-A camera separately.** Confirm macOS and OBS see a
   live overhead view when the camera is connected. Do not enable the
   controller's OBS preflight yet: it correctly requires both receiver audio
   channels, and the two-transmitter microphone is not available. OBS was not
   found in `/Applications` during this preparation pass; install it from an
   approved source before its media pilot if it is still absent.

## Later gates

- Refine both provisional local mask profiles from the on-head views and any
  later scans. The fresh calibration report, not the phone photos or old world
  poses, supplies all six tag positions. Replace the white appearance with
  new-room wall/desk assets after the physical coverage is accepted.
- When the stereo receiver arrives, configure the two transmitters as separate
  left/right channels, enable OBS and its questionnaire gates with approved
  storage and links, and play a real pilot MKV to verify camera, channel mapping,
  sync, and pseudonymous filename. No microphone result can be inferred from
  today's mock tests.
- Repeat calibration, DR appearance, movement, networking, faults, and sustained
  frame rate with **two physical Quests**. A one-Quest/simulator run is partial.
