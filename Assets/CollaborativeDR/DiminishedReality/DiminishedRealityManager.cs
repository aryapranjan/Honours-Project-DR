using System;
using System.Collections.Generic;
using CollaborativeDR.Protocol;
using UnityEngine;
using UnityEngine.Rendering;

namespace CollaborativeDR.DiminishedReality
{
    [DisallowMultipleComponent]
    public sealed class DiminishedRealityManager : MonoBehaviour
    {
        public const string MaskShaderName = "CollaborativeDR/FeatheredUnlitMask";

        [SerializeField] private DiminishedRealityTargetProfile[] profiles =
            Array.Empty<DiminishedRealityTargetProfile>();

        private readonly Dictionary<string, DiminishedRealityTargetProfile> profilesById =
            new Dictionary<string, DiminishedRealityTargetProfile>(StringComparer.Ordinal);
        private GameObject geometryRoot;
        private MeshFilter maskFilter;
        private MeshRenderer maskRenderer;
        private GameObject debugRoot;
        private Material runtimeFallbackMaterial;
        private Material runtimeDebugMaterial;
        private Mesh runtimeQuadMesh;
        private Mesh runtimeOpenBottomBoxMesh;
        private float openBottomBoxFeatherFraction = -1f;
        private MaterialPropertyBlock propertyBlock;
        private DiminishedRealityTargetProfile activeProfile;
        private string requestedAction = "HIDE";
        private string requestedTarget = string.Empty;
        private string actualState = "HIDDEN";
        private string calibrationAttemptId = string.Empty;
        private string calibrationStatus = "NOT_RUN";
        private string currentReason = string.Empty;
        private bool requestedEnabled;
        private bool prepared;
        private bool debugBoundsRequested;
        private float visibleSampleSeconds;
        private int visibleFrameCount;

        public bool IsMaskVisible =>
            geometryRoot != null && geometryRoot.activeInHierarchy &&
            maskRenderer != null && maskRenderer.enabled;

        public bool IsPrepared => prepared;

        public void Configure(DiminishedRealityTargetProfile[] configuredProfiles)
        {
            profiles = configuredProfiles ?? Array.Empty<DiminishedRealityTargetProfile>();
            RebuildProfileIndex();
        }

        public bool PrepareTrial(
            bool enableDiminishedReality,
            string targetId,
            string requiredProfileVersion,
            string requiredCalibrationStatus,
            CalibrationReportPayload calibrationReport,
            out string reason)
        {
            requestedAction = "PREPARE";
            requestedEnabled = enableDiminishedReality;
            requestedTarget = NormalizeTarget(targetId);
            calibrationStatus = requiredCalibrationStatus ?? "NOT_RUN";
            calibrationAttemptId = calibrationReport?.AttemptId ?? string.Empty;
            currentReason = string.Empty;
            HideInternal(true);

            if (!enableDiminishedReality)
            {
                prepared = true;
                actualState = "NO_DR";
                debugBoundsRequested = false;
                reason = string.Empty;
                return true;
            }

            if (!TryGetProfile(requestedTarget, out DiminishedRealityTargetProfile profile))
            {
                reason = $"No DR profile is configured for {requestedTarget}.";
                return Fail(reason);
            }
            if (!string.Equals(
                    profile.ProfileVersion,
                    requiredProfileVersion,
                    StringComparison.Ordinal))
            {
                reason =
                    $"DR profile mismatch: app has {profile.ProfileVersion}, server requires " +
                    $"{requiredProfileVersion}.";
                return Fail(reason);
            }
            if (calibrationStatus != "PASS" && calibrationStatus != "OVERRIDDEN")
            {
                reason = "A passing calibration or recorded override is required for DR.";
                return Fail(reason);
            }
            if (!TryResolveWorldPose(profile, calibrationReport, out Pose pose, out reason))
            {
                return Fail(reason);
            }

            try
            {
                profile.ValidateOrThrow();
                ConfigureGeometry(profile, pose);
            }
            catch (Exception exception)
            {
                reason = exception.Message;
                return Fail(reason);
            }

            activeProfile = profile;
            prepared = true;
            actualState = "PREPARED";
            debugBoundsRequested = false;
            SetDebugBoundsInternal(false);
            reason = string.Empty;
            return true;
        }

