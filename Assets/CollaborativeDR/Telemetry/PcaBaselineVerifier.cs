using System.Collections;
using Meta.XR;
using UnityEngine;

namespace CollaborativeDR.Telemetry
{
    /// <summary>
    /// Performs the Phase 1 Passthrough Camera API smoke test without retaining
    /// or transmitting camera imagery.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class PcaBaselineVerifier : MonoBehaviour
    {
        private const string LogPrefix = "PCA_BASELINE";

        [SerializeField]
        private PassthroughCameraAccess cameraAccess;

        [SerializeField, Min(1f)]
        private float startupTimeoutSeconds = 30f;

        public void Configure(PassthroughCameraAccess access)
        {
            cameraAccess = access;
        }

        private IEnumerator Start()
        {
            if (cameraAccess == null)
            {
                cameraAccess = GetComponent<PassthroughCameraAccess>();
            }

            if (cameraAccess == null)
            {
                Debug.LogError($"{LogPrefix}_FAILED reason=missing_camera_access", this);
                yield break;
            }

            if (!OVRPermissionsRequester.IsPermissionGranted(
                    OVRPermissionsRequester.Permission.PassthroughCameraAccess))
            {
                Debug.Log($"{LogPrefix}_PERMISSION_REQUESTED", this);
                OVRPermissionsRequester.Request(new[]
                {
                    OVRPermissionsRequester.Permission.PassthroughCameraAccess
                });
            }

            float deadline = Time.realtimeSinceStartup + startupTimeoutSeconds;
            while (!OVRPermissionsRequester.IsPermissionGranted(
                       OVRPermissionsRequester.Permission.PassthroughCameraAccess))
            {
                if (Time.realtimeSinceStartup >= deadline)
                {
                    Debug.LogError($"{LogPrefix}_FAILED reason=permission_timeout", this);
                    yield break;
                }

                yield return null;
            }

            Debug.Log($"{LogPrefix}_PERMISSION_GRANTED", this);

            while (!cameraAccess.IsPlaying || cameraAccess.GetTexture() == null)
            {
                if (Time.realtimeSinceStartup >= deadline)
                {
                    Debug.LogError($"{LogPrefix}_FAILED reason=frame_timeout", this);
                    yield break;
                }

                yield return null;
            }

            PassthroughCameraAccess.CameraIntrinsics intrinsics = cameraAccess.Intrinsics;
            Pose pose = cameraAccess.GetCameraPose();
            Texture texture = cameraAccess.GetTexture();

            Debug.Log(
                $"{LogPrefix}_FRAME_RECEIVED " +
                $"camera={cameraAccess.CameraPosition} " +
                $"resolution={cameraAccess.CurrentResolution.x}x{cameraAccess.CurrentResolution.y} " +
                $"texture={texture.width}x{texture.height} " +
                $"timestamp_utc={cameraAccess.Timestamp:O}",
                this);

            Debug.Log(
                $"{LogPrefix}_INTRINSICS " +
                $"focal_length=({intrinsics.FocalLength.x:F3},{intrinsics.FocalLength.y:F3}) " +
                $"principal_point=({intrinsics.PrincipalPoint.x:F3},{intrinsics.PrincipalPoint.y:F3}) " +
                $"sensor_resolution={intrinsics.SensorResolution.x}x{intrinsics.SensorResolution.y}",
                this);

            Debug.Log(
                $"{LogPrefix}_POSE " +
                $"position=({pose.position.x:F4},{pose.position.y:F4},{pose.position.z:F4}) " +
                $"rotation=({pose.rotation.x:F4},{pose.rotation.y:F4},{pose.rotation.z:F4},{pose.rotation.w:F4})",
                this);

            Debug.Log($"{LogPrefix}_PASSED raw_frames_persisted=false", this);
        }
    }
}
