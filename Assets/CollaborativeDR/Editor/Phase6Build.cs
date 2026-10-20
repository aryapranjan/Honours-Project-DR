using System;
using System.IO;
using System.Linq;
using CollaborativeDR.DiminishedReality;
using CollaborativeDR.Protocol;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace CollaborativeDR.Editor
{
    public static class Phase6Build
    {
        private const string ScenePath = "Assets/Final-Design-Scene.unity";
        private const string RuntimeObjectName = "[Study] Phase 4 Client Runtime";
        private const string ShaderPath =
            "Assets/CollaborativeDR/DiminishedReality/Shaders/FeatheredUnlitMask.shader";
        private const string MaterialFolder =
            "Assets/CollaborativeDR/DiminishedReality/Materials";
        private const string MaterialPath = MaterialFolder + "/Phase6WhiteMask.mat";
        private const string TvProfilePath =
            "Assets/CollaborativeDR/Configuration/TvDiminishedRealityProfile.asset";
        private const string KeyboardProfilePath =
            "Assets/CollaborativeDR/Configuration/KeyboardDiminishedRealityProfile.asset";
        private const string DefaultBuildPath =
            "Builds/Android/CollaborativeDR-Phase8-Final.apk";

        [MenuItem("Collaborative DR/Phase 6/Configure DR Masks")]
        public static void ConfigureDiminishedRealityMasks()
        {
            Phase5Build.ConfigureSixTagCalibration();
            Scene scene = SceneManager.GetActiveScene();
            if (scene.path != ScenePath)
            {
                scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            }

            Shader shader = AssetDatabase.LoadAssetAtPath<Shader>(ShaderPath);
            Require(shader != null, $"Missing Phase 6 mask shader: {ShaderPath}");
            EnsureFolder(MaterialFolder);
            Material material = AssetDatabase.LoadAssetAtPath<Material>(MaterialPath);
            if (material == null)
            {
                material = new Material(shader)
                {
                    name = "Phase 6 White Mask"
                };
                AssetDatabase.CreateAsset(material, MaterialPath);
            }
            else if (material.shader != shader)
            {
                material.shader = shader;
            }
            material.SetColor("_Tint", Color.white);
            material.SetFloat("_Brightness", 1f);
            material.SetFloat("_Contrast", 1f);
            material.SetFloat("_Opacity", 1f);
            material.SetFloat("_UseTexture", 0f);
            // Target profiles own their measured geometry and appearance.
            // Reconfiguring the scene must never restore the previous room's
            // dimensions, offsets, or photo textures.
            DiminishedRealityTargetProfile tv =
                AssetDatabase.LoadAssetAtPath<DiminishedRealityTargetProfile>(TvProfilePath);
            DiminishedRealityTargetProfile keyboard =
                AssetDatabase.LoadAssetAtPath<DiminishedRealityTargetProfile>(KeyboardProfilePath);
            Require(tv != null, $"Missing TV profile: {TvProfilePath}");
            Require(keyboard != null, $"Missing keyboard profile: {KeyboardProfilePath}");
            Require(tv.ReplacementMaterial == material &&
                    keyboard.ReplacementMaterial == material,
                "Both DR profiles must reference the shared mask material.");

            GameObject runtime = scene.GetRootGameObjects()
                .FirstOrDefault(root => root.name == RuntimeObjectName);
            Require(runtime != null,
                $"Scene is missing {RuntimeObjectName}; configure Phase 4 first.");
            DiminishedRealityManager manager = AddIfMissing<DiminishedRealityManager>(runtime);
            manager.Configure(new[] { tv, keyboard });
            PassthroughSafetyController safety =
                AddIfMissing<PassthroughSafetyController>(runtime);
            safety.Configure(manager);

            EditorUtility.SetDirty(material);
            EditorUtility.SetDirty(tv);
            EditorUtility.SetDirty(keyboard);
            EditorUtility.SetDirty(manager);
            EditorUtility.SetDirty(safety);
            EditorUtility.SetDirty(runtime);
            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene);
            AssetDatabase.SaveAssets();
            Debug.Log(
                $"Configured Phase 6 TV and keyboard masks in {ScenePath}. " +
                $"profile={StudyProtocol.DrProfileVersion} protocol={StudyProtocol.ProtocolVersion} " +
                $"build={StudyProtocol.AppBuildId}");
        }

        [MenuItem("Collaborative DR/Phase 6/Validate DR Masks")]
        public static void ValidateDiminishedRealityMasks()
        {
            ValidateOrThrow();
            Debug.Log("Phase 6 diminished-reality mask validation passed.");
        }

        [MenuItem("Collaborative DR/Phase 8/Build Final APK")]
        public static void BuildAndroidApk()
        {
            ConfigureDiminishedRealityMasks();
            ValidateOrThrow();
            if (!EditorUserBuildSettings.SwitchActiveBuildTarget(
                    BuildTargetGroup.Android,
                    BuildTarget.Android))
            {
                throw new InvalidOperationException(
                    "Could not switch the active build target to Android.");
            }

            string buildPath = GetCommandLineValue("-phase8BuildPath") ??
                               GetCommandLineValue("-phase6BuildPath") ??
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
                $"Phase 8 Android build succeeded: {absoluteBuildPath} " +
                $"({report.summary.totalSize} bytes).");
        }

        private static void ValidateOrThrow()
        {
            Phase5Build.ValidateSixTagCalibration();
            Require(StudyProtocol.ProtocolVersion == "1.3.0",
                "Phase 6 requires protocol 1.3.0.");
            Require(StudyProtocol.AppBuildId == "cdr-phase8-final",
                "The Phase 8 final APK needs its approved build ID.");
            Require(StudyProtocol.DrProfileVersion ==
                    DiminishedRealityTargetProfile.Phase6ProfileVersion,
                "The protocol and Unity DR profile versions do not match.");

            Material material = AssetDatabase.LoadAssetAtPath<Material>(MaterialPath);
            Require(material != null &&
                    material.shader != null &&
                    material.shader.name == DiminishedRealityManager.MaskShaderName,
                "The Phase 6 white-mask material is missing or uses the wrong shader.");
            DiminishedRealityTargetProfile tv =
                AssetDatabase.LoadAssetAtPath<DiminishedRealityTargetProfile>(TvProfilePath);
            DiminishedRealityTargetProfile keyboard =
                AssetDatabase.LoadAssetAtPath<DiminishedRealityTargetProfile>(KeyboardProfilePath);
            Require(tv != null, $"Missing Phase 6 TV profile: {TvProfilePath}");
            Require(keyboard != null,
                $"Missing Phase 6 keyboard profile: {KeyboardProfilePath}");
            tv.ValidateOrThrow();
            keyboard.ValidateOrThrow();
            Require(tv.TargetId == "TV" &&
                    tv.RigAnchor == DiminishedRealityRigAnchor.TvTagFrame &&
                    tv.ReplacementMaterial == material,
                "The TV profile has the wrong identity, rig anchor, or material.");
            Require(keyboard.TargetId == "KEYBOARD" &&
                    keyboard.RigAnchor == DiminishedRealityRigAnchor.KeyboardRig &&
                    keyboard.ReplacementMaterial == material,
                "The keyboard profile has the wrong identity, rig anchor, or material.");
            Require(!tv.PlacementPendingNewRoomSurvey || !tv.UseReplacementTexture,
                "The pending new-room TV profile must use the white placeholder.");
            Require(!keyboard.PlacementPendingNewRoomSurvey ||
                    !keyboard.UseReplacementTexture,
                "The pending new-room keyboard profile must use the white placeholder.");
            Require(!tv.PlacementPendingNewRoomSurvey &&
                    !keyboard.PlacementPendingNewRoomSurvey,
                "Both new-room placements must be surveyed before this pilot build.");

            Scene scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            GameObject runtime = scene.GetRootGameObjects()
                .FirstOrDefault(root => root.name == RuntimeObjectName);
            Require(runtime != null, $"Scene is missing {RuntimeObjectName}.");
            Require(runtime.GetComponent<DiminishedRealityManager>() != null,
                "Phase 6 runtime is missing DiminishedRealityManager.");
            Require(runtime.GetComponent<PassthroughSafetyController>() != null,
                "Phase 6 runtime is missing PassthroughSafetyController.");
        }

        private static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path))
            {
                return;
            }
            string parent = Path.GetDirectoryName(path)?.Replace('\\', '/');
            string name = Path.GetFileName(path);
            Require(!string.IsNullOrWhiteSpace(parent) &&
                    AssetDatabase.IsValidFolder(parent),
                $"Cannot create asset folder because its parent is missing: {path}");
            AssetDatabase.CreateFolder(parent, name);
        }

        private static T AddIfMissing<T>(GameObject target) where T : Component
        {
            return target.GetComponent<T>() ?? target.AddComponent<T>();
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
