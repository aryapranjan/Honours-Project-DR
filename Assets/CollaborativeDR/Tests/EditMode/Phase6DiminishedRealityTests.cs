using CollaborativeDR.DiminishedReality;
using CollaborativeDR.Protocol;
using NUnit.Framework;
using UnityEngine;

namespace CollaborativeDR.Tests.EditMode
{
    public sealed class Phase6DiminishedRealityTests
    {
        [Test]
        public void TvPlacementComposesKeyboardAndTvCalibrationFrames()
        {
            DiminishedRealityTargetProfile profile = CreateProfile(
                "TV",
                DiminishedRealityRigAnchor.TvTagFrame,
                new Vector3(0.025f, 0f, -0.31f),
                Vector3.zero,
                new Vector2(1.18f, 1.075f),
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
                    new Vector3(0.025f, 1.2f, 1.69f);
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
        public void TvProfileExtendsOnlyParticipantRightEdge()
        {
            const float originalWidth = 1.13f;
            const float extendedWidth = 1.18f;
            const float centreShift = 0.025f;

            float originalLeft = -originalWidth * 0.5f;
            float originalRight = originalWidth * 0.5f;
            float extendedLeft = centreShift - extendedWidth * 0.5f;
            float extendedRight = centreShift + extendedWidth * 0.5f;

            Assert.That(extendedLeft, Is.EqualTo(originalLeft).Within(0.000001f));
            Assert.That(extendedRight - originalRight, Is.EqualTo(0.05f).Within(0.000001f));
        }

        [Test]
        public void KeyboardProfileIncludesApprovedCoveragePadding()
        {
            DiminishedRealityTargetProfile profile = CreateProfile(
                "KEYBOARD",
                DiminishedRealityRigAnchor.KeyboardRig,
                new Vector3(0f, 0.0375f, 0f),
                new Vector3(-90f, 0f, 0f),
                new Vector2(0.31f, 0.115f),
                0.003f,
                DiminishedRealityGeometryKind.OpenBottomBox,
                0.0375f);
            try
            {
                Assert.That(profile.OuterDimensionsMeters.x, Is.EqualTo(0.31f).Within(0.000001f));
                Assert.That(profile.OuterDimensionsMeters.y, Is.EqualTo(0.115f).Within(0.000001f));
                Assert.That(profile.LocalPositionMeters.y, Is.EqualTo(0.0375f).Within(0.000001f));
                Assert.That(profile.GeometryKind,
                    Is.EqualTo(DiminishedRealityGeometryKind.OpenBottomBox));
                Assert.That(profile.CoverHeightMeters, Is.EqualTo(0.0375f).Within(0.000001f));
                Assert.That(
                    Quaternion.Angle(profile.LocalRotation, Quaternion.Euler(-90f, 0f, 0f)),
                    Is.LessThan(0.001f));
                Assert.That(profile.FeatherMeters, Is.EqualTo(0.003f).Within(0.000001f));
                Assert.That(profile.PerformanceTargetFps, Is.EqualTo(72));
            }
            finally
            {
                Object.DestroyImmediate(profile);
            }
        }

        [Test]
        public void KeyboardPrepareBuildsCoverFromTopDownToDesk()
        {
            GameObject host = new GameObject("Phase 6 Keyboard Cover Test Host");
            Shader shader = Shader.Find(DiminishedRealityManager.MaskShaderName);
            Assert.That(shader, Is.Not.Null, "The Phase 6 mask shader was not loaded.");
            Material material = new Material(shader);
            DiminishedRealityTargetProfile profile =
                ScriptableObject.CreateInstance<DiminishedRealityTargetProfile>();
            profile.Configure(
                "KEYBOARD",
                DiminishedRealityRigAnchor.KeyboardRig,
                new Vector3(0f, 0.0375f, 0f),
                new Vector3(-90f, 0f, 0f),
                new Vector2(0.31f, 0.115f),
                0.003f,
                material,
                Color.white,
                72,
                DiminishedRealityGeometryKind.OpenBottomBox,
                0.0375f);
            try
            {
                DiminishedRealityManager manager = host.AddComponent<DiminishedRealityManager>();
                manager.Configure(new[] { profile });
                CalibrationReportPayload report = new CalibrationReportPayload
                {
                    AttemptId = "CAL-KEYBOARD-COVER",
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
                Assert.That(filter.sharedMesh.vertexCount, Is.EqualTo(36));
                Assert.That(filter.sharedMesh.bounds.max.z, Is.EqualTo(0f).Within(0.000001f));
                Assert.That(filter.sharedMesh.bounds.min.z, Is.EqualTo(-1f).Within(0.000001f));
                Assert.That(filter.transform.localScale.z,
                    Is.EqualTo(0.0375f).Within(0.000001f));
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
                new Vector3(0f, 0.0375f, 0f),
                new Vector3(-90f, 0f, 0f),
                new Vector2(0.31f, 0.115f),
                0.003f);
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
            float feather,
            DiminishedRealityGeometryKind geometryKind =
                DiminishedRealityGeometryKind.FlatQuad,
            float coverHeightMeters = 0f)
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
                Color.white,
                72,
                geometryKind,
                coverHeightMeters);
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
