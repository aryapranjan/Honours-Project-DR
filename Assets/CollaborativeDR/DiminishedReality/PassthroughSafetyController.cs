using CollaborativeDR.StudyCore;
using UnityEngine;

namespace CollaborativeDR.DiminishedReality
{
    [DisallowMultipleComponent]
    public sealed class PassthroughSafetyController : MonoBehaviour,
        IVisualSafetyController
    {
        [SerializeField]
        private OVRPassthroughLayer passthroughLayer;

        [SerializeField]
        private GameObject[] diminishedRealityRoots = new GameObject[0];

        [SerializeField]
        private DiminishedRealityManager diminishedRealityManager;

        public bool IsFailSafeActive { get; private set; }

        private void Awake()
        {
            if (passthroughLayer == null)
            {
                passthroughLayer = FindFirstObjectByType<OVRPassthroughLayer>();
            }

            if (diminishedRealityManager == null)
            {
                diminishedRealityManager = GetComponent<DiminishedRealityManager>() ??
                                           FindFirstObjectByType<DiminishedRealityManager>();
            }

            EnsureTransparentCameraBackground();
            EnsureClearPassthroughVisible();
        }

        public void PreserveLastValidState()
        {
            // Intentionally do not change DR visibility during the short
            // recovery window. The server stopwatch remains authoritative.
        }

        public void EnterClearPassthroughFailSafe(string reason)
        {
            diminishedRealityManager?.EnterFailSafe(reason);
            foreach (GameObject root in diminishedRealityRoots)
            {
                if (root != null)
                {
                    root.SetActive(false);
                }
            }

            IsFailSafeActive = true;
            EnsureClearPassthroughVisible();
            Debug.LogWarning($"STUDY_FAIL_SAFE_ACTIVE reason={reason}", this);
        }

        public void Configure(DiminishedRealityManager manager)
        {
            diminishedRealityManager = manager;
        }

        public void ExitFailSafeAfterAuthoritativeContinuation()
        {
            IsFailSafeActive = false;
            EnsureClearPassthroughVisible();
        }

        private void EnsureClearPassthroughVisible()
        {
            if (passthroughLayer != null)
            {
                passthroughLayer.hidden = false;
                passthroughLayer.enabled = true;
            }
        }

        private static void EnsureTransparentCameraBackground()
        {
            OVRCameraRig rig = FindFirstObjectByType<OVRCameraRig>();
            Camera centerEyeCamera = rig != null && rig.centerEyeAnchor != null
                ? rig.centerEyeAnchor.GetComponent<Camera>()
                : Camera.main;
            if (centerEyeCamera == null)
            {
                Debug.LogError("PASSTHROUGH_CAMERA_CONFIGURATION_FAILED reason=missing_center_eye_camera");
                return;
            }

            // A passthrough underlay requires the application framebuffer to
            // be cleared to transparent every frame. CameraClearFlags.Nothing
            // retains prior frames and produces severe motion-dependent bands.
            centerEyeCamera.clearFlags = CameraClearFlags.SolidColor;
            centerEyeCamera.backgroundColor = Color.clear;
        }
    }
}
