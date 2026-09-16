using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using CollaborativeDR.Calibration;
using CollaborativeDR.Configuration;
using CollaborativeDR.Protocol;
using Meta.XR;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace CollaborativeDR.Editor
{
    public static class Phase5Build
    {
        private const string ScenePath = "Assets/Final-Design-Scene.unity";
        private const string RuntimeObjectName = "[Study] Phase 4 Client Runtime";
        private const string ConfigurationPath =
            "Assets/CollaborativeDR/Configuration/AprilTagRigConfiguration.asset";
        private const string DetectorPackageRoot = "Packages/jp.keijiro.apriltag";
        private const string AndroidPluginPath =
            DetectorPackageRoot + "/Plugin/Android/libAprilTag.so";
        private const string ExpectedAndroidPluginSha256 =
            "c81ef567c0226fbfa7b64cf9b559daaae9a94e4f180d5ca7a3572f6d983e8f5f";
        private const string DefaultBuildPath =
            "Builds/Android/CollaborativeDR-Phase5.apk";

        [MenuItem("Collaborative DR/Phase 5/Configure Six-Tag Calibration")]
        public static void ConfigureSixTagCalibration()
        {
            Phase4Build.ConfigureQuestClientScene();
            Scene scene = SceneManager.GetActiveScene();
            if (scene.path != ScenePath)
            {
                scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            }

            GameObject runtime = scene.GetRootGameObjects()
                .FirstOrDefault(root => root.name == RuntimeObjectName);
            Require(runtime != null,
                $"Scene is missing {RuntimeObjectName}; configure Phase 4 first.");
            PassthroughCameraAccess access =
                UnityEngine.Object.FindFirstObjectByType<PassthroughCameraAccess>();
            Require(access != null,
                "Phase 5 requires the verified Phase 1 PassthroughCameraAccess component.");
            access.CameraPosition = PassthroughCameraAccess.CameraPositionType.Left;
            access.RequestedResolution = new Vector2Int(1280, 960);

            AprilTagRigConfiguration configuration = GetOrCreateConfiguration();
            configuration.ValidateOrThrow();
            PcaAprilTagObservationSource source =
                AddIfMissing<PcaAprilTagObservationSource>(runtime);
            AprilTagCalibrationManager manager =
                AddIfMissing<AprilTagCalibrationManager>(runtime);
            source.Configure(access, configuration);
            manager.Configure(source, configuration);

            EditorUtility.SetDirty(access);
            EditorUtility.SetDirty(configuration);
            EditorUtility.SetDirty(source);
            EditorUtility.SetDirty(manager);
            EditorUtility.SetDirty(runtime);
            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene);
            AssetDatabase.SaveAssets();
            Debug.Log(
                $"Configured Phase 5 six-tag calibration in {ScenePath}. " +
                $"family={configuration.TagFamily} tag_size_m={configuration.TagSizeMeters:F3} " +
                $"protocol={StudyProtocol.ProtocolVersion} build={StudyProtocol.AppBuildId}");
        }

        [MenuItem("Collaborative DR/Phase 5/Validate Six-Tag Calibration")]
        public static void ValidateSixTagCalibration()
        {
            ValidateOrThrow();
            Debug.Log("Phase 5 six-tag calibration validation passed.");
        }

        [MenuItem("Collaborative DR/Phase 5/Build Android APK")]
        public static void BuildAndroidApk()
        {
            ConfigureSixTagCalibration();
            ValidateOrThrow();
            if (!EditorUserBuildSettings.SwitchActiveBuildTarget(
                    BuildTargetGroup.Android,
                    BuildTarget.Android))
            {
                throw new InvalidOperationException(
                    "Could not switch the active build target to Android.");
            }

            string buildPath = GetCommandLineValue("-phase5BuildPath") ??
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

            Debug.Log(
                $"Phase 5 Android build succeeded: {absoluteBuildPath} " +
                $"({report.summary.totalSize} bytes).");
        }

        private static void ValidateOrThrow()
        {
            Phase4Build.ValidateQuestClient();
            string manifest = File.ReadAllText("Packages/manifest.json");
            Require(
                manifest.Contains("\"jp.keijiro.apriltag\": \"file:jp.keijiro.apriltag\""),
                "The reviewed AprilTag package must remain embedded and pinned.");
            Require(File.Exists(DetectorPackageRoot + "/LICENSE"),
                "The embedded AprilTag BSD-2-Clause license is missing.");
            Require(File.Exists(AndroidPluginPath),
                "The AprilTag Android ARM64 plugin is missing.");
            Require(Sha256File(AndroidPluginPath) == ExpectedAndroidPluginSha256,
                "The AprilTag Android plugin checksum does not match the reviewed binary.");
            string packageJson = File.ReadAllText(DetectorPackageRoot + "/package.json");
            Require(packageJson.Contains("\"version\": \"1.0.3\""),
                "The embedded AprilTag package must remain at reviewed version 1.0.3.");

            AprilTagRigConfiguration configuration =
                AssetDatabase.LoadAssetAtPath<AprilTagRigConfiguration>(ConfigurationPath);
            Require(configuration != null,
                $"Missing Phase 5 configuration asset: {ConfigurationPath}");
            configuration.ValidateOrThrow();

            Scene scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            GameObject runtime = scene.GetRootGameObjects()
                .FirstOrDefault(root => root.name == RuntimeObjectName);
            Require(runtime != null, $"Scene is missing {RuntimeObjectName}.");
            PcaAprilTagObservationSource source =
                runtime.GetComponent<PcaAprilTagObservationSource>();
            AprilTagCalibrationManager manager =
                runtime.GetComponent<AprilTagCalibrationManager>();
            Require(source != null,
                "Phase 5 runtime is missing PcaAprilTagObservationSource.");
            Require(manager != null,
                "Phase 5 runtime is missing AprilTagCalibrationManager.");
            PassthroughCameraAccess access =
                UnityEngine.Object.FindFirstObjectByType<PassthroughCameraAccess>();
            Require(access != null &&
                    access.CameraPosition == PassthroughCameraAccess.CameraPositionType.Left,
                "Phase 5 requires the left PCA camera.");
            Require(access.RequestedResolution == new Vector2Int(1280, 960),
                "Phase 5 reviewed detector resolution must be 1280x960.");
        }

        private static AprilTagRigConfiguration GetOrCreateConfiguration()
        {
            AprilTagRigConfiguration configuration =
                AssetDatabase.LoadAssetAtPath<AprilTagRigConfiguration>(ConfigurationPath);
            if (configuration != null)
            {
                return configuration;
            }

            configuration = ScriptableObject.CreateInstance<AprilTagRigConfiguration>();
            AssetDatabase.CreateAsset(configuration, ConfigurationPath);
            return configuration;
        }

        private static T AddIfMissing<T>(GameObject gameObject)
            where T : Component
        {
            return gameObject.GetComponent<T>() ?? gameObject.AddComponent<T>();
        }

        private static string Sha256File(string path)
        {
            using FileStream stream = File.OpenRead(path);
            using SHA256 sha256 = SHA256.Create();
            return string.Concat(sha256.ComputeHash(stream)
                .Select(value => value.ToString("x2")));
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
