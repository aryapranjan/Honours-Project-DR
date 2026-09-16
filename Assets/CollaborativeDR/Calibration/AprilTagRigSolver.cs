using System;
using System.Collections.Generic;
using System.Linq;
using CollaborativeDR.Configuration;
using CollaborativeDR.Protocol;
using UnityEngine;

namespace CollaborativeDR.Calibration
{
    public static class AprilTagRigSolver
    {
        public const string ProvisionalThresholdProfile = "PROVISIONAL_PHASE5_V2";

        // Only isolated, gross position outliers are removed. Broad or bimodal
        // instability remains in the sample set and still fails the position RMS gate.
        private const float PositionOutlierMadMultiplier = 6f;

        public static CalibrationReportPayload BuildReport(
            string attemptId,
            DateTime startedAtUtc,
            DateTime completedAtUtc,
            IReadOnlyList<TagObservation> observations,
            IReadOnlyDictionary<int, int> rejectedByTag,
            int rejectedWithoutTagId,
            IReadOnlyCollection<string> sourceRejectionReasons,
            AprilTagRigConfiguration configuration,
            string cameraPosition,
            int imageWidth,
            int imageHeight)
        {
            if (configuration == null)
            {
                throw new ArgumentNullException(nameof(configuration));
            }
            configuration.ValidateOrThrow();
            observations = observations ?? Array.Empty<TagObservation>();

            Dictionary<int, List<TagObservation>> groups = configuration.RequiredTagIds
                .ToDictionary(id => id, _ => new List<TagObservation>());
            foreach (TagObservation observation in observations)
            {
                if (groups.TryGetValue(observation.TagId, out List<TagObservation> group))
                {
                    group.Add(observation);
                }
            }

            Dictionary<int, int> robustRejectedByTag =
                configuration.RequiredTagIds.ToDictionary(id => id, _ => 0);
            List<string> robustWarnings = new List<string>();
            foreach (int tagId in configuration.RequiredTagIds)
            {
                int rejected = RemoveIsolatedPositionOutliers(
                    groups[tagId],
                    configuration.MaximumPositionRmsMeters);
                robustRejectedByTag[tagId] = rejected;
                if (rejected > 0)
                {
                    robustWarnings.Add(
                        $"ROBUST_POSITION_OUTLIERS_REJECTED:id={tagId},count={rejected}");
                }
            }

            Dictionary<int, TagEstimate> estimates = new Dictionary<int, TagEstimate>();
            List<CalibrationTagSamplePayload> tagSamples =
                new List<CalibrationTagSamplePayload>(6);
            foreach (int tagId in configuration.RequiredTagIds)
            {
                List<TagObservation> samples = groups[tagId];
                TagEstimate estimate = samples.Count == 0
                    ? TagEstimate.Empty(tagId)
                    : EstimateTag(tagId, samples);
                estimates[tagId] = estimate;
                tagSamples.Add(new CalibrationTagSamplePayload
                {
                    TagId = tagId,
                    AcceptedCount = samples.Count,
                    RejectedCount = rejectedByTag != null &&
                                    rejectedByTag.TryGetValue(tagId, out int count)
                        ? count + robustRejectedByTag[tagId]
                        : robustRejectedByTag[tagId],
                    PositionRmsMeters = estimate.PositionRmsMeters,
                    RotationRmsDegrees = estimate.RotationRmsDegrees
                });
            }

            List<string> failures = new List<string>();
            List<string> warnings = new List<string>
            {
                "PROVISIONAL_THRESHOLDS_REQUIRE_PHYSICAL_PILOT_LOCK"
            };
            warnings.AddRange(robustWarnings);
            int minimumSamples = configuration.MinimumObservationsPerRequiredTag;
            RequireMinimumSamples(
                groups,
                configuration.KeyboardLeftTagId,
                minimumSamples,
                failures);
            RequireMinimumSamples(
                groups,
                configuration.KeyboardRightTagId,
                minimumSamples,
                failures);

            int[] usableTvIds = configuration.TvTagIds
                .Where(id => groups[id].Count >= minimumSamples)
                .ToArray();
            if (usableTvIds.Length < configuration.MinimumVisibleTvTags)
            {
                failures.Add(
                    $"TV_TAGS_INSUFFICIENT:required={configuration.MinimumVisibleTvTags},usable={usableTvIds.Length}");
            }
            else if (usableTvIds.Length == 3)
            {
                int missing = configuration.TvTagIds.Except(usableTvIds).Single();
                warnings.Add($"TV_REDUNDANCY_USED:missing_tag={missing}");
            }

            HashSet<int> qualityTagIds = new HashSet<int>(usableTvIds)
            {
                configuration.KeyboardLeftTagId,
                configuration.KeyboardRightTagId
            };
            foreach (int tagId in qualityTagIds)
            {
                if (groups[tagId].Count < minimumSamples)
                {
                    continue;
                }
                TagEstimate estimate = estimates[tagId];
                if (estimate.PositionRmsMeters > configuration.MaximumPositionRmsMeters)
                {
                    failures.Add(
                        $"TAG_POSITION_UNSTABLE:id={tagId},rms_m={estimate.PositionRmsMeters:F4}");
                }
                if (estimate.RotationRmsDegrees > configuration.MaximumRotationRmsDegrees)
                {
                    // The authoritative keyboard and TV frames are solved from tag-centre
                    // positions. Per-tag quaternion jitter is retained as a diagnostic but
                    // must not invalidate an otherwise accurate room transform.
                    warnings.Add(
                        $"TAG_ROTATION_UNSTABLE:id={tagId},rms_deg={estimate.RotationRmsDegrees:F2}");
                }
            }

            Pose? keyboardRig = null;
            float? keyboardSpacing = null;
            float? keyboardSpacingResidual = null;
            if (groups[configuration.KeyboardLeftTagId].Count >= minimumSamples &&
                groups[configuration.KeyboardRightTagId].Count >= minimumSamples)
            {
                TagEstimate left = estimates[configuration.KeyboardLeftTagId];
                TagEstimate right = estimates[configuration.KeyboardRightTagId];
                keyboardSpacing = Vector3.Distance(left.Position, right.Position);
                keyboardSpacingResidual = Mathf.Abs(
                    keyboardSpacing.Value - configuration.KeyboardSpacingMeters);
                if (keyboardSpacingResidual.Value >
                    configuration.KeyboardSpacingToleranceMeters)
                {
                    failures.Add(
                        $"KEYBOARD_SPACING_OUT_OF_TOLERANCE:measured_m={keyboardSpacing.Value:F4}," +
                        $"expected_m={configuration.KeyboardSpacingMeters:F4}");
                }

                if (TryCreateRoomFrame(
                        (left.Position + right.Position) * 0.5f,
                        right.Position - left.Position,
                        Vector3.up,
                        out Pose solvedKeyboard))
                {
                    keyboardRig = solvedKeyboard;
                }
                else
                {
                    failures.Add("KEYBOARD_FRAME_DEGENERATE");
                }
            }

            Pose? tvRig = null;
            float? tvPlanarityRms = null;
            if (usableTvIds.Length >= configuration.MinimumVisibleTvTags)
            {
                if (TrySolveTvFrame(
                        estimates,
                        usableTvIds,
                        configuration,
                        out Pose solvedTv,
                        out float solvedPlanarity))
                {
                    tvRig = solvedTv;
                    if (usableTvIds.Length == 4)
                    {
                        tvPlanarityRms = solvedPlanarity;
                        if (solvedPlanarity > configuration.MaximumTvPlanarityRmsMeters)
                        {
                            failures.Add(
                                $"TV_PLANARITY_OUT_OF_TOLERANCE:rms_m={solvedPlanarity:F4}");
                        }
                    }
                }
                else
                {
                    failures.Add("TV_FRAME_DEGENERATE");
                }
            }

            int totalRejected = rejectedWithoutTagId;
            if (rejectedByTag != null)
            {
                totalRejected += rejectedByTag.Values.Sum();
            }
            totalRejected += robustRejectedByTag.Values.Sum();
            if (totalRejected > 0)
            {
                warnings.Add($"REJECTED_SAMPLES_PRESENT:count={totalRejected}");
            }
            if (sourceRejectionReasons != null)
            {
                warnings.AddRange(sourceRejectionReasons
                    .Where(reason => !string.IsNullOrWhiteSpace(reason))
                    .Distinct(StringComparer.Ordinal)
                    .Select(reason => $"SOURCE_REJECTION:{reason}"));
            }

            CalibrationPosePayload keyboardWorldPayload = keyboardRig.HasValue
                ? ToPayload(keyboardRig.Value)
                : null;
            CalibrationPosePayload tvInKeyboardPayload =
                keyboardRig.HasValue && tvRig.HasValue
                    ? ToPayload(RelativePose(keyboardRig.Value, tvRig.Value))
                    : null;
            CalibrationTagTransformPayload[] transforms = keyboardRig.HasValue
                ? estimates.Values
                    .Where(estimate => groups[estimate.TagId].Count >= minimumSamples)
                    .OrderBy(estimate => estimate.TagId)
                    .Select(estimate => new CalibrationTagTransformPayload
                    {
                        TagId = estimate.TagId,
                        PoseInKeyboardRig = ToPayload(RelativePose(
                            keyboardRig.Value,
                            new Pose(estimate.Position, estimate.Rotation)))
                    })
                    .ToArray()
                : Array.Empty<CalibrationTagTransformPayload>();

            string[] distinctFailures = failures
                .Distinct(StringComparer.Ordinal)
                .ToArray();
            return new CalibrationReportPayload
            {
                AttemptId = attemptId,
                Status = distinctFailures.Length == 0 ? "PASS" : "FAIL",
                StartedAtUtc = startedAtUtc.ToUniversalTime().ToString("O"),
                CompletedAtUtc = completedAtUtc.ToUniversalTime().ToString("O"),
                DurationMs = Mathf.Max(
                    0,
                    Mathf.RoundToInt((float)(completedAtUtc - startedAtUtc).TotalMilliseconds)),
                TagFamily = configuration.TagFamily,
                TagSizeMeters = configuration.TagSizeMeters,
                ThresholdProfile = ProvisionalThresholdProfile,
                CameraPosition = string.IsNullOrWhiteSpace(cameraPosition)
                    ? "UNKNOWN"
                    : cameraPosition,
                ImageWidth = imageWidth,
                ImageHeight = imageHeight,
                ObservedTagIds = groups
                    .Where(pair => pair.Value.Count > 0)
                    .Select(pair => pair.Key)
                    .OrderBy(id => id)
                    .ToArray(),
                TagSamples = tagSamples.OrderBy(sample => sample.TagId).ToArray(),
                AcceptedObservationCount = groups.Values.Sum(group => group.Count),
                RejectedObservationCount = totalRejected,
                KeyboardSpacingMeters = keyboardSpacing,
                KeyboardSpacingResidualMeters = keyboardSpacingResidual,
                TvPlanarityRmsMeters = tvPlanarityRms,
                KeyboardRigInWorld = keyboardWorldPayload,
                TvInKeyboardRig = tvInKeyboardPayload,
                TagTransforms = transforms,
                FailureReasons = distinctFailures,
                Warnings = warnings.Distinct(StringComparer.Ordinal).ToArray(),
                RawFramesPersisted = false,
                Simulation = false
            };
        }

