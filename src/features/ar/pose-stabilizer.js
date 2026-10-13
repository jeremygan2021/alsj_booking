import { Matrix4, Vector3, Quaternion } from "three-mindar";

// Input comes from the image tracker; rendering interpolates independently of its FPS.
export class PoseStabilizer {
  constructor() {
    this.reset();
  }
  reset() {
    this.target = null;
    this.current = null;
    this.candidate = null;
  }
  sample(matrix, time) {
    const pose = {
      position: new Vector3(),
      rotation: new Quaternion(),
      scale: new Vector3(),
    };
    matrix.decompose(pose.position, pose.rotation, pose.scale);
    if (
      ![...pose.position, ...pose.scale, ...pose.rotation].every(
        Number.isFinite,
      ) ||
      pose.scale.x <= 0
    )
      return;
    if (!this.target) {
      this.target = pose;
      this.current = {
        position: pose.position.clone(),
        rotation: pose.rotation.clone(),
        scale: pose.scale.clone(),
      };
      return;
    }
    const width = this.target.scale.x;
    const distance = pose.position.distanceTo(this.target.position) / width;
    const angle = pose.rotation.angleTo(this.target.rotation);
    const ratio = Math.abs(pose.scale.x / width - 1);
    if (distance > 0.28 || angle > 0.65 || ratio > 0.3) {
      if (
        !this.candidate ||
        pose.position.distanceTo(this.candidate.pose.position) / width > 0.12
      ) {
        this.candidate = { pose, since: time, count: 1 };
        return;
      }
      this.candidate.count++;
      if (time - this.candidate.since < 180 || this.candidate.count < 3) return;
    }
    this.candidate = null;
    if (distance < 0.003 && angle < 0.008 && ratio < 0.004) return;
    this.target = pose;
  }
  render(deltaSeconds) {
    if (!this.current) return null;
    const alpha = 1 - Math.exp(-Math.min(deltaSeconds, 0.1) / 0.095);
    this.current.position.lerp(this.target.position, alpha);
    this.current.rotation.slerp(this.target.rotation, alpha);
    this.current.scale.lerp(this.target.scale, alpha);
    return new Matrix4().compose(
      this.current.position,
      this.current.rotation,
      this.current.scale,
    );
  }
}
