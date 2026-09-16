using System;
using System.Collections.Generic;
using System.Linq;
using CollaborativeDR.Calibration;
using CollaborativeDR.Configuration;
using CollaborativeDR.Protocol;
using NUnit.Framework;
using UnityEngine;

namespace CollaborativeDR.Tests.EditMode
{
    public sealed class Phase5CalibrationTests
    {
        private AprilTagRigConfiguration configuration;

        [SetUp]
        public void SetUp()
        {
            configuration = ScriptableObject.CreateInstance<AprilTagRigConfiguration>();
            configuration.ValidateOrThrow();
        }

        [TearDown]
        public void TearDown()
        {
            UnityEngine.Object.DestroyImmediate(configuration);
        }

        [Test]
        public void ConfigurationLocksMeasuredDetectionCornerSizeAndIds()
        {
            Assert.That(configuration.TagFamily, Is.EqualTo("tagStandard41h12"));
            Assert.That(configuration.TagSizeMeters, Is.EqualTo(0.0567f).Within(0.000001f));
            Assert.That(configuration.KeyboardSpacingMeters, Is.EqualTo(0.40f).Within(0.000001f));
            Assert.That(configuration.KeyboardLeftTagId, Is.EqualTo(1));
            Assert.That(configuration.KeyboardRightTagId, Is.EqualTo(2));
            Assert.That(configuration.TvTopLeftTagId, Is.EqualTo(4));
            Assert.That(configuration.TvTopRightTagId, Is.EqualTo(5));
            Assert.That(configuration.TvBottomRightTagId, Is.EqualTo(6));
            Assert.That(configuration.TvBottomLeftTagId, Is.EqualTo(3));
            Assert.That(configuration.RequiredTagIds, Is.EquivalentTo(new[] { 1, 2, 3, 4, 5, 6 }));
            Assert.That(configuration.MinimumVisibleTvTags, Is.EqualTo(3));
        }

        [Test]
        public void StableSixTagRigPassesWithoutPersistingFrames()
        {
            CalibrationReportPayload report = Solve(StandardRig());

            Assert.That(report.Status, Is.EqualTo("PASS"));
            Assert.That(report.ObservedTagIds, Is.EqualTo(new[] { 1, 2, 3, 4, 5, 6 }));
            Assert.That(report.KeyboardSpacingMeters, Is.EqualTo(0.40f).Within(0.001f));
            Assert.That(report.TvPlanarityRmsMeters, Is.LessThan(0.001f));
            Assert.That(report.TvInKeyboardRig, Is.Not.Null);
            Assert.That(Mathf.Abs(report.TvInKeyboardRig.Rotation.W), Is.GreaterThan(0.99f),
                "The confirmed participant-view tag 1 -> tag 2 axis must align with physical right.");
            Assert.That(report.TagTransforms, Has.Length.EqualTo(6));
            Assert.That(report.RawFramesPersisted, Is.False);
            Assert.That(report.Simulation, Is.False);
        }

        [Test]
        public void AnyThreeTvTagsUseApprovedRedundancy()
        {
            List<TagObservation> observations = StandardRig()
                .Where(observation => observation.TagId != 5)
                .ToList();

            CalibrationReportPayload report = Solve(observations);

            Assert.That(report.Status, Is.EqualTo("PASS"));
            Assert.That(report.ObservedTagIds, Is.EqualTo(new[] { 1, 2, 3, 4, 6 }));
            Assert.That(report.Warnings.Any(value =>
                value == "TV_REDUNDANCY_USED:missing_tag=5"), Is.True);
            Assert.That(report.TvInKeyboardRig, Is.Not.Null);
        }

        [Test]
        public void TwoTvTagsProduceActionableFailure()
        {
            List<TagObservation> observations = StandardRig()
                .Where(observation => observation.TagId != 5 && observation.TagId != 6)
                .ToList();

            CalibrationReportPayload report = Solve(observations);

            Assert.That(report.Status, Is.EqualTo("FAIL"));
            Assert.That(report.FailureReasons.Any(value =>
                value.StartsWith("TV_TAGS_INSUFFICIENT", StringComparison.Ordinal)), Is.True);
        }

        [Test]
        public void IncorrectKeyboardSpacingFailsTheQualityGate()
        {
            List<TagObservation> observations = StandardRig();
            observations = observations
                .Select(observation => observation.TagId == 2
                    ? Observation(2, new Vector3(0.30f, 0f, 0f), observation.CapturedAtMonotonicMs)
                    : observation)
                .ToList();

            CalibrationReportPayload report = Solve(observations);

            Assert.That(report.Status, Is.EqualTo("FAIL"));
            Assert.That(report.FailureReasons.Any(value =>
                value.StartsWith("KEYBOARD_SPACING_OUT_OF_TOLERANCE", StringComparison.Ordinal)),
                Is.True);
        }

