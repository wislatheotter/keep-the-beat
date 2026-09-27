import type { TransformPlan } from './loopTransform';
import type { TransformRequest, TransformResponse } from './transform.worker';

export type TransformResult = { channels: Float32Array[]; release: () => void };

type Job = {
  channelCount: number;
  inputLength: number;
  fill: (targets: Float32Array[]) => void;
  sampleRate: number;
  plan: TransformPlan;
  resolve: (result: TransformResult) => void;
  reject: (error: Error) => void;
};

const ROUND_BYTES = 1 << 20;
const POOL_LIMIT_BYTES = 96 << 20;

class BufferPool {
  private free: ArrayBuffer[] = [];

  take(samples: number): ArrayBuffer {
    const bytes = samples * 4;
    let best = -1;
    for (let i = 0; i < this.free.length; i += 1) {
      const size = this.free[i]!.byteLength;
      if (size >= bytes && (best < 0 || size < this.free[best]!.byteLength)) best = i;
    }
    if (best >= 0) return this.free.splice(best, 1)[0]!;
    return new ArrayBuffer(Math.ceil(bytes / ROUND_BYTES) * ROUND_BYTES);
  }

  give(buffer: ArrayBuffer) {
    if (buffer.byteLength === 0) return;
    const kept = this.free.reduce((sum, each) => sum + each.byteLength, 0);
    if (kept + buffer.byteLength <= POOL_LIMIT_BYTES) this.free.push(buffer);
  }
}

class TransformPool {
  private workers: Array<{ worker: Worker; job: (Job & { input: ArrayBuffer[]; output: ArrayBuffer[] }) | null }> = [];
  private queue: Job[] = [];
  private buffers = new BufferPool();
  private nextId = 1;

  private ensure() {
    if (this.workers.length > 0) return;
    for (let i = 0; i < WORKERS; i += 1) {
      const worker = new Worker(new URL('./transform.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<TransformResponse>) => this.settle(i, event.data);
      this.workers.push({ worker, job: null });
    }
  }

  private settle(index: number, reply: TransformResponse) {
    const slot = this.workers[index]!;
    const job = slot.job;
    slot.job = null;
    for (const buffer of reply.input) this.buffers.give(buffer);
    if (job) {
      if ('error' in reply) {
        for (const buffer of reply.output) this.buffers.give(buffer);
        job.reject(new Error(reply.error));
      } else {
        let released = false;
        job.resolve({
          channels: reply.output.map((buffer) => new Float32Array(buffer, 0, job.plan.outLength)),
          release: () => {
            if (released) return;
            released = true;
            for (const buffer of reply.output) this.buffers.give(buffer);
          },
        });
      }
    }
    this.pump();
  }

  private pump() {
    for (let i = 0; i < this.workers.length && this.queue.length > 0; i += 1) {
      const slot = this.workers[i]!;
      if (slot.job) continue;
      const job = this.queue.shift()!;
      const input = Array.from({ length: job.channelCount }, () => this.buffers.take(job.inputLength));
      const output = Array.from({ length: job.channelCount }, () => this.buffers.take(job.plan.outLength));
      try {
        job.fill(input.map((buffer) => new Float32Array(buffer, 0, job.inputLength)));
      } catch (error) {
        for (const buffer of [...input, ...output]) this.buffers.give(buffer);
        job.reject(error instanceof Error ? error : new Error(String(error)));
        i -= 1;
        continue;
      }
      const id = this.nextId++;
      slot.job = { ...job, input, output };
      const request: TransformRequest = { id, input, inputLength: job.inputLength, output, sampleRate: job.sampleRate, plan: job.plan };
      slot.worker.postMessage(request, [...input, ...output]);
    }
  }

  run(channelCount: number, inputLength: number, fill: (targets: Float32Array[]) => void, sampleRate: number, plan: TransformPlan): Promise<TransformResult> {
    this.ensure();
    return new Promise((resolve, reject) => {
      this.queue.push({ channelCount, inputLength, fill, sampleRate, plan, resolve, reject });
      this.pump();
    });
  }
}

const WORKERS = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 2));

export const transformPool = new TransformPool();
