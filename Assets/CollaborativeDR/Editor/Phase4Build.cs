using System;
using System.IO;
using System.Linq;
using CollaborativeDR.DiminishedReality;
using CollaborativeDR.Networking;
using CollaborativeDR.Protocol;
using CollaborativeDR.Telemetry;
using CollaborativeDR.UserInterface;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace CollaborativeDR.Editor
{
    public static class Phase4Build
    {
        private const string ScenePath = "Assets/Final-Design-Scene.unity";
        private const string RuntimeObjectName = "[Study] Phase 4 Client Runtime";
        private const string DefaultBuildPath = "Builds/Android/CollaborativeDR-Phase4.apk";
        private const string ControllerPrefabPath =
            "Packages/com.meta.xr.sdk.core/Prefabs/OVRControllerPrefab.prefab";
        private const string RayHelperPrefabPath =
            "Packages/com.meta.xr.sdk.core/Prefabs/OVRRayHelper.prefab";
        private const string RequiredUnityVersion = "6000.0.61f1";
        private const string NativeWebSocketCommit =
            "c612a4fef60f2ae57614b73202d2d261ba56aa3e";

        [MenuItem("Collaborative DR/Phase 4/Configure Quest Client Scene")]
        public static void ConfigureQuestClientScene()
        {
            ConfigureLocalNetworkPolicy();
            Scene scene = SceneManager.GetActiveScene();
            if (scene.path != ScenePath)
            {
                scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            }

            ConfigurePassthroughCamera();
            ConfigureResearcherSetupController();

            GameObject runtimeObject = scene.GetRootGameObjects()
                .FirstOrDefault(root => root.name == RuntimeObjectName);
            if (runtimeObject == null)
            {
                runtimeObject = new GameObject(RuntimeObjectName);
            }

            AddIfMissing<QuestEventLogger>(runtimeObject);
            AddIfMissing<PassthroughSafetyController>(runtimeObject);
            AddIfMissing<StudyNetworkClient>(runtimeObject);
            AddIfMissing<HeadsetStudyView>(runtimeObject);

            EditorUtility.SetDirty(runtimeObject);
            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene);
            EnsureSceneIsFirstInBuildSettings();
            AssetDatabase.SaveAssets();
            Debug.Log(
                $"Configured Phase 4 Quest client runtime in {ScenePath}. " +
                $"protocol={StudyProtocol.ProtocolVersion} build={StudyProtocol.AppBuildId}");
        }

        [MenuItem("Collaborative DR/Phase 4/Validate Quest Client")]
        public static void ValidateQuestClient()
        {
            ValidateOrThrow();
            Debug.Log("Phase 4 Quest client validation passed.");
        }

        [MenuItem("Collaborative DR/Phase 4/Build Android APK")]
        public static void BuildAndroidApk()
        {
            ConfigureQuestClientScene();
            ValidateOrThrow();

            if (!EditorUserBuildSettings.SwitchActiveBuildTarget(
                    BuildTargetGroup.Android,
                    BuildTarget.Android))
            {
                throw new InvalidOperationException(
                    "Could not switch the active build target to Android.");
            }

            string buildPath = GetCommandLineValue("-phase4BuildPath") ??
                               DefaultBuildPath;
            string absoluteBuildPath = Path.GetFullPath(buildPath);
            Directory.CreateDirectory(
                Path.GetDirectoryName(absoluteBuildPath) ??
                throw new InvalidOperationException("Build path has no parent directory."));

            BuildReport report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = new[] { ScenePath },
                locationPathName = absoluteBuildPath,
                target = BuildTarget.Android,
                options = BuildOptions.Development
            });
            if (report.summary.result != BuildResult.Succeeded)
            {
                throw new InvalidOperationException(
                    $"Android build failed with result {report.summary.result} and " +
                    $"{report.summary.totalErrors} error(s).");
            }

            ValidateGeneratedAndroidNetworkPolicy();

            Debug.Log(
                $"Phase 4 Android build succeeded: {absoluteBuildPath} " +
                $"({report.summary.totalSize} bytes). ");
        }

        private static void ValidateOrThrow()
        {
            Require(Application.unityVersion == RequiredUnityVersion,
                $"Unity {RequiredUnityVersion} is required; current editor is {Application.unityVersion}.");
            Require(File.Exists(ScenePath), $"Missing study scene: {ScenePath}");
            Require(File.Exists("Packages/packages-lock.json"),
                "Packages/packages-lock.json is required for reproducible package resolution.");

            string manifest = File.ReadAllText("Packages/manifest.json");
            Require(manifest.Contains("com.endel.nativewebsocket"),
                "NativeWebSocket is not declared in Packages/manifest.json.");
            Require(manifest.Contains(NativeWebSocketCommit),
                "NativeWebSocket must remain pinned to the reviewed Phase 4 commit.");

            const string androidManifestPath =
                "Assets/Plugins/Android/AndroidManifest.xml";
            Require(File.Exists(androidManifestPath),
                $"Missing Android manifest: {androidManifestPath}");
            string androidManifest = File.ReadAllText(androidManifestPath);
            Require(androidManifest.Contains("android.permission.INTERNET"),
                "Android manifest is missing android.permission.INTERNET.");
            Require(androidManifest.Contains("android:usesCleartextTraffic=\"true\""),
                "The approved isolated-network ws:// design requires cleartext traffic.");
            Require(androidManifest.Contains("horizonos.permission.HEADSET_CAMERA"),
                "Android manifest is missing the headset-camera permission.");

            string oculusConfig = File.ReadAllText(
                "Assets/Oculus/OculusProjectConfig.asset");
            Require(oculusConfig.Contains("enableNSCConfig: 0"),
                "Meta NSC HTTPS-only generation must be disabled for the approved local ws:// design.");
            Require(PlayerSettings.insecureHttpOption == InsecureHttpOption.AlwaysAllowed,
                "Unity must allow insecure HTTP for the approved isolated-network http:// and ws:// design.");
            Require(PlayerSettings.GetScriptingBackend(NamedBuildTarget.Android) ==
                    ScriptingImplementation.IL2CPP,
                "Android scripting backend must be IL2CPP.");
            Require(PlayerSettings.Android.targetArchitectures ==
                    AndroidArchitecture.ARM64,
                "Android target architecture must be ARM64 only.");

            Scene scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            GameObject runtimeObject = scene.GetRootGameObjects()
                .FirstOrDefault(root => root.name == RuntimeObjectName);
            Require(runtimeObject != null,
                $"Scene is missing {RuntimeObjectName}; run Configure Quest Client Scene.");
            Require(runtimeObject.GetComponent<QuestEventLogger>() != null,
                "Phase 4 runtime is missing QuestEventLogger.");
            Require(runtimeObject.GetComponent<PassthroughSafetyController>() != null,
                "Phase 4 runtime is missing PassthroughSafetyController.");
            Require(runtimeObject.GetComponent<StudyNetworkClient>() != null,
                "Phase 4 runtime is missing StudyNetworkClient.");
            Require(runtimeObject.GetComponent<HeadsetStudyView>() != null,
                "Phase 4 runtime is missing HeadsetStudyView.");

            OVRCameraRig cameraRig = UnityEngine.Object.FindFirstObjectByType<OVRCameraRig>();
            Camera centerEyeCamera = cameraRig != null && cameraRig.centerEyeAnchor != null
                ? cameraRig.centerEyeAnchor.GetComponent<Camera>()
                : null;
            Require(centerEyeCamera != null,
                "Phase 4 scene is missing the center-eye camera.");
            Require(centerEyeCamera.clearFlags == CameraClearFlags.SolidColor &&
                    centerEyeCamera.backgroundColor.a < 1f,
                "Passthrough requires a Solid Color center-eye clear with transparent alpha.");

            OVRPassthroughLayer passthroughLayer =
                UnityEngine.Object.FindFirstObjectByType<OVRPassthroughLayer>();
            Require(passthroughLayer != null,
                "Phase 4 scene is missing its passthrough layer.");
            SerializedProperty overlayType =
                new SerializedObject(passthroughLayer).FindProperty("overlayType");
            Require(overlayType != null &&
                    overlayType.intValue == (int)OVROverlay.OverlayType.Underlay,
                "Phase 4 passthrough must remain an Underlay.");

            Require(cameraRig.rightControllerAnchor != null,
                "Phase 4 camera rig is missing its right-controller anchor.");
            OVRControllerHelper[] controllerHelpers = cameraRig.rightControllerAnchor
                .GetComponentsInChildren<OVRControllerHelper>(true);
            Require(controllerHelpers.Length == 1,
                "Phase 4 requires exactly one researcher setup controller under RightControllerAnchor.");
            OVRControllerHelper controllerHelper = controllerHelpers[0];
            Require(controllerHelper.gameObject.name == HeadsetStudyView.SetupControllerObjectName,
                "The right controller must use the dedicated researcher setup object.");
            Require(controllerHelper.m_controller == OVRInput.Controller.RTouch,
                "The researcher setup controller must be assigned to RTouch.");
            Require(controllerHelper.RayHelper != null &&
                    controllerHelper.RayHelper.transform.IsChildOf(controllerHelper.transform),
                "The researcher setup controller requires its assigned child OVRRayHelper.");
            Require(controllerHelper.RayHelper.Renderer != null,
                "The researcher setup controller ray requires its visible beam renderer.");
            Require(controllerHelper.RayHelper.Cursor == null &&
                    controllerHelper.RayHelper.CursorFill == null,
                "The setup ray cursor must remain disabled because Meta Core v85 supplies no " +
                "canvas normal for OVRRayHelper; the beam and UI hover remain active.");
        }

        private static void ConfigurePassthroughCamera()
        {
            OVRCameraRig cameraRig = UnityEngine.Object.FindFirstObjectByType<OVRCameraRig>();
            Camera centerEyeCamera = cameraRig != null && cameraRig.centerEyeAnchor != null
                ? cameraRig.centerEyeAnchor.GetComponent<Camera>()
                : null;
            Require(centerEyeCamera != null,
                "Phase 4 scene is missing the center-eye camera.");

            centerEyeCamera.clearFlags = CameraClearFlags.SolidColor;
            centerEyeCamera.backgroundColor = Color.clear;
            EditorUtility.SetDirty(centerEyeCamera);
        }

        private static void ConfigureResearcherSetupController()
        {
            OVRCameraRig cameraRig = UnityEngine.Object.FindFirstObjectByType<OVRCameraRig>();
            Require(cameraRig != null && cameraRig.rightControllerAnchor != null,
                "Phase 4 scene is missing the right-controller anchor.");

            Transform rightAnchor = cameraRig.rightControllerAnchor;
            Transform existing = rightAnchor.Find(HeadsetStudyView.SetupControllerObjectName);
            GameObject controllerObject = existing != null ? existing.gameObject : null;
            if (controllerObject == null)
            {
                GameObject controllerPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(
                    ControllerPrefabPath);
                Require(controllerPrefab != null,
                    $"Missing Meta controller prefab: {ControllerPrefabPath}");
                controllerObject = PrefabUtility.InstantiatePrefab(
                    controllerPrefab,
                    rightAnchor) as GameObject;
                Require(controllerObject != null,
                    "Could not instantiate the Meta right-controller prefab.");
                controllerObject.name = HeadsetStudyView.SetupControllerObjectName;
            }

            controllerObject.transform.SetLocalPositionAndRotation(
                Vector3.zero,
                Quaternion.identity);
            controllerObject.transform.localScale = Vector3.one;
            controllerObject.SetActive(true);

            OVRControllerHelper controllerHelper =
                controllerObject.GetComponent<OVRControllerHelper>();
            Require(controllerHelper != null,
                "The Meta controller prefab is missing OVRControllerHelper.");
            controllerHelper.m_controller = OVRInput.Controller.RTouch;

            OVRRayHelper rayHelper = controllerObject.GetComponentInChildren<OVRRayHelper>(true);
            if (rayHelper == null)
            {
                GameObject rayPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(
                    RayHelperPrefabPath);
                Require(rayPrefab != null,
                    $"Missing Meta ray-helper prefab: {RayHelperPrefabPath}");
                GameObject rayObject = PrefabUtility.InstantiatePrefab(
                    rayPrefab,
                    controllerObject.transform) as GameObject;
                Require(rayObject != null,
                    "Could not instantiate the Meta controller ray helper.");
                rayHelper = rayObject.GetComponent<OVRRayHelper>();
            }

            Require(rayHelper != null,
                "The Meta ray-helper prefab is missing OVRRayHelper.");
            rayHelper.transform.SetLocalPositionAndRotation(Vector3.zero, Quaternion.identity);
            rayHelper.transform.localScale = Vector3.one;

            // Meta Core v85's OVRRaycaster does not populate RaycastResult.worldNormal.
            // OVRRayHelper's optional cursor uses that zero normal as transform.forward,
            // producing a warning every frame over the setup canvas. Keep the official
            // beam/hover/trigger path and disable only the cursor dot.
            if (rayHelper.Cursor != null)
            {
                rayHelper.Cursor.SetActive(false);
            }

            rayHelper.Cursor = null;
            rayHelper.CursorFill = null;
            controllerHelper.RayHelper = rayHelper;

            PrefabUtility.RecordPrefabInstancePropertyModifications(controllerObject.transform);
            PrefabUtility.RecordPrefabInstancePropertyModifications(controllerHelper);
            PrefabUtility.RecordPrefabInstancePropertyModifications(rayHelper);
            PrefabUtility.RecordPrefabInstancePropertyModifications(rayHelper.transform);
            EditorUtility.SetDirty(controllerObject);
            EditorUtility.SetDirty(controllerHelper);
            EditorUtility.SetDirty(rayHelper);
        }

        private static void ConfigureLocalNetworkPolicy()
        {
            PlayerSettings.insecureHttpOption = InsecureHttpOption.AlwaysAllowed;
            OVRProjectConfig config = OVRProjectConfig.CachedProjectConfig;
            Require(config != null, "Meta XR project configuration could not be loaded.");
            config.enableNSCConfig = false;
            config.securityXmlPath = string.Empty;
            EditorUtility.SetDirty(config);
            AssetDatabase.SaveAssets();
        }

        private static void ValidateGeneratedAndroidNetworkPolicy()
        {
            const string manifestPath =
                "Library/Bee/Android/Prj/IL2CPP/Gradle/launcher/build/" +
                "intermediates/packaged_manifests/debug/" +
                "processDebugManifestForPackage/AndroidManifest.xml";
            Require(File.Exists(manifestPath),
                "Unity did not produce the expected packaged debug Android manifest.");
            string manifest = File.ReadAllText(manifestPath);
            Require(manifest.Contains("android.permission.INTERNET"),
                "Packaged APK manifest is missing android.permission.INTERNET.");
            Require(manifest.Contains("horizonos.permission.HEADSET_CAMERA"),
                "Packaged APK manifest is missing the headset-camera permission.");
            Require(manifest.Contains("android:usesCleartextTraffic=\"true\""),
                "Packaged APK does not permit the approved isolated-network ws:// connection.");
            Require(!manifest.Contains("android:networkSecurityConfig="),
                "Packaged APK still references Meta's HTTPS-only network-security configuration.");
        }

        private static T AddIfMissing<T>(GameObject target) where T : Component
        {
            T component = target.GetComponent<T>();
            if (component == null)
            {
                component = target.AddComponent<T>();
            }

            EditorUtility.SetDirty(component);
            return component;
        }

        private static void EnsureSceneIsFirstInBuildSettings()
        {
            EditorBuildSettingsScene studyScene =
                new EditorBuildSettingsScene(ScenePath, true);
            EditorBuildSettingsScene[] otherScenes = EditorBuildSettings.scenes
                .Where(scene => scene.path != ScenePath)
                .ToArray();
            EditorBuildSettings.scenes = new[] { studyScene }
                .Concat(otherScenes)
                .ToArray();
        }

        private static string GetCommandLineValue(string argumentName)
        {
            string[] arguments = Environment.GetCommandLineArgs();
            for (int index = 0; index < arguments.Length - 1; index++)
            {
                if (arguments[index] == argumentName)
                {
                    return arguments[index + 1];
                }
            }

            return null;
        }

        private static void Require(bool condition, string message)
        {
            if (!condition)
            {
                throw new InvalidOperationException(message);
            }
        }
    }
}