        public bool Show(out string reason)
        {
            requestedAction = "SHOW";
            if (!prepared)
            {
                reason = "DR has not been prepared.";
                return Fail(reason, false);
            }
            if (!requestedEnabled)
            {
                HideInternal(false);
                actualState = "NO_DR";
                reason = string.Empty;
                return true;
            }
            if (geometryRoot == null || maskRenderer == null || activeProfile == null)
            {
                reason = "Prepared DR geometry is missing.";
                return Fail(reason, false);
            }

            geometryRoot.SetActive(true);
            maskRenderer.enabled = true;
            SetDebugBoundsInternal(false);
            visibleSampleSeconds = 0f;
            visibleFrameCount = 0;
            actualState = "VISIBLE";
            currentReason = string.Empty;
            reason = string.Empty;
            return true;
        }

        public void Hide(bool clearPrepared = true)
        {
            requestedAction = "HIDE";
            requestedEnabled = false;
            HideInternal(clearPrepared);
            actualState = "HIDDEN";
            currentReason = string.Empty;
        }

        public bool Reveal(out string reason)
        {
            requestedAction = "REVEAL";
            if (!prepared || !requestedEnabled || geometryRoot == null)
            {
                reason = "A DR target must be prepared before it can be revealed.";
                return Fail(reason, false);
            }

            maskRenderer.enabled = false;
            SetDebugBoundsInternal(debugBoundsRequested);
            actualState = "REVEALED";
            currentReason = string.Empty;
            reason = string.Empty;
            return true;
        }

        public void SetDebugBounds(bool enabled)
        {
            requestedAction = "SET_DEBUG_BOUNDS";
            debugBoundsRequested = enabled;
            SetDebugBoundsInternal(enabled && prepared && requestedEnabled);
        }

        public void EnterFailSafe(string reason)
        {
            requestedAction = "FAIL_SAFE";
            requestedEnabled = false;
            HideInternal(true);
            actualState = "FAIL_SAFE";
            currentReason = reason ?? "Unknown fail-safe reason.";
        }

        public DiminishedRealityStateReportPayload ReportState(
            string actionOverride = null)
        {
            float? measuredFps = visibleSampleSeconds > 0.25f
                ? visibleFrameCount / visibleSampleSeconds
                : (float?)null;
            int targetFps = activeProfile?.PerformanceTargetFps ?? 72;
            bool performanceEvaluated = visibleSampleSeconds >= 2f;
            bool? performancePass = performanceEvaluated && measuredFps.HasValue
                ? measuredFps.Value >= targetFps - 0.5f
                : (bool?)null;
            bool geometryActive = IsMaskVisible;
            bool stateMatches = StateMatchesRequest(geometryActive);
            return new DiminishedRealityStateReportPayload
            {
                RequestedAction = string.IsNullOrWhiteSpace(actionOverride)
                    ? requestedAction
                    : actionOverride,
                Target = string.IsNullOrWhiteSpace(requestedTarget)
                    ? null
                    : requestedTarget,
                ProfileVersion = activeProfile?.ProfileVersion ??
                                 DiminishedRealityTargetProfile.Phase6ProfileVersion,
                RequestedEnabled = requestedEnabled,
                ActualState = actualState,
                Prepared = prepared,
                MaskVisible = IsMaskVisible,
                DebugBoundsVisible = debugRoot != null && debugRoot.activeInHierarchy,
                GeometryActive = geometryActive,
                CalibrationAttemptId = string.IsNullOrWhiteSpace(calibrationAttemptId)
                    ? null
                    : calibrationAttemptId,
                CalibrationStatus = calibrationStatus,
                DrStateMatches = stateMatches,
                MeasuredFps = measuredFps,
                PerformanceTargetFps = targetFps,
                PerformanceGateEvaluated = performanceEvaluated,
                PerformanceGatePass = performancePass,
                Reason = string.IsNullOrWhiteSpace(currentReason) ? null : currentReason
            };
        }

