import { MathUtils } from 'three';

export class Spring {
  value: number;
  velocity = 0;

  constructor(
    private readonly stiffness: number,
    private readonly damping: number,
    private readonly initial = 0,
  ) {
    this.value = initial;
  }

  reset() {
    this.value = this.initial;
    this.velocity = 0;
  }

  step(target: number, dt: number) {
    const h = dt / 2;
    for (let i = 0; i < 2; i += 1) {
      this.velocity += (this.stiffness * (target - this.value) - this.damping * this.velocity) * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
}

const smooth = MathUtils.smoothstep;

export function bump(p: number, from: number, peak: number, to: number) {
  if (p <= from || p >= to) return 0;
  return p < peak ? smooth(p, from, peak) : 1 - smooth(p, peak, to);
}

export function punch(phase: number, sharpness = 4) {
  const wrapped = phase - Math.floor(phase);
  return (1 - wrapped) ** sharpness;
}

export function windUp(phase: number, lead = 0.25) {
  const wrapped = phase - Math.floor(phase);
  return smooth(wrapped, 1 - lead, 1);
}

export function spinAngle(p: number, turns: number) {
  const x = Math.min(1, Math.max(0, p));
  return turns * Math.PI * 2 * (x - Math.sin(Math.PI * 2 * x) / (Math.PI * 2));
}
