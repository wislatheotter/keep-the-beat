import { Color } from 'three';
import { FAMILY_GLYPH, LAYER_COLORS, hashString, sample as gameSample, type SampleRole } from '@loop/shared';

export const LABEL_SIZE = 128;

const CACHE_LIMIT = 160;

const labels = new Map<string, HTMLCanvasElement>();

export function labelKey(role: SampleRole, family: string, sampleName: string | null) {
  return sampleName ?? `${role}:${family}`;
}

export function recordLabel(role: SampleRole, family: string, sampleName: string | null): HTMLCanvasElement {
  const key = labelKey(role, family, sampleName);
  const existing = labels.get(key);
  if (existing) {
    labels.delete(key);
    labels.set(key, existing);
    return existing;
  }
  const canvas = draw(role, family, sampleName, key);
  labels.set(key, canvas);
  while (labels.size > CACHE_LIMIT) {
    const oldest = labels.keys().next();
    if (oldest.done) break;
    labels.delete(oldest.value);
  }
  return canvas;
}

export function layerColor(role: SampleRole) {
  return LAYER_COLORS[role] ?? LAYER_COLORS.SPECIAL;
}

function draw(role: SampleRole, family: string, sampleName: string | null, key: string) {
  const entry = sampleName ? gameSample(sampleName) : null;
  const seed = hashString(key);
  const size = LABEL_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  const half = size / 2;

  const base = new Color(layerColor(role));
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  const hue = (hsl.h + ((seed % 17) / 17 - 0.5) * 0.075 + 1) % 1;
  const light = ((seed >> 13) & 1) === 1;
  const tint = new Color().setHSL(
    hue,
    Math.min(1, hsl.s * (0.62 + ((seed >> 5) % 13) / 13 * 0.55)),
    light ? 0.58 + ((seed >> 9) % 11) / 11 * 0.2 : 0.2 + ((seed >> 9) % 11) / 11 * 0.14,
  );
  const ink = new Color().setHSL(
    (hue + ((seed >> 17) % 5) / 5 * 0.08) % 1,
    Math.min(1, hsl.s * 0.9),
    light ? 0.13 : 0.7,
  );

  context.fillStyle = `#${tint.getHexString()}`;
  context.beginPath();
  context.arc(half, half, half, 0, Math.PI * 2);
  context.fill();

  context.save();
  context.beginPath();
  context.arc(half, half, half, 0, Math.PI * 2);
  context.clip();
  context.fillStyle = `#${ink.getHexString()}`;
  context.strokeStyle = `#${ink.getHexString()}`;
  drawPattern(context, size, seed % 6, seed);
  context.restore();

  context.fillStyle = 'rgba(0,0,0,0.5)';
  context.beginPath();
  context.arc(half, half, size * 0.3, 0, Math.PI * 2);
  context.fill();

  const bars = entry?.bars ?? 0;
  if (bars > 0) {
    context.fillStyle = '#ffffff';
    for (let i = 0; i < Math.min(bars, 8); i += 1) {
      const angle = (i / Math.min(Math.max(bars, 1), 8)) * Math.PI * 2 - Math.PI / 2;
      context.beginPath();
      context.arc(half + Math.cos(angle) * size * 0.375, half + Math.sin(angle) * size * 0.375, size * 0.028, 0, Math.PI * 2);
      context.fill();
    }
  }

  context.fillStyle = '#ffffff';
  context.font = `${Math.round(size * 0.34)}px system-ui, "Segoe UI Symbol", sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(FAMILY_GLYPH[family] ?? '●', half, half + 2);

  return canvas;
}

function drawPattern(context: CanvasRenderingContext2D, size: number, pattern: number, seed: number) {
  const half = size / 2;
  switch (pattern) {
    case 0: {
      const count = 8 + (seed % 5) * 2;
      context.lineWidth = size * 0.055;
      for (let i = 0; i < count; i += 1) {
        const angle = (i / count) * Math.PI * 2;
        context.beginPath();
        context.moveTo(half, half);
        context.lineTo(half + Math.cos(angle) * size, half + Math.sin(angle) * size);
        context.stroke();
      }
      return;
    }
    case 1: {
      context.lineWidth = size * 0.05;
      for (let r = size * 0.14; r < size * 0.55; r += size * 0.1) {
        context.beginPath();
        context.arc(half, half, r, 0, Math.PI * 2);
        context.stroke();
      }
      return;
    }
    case 2: {
      context.save();
      context.translate(half, half);
      context.rotate(((seed >> 3) % 8) / 8 * Math.PI);
      context.fillRect(-size, -size, size * 2, size);
      context.restore();
      return;
    }
    case 3: {
      const step = size * 0.17;
      for (let x = step / 2; x < size; x += step) {
        for (let y = step / 2; y < size; y += step) {
          context.beginPath();
          context.arc(x, y, size * 0.045, 0, Math.PI * 2);
          context.fill();
        }
      }
      return;
    }
    case 4: {
      const count = 6;
      const cell = size / count;
      for (let x = 0; x < count; x += 1) {
        for (let y = 0; y < count; y += 1) {
          if ((x + y) % 2 === 0) context.fillRect(x * cell, y * cell, cell, cell);
        }
      }
      return;
    }
    default: {
      context.lineWidth = size * 0.16;
      context.beginPath();
      context.arc(half, half, size * 0.34, ((seed >> 4) % 8) / 8 * Math.PI * 2, ((seed >> 4) % 8) / 8 * Math.PI * 2 + Math.PI * 1.2);
      context.stroke();
    }
  }
}
