import { PLAYER_SPEED } from './constants.js';

export const POSE_INTERVAL_MS = 30;

export const POSE_STALE_MS = 220;

export type PlayerPose = {
  id: string;
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  moving: boolean;
  aiming: boolean;
};

export type PoseReport = Omit<PlayerPose, 'id'>;

export type PoseTrack = {
  poses: PlayerPose[];
  head: number;
  playing: boolean;
  interval: number;
  baseline: number;
  jitter: number;
  frame: number;
  jitterAt: number;
  delay: number;
  starving: boolean;
  starvedAt: number;
  resyncs: number;
  cuts: number;
  dropped: number;
  starves: number;
  starvedMs: number;
  lastCut: { distance: number; span: number } | null;
};

export type SampledPose = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  moving: boolean;
  aiming: boolean;
  cut: boolean;
};

const BUFFER_MS = 1500;

const DELAY_INTERVALS = 1.15;
const MIN_DELAY_MS = 25;
const MAX_DELAY_MS = 600;

const BASELINE_CREEP = 0.004;
const JITTER_HALF_LIFE_MS = 2500;
const FRAME_HALF_LIFE_MS = 2500;

const STARVE_BUMP_MS = 15;
const STARVE_BUMP_EVERY_MS = 200;
const MAX_JITTER_MS = 450;

const INTERVAL_RISE = 0.4;
const INTERVAL_FALL = 0.05;

const CATCHUP_MS = 400;
const CATCHUP = 0.15;
const RESYNC_MS = 700;

const STALL_MS = 250;

const STALL_GRACE_MS = 80;

const RESTART_MS = 1000;

const teleported = (distance: number, spanMs: number) => distance > PLAYER_SPEED * 1.8 * (spanMs / 1000) + 0.6;

export function createPoseTrack(): PoseTrack {
  return {
    poses: [], head: 0, playing: false, interval: POSE_INTERVAL_MS,
    baseline: Infinity, jitter: 0, frame: 0, jitterAt: 0, delay: POSE_INTERVAL_MS,
    starving: false, starvedAt: 0,
    resyncs: 0, cuts: 0, dropped: 0, starves: 0, starvedMs: 0, lastCut: null,
  };
}

export function makeSampledPose(): SampledPose {
  return { x: 0, y: 0, z: 0, yaw: 0, moving: false, aiming: false, cut: true };
}

export function pushPose(track: PoseTrack, pose: PlayerPose, arrivedAt: number) {
  const newest = track.poses[track.poses.length - 1];
  if (newest && pose.t <= newest.t) { track.dropped += 1; return; }
  if (newest && pose.t - newest.t > RESTART_MS) {
    track.poses.length = 0;
    track.playing = false;
    track.interval = POSE_INTERVAL_MS;
    track.baseline = Infinity;
  } else if (newest) {
    const gap = Math.min(pose.t - newest.t, MAX_DELAY_MS);
    track.interval += (gap - track.interval) * (gap > track.interval ? INTERVAL_RISE : INTERVAL_FALL);
  }
  observeArrival(track, pose, arrivedAt);
  track.poses.push(pose);
  const cutoff = pose.t - BUFFER_MS;
  while (track.poses.length > 2 && track.poses[0]!.t < cutoff) track.poses.shift();
}

function observeArrival(track: PoseTrack, pose: PlayerPose, arrivedAt: number) {
  const transit = arrivedAt - pose.t;
  const elapsed = track.jitterAt ? Math.max(0, arrivedAt - track.jitterAt) : 0;
  track.jitterAt = arrivedAt;
  if (Number.isFinite(track.baseline)) track.baseline += elapsed * BASELINE_CREEP;
  if (transit < track.baseline) track.baseline = transit;
  const late = transit - track.baseline;
  const decayed = track.jitter * Math.pow(0.5, elapsed / JITTER_HALF_LIFE_MS);
  track.jitter = Math.min(MAX_JITTER_MS, Math.max(decayed, late));
}

export function samplePose(track: PoseTrack, delta: number, out: SampledPose): boolean {
  const poses = track.poses;
  if (!poses.length) return false;

  const newest = poses[poses.length - 1]!;
  const oldest = poses[0]!;
  const frameStep = delta * 1000;
  track.frame = Math.max(track.frame * Math.pow(0.5, frameStep / FRAME_HALF_LIFE_MS), frameStep);
  const delay = Math.min(
    MAX_DELAY_MS,
    Math.max(MIN_DELAY_MS, track.interval * DELAY_INTERVALS + track.jitter + track.frame),
  );
  track.delay = delay;
  const want = newest.t - delay;

  out.cut = false;
  if (!track.playing || Math.abs(want - track.head) > RESYNC_MS) {
    if (track.playing) track.resyncs += 1;
    track.head = want;
    track.playing = true;
    out.cut = true;
  } else {
    const drift = want - track.head;
    const rate = 1 + Math.max(-CATCHUP, Math.min(CATCHUP, drift / CATCHUP_MS));
    track.head += delta * 1000 * rate;
  }
  track.head = Math.max(oldest.t, Math.min(track.head, newest.t + STALL_MS));

  const dry = track.head > newest.t;
  if (dry && newest.t - oldest.t > delay) {
    if (!track.starving || newest.t - track.starvedAt > STARVE_BUMP_EVERY_MS) {
      track.jitter = Math.min(MAX_JITTER_MS, track.jitter + STARVE_BUMP_MS);
      track.starvedAt = newest.t;
      if (!track.starving) track.starves += 1;
    }
    track.starvedMs += frameStep;
  }
  track.starving = dry;

  let index = poses.length - 1;
  while (index > 0 && poses[index]!.t > track.head) index -= 1;
  const from = poses[index]!;
  const to = poses[index + 1] ?? from;
  const span = to.t - from.t;
  const u = span > 0 ? Math.max(0, Math.min(1, (track.head - from.t) / span)) : 1;

  const step = Math.hypot(to.x - from.x, to.z - from.z);
  if (span > 0 && teleported(step, span)) {
    const at = u < 0.5 ? from : to;
    out.x = at.x; out.y = at.y; out.z = at.z; out.yaw = at.yaw;
    out.cut = true;
    track.cuts += 1;
    track.lastCut = { distance: step, span };
  } else {
    out.x = from.x + (to.x - from.x) * u;
    out.y = from.y + (to.y - from.y) * u;
    out.z = from.z + (to.z - from.z) * u;
    out.yaw = from.yaw + shortestTurn(from.yaw, to.yaw) * u;
  }

  const quiet = track.head > newest.t + STALL_GRACE_MS + track.frame;
  out.moving = !quiet && (from.moving || to.moving);
  out.aiming = quiet ? false : from.aiming || to.aiming;
  return true;
}

function shortestTurn(from: number, to: number) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}