        private static void RequireMinimumSamples(
            IReadOnlyDictionary<int, List<TagObservation>> groups,
            int tagId,
            int required,
            ICollection<string> failures)
        {
            int count = groups[tagId].Count;
            if (count < required)
            {
                failures.Add($"TAG_SAMPLES_INSUFFICIENT:id={tagId},required={required},accepted={count}");
            }
        }

        private static TagEstimate EstimateTag(
            int tagId,
            IReadOnlyList<TagObservation> observations)
        {
            Vector3 position = MedianPosition(observations);
            Quaternion rotation = QuaternionMedoid(
                observations.Select(value => value.WorldRotation));
            float positionSum = 0f;
            float rotationSum = 0f;
            foreach (TagObservation observation in observations)
            {
                positionSum += (observation.WorldPosition - position).sqrMagnitude;
                float angle = Quaternion.Angle(rotation, observation.WorldRotation);
                rotationSum += angle * angle;
            }
            return new TagEstimate(
                tagId,
                position,
                rotation,
                Mathf.Sqrt(positionSum / observations.Count),
                Mathf.Sqrt(rotationSum / observations.Count));
        }

        private static int RemoveIsolatedPositionOutliers(
            List<TagObservation> observations,
            float maximumPositionRmsMeters)
        {
            if (observations.Count < 5)
            {
                return 0;
            }

            Vector3 centre = MedianPosition(observations);
            float[] distances = observations
                .Select(value => Vector3.Distance(value.WorldPosition, centre))
                .ToArray();
            float medianDistance = Median(distances);
            float medianAbsoluteDeviation = Median(
                distances.Select(value => Mathf.Abs(value - medianDistance)));
            float cutoff = medianDistance + Mathf.Max(
                maximumPositionRmsMeters,
                PositionOutlierMadMultiplier * medianAbsoluteDeviation);

            List<TagObservation> inliers = observations
                .Where((_, index) => distances[index] <= cutoff)
                .ToList();
            int rejected = observations.Count - inliers.Count;
            if (rejected == 0 || rejected * 3 > observations.Count || inliers.Count < 3)
            {
                return 0;
            }

            observations.Clear();
            observations.AddRange(inliers);
            return rejected;
        }

