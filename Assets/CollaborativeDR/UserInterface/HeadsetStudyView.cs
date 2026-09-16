using System;
using CollaborativeDR.Networking;
using CollaborativeDR.StudyCore;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;
#if UNITY_EDITOR
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.UI;
#endif

namespace CollaborativeDR.UserInterface
{
    [DisallowMultipleComponent]
    public sealed class HeadsetStudyView : MonoBehaviour
    {
        public const string SetupControllerObjectName = "[Study] Right Setup Controller";

        private enum InputTarget
        {
            Address,
            PairingCode
        }

        private static readonly Color PanelColor = new Color(0.035f, 0.055f, 0.10f, 0.96f);
        private static readonly Color PrimaryColor = new Color(0.30f, 0.48f, 0.94f, 1f);
        private static readonly Color SecondaryColor = new Color(0.10f, 0.14f, 0.22f, 1f);
        private static readonly Color TextColor = new Color(0.94f, 0.96f, 1f, 1f);
        private static readonly Color MutedColor = new Color(0.65f, 0.70f, 0.80f, 1f);
        private static readonly Color FaultColor = new Color(0.48f, 0.08f, 0.10f, 0.98f);

        private StudyNetworkClient networkClient;
        private Font font;
        private GameObject setupPanel;
        private GameObject waitingPanel;
        private GameObject faultPanel;
        private GameObject developerPanel;
        private Text setupStatusText;
        private Text addressText;
        private Text codeText;
        private Text waitingText;
        private Text faultText;
        private Text developerText;
        private Button connectButton;
        private GameObject setupControllerRoot;
        private InputTarget inputTarget = InputTarget.Address;
        private string addressValue = string.Empty;
        private string codeValue = string.Empty;
        private bool developerOverlayVisible;

        private void Awake()
        {
            networkClient = GetComponent<StudyNetworkClient>();
            if (networkClient == null)
            {
                Debug.LogError("HEADSET_UI_FAILED reason=missing_network_client", this);
                enabled = false;
                return;
            }

            font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            BuildInterface();
            networkClient.StatusChanged += HandleStatusChanged;
            HandleStatusChanged(networkClient.CurrentStatus);
        }

        private void OnDestroy()
        {
            if (networkClient != null)
            {
                networkClient.StatusChanged -= HandleStatusChanged;
            }
        }

        private void Update()
        {
#if UNITY_EDITOR
            bool toggleRequested = Keyboard.current?.f1Key.wasPressedThisFrame ?? false;
#else
            bool toggleRequested = OVRInput.GetDown(OVRInput.Button.Start);
#endif
            if (Debug.isDebugBuild && toggleRequested)
            {
                developerOverlayVisible = !developerOverlayVisible;
                developerPanel.SetActive(developerOverlayVisible);
                RefreshDeveloperText(networkClient.CurrentStatus);
            }
        }

