using CollaborativeDR.DiminishedReality;
using CollaborativeDR.Protocol;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace CollaborativeDR.Tests.EditMode
{
    public sealed class Phase6DiminishedRealityTests
    {
        [Test]
        public void PhotoSurfaceAssetsAreDistinctAndQuestReady()
        {
            const string wallPath =
                "Assets/CollaborativeDR/DiminishedReality/Textures/WallSurface.png";
            const string deskPath =
                "Assets/CollaborativeDR/DiminishedReality/Textures/DeskSurface.png";
            Texture2D wall = AssetDatabase.LoadAssetAtPath<Texture2D>(wallPath);
            Texture2D desk = AssetDatabase.LoadAssetAtPath<Texture2D>(deskPath);
            DiminishedRealityTargetProfile tv = AssetDatabase.LoadAssetAtPath<
                DiminishedRealityTargetProfile>(
                "Assets/CollaborativeDR/Configuration/TvDiminishedRealityProfile.asset");
            DiminishedRealityTargetProfile keyboard = AssetDatabase.LoadAssetAtPath<
                DiminishedRealityTargetProfile>(
                "Assets/CollaborativeDR/Configuration/KeyboardDiminishedRealityProfile.asset");

            Assert.That(wall, Is.Not.Null);
            Assert.That(desk, Is.Not.Null);
            Assert.That(wall, Is.Not.SameAs(desk));
            Assert.That(tv.ReplacementTexture, Is.SameAs(wall));
            Assert.That(keyboard.ReplacementTexture, Is.SameAs(desk));
            Assert.That(tv.UseReplacementTexture, Is.False,
                "The new room uses a white TV placeholder until surface assets are ready.");
            Assert.That(keyboard.UseReplacementTexture, Is.False,
                "The new room uses a white keyboard placeholder until surface assets are ready.");
            Assert.That(tv.PlacementPendingNewRoomSurvey, Is.False,
                "The photographed new-room TV placement is ready for a white-mask pilot.");
            Assert.That(keyboard.PlacementPendingNewRoomSurvey, Is.False,
                "The confirmed unchanged keyboard/tag layout is ready for a white-mask pilot.");

            foreach (string path in new[] { wallPath, deskPath })
            {
                TextureImporter importer = AssetImporter.GetAtPath(path) as TextureImporter;
                Assert.That(importer, Is.Not.Null);
                Assert.That(importer.sRGBTexture, Is.True);
                Assert.That(importer.alphaSource, Is.EqualTo(TextureImporterAlphaSource.None));
                Assert.That(importer.mipmapEnabled, Is.True);
                Assert.That(importer.isReadable, Is.False);
                Assert.That(importer.wrapMode, Is.EqualTo(TextureWrapMode.Clamp));
                Assert.That(importer.filterMode, Is.EqualTo(FilterMode.Trilinear));
                Assert.That(importer.maxTextureSize, Is.EqualTo(2048));
                TextureImporterPlatformSettings android =
                    importer.GetPlatformTextureSettings("Android");
                Assert.That(android.overridden, Is.True);
                Assert.That(android.format, Is.EqualTo(TextureImporterFormat.ASTC_6x6));
            }
        }

        [Test]
        public void GeometryReconfigurationPreservesSurfaceAndPilotColourSettings()
        {
            DiminishedRealityTargetProfile profile = CreateProfile(
                "KEYBOARD", DiminishedRealityRigAnchor.KeyboardRig,
                Vector3.zero, new Vector3(-90f, 0f, 0f),
                new Vector2(0.55f, 0.35f), 0.005f);
            Texture2D texture = new Texture2D(2, 2);
            try
            {
                profile.SetReplacementTexture(texture);
                SerializedObject serialized = new SerializedObject(profile);
                serialized.FindProperty("brightness").floatValue = 0.85f;
                serialized.FindProperty("contrast").floatValue = 0.9f;
                serialized.FindProperty("tint").colorValue = new Color(0.95f, 1f, 0.92f, 1f);
                serialized.ApplyModifiedPropertiesWithoutUndo();
                Color approvedTint = profile.Tint;

                profile.Configure(
                    "KEYBOARD", DiminishedRealityRigAnchor.KeyboardRig,
                    Vector3.zero, new Vector3(-90f, 0f, 0f),
                    new Vector2(0.55f, 0.35f), 0.005f, null, profile.Tint);

                Assert.That(profile.ReplacementTexture, Is.SameAs(texture));
                Assert.That(profile.Brightness, Is.EqualTo(0.85f));
                Assert.That(profile.Contrast, Is.EqualTo(0.9f));
                Assert.That(profile.Tint, Is.EqualTo(approvedTint));
                Assert.That(profile.Opacity, Is.EqualTo(1f));
            }
            finally
            {
                Object.DestroyImmediate(profile);
                Object.DestroyImmediate(texture);
            }
        }

        [Test]
        public void TargetSwitchRebindsTextureAndNoDrHidesPreviouslyShownMask()
        {
            GameObject host = new GameObject("Phase 6 Surface Switching Test");
            DiminishedRealityTargetProfile tv = CreateProfile(
                "TV", DiminishedRealityRigAnchor.TvTagFrame,
                new Vector3(0.034f, 0f, 0.07f), Vector3.zero,
                new Vector2(1.60f, 1.46f), 0.005f);
            DiminishedRealityTargetProfile keyboard = CreateProfile(
                "KEYBOARD", DiminishedRealityRigAnchor.KeyboardRig,
                Vector3.zero, new Vector3(-90f, 0f, 0f),
                new Vector2(0.55f, 0.35f), 0.005f);
            Texture2D wallTexture = new Texture2D(2, 2);
            Texture2D deskTexture = new Texture2D(2, 2);
            try
            {
                tv.SetReplacementTexture(wallTexture);
                keyboard.SetReplacementTexture(deskTexture);
                DiminishedRealityManager manager = host.AddComponent<DiminishedRealityManager>();
                manager.Configure(new[] { tv, keyboard });
                CalibrationReportPayload report = new CalibrationReportPayload
                {
                    AttemptId = "CAL-SURFACE-SWITCH",
                    Status = "PASS",
                    KeyboardRigInWorld = PosePayload(Vector3.zero, Quaternion.identity),
                    TvInKeyboardRig = PosePayload(Vector3.forward, Quaternion.identity)
                };
                MaterialPropertyBlock block = new MaterialPropertyBlock();
                foreach (DiminishedRealityTargetProfile profile in new[] { tv, keyboard })
                {
                    Assert.That(manager.PrepareTrial(true, profile.TargetId,
                        profile.ProfileVersion, "PASS", report, out string reason), Is.True, reason);
                    Assert.That(manager.IsMaskVisible, Is.False, "Prepare must stay hidden.");
                    MeshRenderer renderer = host.GetComponentInChildren<MeshRenderer>(true);
                    renderer.GetPropertyBlock(block);
                    Assert.That(block.GetTexture("_MainTex"), Is.SameAs(profile.ReplacementTexture));
                    Assert.That(block.GetFloat("_UseTexture"), Is.EqualTo(1f));
                    Assert.That(manager.Show(out reason), Is.True, reason);
                    Assert.That(manager.IsMaskVisible, Is.True);
                }

                SerializedObject placeholder = new SerializedObject(keyboard);
                placeholder.FindProperty("useReplacementTexture").boolValue = false;
                placeholder.ApplyModifiedPropertiesWithoutUndo();
                Assert.That(keyboard.ReplacementTexture, Is.SameAs(deskTexture));
                Assert.That(manager.PrepareTrial(true, "KEYBOARD", keyboard.ProfileVersion,
                    "PASS", report, out string fallbackReason), Is.True, fallbackReason);
                host.GetComponentInChildren<MeshRenderer>(true).GetPropertyBlock(block);
                Assert.That(block.GetTexture("_MainTex"), Is.SameAs(Texture2D.whiteTexture));
                Assert.That(block.GetFloat("_UseTexture"), Is.EqualTo(0f));
                Assert.That(manager.Show(out fallbackReason), Is.True, fallbackReason);

                Assert.That(manager.PrepareTrial(false, "KEYBOARD", keyboard.ProfileVersion,
                    "NOT_RUN", null, out string noDrReason), Is.True, noDrReason);
                Assert.That(manager.Show(out noDrReason), Is.True, noDrReason);
                Assert.That(manager.IsMaskVisible, Is.False);
                Assert.That(manager.ReportState().ActualState, Is.EqualTo("NO_DR"));

                SerializedObject pendingSurvey = new SerializedObject(tv);
                pendingSurvey.FindProperty("placementPendingNewRoomSurvey").boolValue = true;
                pendingSurvey.ApplyModifiedPropertiesWithoutUndo();
                Assert.That(manager.PrepareTrial(true, "TV", tv.ProfileVersion,
                    "PASS", report, out string pendingReason), Is.False);
                StringAssert.Contains("pending the new-room survey", pendingReason);
                Assert.That(manager.IsMaskVisible, Is.False);
            }
            finally
            {
                Object.DestroyImmediate(host);
                Object.DestroyImmediate(tv);
                Object.DestroyImmediate(keyboard);
                Object.DestroyImmediate(wallTexture);
                Object.DestroyImmediate(deskTexture);
            }
        }

        [Test]
        public void TvPlacementComposesKeyboardAndTvCalibrationFrames()
        {
            DiminishedRealityTargetProfile profile = CreateProfile(
                "TV",
                DiminishedRealityRigAnchor.TvTagFrame,
                new Vector3(0.034f, 0f, 0.07f),
                Vector3.zero,
                new Vector2(1.60f, 1.46f),
                0.005f);
            try
            {
                CalibrationReportPayload report = new CalibrationReportPayload
                {
                    AttemptId = "CAL-TEST",
                    Status = "PASS",
                    KeyboardRigInWorld = PosePayload(
                        new Vector3(1f, 0.5f, -2f),
                        Quaternion.Euler(0f, 90f, 0f)),
                    TvInKeyboardRig = PosePayload(
                        new Vector3(0f, 1.2f, 2f),
                        Quaternion.identity)
                };

                bool resolved = DiminishedRealityManager.TryResolveWorldPose(
                    profile,
                    report,
                    out Pose pose,
                    out string reason);

                Assert.That(resolved, Is.True, reason);
                Pose keyboard = new Pose(
                    new Vector3(1f, 0.5f, -2f),
                    Quaternion.Euler(0f, 90f, 0f));
                Vector3 expected = keyboard.position + keyboard.rotation *
                    new Vector3(0.034f, 1.2f, 2.07f);
                Assert.That(Vector3.Distance(pose.position, expected), Is.LessThan(0.00001f));
                Assert.That(
                    Quaternion.Angle(pose.rotation, keyboard.rotation),
                    Is.LessThan(0.001f));
            }
            finally
            {
                Object.DestroyImmediate(profile);
            }
        }

        [Test]
        public void NewRoomTvWallPlaneUsesConfirmedViewDistance()
        {
            const float wallDistance = 1.50f;
            const float tvProtrusion = 0.29f;
            const float frontPlaneWidth = 1.18f;
            const float photographedTvHeightEstimate = 0.68f;
            const float horizontalTagSeparation = 1.673f;
            const float verticalTagSeparation = 1.075f;
            const float printedTagWidth = 0.102f;
            float scale = wallDistance / (wallDistance - tvProtrusion);
            DiminishedRealityTargetProfile profile = AssetDatabase.LoadAssetAtPath<
                DiminishedRealityTargetProfile>(
                "Assets/CollaborativeDR/Configuration/TvDiminishedRealityProfile.asset");

            Assert.That(profile, Is.Not.Null);
            Assert.That(profile.OuterDimensionsMeters.x,
                Is.GreaterThan(frontPlaneWidth * scale));
            Assert.That(profile.OuterDimensionsMeters.y,
                Is.GreaterThan(photographedTvHeightEstimate * scale));
            Assert.That(profile.LocalPositionMeters.z, Is.EqualTo(0f),
                "The pilot mask belongs on the photographed TV-tag wall plane.");
            Assert.That(Mathf.Abs(profile.LocalPositionMeters.x) +
                        profile.OuterDimensionsMeters.x * 0.5f,
                Is.LessThan((horizontalTagSeparation - printedTagWidth) * 0.5f),
                "The white rectangle must stay between the printed TV tags.");
            Assert.That(Mathf.Abs(profile.LocalPositionMeters.y) +
                        profile.OuterDimensionsMeters.y * 0.5f,
                Is.LessThan((verticalTagSeparation - printedTagWidth) * 0.5f),
                "The white rectangle must stay between the printed TV tags.");
        }

        [Test]
        public void KeyboardProfileIsExpandedAndFlushWithDesk()
        {
            DiminishedRealityTargetProfile profile = CreateProfile(
                "KEYBOARD",
                DiminishedRealityRigAnchor.KeyboardRig,
                Vector3.zero,
                new Vector3(-90f, 0f, 0f),
                new Vector2(0.55f, 0.35f),
                0.005f);
            try
            {
                Assert.That(profile.OuterDimensionsMeters.x, Is.EqualTo(0.55f).Within(0.000001f));
                Assert.That(profile.OuterDimensionsMeters.y, Is.EqualTo(0.35f).Within(0.000001f));
                Assert.That(profile.LocalPositionMeters, Is.EqualTo(Vector3.zero));
                Assert.That(
                    Quaternion.Angle(profile.LocalRotation, Quaternion.Euler(-90f, 0f, 0f)),
                    Is.LessThan(0.001f));
                Assert.That(profile.FeatherMeters, Is.EqualTo(0.005f).Within(0.000001f));
                Assert.That(profile.PerformanceTargetFps, Is.EqualTo(72));
            }
            finally
            {
                Object.DestroyImmediate(profile);
            }
        }

        [Test]
        public void KeyboardPrepareBuildsSingleDeskPlane()
        {
            GameObject host = new GameObject("Phase 6 Keyboard Desk Plane Test Host");
            Shader shader = Shader.Find(DiminishedRealityManager.MaskShaderName);
            Assert.That(shader, Is.Not.Null, "The Phase 6 mask shader was not loaded.");
            Material material = new Material(shader);
            DiminishedRealityTargetProfile profile =
                ScriptableObject.CreateInstance<DiminishedRealityTargetProfile>();
            profile.Configure(
                "KEYBOARD",
                DiminishedRealityRigAnchor.KeyboardRig,
                Vector3.zero,
                new Vector3(-90f, 0f, 0f),
                new Vector2(0.55f, 0.35f),
                0.005f,
                material,
                Color.white);
            try
            {
                DiminishedRealityManager manager = host.AddComponent<DiminishedRealityManager>();
                manager.Configure(new[] { profile });
                CalibrationReportPayload report = new CalibrationReportPayload
                {
                    AttemptId = "CAL-KEYBOARD-DESK-PLANE",
                    Status = "PASS",
                    KeyboardRigInWorld = PosePayload(Vector3.zero, Quaternion.identity)
                };

                bool prepared = manager.PrepareTrial(
                    true,
                    "KEYBOARD",
                    DiminishedRealityTargetProfile.Phase6ProfileVersion,
                    "PASS",
                    report,
                    out string reason);

                Assert.That(prepared, Is.True, reason);
                MeshFilter filter = host.GetComponentInChildren<MeshFilter>(true);
                Assert.That(filter, Is.Not.Null);
                Assert.That(filter.sharedMesh.vertexCount, Is.EqualTo(4));
                Assert.That(filter.sharedMesh.bounds.max.z, Is.EqualTo(0f).Within(0.000001f));
                Assert.That(filter.sharedMesh.bounds.min.z, Is.EqualTo(0f).Within(0.000001f));
                Assert.That(filter.transform.position.y, Is.EqualTo(0f).Within(0.000001f));
                Assert.That(filter.transform.localScale.x, Is.EqualTo(0.55f).Within(0.000001f));
                Assert.That(filter.transform.localScale.y, Is.EqualTo(0.35f).Within(0.000001f));
            }
            finally
            {
                Object.DestroyImmediate(host);
                Object.DestroyImmediate(profile);
                Object.DestroyImmediate(material);
            }
        }

        [Test]
        public void NoDrPrepareNeverCreatesVisibleReplacementGeometry()
        {
            GameObject host = new GameObject("Phase 6 DR Test Host");
            DiminishedRealityTargetProfile profile = CreateProfile(
                "KEYBOARD",
                DiminishedRealityRigAnchor.KeyboardRig,
                Vector3.zero,
                new Vector3(-90f, 0f, 0f),
                new Vector2(0.55f, 0.35f),
                0.005f);
            try
            {
                DiminishedRealityManager manager = host.AddComponent<DiminishedRealityManager>();
                manager.Configure(new[] { profile });

                bool prepared = manager.PrepareTrial(
                    false,
                    "KEYBOARD",
                    DiminishedRealityTargetProfile.Phase6ProfileVersion,
                    "NOT_RUN",
                    null,
                    out string reason);
                DiminishedRealityStateReportPayload state = manager.ReportState();

                Assert.That(prepared, Is.True, reason);
                Assert.That(manager.IsPrepared, Is.True);
                Assert.That(manager.IsMaskVisible, Is.False);
                Assert.That(state.ActualState, Is.EqualTo("NO_DR"));
                Assert.That(state.GeometryActive, Is.False);
                Assert.That(state.DrStateMatches, Is.True);
            }
            finally
            {
                Object.DestroyImmediate(host);
                Object.DestroyImmediate(profile);
            }
        }

        private static DiminishedRealityTargetProfile CreateProfile(
            string target,
            DiminishedRealityRigAnchor anchor,
            Vector3 localPosition,
            Vector3 localEuler,
            Vector2 outerDimensions,
            float feather)
        {
            DiminishedRealityTargetProfile profile =
                ScriptableObject.CreateInstance<DiminishedRealityTargetProfile>();
            profile.Configure(
                target,
                anchor,
                localPosition,
                localEuler,
                outerDimensions,
                feather,
                null,
                Color.white);
            return profile;
        }

        private static CalibrationPosePayload PosePayload(
            Vector3 position,
            Quaternion rotation)
        {
            return new CalibrationPosePayload
            {
                Position = new CalibrationVector3Payload
                {
                    X = position.x,
                    Y = position.y,
                    Z = position.z
                },
                Rotation = new CalibrationQuaternionPayload
                {
                    X = rotation.x,
                    Y = rotation.y,
                    Z = rotation.z,
                    W = rotation.w
                }
            };
        }
    }
}