        public static bool TryResolveWorldPose(
            DiminishedRealityTargetProfile profile,
            CalibrationReportPayload report,
            out Pose worldPose,
            out string reason)
        {
            worldPose = default;
            if (profile == null)
            {
                reason = "The DR target profile is missing.";
                return false;
            }
            if (report?.KeyboardRigInWorld == null)
            {
                reason = "The calibration report has no keyboard-rig world transform.";
                return false;
            }

            Pose keyboardInWorld = FromPayload(report.KeyboardRigInWorld);
            Pose anchorInWorld = keyboardInWorld;
            if (profile.RigAnchor == DiminishedRealityRigAnchor.TvTagFrame)
            {
                if (report.TvInKeyboardRig == null)
                {
                    reason = "The calibration report has no TV transform.";
                    return false;
                }
                anchorInWorld = Compose(
                    keyboardInWorld,
                    FromPayload(report.TvInKeyboardRig));
            }

            worldPose = Compose(
                anchorInWorld,
                new Pose(profile.LocalPositionMeters, profile.LocalRotation));
            reason = string.Empty;
            return true;
        }

        private void Awake()
        {
            RebuildProfileIndex();
        }

        private void Update()
        {
            if (IsMaskVisible)
            {
                visibleSampleSeconds += Time.unscaledDeltaTime;
                visibleFrameCount += 1;
            }
        }

        private void RebuildProfileIndex()
        {
            profilesById.Clear();
            foreach (DiminishedRealityTargetProfile profile in profiles)
            {
                if (profile == null)
                {
                    continue;
                }
                profile.ValidateOrThrow();
                if (!profilesById.TryAdd(profile.TargetId, profile))
                {
                    throw new InvalidOperationException(
                        $"Duplicate DR profile for {profile.TargetId}.");
                }
            }
        }

        private bool TryGetProfile(
            string targetId,
            out DiminishedRealityTargetProfile profile)
        {
            if (profilesById.Count != profiles.Length)
            {
                RebuildProfileIndex();
            }
            return profilesById.TryGetValue(targetId, out profile);
        }

        private void ConfigureGeometry(
            DiminishedRealityTargetProfile profile,
            Pose worldPose)
        {
            EnsureGeometry();
            Material material = profile.ReplacementMaterial;
            if (material == null)
            {
                Shader shader = Shader.Find(MaskShaderName);
                if (shader == null)
                {
                    throw new InvalidOperationException(
                        $"Required DR shader is missing: {MaskShaderName}.");
                }
                runtimeFallbackMaterial ??= new Material(shader)
                {
                    name = "[Runtime] Phase 6 DR Mask Material",
                    hideFlags = HideFlags.DontSave
                };
                material = runtimeFallbackMaterial;
            }

            geometryRoot.transform.SetPositionAndRotation(
                worldPose.position,
                worldPose.rotation);
            maskFilter.sharedMesh = ResolveMaskMesh(profile);
            geometryRoot.transform.localScale = new Vector3(
                profile.OuterDimensionsMeters.x,
                profile.OuterDimensionsMeters.y,
                profile.GeometryKind == DiminishedRealityGeometryKind.OpenBottomBox
                    ? profile.CoverHeightMeters
                    : 1f);
            geometryRoot.SetActive(true);
            maskRenderer.sharedMaterial = material;
            maskRenderer.enabled = false;

            propertyBlock ??= new MaterialPropertyBlock();
            propertyBlock.Clear();
            propertyBlock.SetTexture(
                "_MainTex",
                profile.ReplacementTexture != null
                    ? profile.ReplacementTexture
                    : Texture2D.whiteTexture);
            propertyBlock.SetFloat(
                "_UseTexture",
                profile.ReplacementTexture != null ? 1f : 0f);
            propertyBlock.SetColor("_Tint", profile.Tint);
            propertyBlock.SetFloat("_Brightness", profile.Brightness);
            propertyBlock.SetFloat("_Contrast", profile.Contrast);
            propertyBlock.SetFloat("_Opacity", profile.Opacity);
            propertyBlock.SetVector("_FeatherUv", new Vector4(
                Mathf.Clamp(
                    profile.FeatherMeters / profile.OuterDimensionsMeters.x,
                    0f,
                    0.49f),
                Mathf.Clamp(
                    profile.FeatherMeters / profile.OuterDimensionsMeters.y,
                    0f,
                    0.49f),
                0f,
                0f));
            maskRenderer.SetPropertyBlock(propertyBlock);
            ConfigureDebugBounds(profile.DebugColour);
        }

