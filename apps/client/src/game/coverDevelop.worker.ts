export type DevelopJob = {
  size: number;
  source: number;
  pixels: Uint16Array;
  quality: number;
};

export type DevelopAnswer = { blob: Blob } | { error: string };

const BLOOM_THRESHOLD = 1;
const BLOOM_SMOOTHING = 0.45;
const BLOOM_INTENSITY = 0.7;
const SATURATION = 0.16;
const VIGNETTE_OFFSET = 0.28;
const VIGNETTE_DARKNESS = 0.5;

const HALF = (() => {
  const table = new Float32Array(65536);
  for (let bits = 0; bits < 65536; bits += 1) {
    const sign = bits & 0x8000 ? -1 : 1;
    const exponent = (bits >> 10) & 0x1f;
    const fraction = bits & 0x3ff;
    table[bits] = exponent === 0
      ? sign * 2 ** -14 * (fraction / 1024)
      : exponent === 31 ? 0 : sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
  }
  return table;
})();

self.onmessage = async (event: MessageEvent<DevelopJob>) => {
  try {
    const job = event.data;
    const bytes = develop(job);
    const canvas = new OffscreenCanvas(job.size, job.size);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context in the worker');
    context.putImageData(new ImageData(bytes, job.size, job.size), 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: job.quality });
    (self as DedicatedWorkerGlobalScope).postMessage({ blob } satisfies DevelopAnswer);
  } catch (error) {
    (self as DedicatedWorkerGlobalScope).postMessage({ error: String(error) } satisfies DevelopAnswer);
  }
};

function develop({ size, source, pixels }: DevelopJob): Uint8ClampedArray<ArrayBuffer> {
  const scale = Math.max(1, Math.round(source / size));
  const rgb = new Float32Array(size * size * 3);
  const share = 1 / (scale * scale);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < scale; sy += 1) {
        const row = source - 1 - (y * scale + sy);
        for (let sx = 0; sx < scale; sx += 1) {
          const at = (row * source + x * scale + sx) * 4;
          r += finite(HALF[pixels[at]!]!);
          g += finite(HALF[pixels[at + 1]!]!);
          b += finite(HALF[pixels[at + 2]!]!);
        }
      }
      const to = (y * size + x) * 3;
      rgb[to] = r * share;
      rgb[to + 1] = g * share;
      rgb[to + 2] = b * share;
    }
  }

  const glow = bloom(rgb, size);
  const out = new Uint8ClampedArray(new ArrayBuffer(size * size * 4));
  const colour = [0, 0, 0];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const at = (y * size + x) * 3;
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      colour[0] = rgb[at]! + glow[at]! * BLOOM_INTENSITY;
      colour[1] = rgb[at + 1]! + glow[at + 1]! * BLOOM_INTENSITY;
      colour[2] = rgb[at + 2]! + glow[at + 2]! * BLOOM_INTENSITY;
      const d = Math.hypot(u - 0.5, v - 0.5);
      const shade = smoothstep(0.8, VIGNETTE_OFFSET * 0.799, d * (VIGNETTE_DARKNESS + VIGNETTE_OFFSET));
      colour[0] *= shade;
      colour[1] *= shade;
      colour[2] *= shade;
      agx(colour);
      const average = (colour[0] + colour[1] + colour[2]) / 3;
      const push = -(1 - 1 / (1.001 - SATURATION));
      const to = (y * size + x) * 4;
      out[to] = encode(colour[0] + (colour[0] - average) * push);
      out[to + 1] = encode(colour[1] + (colour[1] - average) * push);
      out[to + 2] = encode(colour[2] + (colour[2] - average) * push);
      out[to + 3] = 255;
    }
  }
  return out;
}

function bloom(rgb: Float32Array, size: number): Float32Array {
  const quarter = Math.max(8, size >> 2);
  const step = size / quarter;
  let level = new Float32Array(quarter * quarter * 3);
  for (let y = 0; y < quarter; y += 1) {
    for (let x = 0; x < quarter; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < step; sy += 1) {
        for (let sx = 0; sx < step; sx += 1) {
          const at = ((y * step + sy) * size + x * step + sx) * 3;
          const lr = rgb[at]!;
          const lg = rgb[at + 1]!;
          const lb = rgb[at + 2]!;
          const weight = smoothstep(BLOOM_THRESHOLD, BLOOM_THRESHOLD + BLOOM_SMOOTHING, 0.2126 * lr + 0.7152 * lg + 0.0722 * lb);
          r += lr * weight;
          g += lg * weight;
          b += lb * weight;
        }
      }
      const to = (y * quarter + x) * 3;
      const share = 1 / (step * step);
      level[to] = r * share;
      level[to + 1] = g * share;
      level[to + 2] = b * share;
    }
  }
  const levels: Array<{ data: Float32Array; side: number }> = [];
  let side = quarter;
  for (let depth = 0; depth < 4 && side >= 8; depth += 1) {
    blur(level, side, 2);
    blur(level, side, 2);
    levels.push({ data: level, side });
    const half = side >> 1;
    const smaller = new Float32Array(half * half * 3);
    for (let y = 0; y < half; y += 1) {
      for (let x = 0; x < half; x += 1) {
        for (let c = 0; c < 3; c += 1) {
          smaller[(y * half + x) * 3 + c] = (
            level[((2 * y) * side + 2 * x) * 3 + c]! + level[((2 * y) * side + 2 * x + 1) * 3 + c]!
            + level[((2 * y + 1) * side + 2 * x) * 3 + c]! + level[((2 * y + 1) * side + 2 * x + 1) * 3 + c]!
          ) / 4;
        }
      }
    }
    level = smaller;
    side = half;
  }
  const glow = new Float32Array(size * size * 3);
  const sample = [0, 0, 0];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const at = (y * size + x) * 3;
      for (const each of levels) {
        bilinear(each.data, each.side, (x + 0.5) / size, (y + 0.5) / size, sample);
        glow[at] += sample[0]!;
        glow[at + 1] += sample[1]!;
        glow[at + 2] += sample[2]!;
      }
    }
  }
  return glow;
}

