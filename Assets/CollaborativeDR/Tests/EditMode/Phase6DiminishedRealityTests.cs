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
        public void TvWallPlaneUsesApprovedPerspectiveCompensation()
        {
            const float recessedPlaneDistance = 1.37f;
            const float tvProtrusion = 0.29f;
            const float wallDistance = 1.30f;
            const float frontPlaneWidth = 1.18f;
            const float frontPlaneHeight = 1.075f;
            const float frontPlaneCentreShift = 0.025f;
            float scale = recessedPlaneDistance / (wallDistance - tvProtrusion);

            Assert.That(1.60f, Is.EqualTo(frontPlaneWidth * scale).Within(0.005f));
            Assert.That(1.46f, Is.EqualTo(frontPlaneHeight * scale).Within(0.005f));
            Assert.That(0.034f,
                Is.EqualTo(frontPlaneCentreShift * scale).Within(0.001f));
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
