# Unity-PassthroughCameraAPISamples

## Project Overview

The **Unity-PassthroughCameraAPISamples** project helps Unity developers access Quest camera data using the **PassthroughCameraAccess** component from the Mixed Reality Utility Kit (MRUK). This component provides direct access to headset cameras with enhanced functionality including:
- **Precise timestamps** for better camera-world alignment
- **Simultaneous access to both cameras** (left and right)
- **Complete camera metadata** including intrinsics, extrinsics, and pose information

The project includes **five sample scenes** demonstrating various use cases:

| CameraToWorld | BrightnessEstimation | MultiObjectDectection | ShaderSample |
|:-------------:|:--------------------:|:---------------------:|:------------:|
| ![GIF 1](./Media/CameraToWorld.gif) | ![GIF 2](./Media/BrightnessEstimation.gif) | ![GIF 3](./Media/ObjectDetectionSentis.gif) | ![GIF 4](./Media/ShaderSample.gif) |

## Collaborative DR study extension

This checkout also contains the authoritative Final Design study application in
`Assets/Final-Design-Scene.unity`, its laptop controller in `StudyController/`,
and the study documentation in `Docs/`. Start with
[`Docs/PROJECT_HANDOFF.md`](Docs/PROJECT_HANDOFF.md); Phase 6 implementation and
remaining physical gates are recorded in
[`Docs/Development/Phase6Implementation.md`](Docs/Development/Phase6Implementation.md).
The original sample scenes remain available as reference material.

## Documentation

For comprehensive guides, API reference, and tutorials, visit the official Meta Developers documentation:

- **[Passthrough Camera API Overview](https://developers.meta.com/horizon/documentation/unity/unity-pca-overview)** - Introduction and key concepts
- **[Getting Started Guide](https://developers.meta.com/horizon/documentation/unity/unity-pca-documentation)** - Setup, configuration, and usage instructions
- **[Unity Inference Engine Integration](https://developers.meta.com/horizon/documentation/unity/unity-pca-sentis)** - Using ML/CV models with PCA
- **[Migration Guide](https://developers.meta.com/horizon/documentation/unity/unity-pca-migration-from-webcamtexture)** - Migrating from WebCamTexture

## Requirements

- **Unity:** 6000.0.38f1 or newer
- **Packages:**
  - [Meta MRUK](https://assetstore.unity.com/packages/tools/integration/meta-mr-utility-kit-272450) (v81 or higher)
  - [Unity Inference Engine](https://unity.com/sentis) (v2.2.1 for MultiObjectDetection sample)
- **Hardware:** Quest 3 / Quest 3S with Horizon OS v74 or higher
- **Permissions:** `horizonos.permission.HEADSET_CAMERA`
- **Passthrough:** Must be enabled in your project

> [!NOTE]
> You must use a physical headset or Meta Horizon Link v2.1 or later to preview the passthrough camera. XR Simulator does not currently support Passthrough Camera API.

## Download the Project

First, ensure you have Git LFS installed by running this command:

```bash
git lfs install
```

Then, clone this repo using the "Code" button above, or this command:

```bash
git clone https://github.com/oculus-samples/Unity-PassthroughCameraApiSamples
```

## Project Content

The project contains **five sample scenes** that demonstrate how to use the **PassthroughCameraAccess** component to access Quest camera data. All sample code and resources are located in the [**`PassthroughCameraApiSamples`**](./Assets/PassthroughCameraApiSamples/) folder:

### Samples

* **[`CameraViewer`](./Assets/PassthroughCameraApiSamples/CameraViewer)** - Displays a 2D canvas with camera feed
* **[`CameraToWorld`](./Assets/PassthroughCameraApiSamples/CameraToWorld)** - Aligns RGB camera pose with Passthrough and transforms 2D coordinates to 3D world space rays
* **[`BrightnessEstimation`](./Assets/PassthroughCameraApiSamples/BrightnessEstimation)** - Adapts the experience based on environment brightness
* **[`MultiObjectDetection`](./Assets/PassthroughCameraApiSamples/MultiObjectDetection)** - Uses Unity Inference Engine for real-world object recognition
* **[`ShaderSample`](./Assets/PassthroughCameraApiSamples/ShaderSample)** - Applies custom GPU effects to camera texture

### Additional Components

* **[`PassthroughCamera`](./Assets/PassthroughCameraApiSamples/PassthroughCamera)** - C# classes and utilities for camera access
* **[`StartScene`](./Assets/PassthroughCameraApiSamples/StartScene)** - Menu scene for switching between samples

## Getting Started

1. Clone the GitHub project as described [above](#download-the-project)
2. Open the project with **Unity 6000.0.38f1** or newer
3. Open a sample scene from the **[`PassthroughCameraApiSamples`](./Assets/PassthroughCameraApiSamples/)** folder
4. Use **Meta > Tools > Project Setup Tool** to fix any configuration issues
5. Build and deploy to your Quest 3/3S device

For detailed setup instructions, API reference, and usage examples, see the **[Getting Started Guide](https://developers.meta.com/horizon/documentation/unity/unity-pca-documentation)**.

## Learn More

For comprehensive information about using the Passthrough Camera API:

- **Setup & Configuration** - [Getting Started Guide](https://developers.meta.com/horizon/documentation/unity/unity-pca-documentation)
- **Unity Inference Engine Integration** - [ML/CV with PCA](https://developers.meta.com/horizon/documentation/unity/unity-pca-sentis)
- **Troubleshooting** - See the troubleshooting section in the [Getting Started Guide](https://developers.meta.com/horizon/documentation/unity/unity-pca-documentation#troubleshooting)

## Report an Issue

If you encounter any issues, please report them with:

- **Unity Engine version**
- **XR plugin** (Oculus XR or Open XR) and version number
- **Quest device** model and **Horizon OS version**
- **Quest logs** (use `npx -y @meta-quest/hzdb log -t Unity`)
- **Video or screenshot** of the issue
- **Relevant information** about your use case

## License

The [`Oculus License`](./LICENSE.txt) applies to the SDK and supporting material. The [`MIT License`](./Assets/PassthroughCameraApiSamples/LICENSE.txt) applies to only certain, clearly marked documents. If an individual file does not indicate which license it is subject to, then the Oculus License applies.

However,
* Files from [`Assets/PassthroughCameraApiSamples/MultiObjectDetection/SentisInference/Model`](./Assets/PassthroughCameraApiSamples/MultiObjectDetection/SentisInference/Model) are licensed under [`MIT`](https://github.com/MultimediaTechLab/YOLO/blob/main/LICENSE).

See the [`CONTRIBUTING`](./CONTRIBUTING.md) file for how to help out.

## Development tooling

Project-specific Quest guidance lives in `AGENTS.md`. The repository keeps one
shared `hzdb` configuration in `.mcp.json`, plus the Unity and Quest setup used
by VS Code in `.vscode/`. Client-specific AI configuration files are deliberately
excluded to keep the project root focused on the study implementation.

Optional Quest tooling and Unity skills are available from
[github.com/meta-quest/agentic-tools](https://github.com/meta-quest/agentic-tools).