function blur(data: Float32Array, side: number, radius: number) {
  const line = new Float32Array(side * 3);
  const span = radius * 2 + 1;
  for (let pass = 0; pass < 2; pass += 1) {
    for (let a = 0; a < side; a += 1) {
      for (let b = 0; b < side; b += 1) {
        for (let c = 0; c < 3; c += 1) {
          let sum = 0;
          for (let k = -radius; k <= radius; k += 1) {
            const at = Math.min(side - 1, Math.max(0, b + k));
            sum += pass === 0 ? data[(a * side + at) * 3 + c]! : data[(at * side + a) * 3 + c]!;
          }
          line[b * 3 + c] = sum / span;
        }
      }
      for (let b = 0; b < side; b += 1) {
        for (let c = 0; c < 3; c += 1) {
          if (pass === 0) data[(a * side + b) * 3 + c] = line[b * 3 + c]!;
          else data[(b * side + a) * 3 + c] = line[b * 3 + c]!;
        }
      }
    }
  }
}

function bilinear(data: Float32Array, side: number, u: number, v: number, out: number[]) {
  const x = Math.min(side - 1, Math.max(0, u * side - 0.5));
  const y = Math.min(side - 1, Math.max(0, v * side - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(side - 1, x0 + 1);
  const y1 = Math.min(side - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  for (let c = 0; c < 3; c += 1) {
    const top = data[(y0 * side + x0) * 3 + c]! * (1 - fx) + data[(y0 * side + x1) * 3 + c]! * fx;
    const bottom = data[(y1 * side + x0) * 3 + c]! * (1 - fx) + data[(y1 * side + x1) * 3 + c]! * fx;
    out[c] = top * (1 - fy) + bottom * fy;
  }
}

function agx(c: number[]) {
  let r = 0.6274 * c[0]! + 0.3293 * c[1]! + 0.0433 * c[2]!;
  let g = 0.0691 * c[0]! + 0.9195 * c[1]! + 0.0113 * c[2]!;
  let b = 0.0164 * c[0]! + 0.0880 * c[1]! + 0.8956 * c[2]!;
  const ir = 0.856627153315983 * r + 0.0951212405381588 * g + 0.0482516061458583 * b;
  const ig = 0.137318972929847 * r + 0.761241990602591 * g + 0.101439036467562 * b;
  const ib = 0.11189821299995 * r + 0.0767994186031903 * g + 0.811302368396859 * b;
  const min = -12.47393;
  const max = 4.026069;
  const curve = (value: number) => {
    const x = Math.min(1, Math.max(0, (Math.log2(Math.max(value, 1e-10)) - min) / (max - min)));
    const x2 = x * x;
    const x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
  };
  r = curve(ir);
  g = curve(ig);
  b = curve(ib);
  const or = 1.1271005818144368 * r - 0.11060664309660323 * g - 0.016493938717834573 * b;
  const og = -0.1413297634984383 * r + 1.157823702216272 * g - 0.016493938717834257 * b;
  const ob = -0.14132976349843826 * r - 0.11060664309660294 * g + 1.2519364065950405 * b;
  const lr = Math.max(0, or) ** 2.2;
  const lg = Math.max(0, og) ** 2.2;
  const lb = Math.max(0, ob) ** 2.2;
  c[0] = clamp01(1.6605 * lr - 0.5876 * lg - 0.0728 * lb);
  c[1] = clamp01(-0.1246 * lr + 1.1329 * lg - 0.0083 * lb);
  c[2] = clamp01(-0.0182 * lr - 0.1006 * lg + 1.1187 * lb);
}

function encode(linear: number) {
  const value = clamp01(linear);
  return Math.round(255 * (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055));
}

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);
const finite = (value: number) => (value > 0 && value < 64 ? value : value >= 64 ? 64 : 0);

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