        private void BuildInterface()
        {
            Transform anchor = FindInterfaceAnchor();
            setupControllerRoot = FindSetupControllerRoot();
            GameObject canvasObject = new GameObject(
                "HeadsetStudyCanvas",
                typeof(RectTransform),
                typeof(Canvas),
                typeof(CanvasScaler));
            canvasObject.transform.SetParent(anchor, false);
            canvasObject.transform.localPosition = new Vector3(0f, 0f, 1.35f);
            canvasObject.transform.localRotation = Quaternion.identity;
            canvasObject.transform.localScale = Vector3.one * 0.001f;

            Canvas canvas = canvasObject.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            canvas.worldCamera = FindFirstObjectByType<OVRCameraRig>()?.centerEyeAnchor
                ?.GetComponent<Camera>();
            canvas.sortingOrder = 200;
            RectTransform canvasRect = canvasObject.GetComponent<RectTransform>();
            canvasRect.sizeDelta = new Vector2(1000f, 700f);

            CanvasScaler scaler = canvasObject.GetComponent<CanvasScaler>();
            scaler.dynamicPixelsPerUnit = 1f;
            OVRRaycaster raycaster = canvasObject.AddComponent<OVRRaycaster>();
            ConfigureEventSystem(raycaster);

            setupPanel = CreatePanel(canvasRect, "ResearcherSetupPanel", PanelColor);
            BuildSetupPanel(setupPanel.GetComponent<RectTransform>());

            waitingPanel = CreatePanel(canvasRect, "ParticipantWaitingView", PanelColor);
            waitingText = CreateText(
                waitingPanel.transform,
                "WaitingText",
                "Please wait for the researcher.",
                46,
                TextAnchor.MiddleCenter,
                TextColor);
            Stretch(waitingText.rectTransform, 70f);

            faultPanel = CreatePanel(canvasRect, "ParticipantSafeFaultView", FaultColor);
            faultText = CreateText(
                faultPanel.transform,
                "FaultText",
                "Technical pause\nPlease wait for the researcher.",
                44,
                TextAnchor.MiddleCenter,
                TextColor);
            Stretch(faultText.rectTransform, 70f);

            developerPanel = CreatePanel(canvasRect, "DeveloperStatusOverlay", PanelColor);
            RectTransform developerRect = developerPanel.GetComponent<RectTransform>();
            developerRect.anchorMin = new Vector2(0.52f, 0.52f);
            developerRect.anchorMax = new Vector2(0.98f, 0.96f);
            developerRect.offsetMin = Vector2.zero;
            developerRect.offsetMax = Vector2.zero;
            developerText = CreateText(
                developerPanel.transform,
                "DeveloperText",
                string.Empty,
                22,
                TextAnchor.UpperLeft,
                TextColor);
            developerText.rectTransform.anchorMin = new Vector2(0f, 0.22f);
            developerText.rectTransform.anchorMax = new Vector2(1f, 1f);
            developerText.rectTransform.offsetMin = new Vector2(24f, 12f);
            developerText.rectTransform.offsetMax = new Vector2(-24f, -24f);
            Button resetButton = CreateButton(
                developerPanel.transform,
                "ResetEnrollmentButton",
                "Reset enrollment",
                new Vector2(0f, -120f),
                new Vector2(300f, 58f),
                SecondaryColor,
                () => networkClient.ResetEnrollment());
            RectTransform resetRect = resetButton.GetComponent<RectTransform>();
            resetRect.anchorMin = new Vector2(0.5f, 0f);
            resetRect.anchorMax = new Vector2(0.5f, 0f);
            resetRect.pivot = new Vector2(0.5f, 0f);
            resetRect.anchoredPosition = new Vector2(0f, 22f);
            developerPanel.SetActive(false);
        }

