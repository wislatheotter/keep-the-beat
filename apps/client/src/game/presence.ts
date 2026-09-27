import {
  createPoseTrack,
  pushPose,
  samplePose as playBack,
  type PlayerPose,
  type PoseTrack,
  type SampledPose,
} from '@loop/shared';
import { DEV_HANDLE } from '../runtime/devFlag';

const tracks = new Map<string, PoseTrack>();

export { makeSampledPose, type SampledPose } from '@loop/shared';

export function receivePoses(poses: PlayerPose[], arrivedAt: number) {
  for (const pose of poses) {
    let track = tracks.get(pose.id);
    if (!track) tracks.set(pose.id, (track = createPoseTrack()));
    pushPose(track, pose, arrivedAt);
  }
}

export function forgetPoses(playerId: string) {
  tracks.delete(playerId);
}

export function samplePose(playerId: string, delta: number, out: SampledPose): boolean {
  const track = tracks.get(playerId);
  return track ? playBack(track, delta, out) : false;
}

if (DEV_HANDLE) {
  const handle = ((window as unknown as { __loop?: Record<string, unknown> }).__loop ??= {});
  handle.presence = () => Object.fromEntries([...tracks].map(([id, track]) => [id, {
    buffered: track.poses.length,
    interval: Math.round(track.interval),
    delay: Math.round(track.delay),
    jitter: Math.round(track.jitter),
    starves: track.starves,
    starvedMs: Math.round(track.starvedMs),
    span: track.poses.length > 1 ? Math.round(track.poses[track.poses.length - 1]!.t - track.poses[0]!.t) : 0,
    resyncs: track.resyncs,
    cuts: track.cuts,
    dropped: track.dropped,
    lastCut: track.lastCut && { distance: Number(track.lastCut.distance.toFixed(2)), span: Math.round(track.lastCut.span) },
  }]));
}