        private static Vector3 MedianPosition(IReadOnlyList<TagObservation> observations)
        {
            return new Vector3(
                Median(observations.Select(value => value.WorldPosition.x)),
                Median(observations.Select(value => value.WorldPosition.y)),
                Median(observations.Select(value => value.WorldPosition.z)));
        }

        private static float Median(IEnumerable<float> values)
        {
            float[] ordered = values.OrderBy(value => value).ToArray();
            int middle = ordered.Length / 2;
            return ordered.Length % 2 == 0
                ? (ordered[middle - 1] + ordered[middle]) * 0.5f
                : ordered[middle];
        }

        private static Quaternion QuaternionMedoid(IEnumerable<Quaternion> values)
        {
            Quaternion[] rotations = values.ToArray();
            Quaternion best = rotations[0];
            float bestCost = float.PositiveInfinity;
            foreach (Quaternion candidate in rotations)
            {
                float cost = 0f;
                foreach (Quaternion rotation in rotations)
                {
                    float angle = Quaternion.Angle(candidate, rotation);
                    cost += angle * angle;
                }
                if (cost < bestCost)
                {
                    best = candidate;
                    bestCost = cost;
                }
            }
            return best;
        }

        private static bool TryCreateRoomFrame(
            Vector3 origin,
            Vector3 xDirection,
            Vector3 approximateUp,
            out Pose pose)
        {
            pose = default;
            if (xDirection.sqrMagnitude < 0.000001f)
            {
                return false;
            }
            Vector3 xAxis = xDirection.normalized;
            Vector3 yAxis = approximateUp - Vector3.Dot(approximateUp, xAxis) * xAxis;
            if (yAxis.sqrMagnitude < 0.000001f)
            {
                return false;
            }
            yAxis.Normalize();
            Vector3 zAxis = Vector3.Cross(xAxis, yAxis);
            if (zAxis.sqrMagnitude < 0.000001f)
            {
                return false;
            }
            zAxis.Normalize();
            yAxis = Vector3.Cross(zAxis, xAxis).normalized;
            pose = new Pose(origin, Quaternion.LookRotation(zAxis, yAxis));
            return true;
        }