        private void BuildSetupPanel(RectTransform panel)
        {
            Text title = CreateText(
                panel,
                "Title",
                "Collaborative DR — Researcher Setup",
                38,
                TextAnchor.MiddleCenter,
                TextColor);
            Place(title.rectTransform, new Vector2(0f, 285f), new Vector2(900f, 70f));

            setupStatusText = CreateText(
                panel,
                "SetupStatus",
                "Enter the laptop IPv4 address and pairing code.",
                22,
                TextAnchor.MiddleCenter,
                MutedColor);
            Place(setupStatusText.rectTransform, new Vector2(0f, 232f), new Vector2(900f, 50f));

            CreateText(panel, "AddressLabel", "Laptop IPv4 address", 22,
                TextAnchor.MiddleLeft, MutedColor,
                new Vector2(-260f, 170f), new Vector2(350f, 40f));
            Button addressButton = CreateButton(
                panel,
                "AddressField",
                string.Empty,
                new Vector2(-210f, 125f),
                new Vector2(460f, 65f),
                SecondaryColor,
                () => SelectInput(InputTarget.Address));
            addressText = addressButton.GetComponentInChildren<Text>();

            CreateText(panel, "CodeLabel", "One-time pairing code", 22,
                TextAnchor.MiddleLeft, MutedColor,
                new Vector2(-260f, 57f), new Vector2(350f, 40f));
            Button codeButton = CreateButton(
                panel,
                "CodeField",
                string.Empty,
                new Vector2(-210f, 12f),
                new Vector2(460f, 65f),
                SecondaryColor,
                () => SelectInput(InputTarget.PairingCode));
            codeText = codeButton.GetComponentInChildren<Text>();

            string[] keys = { "1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫" };
            for (int index = 0; index < keys.Length; index++)
            {
                int row = index / 3;
                int column = index % 3;
                string key = keys[index];
                CreateButton(
                    panel,
                    $"Key_{index}",
                    key,
                    new Vector2(220f + column * 105f, 145f - row * 80f),
                    new Vector2(92f, 64f),
                    SecondaryColor,
                    () => ApplyKey(key));
            }

            connectButton = CreateButton(
                panel,
                "ConnectButton",
                "Pair and connect",
                new Vector2(-145f, -165f),
                new Vector2(330f, 70f),
                PrimaryColor,
                Connect);
            CreateButton(
                panel,
                "ClearButton",
                "Clear selected",
                new Vector2(220f, -165f),
                new Vector2(250f, 70f),
                SecondaryColor,
                ClearSelected);

            Text hint = CreateText(
                panel,
                "ControllerHint",
                "Point with the right controller and press the index trigger. Controllers are setup-only.",
                20,
                TextAnchor.MiddleCenter,
                MutedColor);
            Place(hint.rectTransform, new Vector2(0f, -285f), new Vector2(900f, 45f));
            RefreshInputFields();
        }

        private void ConfigureEventSystem(OVRRaycaster raycaster)
        {
            EventSystem eventSystem = FindFirstObjectByType<EventSystem>();
            if (eventSystem == null)
            {
                GameObject eventObject = new GameObject("Study EventSystem", typeof(EventSystem));
                eventObject.transform.SetParent(transform, false);
                eventSystem = eventObject.GetComponent<EventSystem>();
            }

#if UNITY_EDITOR
            if (eventSystem.GetComponent<BaseInputModule>() == null)
            {
                eventSystem.gameObject.AddComponent<InputSystemUIInputModule>();
            }
#else
            OVRInputModule inputModule = eventSystem.GetComponent<OVRInputModule>();
            if (inputModule == null)
            {
                inputModule = eventSystem.gameObject.AddComponent<OVRInputModule>();
            }

            OVRCameraRig rig = FindFirstObjectByType<OVRCameraRig>();
            ConfigureQuestInputModule(
                inputModule,
                rig != null ? rig.rightControllerAnchor : Camera.main?.transform);
#endif
        }

        public static void ConfigureQuestInputModule(
            OVRInputModule inputModule,
            Transform rightControllerAnchor)
        {
            if (inputModule == null)
            {
                throw new ArgumentNullException(nameof(inputModule));
            }

            inputModule.allowActivationOnMobileDevice = true;
            inputModule.rayTransform = rightControllerAnchor;
            inputModule.joyPadClickButton = OVRInput.Button.PrimaryIndexTrigger;
        }

        private Transform FindInterfaceAnchor()
        {
            OVRCameraRig rig = FindFirstObjectByType<OVRCameraRig>();
            if (rig != null && rig.centerEyeAnchor != null)
            {
                return rig.centerEyeAnchor;
            }

            return transform;
        }

        private GameObject FindSetupControllerRoot()
        {
            OVRCameraRig rig = FindFirstObjectByType<OVRCameraRig>();
            Transform controller = rig != null && rig.rightControllerAnchor != null
                ? rig.rightControllerAnchor.Find(SetupControllerObjectName)
                : null;
            return controller != null ? controller.gameObject : null;
        }

