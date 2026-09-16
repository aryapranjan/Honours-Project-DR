using System;
using System.Collections.Generic;
using System.Linq;
using AprilTag;
using CollaborativeDR.Configuration;
using Meta.XR;
using Unity.Collections;
using UnityEngine;
using UnityEngine.Rendering;

namespace CollaborativeDR.Calibration
{
    [DisallowMultipleComponent]
    public sealed class PcaAprilTagObservationSource : MonoBehaviour
    {
        private const string LogPrefix = "PHASE5_APRILTAG";

        private readonly Dictionary<int, LineRenderer> outlines =
            new Dictionary<int, LineRenderer>();
        private readonly Dictionary<int, float> outlineLastSeen =
            new Dictionary<int, float>();

        [SerializeField] private PassthroughCameraAccess cameraAccess;
        [SerializeField] private AprilTagRigConfiguration configuration;

        private TagDetector detector;
        private Material outlineMaterial;
        private int detectorWidth;
        private int detectorHeight;
        private int readbackGeneration;
        private float nextDetectionAt;
        private bool readbackInFlight;
        private bool samplingEnabled;

        public event Action<IReadOnlyList<TagObservation>> ObservationsReady;
        public event Action<string> SampleRejected;

        public int LastImageWidth { get; private set; }
        public int LastImageHeight { get; private set; }
        public string CameraPositionName => cameraAccess == null
            ? "UNKNOWN"
            : cameraAccess.CameraPosition.ToString().ToUpperInvariant();

        public void Configure(
            PassthroughCameraAccess access,
            AprilTagRigConfiguration rigConfiguration)
        {
            cameraAccess = access;
            configuration = rigConfiguration;
            configuration?.ValidateOrThrow();
        }

        public void SetSamplingEnabled(bool enabled)
        {
            samplingEnabled = enabled;
            readbackGeneration += 1;
            readbackInFlight = false;
            nextDetectionAt = 0f;
            if (!enabled)
            {
                HideAllOutlines();
            }
        }

        private void Update()
        {
            HideExpiredOutlines();
            if (!samplingEnabled || readbackInFlight || configuration == null ||
                cameraAccess == null || !cameraAccess.IsPlaying ||
                !cameraAccess.IsUpdatedThisFrame ||
                Time.unscaledTime < nextDetectionAt)
            {
                return;
            }

            Texture texture = cameraAccess.GetTexture();
            if (texture == null || texture.width <= 0 || texture.height <= 0)
            {
                Reject("CAMERA_TEXTURE_NOT_READY");
                return;
            }

            nextDetectionAt = Time.unscaledTime + configuration.DetectionIntervalSeconds;
            FrameContext context;
            try
            {
                context = CaptureFrameContext(texture.width, texture.height);
            }
            catch (Exception exception)
            {
                Reject($"CAMERA_GEOMETRY_INVALID:{exception.Message}");
                return;
            }

            if (context.FrameAgeSeconds > configuration.MaximumFrameAgeSeconds)
            {
                Reject("STALE_CAMERA_FRAME");
                return;
            }

            int generation = readbackGeneration;
            if (SystemInfo.supportsAsyncGPUReadback)
            {
                readbackInFlight = true;
                AsyncGPUReadback.Request(
                    texture,
                    0,
                    TextureFormat.RGBA32,
                    request => HandleReadback(request, context, generation));
                return;
            }

            NativeArray<Color32> colors = cameraAccess.GetColors();
            ProcessPixels(colors, context, generation);
        }

