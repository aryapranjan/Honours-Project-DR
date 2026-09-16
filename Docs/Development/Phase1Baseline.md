# Phase 1: Clean PCA Baseline and Reproducible Build

Status: automated build and physical Quest PCA baseline verified

## Locked baseline

- Unity: `6000.0.61f1`
- Meta MRUK: `85.0.0`
- OpenXR: `1.15.1`
- XR Management: `4.5.3`
- Unity Inference Engine: `2.2.1`
- Android architecture: ARM64
- Scripting backend: IL2CPP
- Render pipeline: Built-in
- Baseline scene: `Assets/Final-Design-Scene.unity`

`Packages/packages-lock.json` is committed and is the dependency-resolution
lock for the Unity project.

## Existing-change audit

The Phase 1 starting worktree contained user-created or Unity-generated changes.
They are preserved:

- `Assets/Final-Design-Scene.unity` and its meta file: user-created study scene.
- `Assets/Oculus/OculusProjectConfig.asset`: Unity/Meta configuration migration.
- `Assets/XR/Settings/OpenXR Package Settings.asset`: Oculus Touch interaction
  profile enabled.
- `Assets/XR/XRGeneralSettingsPerBuildTarget.asset`: OpenXR loader selection
  changes.
- `ProjectSettings/ProjectSettings.asset`: Unity-generated graphics-jobs
  settings.
- `.vscode/extensions.json`, `.vscode/launch.json`, `.vscode/settings.json`,
  and `Unity-PassthroughCameraApiSamples.slnx`: local editor integration.
- `Docs/`: authoritative study handoff, architecture, decisions, and plan.

No Phase 1 implementation reverts or overwrites those changes.

## PCA baseline behavior

The scene contains one left-camera `PassthroughCameraAccess` and a
`PcaBaselineVerifier`. On a supported Quest it requests the camera permission
and emits these markers:

- `PCA_BASELINE_PERMISSION_GRANTED`
- `PCA_BASELINE_FRAME_RECEIVED`
- `PCA_BASELINE_INTRINSICS`
- `PCA_BASELINE_POSE`
- `PCA_BASELINE_PASSED`

The verifier reads only metadata and the transient texture handle. It does not
save, transmit, or persist raw PCA frames.

## Configure and validate in Unity

Use these menu commands:

1. `Collaborative DR > Phase 1 > Configure PCA Baseline Scene`
2. `Collaborative DR > Phase 1 > Validate Build Configuration`
3. `Collaborative DR > Phase 1 > Build Android APK`

The default APK path is:

`Builds/Android/CollaborativeDR-Phase1.apk`

## Batch build

From the repository root:

```bash
"/Applications/Unity/Hub/Editor/6000.0.61f1/Unity.app/Contents/MacOS/Unity" \
  -batchmode \
  -quit \
  -projectPath "$PWD" \
  -executeMethod CollaborativeDR.Editor.Phase1Build.BuildAndroidApk \
  -logFile Logs/Phase1Build.log
```

The process must exit with code zero. Review `Logs/Phase1Build.log` for compile
errors and the final build-success marker.

## Physical Quest exit-gate check

XR Simulator cannot verify PCA. Use a Quest 3 or Quest 3S and the repository's
`hzdb` tooling to:

1. Confirm the headset is connected.
2. Install `Builds/Android/CollaborativeDR-Phase1.apk`.
3. Launch package `com.samples.passthroughcamera`.
4. Accept the headset-camera permission if prompted.
5. Capture logs and confirm all five `PCA_BASELINE_*` success markers.
6. Observe for at least two minutes and confirm there are no continuously
   repeating exceptions.

Record headset model, Horizon OS version, APK checksum, test time, and the
relevant log excerpt below before marking Phase 1 complete.

## Verification record

- Build result: success on 2026-07-16
- APK: `Builds/Android/CollaborativeDR-Phase1.apk` (`49 MB` compressed)
- APK SHA-256:
  `5b4e05e6c33d98473bd0ef89666e56de80c9da432f74f5a01684fc89930d6d06`
- Packaged architecture: ARM64 `libil2cpp.so`
- Packaged headset-camera permission: verified
- C# compile errors: zero
- Headset model: Meta Quest 3 (`eureka`)
- Device OS: Android 14, SDK 34, build `UP1A.231005.007.A1`
- Physical test time: 2026-07-17 00:25 ACST
- PCA permission: granted
- PCA frame: received at `1280x960`
- PCA timestamp: received
- PCA intrinsics: received
- PCA camera pose: received
- Raw PCA frames persisted: false
- Crash/exception scan: no fatal exception, ANR, or PCA baseline failure found
- Baseline Git tag or commit: pending