        private void HandleStatusChanged(StudyClientStatus current)
        {
            if (string.IsNullOrWhiteSpace(addressValue) &&
                !string.IsNullOrWhiteSpace(current.ServerAddress))
            {
                addressValue = ExtractHost(current.ServerAddress);
            }

            setupStatusText.text = current.Detail;
            connectButton.interactable = !current.IsPaired &&
                                         current.Phase != StudyClientPhase.Enrolling;
            setupPanel.SetActive(
                current.Phase == StudyClientPhase.Setup ||
                current.Phase == StudyClientPhase.Enrolling ||
                current.Phase == StudyClientPhase.Connecting ||
                current.Phase == StudyClientPhase.Synchronizing);
            if (setupControllerRoot != null)
            {
                setupControllerRoot.SetActive(setupPanel.activeSelf);
            }
            waitingPanel.SetActive(
                current.Phase == StudyClientPhase.Waiting ||
                current.Phase == StudyClientPhase.Calibrating ||
                current.Phase == StudyClientPhase.Prepared ||
                current.Phase == StudyClientPhase.Recovering);
            faultPanel.SetActive(current.Phase == StudyClientPhase.Faulted);

            if (current.Phase == StudyClientPhase.Active)
            {
                setupPanel.SetActive(false);
                waitingPanel.SetActive(false);
                faultPanel.SetActive(false);
            }

            waitingText.text = current.Phase == StudyClientPhase.Recovering
                ? "Technical pause\nPlease wait for the researcher."
                : current.Phase == StudyClientPhase.Calibrating
                    ? "Calibration in progress\nSlowly look from the keyboard to the TV."
                    : "Please wait for the researcher.";
            faultText.text = "Technical pause\nPlease wait for the researcher.";
            RefreshInputFields();
            RefreshDeveloperText(current);
        }

        private void SelectInput(InputTarget target)
        {
            inputTarget = target;
            RefreshInputFields();
        }

        private void ApplyKey(string key)
        {
            if (key == "⌫")
            {
                BackspaceSelected();
                return;
            }

            if (inputTarget == InputTarget.Address)
            {
                if (addressValue.Length < 15 &&
                    (char.IsDigit(key[0]) || key == "."))
                {
                    addressValue += key;
                }
            }
            else if (codeValue.Length < 6 && char.IsDigit(key[0]))
            {
                codeValue += key;
            }

            RefreshInputFields();
        }

        private void BackspaceSelected()
        {
            if (inputTarget == InputTarget.Address && addressValue.Length > 0)
            {
                addressValue = addressValue.Substring(0, addressValue.Length - 1);
            }
            else if (inputTarget == InputTarget.PairingCode && codeValue.Length > 0)
            {
                codeValue = codeValue.Substring(0, codeValue.Length - 1);
            }

            RefreshInputFields();
        }

        private void ClearSelected()
        {
            if (inputTarget == InputTarget.Address)
            {
                addressValue = string.Empty;
            }
            else
            {
                codeValue = string.Empty;
            }

            RefreshInputFields();
        }

        private void Connect()
        {
            networkClient.BeginEnrollment(addressValue, codeValue);
        }

        private void RefreshInputFields()
        {
            if (addressText == null || codeText == null)
            {
                return;
            }

            addressText.text = string.IsNullOrWhiteSpace(addressValue)
                ? "Select, then enter address"
                : addressValue;
            codeText.text = string.IsNullOrWhiteSpace(codeValue)
                ? "Select, then enter 6 digits"
                : new string('•', codeValue.Length);
            addressText.color = inputTarget == InputTarget.Address
                ? TextColor
                : MutedColor;
            codeText.color = inputTarget == InputTarget.PairingCode
                ? TextColor
                : MutedColor;
        }