        private void EnsureGeometry()
        {
            if (geometryRoot != null)
            {
                return;
            }

            geometryRoot = new GameObject("[DR] Replacement Mask");
            geometryRoot.transform.SetParent(transform, true);
            maskFilter = geometryRoot.AddComponent<MeshFilter>();
            maskRenderer = geometryRoot.AddComponent<MeshRenderer>();
            maskRenderer.shadowCastingMode = ShadowCastingMode.Off;
            maskRenderer.receiveShadows = false;
            maskRenderer.lightProbeUsage = LightProbeUsage.Off;
            maskRenderer.reflectionProbeUsage = ReflectionProbeUsage.Off;
            maskRenderer.motionVectorGenerationMode = MotionVectorGenerationMode.ForceNoMotion;
        }

        private Mesh ResolveMaskMesh(DiminishedRealityTargetProfile profile)
        {
            if (profile.GeometryKind == DiminishedRealityGeometryKind.FlatQuad)
            {
                runtimeQuadMesh ??= CreateQuadMesh();
                return runtimeQuadMesh;
            }

            float featherFraction = Mathf.Clamp01(
                profile.FeatherMeters / profile.CoverHeightMeters);
            if (runtimeOpenBottomBoxMesh == null ||
                !Mathf.Approximately(openBottomBoxFeatherFraction, featherFraction))
            {
                if (runtimeOpenBottomBoxMesh != null)
                {
                    DestroyRuntimeObject(runtimeOpenBottomBoxMesh);
                }
                runtimeOpenBottomBoxMesh = CreateOpenBottomBoxMesh(featherFraction);
                openBottomBoxFeatherFraction = featherFraction;
            }
            return runtimeOpenBottomBoxMesh;
        }

        private void ConfigureDebugBounds(Color colour)
        {
            if (debugRoot == null)
            {
                debugRoot = new GameObject("[DR] Researcher Debug Bounds");
                debugRoot.transform.SetParent(geometryRoot.transform, false);
                CreateDebugLine(
                    "Outline",
                    new[]
                    {
                        new Vector3(-0.5f, -0.5f, -0.002f),
                        new Vector3(-0.5f, 0.5f, -0.002f),
                        new Vector3(0.5f, 0.5f, -0.002f),
                        new Vector3(0.5f, -0.5f, -0.002f),
                        new Vector3(-0.5f, -0.5f, -0.002f)
                    });
                CreateDebugLine(
                    "Centre Horizontal",
                    new[]
                    {
                        new Vector3(-0.04f, 0f, -0.002f),
                        new Vector3(0.04f, 0f, -0.002f)
                    });
                CreateDebugLine(
                    "Centre Vertical",
                    new[]
                    {
                        new Vector3(0f, -0.04f, -0.002f),
                        new Vector3(0f, 0.04f, -0.002f)
                    });
            }

            foreach (LineRenderer line in debugRoot.GetComponentsInChildren<LineRenderer>())
            {
                line.startColor = colour;
                line.endColor = colour;
            }
            SetDebugBoundsInternal(debugBoundsRequested && prepared && requestedEnabled);
        }

        private void CreateDebugLine(string name, IReadOnlyList<Vector3> positions)
        {
            GameObject child = new GameObject(name);
            child.transform.SetParent(debugRoot.transform, false);
            LineRenderer line = child.AddComponent<LineRenderer>();
            line.useWorldSpace = false;
            line.loop = false;
            line.positionCount = positions.Count;
            for (int index = 0; index < positions.Count; index += 1)
            {
                line.SetPosition(index, positions[index]);
            }
            line.widthMultiplier = 0.004f;
            line.numCapVertices = 2;
            line.numCornerVertices = 2;
            if (runtimeDebugMaterial == null)
            {
                Shader shader = Shader.Find("Sprites/Default") ??
                                Shader.Find("Unlit/Color");
                if (shader != null)
                {
                    runtimeDebugMaterial = new Material(shader)
                    {
                        name = "[Runtime] Phase 6 Debug Material",
                        hideFlags = HideFlags.DontSave
                    };
                }
            }
            line.sharedMaterial = runtimeDebugMaterial;
        }