        private FrameContext CaptureFrameContext(int width, int height)
        {
            PassthroughCameraAccess.CameraIntrinsics intrinsics = cameraAccess.Intrinsics;
            if (intrinsics.FocalLength.x <= 0f || intrinsics.FocalLength.y <= 0f ||
                intrinsics.SensorResolution.x <= 0 || intrinsics.SensorResolution.y <= 0)
            {
                throw new InvalidOperationException("PCA intrinsics are not ready.");
            }

            DateTime timestamp = cameraAccess.Timestamp.Kind == DateTimeKind.Utc
                ? cameraAccess.Timestamp
                : cameraAccess.Timestamp.ToUniversalTime();
            float frameAge = timestamp == default
                ? float.PositiveInfinity
                : Mathf.Max(0f, (float)(DateTime.UtcNow - timestamp).TotalSeconds);
            CalculateTextureIntrinsics(
                intrinsics,
                width,
                height,
                out Vector2 focalLength,
                out Vector2 principalPoint);

            return new FrameContext(
                width,
                height,
                focalLength,
                principalPoint,
                cameraAccess.GetCameraPose(),
                timestamp,
                Time.realtimeSinceStartupAsDouble * 1000d,
                frameAge);
        }

        private void HandleReadback(
            AsyncGPUReadbackRequest request,
            FrameContext context,
            int generation)
        {
            readbackInFlight = false;
            if (!samplingEnabled || generation != readbackGeneration)
            {
                return;
            }

            if (request.hasError)
            {
                Reject("GPU_READBACK_FAILED");
                return;
            }

            ProcessPixels(request.GetData<Color32>(), context, generation);
        }

        private void ProcessPixels(
            NativeArray<Color32> pixels,
            FrameContext context,
            int generation)
        {
            if (!samplingEnabled || generation != readbackGeneration)
            {
                return;
            }

            int requiredPixels = context.Width * context.Height;
            if (!pixels.IsCreated || pixels.Length < requiredPixels)
            {
                Reject("CPU_PIXEL_BUFFER_TOO_SMALL");
                return;
            }

            try
            {
                EnsureDetector(context.Width, context.Height);
                NativeArray<Color32> imagePixels = pixels.GetSubArray(0, requiredPixels);
                detector.ProcessImage(
                    imagePixels.AsReadOnlySpan(),
                    context.FocalLength,
                    context.PrincipalPoint,
                    configuration.TagSizeMeters);

                HashSet<int> acceptedIds = new HashSet<int>(configuration.RequiredTagIds);
                List<TagObservation> batch = new List<TagObservation>(6);
                foreach (TagPose tag in detector.DetectedTags)
                {
                    if (!acceptedIds.Contains(tag.ID))
                    {
                        continue;
                    }

                    if (!IsFinite(tag.Position) || !IsFinite(tag.Rotation) ||
                        !IsFinite(tag.Corner1) || !IsFinite(tag.Corner2) ||
                        !IsFinite(tag.Corner3) || !IsFinite(tag.Corner4))
                    {
                        Reject($"INVALID_TAG_POSE:id={tag.ID}");
                        continue;
                    }

                    Vector3 worldPosition = context.CameraPose.position +
                                            context.CameraPose.rotation * tag.Position;
                    Quaternion worldRotation = context.CameraPose.rotation * tag.Rotation;
                    batch.Add(new TagObservation(
                        tag.ID,
                        context.TimestampUtc,
                        context.CapturedAtMonotonicMs,
                        context.FrameAgeSeconds,
                        worldPosition,
                        worldRotation,
                        context.Width,
                        context.Height));
                    UpdateOutline(tag, context, worldPosition);
                }

                LastImageWidth = context.Width;
                LastImageHeight = context.Height;
                if (batch.Count > 0)
                {
                    ObservationsReady?.Invoke(batch);
                }
            }
            catch (Exception exception)
            {
                Reject($"DETECTOR_FAILED:{exception.GetType().Name}");
                Debug.LogError($"{LogPrefix}_FAILED {exception}", this);
            }
        }