        private static bool TrySolveTvFrame(
            IReadOnlyDictionary<int, TagEstimate> estimates,
            IReadOnlyCollection<int> usableIds,
            AprilTagRigConfiguration configuration,
            out Pose tvPose,
            out float planarityRms)
        {
            tvPose = default;
            planarityRms = 0f;
            Vector3? topLeft = ValueFor(configuration.TvTopLeftTagId);
            Vector3? topRight = ValueFor(configuration.TvTopRightTagId);
            Vector3? bottomRight = ValueFor(configuration.TvBottomRightTagId);
            Vector3? bottomLeft = ValueFor(configuration.TvBottomLeftTagId);

            if (!topLeft.HasValue)
            {
                topLeft = topRight + bottomLeft - bottomRight;
            }
            else if (!topRight.HasValue)
            {
                topRight = topLeft + bottomRight - bottomLeft;
            }
            else if (!bottomRight.HasValue)
            {
                bottomRight = topRight + bottomLeft - topLeft;
            }
            else if (!bottomLeft.HasValue)
            {
                bottomLeft = topLeft + bottomRight - topRight;
            }

            if (!topLeft.HasValue || !topRight.HasValue ||
                !bottomRight.HasValue || !bottomLeft.HasValue)
            {
                return false;
            }

            Vector3 tl = topLeft.Value;
            Vector3 tr = topRight.Value;
            Vector3 br = bottomRight.Value;
            Vector3 bl = bottomLeft.Value;
            Vector3 origin = (tl + tr + br + bl) * 0.25f;
            Vector3 xDirection = ((tr + br) - (tl + bl)) * 0.5f;
            Vector3 yDirection = ((tl + tr) - (bl + br)) * 0.5f;
            if (!TryCreateRoomFrame(origin, xDirection, yDirection, out tvPose))
            {
                return false;
            }

            Vector3 normal = tvPose.rotation * Vector3.forward;
            float squared = 0f;
            foreach (int id in usableIds)
            {
                float distance = Vector3.Dot(estimates[id].Position - origin, normal);
                squared += distance * distance;
            }
            planarityRms = Mathf.Sqrt(squared / usableIds.Count);
            return true;

            Vector3? ValueFor(int id)
            {
                return usableIds.Contains(id) ? estimates[id].Position : (Vector3?)null;
            }
        }

