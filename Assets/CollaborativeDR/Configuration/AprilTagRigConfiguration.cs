using System;
using UnityEngine;

namespace CollaborativeDR.Configuration
{
    [CreateAssetMenu(
        fileName = "AprilTagRigConfiguration",
        menuName = "Collaborative DR/AprilTag Rig Configuration")]
    public sealed class AprilTagRigConfiguration : ScriptableObject
    {
        public const string RequiredTagFamily = "tagStandard41h12";
        public const float LockedTagSizeMeters = 0.0567f;
        public const float LockedKeyboardSpacingMeters = 0.40f;
        public const int LockedKeyboardLeftTagId = 1;
        public const int LockedKeyboardRightTagId = 2;

        [Header("Printed tag geometry")]
        [SerializeField] private string tagFamily = RequiredTagFamily;
        [SerializeField, Min(0.001f)] private float tagSizeMeters = LockedTagSizeMeters;
        [SerializeField] private int keyboardLeftTagId = LockedKeyboardLeftTagId;
        [SerializeField] private int keyboardRightTagId = LockedKeyboardRightTagId;
        [SerializeField] private int tvTopLeftTagId = 4;
        [SerializeField] private int tvTopRightTagId = 5;
        [SerializeField] private int tvBottomRightTagId = 6;
        [SerializeField] private int tvBottomLeftTagId = 3;
        [SerializeField, Min(0.01f)] private float keyboardSpacingMeters =
            LockedKeyboardSpacingMeters;

        [Header("Sampling")]
        [SerializeField, Min(1f)] private float sampleDurationSeconds = 6f;
        [SerializeField, Range(0.03f, 0.5f)] private float detectionIntervalSeconds = 0.1f;
        [SerializeField, Range(1, 4)] private int detectorDecimation = 1;
        [SerializeField, Range(3, 4)] private int minimumVisibleTvTags = 3;
        [SerializeField, Min(2)] private int minimumObservationsPerRequiredTag = 5;
        [SerializeField, Min(0.05f)] private float maximumFrameAgeSeconds = 0.35f;

        [Header("Provisional pilot thresholds")]
        [SerializeField, Min(0.001f)] private float maximumSequentialJumpMeters = 0.12f;
        [SerializeField, Min(0.001f)] private float maximumPositionRmsMeters = 0.025f;
        [SerializeField, Min(0.1f)] private float maximumRotationRmsDegrees = 4f;
        [SerializeField, Min(0.001f)] private float keyboardSpacingToleranceMeters = 0.04f;
        [SerializeField, Min(0.001f)] private float maximumTvPlanarityRmsMeters = 0.025f;
        [SerializeField, Min(0.001f)] private float maximumCrossHeadsetPositionMeters = 0.05f;
        [SerializeField, Min(0.1f)] private float maximumCrossHeadsetRotationDegrees = 5f;

        [Header("Calibration-only visualization")]
        [SerializeField] private bool flipDetectedCornerX;
        [SerializeField] private bool flipDetectedCornerY = true;
        [SerializeField, Min(0f)] private float outlineSurfaceOffsetMeters = 0.002f;
        [SerializeField, Min(0.05f)] private float outlineLifetimeSeconds = 0.35f;

        public string TagFamily => tagFamily;
        public float TagSizeMeters => tagSizeMeters;
        public int KeyboardLeftTagId => keyboardLeftTagId;
        public int KeyboardRightTagId => keyboardRightTagId;
        public int TvTopLeftTagId => tvTopLeftTagId;
        public int TvTopRightTagId => tvTopRightTagId;
        public int TvBottomRightTagId => tvBottomRightTagId;
        public int TvBottomLeftTagId => tvBottomLeftTagId;
        public float KeyboardSpacingMeters => keyboardSpacingMeters;
        public float SampleDurationSeconds => sampleDurationSeconds;
        public float DetectionIntervalSeconds => detectionIntervalSeconds;
        public int DetectorDecimation => detectorDecimation;
        public int MinimumVisibleTvTags => minimumVisibleTvTags;
        public int MinimumObservationsPerRequiredTag => minimumObservationsPerRequiredTag;
        public float MaximumFrameAgeSeconds => maximumFrameAgeSeconds;
        public float MaximumSequentialJumpMeters => maximumSequentialJumpMeters;
        public float MaximumPositionRmsMeters => maximumPositionRmsMeters;
        public float MaximumRotationRmsDegrees => maximumRotationRmsDegrees;
        public float KeyboardSpacingToleranceMeters => keyboardSpacingToleranceMeters;
        public float MaximumTvPlanarityRmsMeters => maximumTvPlanarityRmsMeters;
        public float MaximumCrossHeadsetPositionMeters => maximumCrossHeadsetPositionMeters;
        public float MaximumCrossHeadsetRotationDegrees => maximumCrossHeadsetRotationDegrees;
        public bool FlipDetectedCornerX => flipDetectedCornerX;
        public bool FlipDetectedCornerY => flipDetectedCornerY;
        public float OutlineSurfaceOffsetMeters => outlineSurfaceOffsetMeters;
        public float OutlineLifetimeSeconds => outlineLifetimeSeconds;

        public int[] RequiredTagIds => new[]
        {
            keyboardLeftTagId,
            keyboardRightTagId,
            tvTopLeftTagId,
            tvTopRightTagId,
            tvBottomRightTagId,
            tvBottomLeftTagId
        };

        public int[] TvTagIds => new[]
        {
            tvTopLeftTagId,
            tvTopRightTagId,
            tvBottomRightTagId,
            tvBottomLeftTagId
        };

        public void ValidateOrThrow()
        {
            if (!string.Equals(tagFamily, RequiredTagFamily, StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    $"Only {RequiredTagFamily} is supported; configured family is {tagFamily}.");
            }

            if (Mathf.Abs(tagSizeMeters - LockedTagSizeMeters) > 0.00001f)
            {
                throw new InvalidOperationException(
                    $"The measured detection-corner tag size must be {LockedTagSizeMeters:F3} m.");
            }

            if (Mathf.Abs(keyboardSpacingMeters - LockedKeyboardSpacingMeters) > 0.00001f)
            {
                throw new InvalidOperationException(
                    $"The keyboard tag-centre spacing must be {LockedKeyboardSpacingMeters:F2} m.");
            }

            if (keyboardLeftTagId != LockedKeyboardLeftTagId ||
                keyboardRightTagId != LockedKeyboardRightTagId)
            {
                throw new InvalidOperationException(
                    $"The mounted keyboard layout requires tag {LockedKeyboardLeftTagId} on " +
                    $"the left and tag {LockedKeyboardRightTagId} on the right.");
            }

            int[] ids = RequiredTagIds;
            Array.Sort(ids);
            for (int index = 0; index < ids.Length; index++)
            {
                int expected = index + 1;
                if (ids[index] != expected)
                {
                    throw new InvalidOperationException(
                        "The final rig must contain each AprilTag ID from 1 through 6 exactly once.");
                }
            }
        }
    }
}