        private void EnsureDetector(int width, int height)
        {
            if (detector != null && detectorWidth == width && detectorHeight == height)
            {
                return;
            }

            detector?.Dispose();
            detector = new TagDetector(width, height, configuration.DetectorDecimation);
            detectorWidth = width;
            detectorHeight = height;
            Debug.Log(
                $"{LogPrefix}_CONFIGURED family={configuration.TagFamily} " +
                $"tag_size_m={configuration.TagSizeMeters:F3} resolution={width}x{height} " +
                $"decimation={configuration.DetectorDecimation}",
                this);
        }

        private void UpdateOutline(
            TagPose tag,
            FrameContext context,
            Vector3 tagPosition)
        {
            LineRenderer line = GetOrCreateOutline(tag.ID);
            Vector3 towardCamera = context.CameraPose.position - tagPosition;
            towardCamera = towardCamera.sqrMagnitude < 0.000001f
                ? context.CameraPose.rotation * Vector3.back
                : towardCamera.normalized;

            // This is a researcher-only screen-space detection diagnostic. Intersecting
            // the detected corner rays with a camera-facing plane at the tracked centre
            // keeps the outline aligned even when square-tag PnP selects a noisy
            // orientation branch. Calibration geometry continues to use world positions.
            Plane plane = new Plane(towardCamera, tagPosition);
            Vector2[] corners = { tag.Corner1, tag.Corner2, tag.Corner3, tag.Corner4 };
            Vector3[] worldCorners = new Vector3[4];
            for (int index = 0; index < corners.Length; index++)
            {
                Vector2 viewport = ImagePointToViewport(
                    corners[index],
                    context.Width,
                    context.Height);
                Ray ray = cameraAccess.ViewportPointToRay(viewport, context.CameraPose);
                if (!plane.Raycast(ray, out float distance) || distance <= 0f)
                {
                    return;
                }

                worldCorners[index] = ray.GetPoint(distance) +
                                      towardCamera * configuration.OutlineSurfaceOffsetMeters;
            }

            line.positionCount = 4;
            line.SetPositions(worldCorners);
            line.enabled = true;
            outlineLastSeen[tag.ID] = Time.unscaledTime;
        }

        private Vector2 ImagePointToViewport(Vector2 point, int width, int height)
        {
            float x = point.x / Mathf.Max(1f, width - 1f);
            float y = point.y / Mathf.Max(1f, height - 1f);
            if (configuration.FlipDetectedCornerX)
            {
                x = 1f - x;
            }
            if (configuration.FlipDetectedCornerY)
            {
                y = 1f - y;
            }
            return new Vector2(Mathf.Clamp01(x), Mathf.Clamp01(y));
        }

        private LineRenderer GetOrCreateOutline(int tagId)
        {
            if (outlines.TryGetValue(tagId, out LineRenderer existing))
            {
                return existing;
            }

            if (outlineMaterial == null)
            {
                Shader shader = Shader.Find("Sprites/Default");
                if (shader == null)
                {
                    throw new InvalidOperationException("Outline shader is unavailable.");
                }
                outlineMaterial = new Material(shader)
                {
                    name = "Phase 5 AprilTag Outline (Runtime)",
                    hideFlags = HideFlags.DontSave
                };
            }

            GameObject child = new GameObject($"CalibrationOnly_Tag_{tagId}_Outline");
            child.transform.SetParent(transform, false);
            LineRenderer line = child.AddComponent<LineRenderer>();
            line.useWorldSpace = true;
            line.loop = true;
            line.widthMultiplier = 0.004f;
            line.numCornerVertices = 2;
            line.numCapVertices = 2;
            line.sharedMaterial = outlineMaterial;
            Color color = tagId <= 2
                ? new Color(0.20f, 1f, 0.35f, 1f)
                : new Color(0.15f, 0.80f, 1f, 1f);
            line.startColor = color;
            line.endColor = color;
            line.enabled = false;
            outlines.Add(tagId, line);
            return line;
        }

