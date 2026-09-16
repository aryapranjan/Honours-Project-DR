using System;
using System.Collections;
using System.Collections.Generic;
using System.Threading.Tasks;
using CollaborativeDR.Configuration;
using CollaborativeDR.Protocol;
using UnityEngine;

namespace CollaborativeDR.Calibration
{
    [DisallowMultipleComponent]
    public sealed class AprilTagCalibrationManager : MonoBehaviour
    {
        [SerializeField] private PcaAprilTagObservationSource observationSource;
        [SerializeField] private AprilTagRigConfiguration configuration;

        private readonly List<TagObservation> accepted = new List<TagObservation>();
        private readonly Dictionary<int, TagObservation> lastAccepted =
            new Dictionary<int, TagObservation>();
        private readonly Dictionary<int, int> rejectedByTag =
            new Dictionary<int, int>();
        private readonly HashSet<string> sourceRejectionReasons =
            new HashSet<string>(StringComparer.Ordinal);
        private TaskCompletionSource<CalibrationReportPayload> completion;
        private Coroutine activeAttempt;
        private int rejectedWithoutTagId;

        public bool IsRunning => activeAttempt != null;
        public CalibrationReportPayload LastReport { get; private set; }

        public event Action<CalibrationReportPayload> CalibrationCompleted;

        public void Configure(
            PcaAprilTagObservationSource source,
            AprilTagRigConfiguration rigConfiguration)
        {
            Unsubscribe();
            observationSource = source;
            configuration = rigConfiguration;
            configuration?.ValidateOrThrow();
            Subscribe();
        }

        public Task<CalibrationReportPayload> RunCalibrationAsync(
            string attemptId,
            float requestedDurationSeconds)
        {
            if (IsRunning)
            {
                throw new InvalidOperationException(
                    "A calibration attempt is already running on this Quest.");
            }
            if (observationSource == null || configuration == null)
            {
                throw new InvalidOperationException(
                    "The Phase 5 calibration runtime is not configured.");
            }
            if (!Guid.TryParse(attemptId, out _))
            {
                throw new ArgumentException(
                    "Calibration attempt ID must be a UUID.",
                    nameof(attemptId));
            }
            if (Mathf.Abs(requestedDurationSeconds - configuration.SampleDurationSeconds) > 0.01f)
            {
                throw new InvalidOperationException(
                    $"Calibration duration must be {configuration.SampleDurationSeconds:F1} seconds.");
            }

            accepted.Clear();
            lastAccepted.Clear();
            rejectedByTag.Clear();
            sourceRejectionReasons.Clear();
            rejectedWithoutTagId = 0;
            completion = new TaskCompletionSource<CalibrationReportPayload>();
            activeAttempt = StartCoroutine(RunAttempt(
                attemptId,
                configuration.SampleDurationSeconds));
            return completion.Task;
        }

        private IEnumerator RunAttempt(string attemptId, float durationSeconds)
        {
            DateTime startedAtUtc = DateTime.UtcNow;
            observationSource.SetSamplingEnabled(true);
            Debug.Log(
                $"PHASE5_CALIBRATION_STARTED attempt={attemptId} duration_s={durationSeconds:F1} " +
                $"tag_size_m={configuration.TagSizeMeters:F3}",
                this);

            yield return new WaitForSecondsRealtime(durationSeconds);

            observationSource.SetSamplingEnabled(false);
            DateTime completedAtUtc = DateTime.UtcNow;
            CalibrationReportPayload report;
            try
            {
                report = AprilTagRigSolver.BuildReport(
                    attemptId,
                    startedAtUtc,
                    completedAtUtc,
                    accepted,
                    rejectedByTag,
                    rejectedWithoutTagId,
                    sourceRejectionReasons,
                    configuration,
                    observationSource.CameraPositionName,
                    observationSource.LastImageWidth,
                    observationSource.LastImageHeight);
            }
            catch (Exception exception)
            {
                activeAttempt = null;
                completion.TrySetException(exception);
                completion = null;
                yield break;
            }

            LastReport = report;
            activeAttempt = null;
            TaskCompletionSource<CalibrationReportPayload> result = completion;
            completion = null;
            CalibrationCompleted?.Invoke(report);
            result.TrySetResult(report);
            Debug.Log(
                $"PHASE5_CALIBRATION_COMPLETED attempt={attemptId} status={report.Status} " +
                $"accepted={report.AcceptedObservationCount} rejected={report.RejectedObservationCount} " +
                $"raw_frames_persisted={report.RawFramesPersisted.ToString().ToLowerInvariant()}",
                this);
        }

        private void HandleObservations(IReadOnlyList<TagObservation> batch)
        {
            if (!IsRunning || batch == null)
            {
                return;
            }
            foreach (TagObservation observation in batch)
            {
                if (observation.FrameAgeSeconds > configuration.MaximumFrameAgeSeconds)
                {
                    Reject(observation.TagId);
                    sourceRejectionReasons.Add("STALE_CAMERA_FRAME");
                    continue;
                }
                if (lastAccepted.TryGetValue(
                        observation.TagId,
                        out TagObservation previous) &&
                    Vector3.Distance(
                        previous.WorldPosition,
                        observation.WorldPosition) >
                    configuration.MaximumSequentialJumpMeters)
                {
                    Reject(observation.TagId);
                    sourceRejectionReasons.Add("IMPLAUSIBLE_SEQUENTIAL_JUMP");
                    continue;
                }

                accepted.Add(observation);
                lastAccepted[observation.TagId] = observation;
            }
        }

        private void HandleSourceRejection(string reason)
        {
            if (!IsRunning)
            {
                return;
            }
            rejectedWithoutTagId += 1;
            if (!string.IsNullOrWhiteSpace(reason))
            {
                sourceRejectionReasons.Add(reason);
            }
        }

        private void Reject(int tagId)
        {
            rejectedByTag.TryGetValue(tagId, out int count);
            rejectedByTag[tagId] = count + 1;
        }

        private void Awake()
        {
            Subscribe();
        }

        private void Subscribe()
        {
            if (observationSource == null)
            {
                return;
            }
            observationSource.ObservationsReady -= HandleObservations;
            observationSource.SampleRejected -= HandleSourceRejection;
            observationSource.ObservationsReady += HandleObservations;
            observationSource.SampleRejected += HandleSourceRejection;
        }

        private void Unsubscribe()
        {
            if (observationSource == null)
            {
                return;
            }
            observationSource.ObservationsReady -= HandleObservations;
            observationSource.SampleRejected -= HandleSourceRejection;
        }

        private void OnDestroy()
        {
            Unsubscribe();
            if (activeAttempt != null)
            {
                StopCoroutine(activeAttempt);
                activeAttempt = null;
            }
            observationSource?.SetSamplingEnabled(false);
            completion?.TrySetCanceled();
            completion = null;
        }
    }
}