        private static Pose RelativePose(Pose origin, Pose target)
        {
            Quaternion inverse = Quaternion.Inverse(origin.rotation);
            return new Pose(
                inverse * (target.position - origin.position),
                inverse * target.rotation);
        }

        private static CalibrationPosePayload ToPayload(Pose pose)
        {
            return new CalibrationPosePayload
            {
                Position = new CalibrationVector3Payload
                {
                    X = pose.position.x,
                    Y = pose.position.y,
                    Z = pose.position.z
                },
                Rotation = new CalibrationQuaternionPayload
                {
                    X = pose.rotation.x,
                    Y = pose.rotation.y,
                    Z = pose.rotation.z,
                    W = pose.rotation.w
                }
            };
        }

        private readonly struct TagEstimate
        {
            public int TagId { get; }
            public Vector3 Position { get; }
            public Quaternion Rotation { get; }
            public float PositionRmsMeters { get; }
            public float RotationRmsDegrees { get; }

            public TagEstimate(
                int tagId,
                Vector3 position,
                Quaternion rotation,
                float positionRmsMeters,
                float rotationRmsDegrees)
            {
                TagId = tagId;
                Position = position;
                Rotation = rotation;
                PositionRmsMeters = positionRmsMeters;
                RotationRmsDegrees = rotationRmsDegrees;
            }

            public static TagEstimate Empty(int tagId)
            {
                return new TagEstimate(
                    tagId,
                    Vector3.zero,
                    Quaternion.identity,
                    0f,
                    0f);
            }
        }
    }
}
