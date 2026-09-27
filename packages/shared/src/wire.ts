import type { PlayerPose, PoseReport } from './presence.js';

export const LIVE_PATH = '/live';

export const PROTOCOL = 7;

export const POLL_PATH = `${LIVE_PATH}/poll`;

export const HELLO = 'hello';

export const ACK = 0;

export const REFUSED = 4001;

export const OUTDATED = 4002;

export const SNAPSHOT_FRAME = 1;
export const POSE_FRAME = 2;
export const POSES_FRAME = 3;

const POSE_BYTES = 8 + 4 * 4 + 1;
const ID_BYTES = 16;
const ENTRY_BYTES = ID_BYTES + POSE_BYTES;

function writePose(view: DataView, at: number, pose: PoseReport) {
  view.setFloat64(at, pose.t, true);
  view.setFloat32(at + 8, pose.x, true);
  view.setFloat32(at + 12, pose.y, true);
  view.setFloat32(at + 16, pose.z, true);
  view.setFloat32(at + 20, pose.yaw, true);
  view.setUint8(at + 24, (pose.moving ? 1 : 0) | (pose.aiming ? 2 : 0));
}

function readPoseAt(view: DataView, at: number): PoseReport | null {
  const flags = view.getUint8(at + 24);
  if (flags > 3) return null;
  return {
    t: view.getFloat64(at, true),
    x: view.getFloat32(at + 8, true),
    y: view.getFloat32(at + 12, true),
    z: view.getFloat32(at + 16, true),
    yaw: view.getFloat32(at + 20, true),
    moving: (flags & 1) !== 0,
    aiming: (flags & 2) !== 0,
  };
}

const viewOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

export function encodePose(pose: PoseReport): Uint8Array {
  const bytes = new Uint8Array(1 + POSE_BYTES);
  bytes[0] = POSE_FRAME;
  writePose(viewOf(bytes), 1, pose);
  return bytes;
}

export function decodePose(bytes: Uint8Array): PoseReport | null {
  if (bytes.length !== 1 + POSE_BYTES || bytes[0] !== POSE_FRAME) return null;
  return readPoseAt(viewOf(bytes), 1);
}

export function encodePoses(poses: readonly PlayerPose[]): Uint8Array {
  const sendable = poses.filter((pose) => pose.id.length === ID_BYTES);
  const bytes = new Uint8Array(3 + sendable.length * ENTRY_BYTES);
  const view = viewOf(bytes);
  bytes[0] = POSES_FRAME;
  view.setUint16(1, sendable.length, true);
  let at = 3;
  for (const pose of sendable) {
    for (let i = 0; i < ID_BYTES; i += 1) bytes[at + i] = pose.id.charCodeAt(i) & 0x7f;
    writePose(view, at + ID_BYTES, pose);
    at += ENTRY_BYTES;
  }
  return bytes;
}

export function decodePoses(bytes: Uint8Array): PlayerPose[] | null {
  if (bytes.length < 3 || bytes[0] !== POSES_FRAME) return null;
  const view = viewOf(bytes);
  const count = view.getUint16(1, true);
  if (bytes.length !== 3 + count * ENTRY_BYTES) return null;
  const poses: PlayerPose[] = [];
  for (let n = 0, at = 3; n < count; n += 1, at += ENTRY_BYTES) {
    const pose = readPoseAt(view, at + ID_BYTES);
    if (!pose) return null;
    poses.push({ id: String.fromCharCode(...bytes.subarray(at, at + ID_BYTES)), ...pose });
  }
  return poses;
}

export const BATCH_TEXT = 0;
export const BATCH_BINARY = 1;
export const BATCH_CLOSE = 2;

export type BatchFrame = { kind: number; data: Uint8Array };

const utf8Out = new TextEncoder();
const utf8In = new TextDecoder();

export function encodeBatch(frames: readonly BatchFrame[], head = 0): Uint8Array {
  let length = head;
  for (const frame of frames) length += 5 + frame.data.byteLength;
  const bytes = new Uint8Array(length);
  const view = viewOf(bytes);
  let at = head;
  for (const frame of frames) {
    bytes[at] = frame.kind;
    view.setUint32(at + 1, frame.data.byteLength, true);
    bytes.set(frame.data, at + 5);
    at += 5 + frame.data.byteLength;
  }
  return bytes;
}

export function decodeBatch(bytes: Uint8Array, head = 0): BatchFrame[] | null {
  const view = viewOf(bytes);
  const frames: BatchFrame[] = [];
  let at = head;
  while (at < bytes.length) {
    if (at + 5 > bytes.length) return null;
    const kind = bytes[at]!;
    const size = view.getUint32(at + 1, true);
    if (kind > BATCH_CLOSE || at + 5 + size > bytes.length) return null;
    frames.push({ kind, data: bytes.subarray(at + 5, at + 5 + size) });
    at += 5 + size;
  }
  return frames;
}

export function encodeClose(code: number, reason: string): Uint8Array {
  const text = utf8Out.encode(reason);
  const bytes = new Uint8Array(2 + text.length);
  viewOf(bytes).setUint16(0, code, true);
  bytes.set(text, 2);
  return bytes;
}

export function decodeClose(data: Uint8Array): { code: number; reason: string } {
  if (data.length < 2) return { code: 1005, reason: '' };
  return { code: viewOf(data).getUint16(0, true), reason: utf8In.decode(data.subarray(2)) };
}
