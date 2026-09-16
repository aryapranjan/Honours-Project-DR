using System;
using UnityEngine;

namespace CollaborativeDR.DiminishedReality
{
    public enum DiminishedRealityRigAnchor
    {
        KeyboardRig,
        TvTagFrame
    }

    public enum DiminishedRealityGeometryKind
    {
        FlatQuad,
        OpenBottomBox
    }

    [CreateAssetMenu(
        fileName = "DiminishedRealityTargetProfile",
        menuName = "Collaborative DR/Diminished Reality Target Profile")]
    public sealed class DiminishedRealityTargetProfile : ScriptableObject
    {
        public const string Phase6ProfileVersion = "PHASE6_TEST_V1";

        [Header("Identity")]
        [SerializeField] private string targetId = "KEYBOARD";
        [SerializeField] private string profileVersion = Phase6ProfileVersion;
        [SerializeField] private DiminishedRealityRigAnchor rigAnchor =
            DiminishedRealityRigAnchor.KeyboardRig;

        [Header("Rig-relative placement")]
        [SerializeField] private Vector3 localPositionMeters;
        [SerializeField] private Vector3 localEulerDegrees;
        [SerializeField] private Vector2 outerDimensionsMeters = new Vector2(0.31f, 0.115f);
        [SerializeField] private DiminishedRealityGeometryKind geometryKind =
            DiminishedRealityGeometryKind.FlatQuad;
        [SerializeField, Min(0f)] private float coverHeightMeters;

        [Header("Replacement appearance")]
        [SerializeField] private Material replacementMaterial;
        [SerializeField] private Texture2D replacementTexture;
        [SerializeField, Min(0f)] private float featherMeters = 0.003f;
        [SerializeField, Range(0f, 2f)] private float brightness = 1f;
        [SerializeField, Range(0f, 2f)] private float contrast = 1f;
        [SerializeField] private Color tint = Color.white;
        [SerializeField, Range(0f, 1f)] private float opacity = 1f;

        [Header("Pilot gate")]
        [SerializeField, Min(1)] private int performanceTargetFps = 72;
        [SerializeField] private Color debugColour = Color.cyan;

        public string TargetId => targetId;
        public string ProfileVersion => profileVersion;
        public DiminishedRealityRigAnchor RigAnchor => rigAnchor;
        public Vector3 LocalPositionMeters => localPositionMeters;
        public Quaternion LocalRotation => Quaternion.Euler(localEulerDegrees);
        public Vector2 OuterDimensionsMeters => outerDimensionsMeters;
        public DiminishedRealityGeometryKind GeometryKind => geometryKind;
        public float CoverHeightMeters => coverHeightMeters;
        public Material ReplacementMaterial => replacementMaterial;
        public Texture2D ReplacementTexture => replacementTexture;
        public float FeatherMeters => featherMeters;
        public float Brightness => brightness;
        public float Contrast => contrast;
        public Color Tint => tint;
        public float Opacity => opacity;
        public int PerformanceTargetFps => performanceTargetFps;
        public Color DebugColour => debugColour;

        public void Configure(
            string configuredTargetId,
            DiminishedRealityRigAnchor configuredAnchor,
            Vector3 configuredLocalPositionMeters,
            Vector3 configuredLocalEulerDegrees,
            Vector2 configuredOuterDimensionsMeters,
            float configuredFeatherMeters,
            Material configuredMaterial,
            Color configuredTint,
            int configuredPerformanceTargetFps = 72,
            DiminishedRealityGeometryKind configuredGeometryKind =
                DiminishedRealityGeometryKind.FlatQuad,
            float configuredCoverHeightMeters = 0f)
        {
            targetId = configuredTargetId?.Trim().ToUpperInvariant() ?? string.Empty;
            profileVersion = Phase6ProfileVersion;
            rigAnchor = configuredAnchor;
            localPositionMeters = configuredLocalPositionMeters;
            localEulerDegrees = configuredLocalEulerDegrees;
            outerDimensionsMeters = configuredOuterDimensionsMeters;
            geometryKind = configuredGeometryKind;
            coverHeightMeters = configuredCoverHeightMeters;
            featherMeters = configuredFeatherMeters;
            replacementMaterial = configuredMaterial;
            replacementTexture = null;
            brightness = 1f;
            contrast = 1f;
            tint = configuredTint;
            opacity = 1f;
            performanceTargetFps = configuredPerformanceTargetFps;
            debugColour = configuredTargetId == "TV" ? Color.magenta : Color.cyan;
            ValidateOrThrow();
        }

        public void ValidateOrThrow()
        {
            if (targetId != "TV" && targetId != "KEYBOARD")
            {
                throw new InvalidOperationException(
                    "A Phase 6 DR target ID must be TV or KEYBOARD.");
            }
            if (!string.Equals(
                    profileVersion,
                    Phase6ProfileVersion,
                    StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    $"The Phase 6 profile version must be {Phase6ProfileVersion}.");
            }
            if (outerDimensionsMeters.x <= 0f || outerDimensionsMeters.y <= 0f)
            {
                throw new InvalidOperationException(
                    $"{targetId} outer dimensions must both be positive.");
            }
            if (featherMeters < 0f ||
                featherMeters * 2f >= Mathf.Min(
                    outerDimensionsMeters.x,
                    outerDimensionsMeters.y))
            {
                throw new InvalidOperationException(
                    $"{targetId} feather must remain inside the final outer mask edges.");
            }
            if (geometryKind == DiminishedRealityGeometryKind.OpenBottomBox &&
                coverHeightMeters <= 0f)
            {
                throw new InvalidOperationException(
                    $"{targetId} open-bottom cover height must be positive.");
            }
            if (geometryKind == DiminishedRealityGeometryKind.OpenBottomBox &&
                featherMeters >= coverHeightMeters)
            {
                throw new InvalidOperationException(
                    $"{targetId} feather must be smaller than its cover height.");
            }
            if (opacity < 0f || opacity > 1f)
            {
                throw new InvalidOperationException(
                    $"{targetId} opacity must be between zero and one.");
            }
            if (performanceTargetFps != 72)
            {
                throw new InvalidOperationException(
                    "The provisional Phase 6 performance target must remain 72 FPS.");
            }
        }
    }
}
