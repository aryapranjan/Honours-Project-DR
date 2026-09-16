using Unity.Collections;
using Unity.Jobs;
using Unity.Mathematics;
using Vector2 = UnityEngine.Vector2;

namespace AprilTag {

//
// Job struct that wraps AprilTag pose estimator
//
struct PoseEstimationJob : Unity.Jobs.IJobParallelFor
{
    // Input data struct that simply wraps pointers to tag detection data
    public struct Input
    {
        unsafe Interop.Detection* p;

        unsafe public Input(ref Interop.Detection r)
          => p = (Interop.Detection*)Interop.Util.AsPointer(ref r);

        unsafe public ref Interop.Detection Ref
          => ref Interop.Util.AsRef<Interop.Detection>(p);
    }

    // I/O
    [ReadOnly] NativeArray<Input> _input;
    [WriteOnly] NativeArray<TagPose> _output;

    // Camera parameters
    double _tagSize;
    double2 _focalLength;
    double2 _focalCenter;

    // Constructor
    public PoseEstimationJob
      (NativeArray<Input> input, NativeArray<TagPose> output,
       int width, int height, float fov, float tagSize)
      : this(input, output,
             new Vector2(width / 2 / math.tan(fov / 2),
                         width / 2 / math.tan(fov / 2)),
             new Vector2(width, height) / 2,
             tagSize)
    {
    }

    public PoseEstimationJob
      (NativeArray<Input> input, NativeArray<TagPose> output,
       Vector2 focalLength, Vector2 focalCenter, float tagSize)
    {
        _input = input;
        _output = output;
        _tagSize = tagSize;
        _focalLength = math.double2(focalLength.x, focalLength.y);
        _focalCenter = math.double2(focalCenter.x, focalCenter.y);
    }

    // Job execution method
    public void Execute(int i)
    {
        ref var detection = ref _input[i].Ref;

        var info = new Interop.DetectionInfo(ref detection, _tagSize,
           _focalLength.x, _focalLength.y, _focalCenter.x, _focalCenter.y);

        using var pose = new Interop.Pose(ref info);

        var pos = pose.t.AsFloat3() * math.float3(1, -1, 1);

        var rot = math.quaternion(pose.R.AsFloat3x3());
        rot = rot.value * math.float4(-1, 1, -1, 1);

        var center = detection.Center;
        var corner1 = detection.Corner1;
        var corner2 = detection.Corner2;
        var corner3 = detection.Corner3;
        var corner4 = detection.Corner4;

        _output[i] = new TagPose(
            detection.ID,
            pos,
            rot,
            new Vector2((float)center.x, (float)center.y),
            new Vector2((float)corner1.x, (float)corner1.y),
            new Vector2((float)corner2.x, (float)corner2.y),
            new Vector2((float)corner3.x, (float)corner3.y),
            new Vector2((float)corner4.x, (float)corner4.y)
        );
    }
}

} // namespace AprilTag
