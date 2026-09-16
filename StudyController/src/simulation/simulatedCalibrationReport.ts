import {
  APRILTAG_DETECTION_SIZE_METERS,
  CALIBRATION_THRESHOLD_PROFILE,
  type CalibrationReport,
} from "../contracts.js";

export function createDeterministicCalibrationReport(
  attemptId: string,
  simulation: boolean,
  completedAt = new Date(),
): CalibrationReport {
  const startedAt = new Date(completedAt.getTime() - 6_000);
  const rotation = { x: 0, y: 0, z: 0, w: 1 };
  const tags = [
    { tagId: 1, x: -0.2, y: 0, z: 0 },
    { tagId: 2, x: 0.2, y: 0, z: 0 },
    { tagId: 3, x: -0.7, y: 0.3, z: 2 },
    { tagId: 4, x: -0.7, y: 1.2, z: 2 },
    { tagId: 5, x: 0.7, y: 1.2, z: 2 },
    { tagId: 6, x: 0.7, y: 0.3, z: 2 },
  ];
  return {
    attemptId,
    status: "PASS",
    startedAtUtc: startedAt.toISOString(),
    completedAtUtc: completedAt.toISOString(),
    durationMs: 6_000,
    tagFamily: "tagStandard41h12",
    tagSizeMeters: APRILTAG_DETECTION_SIZE_METERS,
    thresholdProfile: CALIBRATION_THRESHOLD_PROFILE,
    cameraPosition: "LEFT",
    imageWidth: 1280,
    imageHeight: 960,
    observedTagIds: [1, 2, 3, 4, 5, 6],
    tagSamples: tags.map(({ tagId }) => ({
      tagId,
      acceptedCount: 6,
      rejectedCount: 0,
      positionRmsMeters: 0.001,
      rotationRmsDegrees: 0.1,
    })),
    acceptedObservationCount: 36,
    rejectedObservationCount: 0,
    keyboardSpacingMeters: 0.4,
    keyboardSpacingResidualMeters: 0,
    tvPlanarityRmsMeters: 0,
    keyboardRigInWorld: {
      position: { x: 0, y: 0, z: 0 },
      rotation,
    },
    tvInKeyboardRig: {
      position: { x: 0, y: 0.75, z: 2 },
      rotation,
    },
    tagTransforms: tags.map(({ tagId, x, y, z }) => ({
      tagId,
      poseInKeyboardRig: {
        position: { x, y, z },
        rotation,
      },
    })),
    failureReasons: [],
    warnings: simulation ? ["SIMULATED_CALIBRATION_REPORT"] : [],
    rawFramesPersisted: false,
    simulation,
  };
}
