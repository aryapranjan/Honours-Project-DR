using System.Collections;
using CollaborativeDR.DiminishedReality;
using CollaborativeDR.Networking;
using CollaborativeDR.StudyCore;
using CollaborativeDR.Telemetry;
using CollaborativeDR.UserInterface;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.TestTools;

namespace CollaborativeDR.Tests.PlayMode
{
    public sealed class Phase4RuntimeSmokeTests
    {
        [Test]
        public void QuestInputUsesRightControllerTriggerAndActivatesOnMobile()
        {
            GameObject eventObject = new GameObject(
                "Phase4QuestEventSystem",
                typeof(EventSystem),
                typeof(OVRInputModule));
            GameObject anchorObject = new GameObject("RightControllerAnchor");
            OVRInputModule inputModule = eventObject.GetComponent<OVRInputModule>();

            HeadsetStudyView.ConfigureQuestInputModule(
                inputModule,
                anchorObject.transform);

            Assert.That(inputModule.allowActivationOnMobileDevice, Is.True);
            Assert.That(inputModule.IsModuleSupported(), Is.True);
            Assert.That(inputModule.rayTransform, Is.SameAs(anchorObject.transform));
            Assert.That(
                inputModule.joyPadClickButton,
                Is.EqualTo(OVRInput.Button.PrimaryIndexTrigger));

            Object.DestroyImmediate(anchorObject);
            Object.DestroyImmediate(eventObject);
        }

        [UnityTest]
        public IEnumerator RuntimeBuildsResearcherSetupWithoutASecondScene()
        {
            GameObject cameraObject = new GameObject("Phase4RuntimeCamera", typeof(Camera));
            cameraObject.tag = "MainCamera";
            Camera runtimeCamera = cameraObject.GetComponent<Camera>();
            runtimeCamera.clearFlags = CameraClearFlags.Nothing;
            runtimeCamera.backgroundColor = Color.magenta;

            GameObject runtime = new GameObject("Phase4RuntimeTest");
            runtime.AddComponent<QuestEventLogger>();
            runtime.AddComponent<PassthroughSafetyController>();
            StudyNetworkClient client = runtime.AddComponent<StudyNetworkClient>();
            runtime.AddComponent<HeadsetStudyView>();

            yield return null;

            Assert.That(client.CurrentStatus.Phase, Is.EqualTo(StudyClientPhase.Setup));
            Assert.That(
                GameObject.Find("HeadsetStudyCanvas"),
                Is.Not.Null,
                "The app-owned setup/waiting canvas was not created.");
            Assert.That(
                GameObject.Find("ResearcherSetupPanel"),
                Is.Not.Null,
                "The researcher setup panel was not created.");
            Assert.That(runtimeCamera.clearFlags, Is.EqualTo(CameraClearFlags.SolidColor));
            Assert.That(runtimeCamera.backgroundColor, Is.EqualTo(Color.clear));

            Object.Destroy(runtime);
            Object.Destroy(cameraObject);
            yield return null;
        }
    }
}