        private void HideExpiredOutlines()
        {
            if (!samplingEnabled)
            {
                return;
            }

            float now = Time.unscaledTime;
            foreach (KeyValuePair<int, LineRenderer> pair in outlines)
            {
                if (!outlineLastSeen.TryGetValue(pair.Key, out float lastSeen) ||
                    now - lastSeen > configuration.OutlineLifetimeSeconds)
                {
                    pair.Value.enabled = false;
                }
            }
        }

        private void HideAllOutlines()
        {
            foreach (LineRenderer line in outlines.Values)
            {
                line.enabled = false;
            }
            outlineLastSeen.Clear();
        }

        private void Reject(string reason)
        {
            const int maximumReasonLength = 200;
            string safeReason = string.IsNullOrWhiteSpace(reason)
                ? "UNKNOWN"
                : reason.Trim();
            if (safeReason.Length > maximumReasonLength)
            {
                safeReason = safeReason.Substring(0, maximumReasonLength);
            }

            SampleRejected?.Invoke(safeReason);
        }

        private static bool IsFinite(float value)
        {
            return !float.IsNaN(value) && !float.IsInfinity(value);
        }

        private static bool IsFinite(Vector2 value)
        {
            return IsFinite(value.x) && IsFinite(value.y);
        }

        private static bool IsFinite(Vector3 value)
        {
            return IsFinite(value.x) && IsFinite(value.y) && IsFinite(value.z);
        }

        private static bool IsFinite(Quaternion value)
        {
            return IsFinite(value.x) && IsFinite(value.y) &&
                   IsFinite(value.z) && IsFinite(value.w) &&
                   value.x * value.x + value.y * value.y +
                   value.z * value.z + value.w * value.w > 0.000001f;
        }

        private static void CalculateTextureIntrinsics(
            PassthroughCameraAccess.CameraIntrinsics intrinsics,
            int width,
            int height,
            out Vector2 focalLength,
            out Vector2 principalPoint)
        {
            Vector2 sensor = intrinsics.SensorResolution;
            Vector2 output = new Vector2(width, height);
            Vector2 cropScale = new Vector2(output.x / sensor.x, output.y / sensor.y);
            cropScale /= Mathf.Max(cropScale.x, cropScale.y);
            Rect crop = new Rect(
                sensor.x * (1f - cropScale.x) * 0.5f,
                sensor.y * (1f - cropScale.y) * 0.5f,
                sensor.x * cropScale.x,
                sensor.y * cropScale.y);
            float scaleX = output.x / crop.width;
            float scaleY = output.y / crop.height;
            focalLength = new Vector2(
                intrinsics.FocalLength.x * scaleX,
                intrinsics.FocalLength.y * scaleY);
            principalPoint = new Vector2(
                (intrinsics.PrincipalPoint.x - crop.x) * scaleX,
                (intrinsics.PrincipalPoint.y - crop.y) * scaleY);
        }

        private void OnDestroy()
        {
            readbackGeneration += 1;
            detector?.Dispose();
            detector = null;
            if (outlineMaterial != null)
            {
                Destroy(outlineMaterial);
            }
        }

        private readonly struct FrameContext
        {
            public int Width { get; }
            public int Height { get; }
            public Vector2 FocalLength { get; }
            public Vector2 PrincipalPoint { get; }
            public Pose CameraPose { get; }
            public DateTime TimestampUtc { get; }
            public double CapturedAtMonotonicMs { get; }
            public float FrameAgeSeconds { get; }

            public FrameContext(
                int width,
                int height,
                Vector2 focalLength,
                Vector2 principalPoint,
                Pose cameraPose,
                DateTime timestampUtc,
                double capturedAtMonotonicMs,
                float frameAgeSeconds)
            {
                Width = width;
                Height = height;
                FocalLength = focalLength;
                PrincipalPoint = principalPoint;
                CameraPose = cameraPose;
                TimestampUtc = timestampUtc;
                CapturedAtMonotonicMs = capturedAtMonotonicMs;
                FrameAgeSeconds = frameAgeSeconds;
            }
        }
    }
}
