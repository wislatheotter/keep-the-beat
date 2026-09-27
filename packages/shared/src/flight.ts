import { BLOCK_REST_Y, FALL_ACCEL } from './constants.js';
import type { Vec3 } from './types.js';

const RESYNC_EPSILON = 0.05;

const CORRECTION_LAMBDA = 2.2;

export type FlightSample = {
  position: Vec3;
  velocity: Vec3;
  airborne: boolean;
};

export class BlockFlight {
  readonly position: Vec3 = { x: 0, y: 0, z: 0 };
  private velocity: Vec3 = { x: 0, y: 0, z: 0 };
  private seeded = false;
  private airborne = false;
  private lastAuthVelocityX = 0;
  private lastAuthVelocityZ = 0;

  reseededThisFrame = false;

  advance(sample: FlightSample, deltaSeconds: number): Vec3 {
    const dt = Math.min(Math.max(deltaSeconds, 0), 0.05);
    const startedFlight = sample.airborne && !this.airborne;
    const discontinuity =
      Math.abs(sample.velocity.x - this.lastAuthVelocityX) +
      Math.abs(sample.velocity.z - this.lastAuthVelocityZ) > RESYNC_EPSILON;

    this.reseededThisFrame = !this.seeded || startedFlight || (sample.airborne && discontinuity);
    if (this.reseededThisFrame) {
      this.position.x = sample.position.x;
      this.position.y = sample.position.y;
      this.position.z = sample.position.z;
      this.velocity.x = sample.velocity.x;
      this.velocity.y = sample.velocity.y;
      this.velocity.z = sample.velocity.z;
      this.seeded = true;
    }

    this.lastAuthVelocityX = sample.velocity.x;
    this.lastAuthVelocityZ = sample.velocity.z;
    this.airborne = sample.airborne;

    if (sample.airborne) {
      this.velocity.y -= FALL_ACCEL * dt;
      this.position.x += this.velocity.x * dt;
      this.position.y += this.velocity.y * dt;
      this.position.z += this.velocity.z * dt;
      if (this.position.y < BLOCK_REST_Y) this.position.y = BLOCK_REST_Y;
      approach(this.position, sample.position, 1 - Math.exp(-dt * CORRECTION_LAMBDA));
    } else {
      approach(this.position, sample.position, 1 - Math.exp(-dt * 16));
      this.velocity.x = 0;
      this.velocity.y = 0;
      this.velocity.z = 0;
    }

    return this.position;
  }
}

function approach(current: Vec3, target: Vec3, t: number) {
  current.x += (target.x - current.x) * t;
  current.y += (target.y - current.y) * t;
  current.z += (target.z - current.z) * t;
}