        private void SetDebugBoundsInternal(bool enabled)
        {
            if (debugRoot != null)
            {
                debugRoot.SetActive(enabled);
            }
        }

        private void HideInternal(bool clearPrepared)
        {
            if (maskRenderer != null)
            {
                maskRenderer.enabled = false;
            }
            if (geometryRoot != null)
            {
                geometryRoot.SetActive(false);
            }
            SetDebugBoundsInternal(false);
            visibleSampleSeconds = 0f;
            visibleFrameCount = 0;
            if (clearPrepared)
            {
                prepared = false;
                activeProfile = null;
            }
        }

        private bool StateMatchesRequest(bool geometryActive)
        {
            switch (requestedAction)
            {
                case "PREPARE":
                    return prepared && !geometryActive &&
                           (requestedEnabled ? activeProfile != null : activeProfile == null);
                case "SHOW":
                    return requestedEnabled ? geometryActive : !geometryActive;
                case "HIDE":
                case "REVEAL":
                case "FAIL_SAFE":
                    return !geometryActive;
                case "SET_DEBUG_BOUNDS":
                case "REPORT":
                    return !requestedEnabled || prepared;
                default:
                    return false;
            }
        }

        private bool Fail(string reason, bool clearPrepared = true)
        {
            currentReason = reason ?? "Unknown diminished-reality failure.";
            actualState = "ERROR";
            HideInternal(clearPrepared);
            return false;
        }

        private static string NormalizeTarget(string targetId)
        {
            return targetId?.Trim().ToUpperInvariant() ?? string.Empty;
        }

        private static Pose FromPayload(CalibrationPosePayload payload)
        {
            return new Pose(
                new Vector3(
                    payload.Position.X,
                    payload.Position.Y,
                    payload.Position.Z),
                new Quaternion(
                    payload.Rotation.X,
                    payload.Rotation.Y,
                    payload.Rotation.Z,
                    payload.Rotation.W));
        }

        private static Pose Compose(Pose parent, Pose child)
        {
            return new Pose(
                parent.position + parent.rotation * child.position,
                parent.rotation * child.rotation);
        }

        private static Mesh CreateQuadMesh()
        {
            Mesh mesh = new Mesh
            {
                name = "[Runtime] Phase 6 Unit Quad",
                hideFlags = HideFlags.DontSave,
                vertices = new[]
                {
                    new Vector3(-0.5f, -0.5f, 0f),
                    new Vector3(0.5f, -0.5f, 0f),
                    new Vector3(0.5f, 0.5f, 0f),
                    new Vector3(-0.5f, 0.5f, 0f)
                },
                uv = new[]
                {
                    new Vector2(0f, 0f),
                    new Vector2(1f, 0f),
                    new Vector2(1f, 1f),
                    new Vector2(0f, 1f)
                },
                uv2 = new[]
                {
                    Vector2.zero,
                    Vector2.zero,
                    Vector2.zero,
                    Vector2.zero
                },
                colors = new[]
                {
                    Color.white,
                    Color.white,
                    Color.white,
                    Color.white
                },
                triangles = new[] { 0, 2, 1, 0, 3, 2 }
            };
            mesh.RecalculateBounds();
            mesh.UploadMeshData(true);
            return mesh;
        }