        [Test]
        public void PerTagRotationJitterIsDiagnosticWhenRigGeometryIsStable()
        {
            List<TagObservation> observations = StandardRig()
                .Select(observation =>
                {
                    if (observation.TagId != 3 && observation.TagId != 5)
                    {
                        return observation;
                    }
                    int sample = Mathf.RoundToInt(
                        (float)(observation.CapturedAtMonotonicMs / 100d));
                    Quaternion rotation = sample % 2 == 0
                        ? Quaternion.identity
                        : Quaternion.Euler(0f, 60f, 0f);
                    return CopyWith(
                        observation,
                        observation.WorldPosition,
                        rotation);
                })
                .ToList();

            CalibrationReportPayload report = Solve(observations);

            Assert.That(report.Status, Is.EqualTo("PASS"));
            Assert.That(report.FailureReasons.Any(value =>
                value.StartsWith("TAG_ROTATION_UNSTABLE", StringComparison.Ordinal)), Is.False);
            Assert.That(report.Warnings.Any(value =>
                value.StartsWith("TAG_ROTATION_UNSTABLE:id=3", StringComparison.Ordinal)), Is.True);
            Assert.That(report.Warnings.Any(value =>
                value.StartsWith("TAG_ROTATION_UNSTABLE:id=5", StringComparison.Ordinal)), Is.True);
        }

        [Test]
        public void IsolatedPositionOutlierIsRejectedBeforeRigSolve()
        {
            List<TagObservation> observations = StandardRig();
            observations.Add(Observation(
                5,
                new Vector3(1.40f, 1.20f, 2.0f),
                650d));

            CalibrationReportPayload report = Solve(observations);
            CalibrationTagSamplePayload tagFive = report.TagSamples.Single(
                sample => sample.TagId == 5);

            Assert.That(report.Status, Is.EqualTo("PASS"));
            Assert.That(report.AcceptedObservationCount, Is.EqualTo(36));
            Assert.That(report.RejectedObservationCount, Is.EqualTo(1));
            Assert.That(tagFive.AcceptedCount, Is.EqualTo(6));
            Assert.That(tagFive.RejectedCount, Is.EqualTo(1));
            Assert.That(report.Warnings.Any(value =>
                value == "ROBUST_POSITION_OUTLIERS_REJECTED:id=5,count=1"), Is.True);
        }

        [Test]
        public void SustainedPositionInstabilityStillFails()
        {
            List<TagObservation> observations = StandardRig()
                .Select(observation =>
                {
                    if (observation.TagId != 5)
                    {
                        return observation;
                    }
                    int sample = Mathf.RoundToInt(
                        (float)(observation.CapturedAtMonotonicMs / 100d));
                    float offset = sample % 2 == 0 ? -0.04f : 0.04f;
                    return CopyWith(
                        observation,
                        observation.WorldPosition + new Vector3(offset, 0f, 0f),
                        observation.WorldRotation);
                })
                .ToList();

            CalibrationReportPayload report = Solve(observations);

            Assert.That(report.Status, Is.EqualTo("FAIL"));
            Assert.That(report.FailureReasons.Any(value =>
                value.StartsWith("TAG_POSITION_UNSTABLE:id=5", StringComparison.Ordinal)), Is.True);
        }

        private CalibrationReportPayload Solve(IReadOnlyList<TagObservation> observations)
        {
            DateTime start = DateTime.UtcNow;
            return AprilTagRigSolver.BuildReport(
                Guid.NewGuid().ToString(),
                start,
                start.AddSeconds(6),
                observations,
                new Dictionary<int, int>(),
                0,
                Array.Empty<string>(),
                configuration,
                "LEFT",
                1280,
                960);
        }

        private static List<TagObservation> StandardRig()
        {
            Dictionary<int, Vector3> positions = new Dictionary<int, Vector3>
            {
                { 1, new Vector3(-0.20f, 0f, 0f) },
                { 2, new Vector3(0.20f, 0f, 0f) },
                { 3, new Vector3(-0.70f, 0.30f, 2.0f) },
                { 4, new Vector3(-0.70f, 1.20f, 2.0f) },
                { 5, new Vector3(0.70f, 1.20f, 2.0f) },
                { 6, new Vector3(0.70f, 0.30f, 2.0f) }
            };
            List<TagObservation> result = new List<TagObservation>();
            foreach (KeyValuePair<int, Vector3> pair in positions)
            {
                for (int sample = 0; sample < 6; sample++)
                {
                    float offset = (sample - 2.5f) * 0.0001f;
                    result.Add(Observation(
                        pair.Key,
                        pair.Value + new Vector3(offset, -offset, 0f),
                        sample * 100d));
                }
            }
            return result;
        }

        private static TagObservation Observation(
            int id,
            Vector3 position,
            double monotonicMs)
        {
            return new TagObservation(
                id,
                DateTime.UtcNow,
                monotonicMs,
                0.01f,
                position,
                Quaternion.identity,
                1280,
                960);
        }

        private static TagObservation CopyWith(
            TagObservation source,
            Vector3 position,
            Quaternion rotation)
        {
            return new TagObservation(
                source.TagId,
                source.FrameTimestampUtc,
                source.CapturedAtMonotonicMs,
                source.FrameAgeSeconds,
                position,
                rotation,
                source.ImageWidth,
                source.ImageHeight);
        }
    }
}
