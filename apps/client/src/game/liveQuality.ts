import { PERFORMANCE } from './performance';

export type Sheddable = 'mirror' | 'shadowRate' | 'shadows';

export const SHEDDABLE: Sheddable[] = [
  ...(PERFORMANCE.reflections ? ['mirror' as const] : []),
  ...(PERFORMANCE.shadows ? ['shadowRate' as const, 'shadows' as const] : []),
];

export const LIVE_QUALITY: Record<Sheddable | 'smaa' | 'fxaa', boolean> = {
  mirror: true, shadowRate: true, shadows: true, smaa: false, fxaa: true,
};

export function applyShed(level: number) {
  SHEDDABLE.forEach((pass, index) => { LIVE_QUALITY[pass] = index >= level; });
}
