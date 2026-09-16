using System;
using System.IO;
using System.Linq;
using CollaborativeDR.Telemetry;
using Meta.XR;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace CollaborativeDR.Editor
{
    public static class Phase1Build
    {
        private const string ScenePath = "Assets/Final-Design-Scene.unity";
        private const string BaselineObjectName = "[Study] Phase 1 PCA Baseline";
        private const string DefaultBuildPath = "Builds/Android/CollaborativeDR-Phase1.apk";
        private const string RequiredUnityVersion = "6000.0.61f1";

        [MenuItem("Collaborative DR/Phase 1/Configure PCA Baseline Scene")]
        public static void ConfigurePcaBaselineScene()
        {
            Scene scene = SceneManager.GetActiveScene();
            if (scene.path != ScenePath)
            {
                scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            }

            GameObject baselineObject = scene.GetRootGameObjects()
                .FirstOrDefault(root => root.name == BaselineObjectName);

            if (baselineObject == null)
            {
                baselineObject = new GameObject(BaselineObjectName);
            }

            PassthroughCameraAccess access =
                baselineObject.GetComponent<PassthroughCameraAccess>() ??
                baselineObject.AddComponent<PassthroughCameraAccess>();
            access.CameraPosition = PassthroughCameraAccess.CameraPositionType.Left;
            access.RequestedResolution = new Vector2Int(1280, 960);

            PcaBaselineVerifier verifier =
                baselineObject.GetComponent<PcaBaselineVerifier>() ??
                baselineObject.AddComponent<PcaBaselineVerifier>();
            verifier.Configure(access);

            EditorUtility.SetDirty(baselineObject);
            EditorUtility.SetDirty(access);
            EditorUtility.SetDirty(verifier);
            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene);

            EnsureSceneIsFirstInBuildSettings();
            AssetDatabase.SaveAssets();
            Debug.Log($"Configured Phase 1 PCA baseline in {ScenePath}.");
        }

        [MenuItem("Collaborative DR/Phase 1/Validate Build Configuration")]
        public static void ValidateBuildConfiguration()
        {
            ValidateBuildConfigurationOrThrow();
            Debug.Log("Phase 1 build configuration validation passed.");
        }

        [MenuItem("Collaborative DR/Phase 1/Build Android APK")]
        public static void BuildAndroidApk()
        {
            ConfigurePcaBaselineScene();
            ValidateBuildConfigurationOrThrow();

            if (!EditorUserBuildSettings.SwitchActiveBuildTarget(
                    BuildTargetGroup.Android,
                    BuildTarget.Android))
            {
                throw new InvalidOperationException("Could not switch the active build target to Android.");
            }

            string buildPath = GetCommandLineValue("-phase1BuildPath") ?? DefaultBuildPath;
            string absoluteBuildPath = Path.GetFullPath(buildPath);
            Directory.CreateDirectory(Path.GetDirectoryName(absoluteBuildPath) ??
                                      throw new InvalidOperationException("Build path has no parent directory."));

            BuildPlayerOptions options = new BuildPlayerOptions
            {
                scenes = new[] { ScenePath },
                locationPathName = absoluteBuildPath,
                target = BuildTarget.Android,
                options = BuildOptions.None
            };

            BuildReport report = BuildPipeline.BuildPlayer(options);
            if (report.summary.result != BuildResult.Succeeded)
            {
                throw new InvalidOperationException(
                    $"Android build failed with result {report.summary.result} and " +
                    $"{report.summary.totalErrors} error(s).");
            }

            Debug.Log(
                $"Phase 1 Android build succeeded: {absoluteBuildPath} " +
                $"({report.summary.totalSize} bytes).");
        }

        private static void ValidateBuildConfigurationOrThrow()
        {
            Require(Application.unityVersion == RequiredUnityVersion,
                $"Unity {RequiredUnityVersion} is required; current editor is {Application.unityVersion}.");
            Require(File.Exists(ScenePath), $"Missing study scene: {ScenePath}");
            Require(File.Exists("Packages/packages-lock.json"),
                "Packages/packages-lock.json is required for reproducible package resolution.");
            Require(File.ReadAllText(".gitignore").IndexOf(
                    "Packages/packages-lock.json",
                    StringComparison.Ordinal) < 0,
                "Packages/packages-lock.json must not be ignored.");
            Require(PlayerSettings.GetScriptingBackend(NamedBuildTarget.Android) ==
                    ScriptingImplementation.IL2CPP,
                "Android scripting backend must be IL2CPP.");
            Require(PlayerSettings.Android.targetArchitectures == AndroidArchitecture.ARM64,
                "Android target architecture must be ARM64 only.");

            const string manifestPath = "Assets/Plugins/Android/AndroidManifest.xml";
            Require(File.Exists(manifestPath), $"Missing Android manifest: {manifestPath}");
            string manifest = File.ReadAllText(manifestPath);
            Require(manifest.Contains("horizonos.permission.HEADSET_CAMERA"),
                "Android manifest is missing horizonos.permission.HEADSET_CAMERA.");
            Require(manifest.Contains("com.oculus.feature.PASSTHROUGH"),
                "Android manifest is missing the required passthrough feature.");
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