        private void RefreshDeveloperText(StudyClientStatus current)
        {
            if (developerText == null)
            {
                return;
            }

            developerText.text =
                $"RESEARCHER / DEVELOPMENT\n" +
                $"Phase: {current.Phase}\n" +
                $"Slot: {BlankAsDash(current.DeviceId)}\n" +
                $"Participant: {BlankAsDash(current.ParticipantId)}\n" +
                $"Role: {BlankAsDash(current.Role)}\n" +
                $"Protocol: {current.ProtocolVersion}\n" +
                $"Build: {current.AppBuildId}\n" +
                $"State version: {current.LastAppliedStateVersion}\n" +
                $"Heartbeat RTT: {(current.LastHeartbeatRoundTripMs < 0d ? "—" : current.LastHeartbeatRoundTripMs.ToString("F1") + " ms")}\n" +
                $"Fail-safe: {(current.IsFailSafeActive ? "ACTIVE" : "clear")}";
        }

        private GameObject CreatePanel(RectTransform parent, string name, Color color)
        {
            GameObject panelObject = new GameObject(name, typeof(RectTransform), typeof(Image));
            panelObject.transform.SetParent(parent, false);
            Image image = panelObject.GetComponent<Image>();
            image.color = color;
            Stretch(panelObject.GetComponent<RectTransform>(), 0f);
            return panelObject;
        }

        private Text CreateText(
            Transform parent,
            string name,
            string value,
            int fontSize,
            TextAnchor alignment,
            Color color,
            Vector2? position = null,
            Vector2? size = null)
        {
            GameObject textObject = new GameObject(name, typeof(RectTransform), typeof(Text));
            textObject.transform.SetParent(parent, false);
            Text text = textObject.GetComponent<Text>();
            text.font = font;
            text.text = value;
            text.fontSize = fontSize;
            text.alignment = alignment;
            text.color = color;
            text.horizontalOverflow = HorizontalWrapMode.Wrap;
            text.verticalOverflow = VerticalWrapMode.Truncate;
            if (position.HasValue && size.HasValue)
            {
                Place(text.rectTransform, position.Value, size.Value);
            }
            return text;
        }

        private Button CreateButton(
            Transform parent,
            string name,
            string label,
            Vector2 position,
            Vector2 size,
            Color color,
            Action onClick)
        {
            GameObject buttonObject = new GameObject(
                name,
                typeof(RectTransform),
                typeof(Image),
                typeof(Button));
            buttonObject.transform.SetParent(parent, false);
            Place(buttonObject.GetComponent<RectTransform>(), position, size);
            Image image = buttonObject.GetComponent<Image>();
            image.color = color;
            Button button = buttonObject.GetComponent<Button>();
            button.targetGraphic = image;
            button.onClick.AddListener(() => onClick());
            Text text = CreateText(
                buttonObject.transform,
                "Label",
                label,
                23,
                TextAnchor.MiddleCenter,
                TextColor);
            Stretch(text.rectTransform, 8f);
            return button;
        }

        private static void Place(RectTransform rect, Vector2 position, Vector2 size)
        {
            rect.anchorMin = new Vector2(0.5f, 0.5f);
            rect.anchorMax = new Vector2(0.5f, 0.5f);
            rect.pivot = new Vector2(0.5f, 0.5f);
            rect.anchoredPosition = position;
            rect.sizeDelta = size;
        }

        private static void Stretch(RectTransform rect, float inset)
        {
            rect.anchorMin = Vector2.zero;
            rect.anchorMax = Vector2.one;
            rect.offsetMin = new Vector2(inset, inset);
            rect.offsetMax = new Vector2(-inset, -inset);
        }

        private static string ExtractHost(string serverAddress)
        {
            return Uri.TryCreate(serverAddress, UriKind.Absolute, out Uri uri)
                ? uri.Host
                : serverAddress;
        }

        private static string BlankAsDash(string value)
        {
            return string.IsNullOrWhiteSpace(value) ? "—" : value;
        }
    }
}
