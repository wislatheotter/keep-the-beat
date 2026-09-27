import { probeResult, type DeviceProbe } from './deviceProbe';
import { DEV_HANDLE } from '../runtime/devFlag';

export type QualityTier = 'low' | 'medium' | 'high' | 'very-high';

function queryOverride(): QualityTier | null {
  const value = new URLSearchParams(window.location.search).get('quality');
  return value === 'low' || value === 'medium' || value === 'high' || value === 'very-high' ? value : null;
}

function hintedTier(): QualityTier {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const memory = nav.deviceMemory ?? 8;
  const cores = nav.hardwareConcurrency ?? 8;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  if ((mobile && (memory <= 4 || cores <= 4)) || memory <= 2 || cores <= 2) return 'low';
  if (mobile || memory <= 6 || cores <= 6) return 'medium';
  return 'high';
}

export const IS_PHONE = (() => {
  const touch = window.matchMedia?.('(pointer: coarse)').matches && !window.matchMedia?.('(any-pointer: fine)').matches;
  return touch || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
})();

function capAskedFor(): 0 | 30 | 60 | null {
  const value = new URLSearchParams(window.location.search).get('cap');
  return value === '0' || value === '30' || value === '60' ? (Number(value) as 0 | 30 | 60) : null;
}

const ORDER: QualityTier[] = ['low', 'medium', 'high', 'very-high'];
const lower = (a: QualityTier, b: QualityTier) => (ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b);

function measuredCeiling(probe: DeviceProbe): QualityTier {
  if (probe.fillMsPerMegapixel > 5 || probe.cpuMs > 26) return 'low';
  if (probe.fillMsPerMegapixel > 2.2 || probe.cpuMs > 13) return 'medium';
  return 'very-high';
}

function chooseTier(): QualityTier {
  const override = queryOverride();
  if (override) return override;
  const hinted = hintedTier();
  const probe = probeResult();
  return probe ? lower(hinted, measuredCeiling(probe)) : hinted;
}

export const QUALITY_TIER: QualityTier = chooseTier();

const VERY_HIGH = QUALITY_TIER === 'very-high';
const HIGH = QUALITY_TIER === 'high' || VERY_HIGH;
const MEDIUM = QUALITY_TIER === 'medium';
const LOW = QUALITY_TIER === 'low';

const MEDIUM_OR_BETTER = HIGH || MEDIUM;

const DPR = IS_PHONE
  ? Math.min(window.devicePixelRatio || 1, LOW ? 1.5 : 2)
  : Math.min(window.devicePixelRatio || 1, HIGH ? 2 : MEDIUM ? 1.5 : 1);

const LIGHT_CROWD_UP_TO = 1200;
function lightCrowd() {
  const asked = new URLSearchParams(window.location.search).get('crowd');
  if (asked === 'phone') return true;
  if (asked === 'full') return false;
  const tallest = (window.screen?.height || window.innerHeight) * DPR;
  return IS_PHONE || tallest <= LIGHT_CROWD_UP_TO;
}

export const PERFORMANCE = {
  quality: QUALITY_TIER,
  tier: (VERY_HIGH ? 'high' : QUALITY_TIER) as Exclude<QualityTier, 'very-high'>,
  dpr: DPR,
  frameCap: capAskedFor() ?? 0,
  batchScenery: new URLSearchParams(window.location.search).get('batch') === '1',
  stillScenery: IS_PHONE,
  lightCrowd: lightCrowd(),
  shadows: false,
  shadowMapSize: VERY_HIGH ? 4096 : HIGH ? 2048 : 1024,

  reflections: false,
  reflectionResolution: 1024,
  mirrorInterval: 0,
  shadowInterval: 1 / 75,

  bloom: true,
  richBloom: MEDIUM_OR_BETTER,
  multisampling: 0,
  smaaOnHeadroom: true,
  smaaAlways: false,
  vignette: true,
  volumetricLights: true,
  movingLightCount: LOW ? 2 : 4,
  spotLights: MEDIUM_OR_BETTER,
  looseRecordLights: true,
  sparkCount: HIGH ? 180 : MEDIUM ? 160 : 60,
  environmentIntensity: HIGH ? 0.42 : MEDIUM ? 0.4 : 0.26,
  antialias: false,
} as const;

export const QUALITY_REASON = (() => {
  if (queryOverride()) return 'asked for in the URL';
  const probe = probeResult();
  const hinted = hintedTier();
  if (!probe) return `device hints (${hinted}); the probe had not finished`;
  const ceiling = measuredCeiling(probe);
  const capped = ORDER.indexOf(ceiling) < ORDER.indexOf(hinted);
  return `device hints (${hinted}), measured fill ${probe.fillMsPerMegapixel.toFixed(2)} ms/Mpix`
    + ` · cpu ${probe.cpuMs.toFixed(1)} ms`
    + (capped ? ` -> capped at ${ceiling}` : ' -> not capped');
})();

if (DEV_HANDLE) {
  const handle = (window as unknown as { __loop?: Record<string, unknown> }).__loop ?? {};
  handle.tier = () => ({ ...PERFORMANCE, reason: QUALITY_REASON });
  (window as unknown as { __loop?: unknown }).__loop = handle;
}