        private static Mesh CreateOpenBottomBoxMesh(float bottomFeatherFraction)
        {
            var vertices = new List<Vector3>();
            var uvs = new List<Vector2>();
            var uv2 = new List<Vector2>();
            var colours = new List<Color>();
            var triangles = new List<int>();

            AddQuad(
                new Vector3(-0.5f, -0.5f, 0f),
                new Vector3(0.5f, -0.5f, 0f),
                new Vector3(0.5f, 0.5f, 0f),
                new Vector3(-0.5f, 0.5f, 0f),
                1f, 1f, 1f, 1f,
                false,
                0f,
                1f);

            float ringZ = -1f + Mathf.Clamp(bottomFeatherFraction, 0.001f, 0.999f);
            AddSide(new Vector2(-0.5f, -0.5f), new Vector2(0.5f, -0.5f));
            AddSide(new Vector2(0.5f, -0.5f), new Vector2(0.5f, 0.5f));
            AddSide(new Vector2(0.5f, 0.5f), new Vector2(-0.5f, 0.5f));
            AddSide(new Vector2(-0.5f, 0.5f), new Vector2(-0.5f, -0.5f));

            Mesh mesh = new Mesh
            {
                name = "[Runtime] Phase 6 Open-Bottom Unit Box",
                hideFlags = HideFlags.DontSave
            };
            mesh.SetVertices(vertices);
            mesh.SetUVs(0, uvs);
            mesh.SetUVs(1, uv2);
            mesh.SetColors(colours);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateBounds();
            mesh.UploadMeshData(true);
            return mesh;

            void AddSide(Vector2 edgeA, Vector2 edgeB)
            {
                Vector3 bottomA = new Vector3(edgeA.x, edgeA.y, -1f);
                Vector3 bottomB = new Vector3(edgeB.x, edgeB.y, -1f);
                Vector3 ringA = new Vector3(edgeA.x, edgeA.y, ringZ);
                Vector3 ringB = new Vector3(edgeB.x, edgeB.y, ringZ);
                Vector3 topA = new Vector3(edgeA.x, edgeA.y, 0f);
                Vector3 topB = new Vector3(edgeB.x, edgeB.y, 0f);

                AddQuad(
                    bottomA, bottomB, ringB, ringA,
                    0f, 0f, 1f, 1f,
                    true,
                    0f,
                    bottomFeatherFraction);
                AddQuad(
                    ringA, ringB, topB, topA,
                    1f, 1f, 1f, 1f,
                    true,
                    bottomFeatherFraction,
                    1f);
            }

            void AddQuad(
                Vector3 bottomLeft,
                Vector3 bottomRight,
                Vector3 topRight,
                Vector3 topLeft,
                float bottomLeftAlpha,
                float bottomRightAlpha,
                float topRightAlpha,
                float topLeftAlpha,
                bool sideFace,
                float minimumV,
                float maximumV)
            {
                int start = vertices.Count;
                vertices.Add(bottomLeft);
                vertices.Add(bottomRight);
                vertices.Add(topRight);
                vertices.Add(topLeft);
                uvs.Add(new Vector2(0f, minimumV));
                uvs.Add(new Vector2(1f, minimumV));
                uvs.Add(new Vector2(1f, maximumV));
                uvs.Add(new Vector2(0f, maximumV));
                Vector2 mode = sideFace ? Vector2.right : Vector2.zero;
                uv2.Add(mode);
                uv2.Add(mode);
                uv2.Add(mode);
                uv2.Add(mode);
                colours.Add(new Color(1f, 1f, 1f, bottomLeftAlpha));
                colours.Add(new Color(1f, 1f, 1f, bottomRightAlpha));
                colours.Add(new Color(1f, 1f, 1f, topRightAlpha));
                colours.Add(new Color(1f, 1f, 1f, topLeftAlpha));
                triangles.Add(start);
                triangles.Add(start + 2);
                triangles.Add(start + 1);
                triangles.Add(start);
                triangles.Add(start + 3);
                triangles.Add(start + 2);
            }
        }

        private void OnDestroy()
        {
            if (runtimeFallbackMaterial != null)
            {
                DestroyRuntimeObject(runtimeFallbackMaterial);
            }
            if (runtimeDebugMaterial != null)
            {
                DestroyRuntimeObject(runtimeDebugMaterial);
            }
            if (runtimeQuadMesh != null)
            {
                DestroyRuntimeObject(runtimeQuadMesh);
            }
            if (runtimeOpenBottomBoxMesh != null)
            {
                DestroyRuntimeObject(runtimeOpenBottomBoxMesh);
            }
        }

        private static void DestroyRuntimeObject(UnityEngine.Object value)
        {
            if (value == null)
            {
                return;
            }
            if (Application.isPlaying)
            {
                Destroy(value);
            }
            else
            {
                DestroyImmediate(value);
            }
        }
    }
}
