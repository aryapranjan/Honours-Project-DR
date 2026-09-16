using System;
using UnityEngine;

namespace CollaborativeDR.Calibration
{
    public sealed class TagObservation
    {
        public int TagId { get; }
        public DateTime FrameTimestampUtc { get; }
        public double CapturedAtMonotonicMs { get; }
        public float FrameAgeSeconds { get; }
        public Vector3 WorldPosition { get; }
        public Quaternion WorldRotation { get; }
        public int ImageWidth { get; }
        public int ImageHeight { get; }

        public TagObservation(
            int tagId,
            DateTime frameTimestampUtc,
            double capturedAtMonotonicMs,
            float frameAgeSeconds,
            Vector3 worldPosition,
            Quaternion worldRotation,
            int imageWidth,
            int imageHeight)
        {
            TagId = tagId;
            FrameTimestampUtc = frameTimestampUtc;
            CapturedAtMonotonicMs = capturedAtMonotonicMs;
            FrameAgeSeconds = frameAgeSeconds;
            WorldPosition = worldPosition;
            WorldRotation = worldRotation;
            ImageWidth = imageWidth;
            ImageHeight = imageHeight;
        }
    }
}
