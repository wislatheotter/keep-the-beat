import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  ShaderMaterial,
  Vector4,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { FX_IDS, LAYER_COLORS, MACHINE_ACCENTS, hashString, type FxId, type FxSet, type SampleRole } from '@loop/shared';
import { RECORD_CUT, RECORD_LABEL_RADIUS, RECORD_RADIUS } from './recordModel';

export const recordClock = {
  time: { value: 0 },
  beat: { value: 0 },
  pulse: { value: 0 },
  pointScale: { value: 360 },
};

export function tickRecordClock(seconds: number, beats: number, pulse: number, bufferHeight: number) {
  recordClock.time.value = seconds;
  recordClock.beat.value = beats;
  recordClock.pulse.value = pulse;
  recordClock.pointScale.value = bufferHeight / 2;
}

const FX_BIT = Object.fromEntries(FX_IDS.map((id, index) => [id, 1 << index])) as Record<FxId, number>;

export function fxMask(fx: FxSet | undefined): number {
  if (!fx) return 0;
  let mask = 0;
  for (const id of FX_IDS) if (fx[id]) mask |= FX_BIT[id];
  return mask;
}

const FX_MACHINE: Record<FxId, keyof typeof MACHINE_ACCENTS> = {
  filter: 'filter', crush: 'crusher', reverb: 'echo', space: 'space', wide: 'wide', swirl: 'swirl', warp: 'warp',
};

function glslColor(hex: string, gain = 1) {
  const color = new Color(hex);
  return `vec3(${(color.r * gain).toFixed(4)}, ${(color.g * gain).toFixed(4)}, ${(color.b * gain).toFixed(4)})`;
}

const accent = (id: FxId) => MACHINE_ACCENTS[FX_MACHINE[id]];

const SHARED_GLSL = `
uniform float uTime;
uniform float uBeat;
uniform float uPulse;
uniform int uFx;
uniform float uSeed;
uniform int uFresh;
uniform float uFreshAt;
varying vec3 vRecord;
varying float vPart;
varying float vBite;
varying float vWave;
varying float vUp;

#define RECORD_EDGE ${RECORD_RADIUS.toFixed(3)}
#define RECORD_CUT ${RECORD_CUT.toFixed(3)}
#define RECORD_LABEL ${RECORD_LABEL_RADIUS.toFixed(3)}
${FX_IDS.map((id) => `#define FX_${id.toUpperCase()} ${FX_BIT[id]}`).join('\n')}

bool hasFx(int bit) { return (uFx & bit) != 0; }
float recordHash(float n) { return fract(sin(n) * 43758.5453123); }
float freshness(int bit) {
  if ((uFresh & bit) == 0) return 1.0;
  return clamp((uTime - uFreshAt) / 0.9, 0.0, 1.0);
}
float growIn(int bit) {
  float t = freshness(bit);
  return 1.0 - (1.0 - t) * (1.0 - t) * (1.0 - t);
}
`;

const VERTEX_GLSL = `
attribute float part;
${SHARED_GLSL}
uniform vec3 uInflate;
uniform float uCut;

float recordBite(float a) {
  float bite = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float centre = (fi + 0.15 + 0.7 * recordHash(uSeed * 1.37 + fi * 7.1)) * (PI2 / 5.0);
    float width = 0.2 + 0.22 * recordHash(uSeed * 2.11 + fi * 3.3);
    float depth = (0.5 + 0.5 * recordHash(uSeed * 0.73 + fi * 1.7)) * step(0.22, recordHash(uSeed * 3.9 + fi * 5.3));
    float gap = mod(a - centre + PI, PI2) - PI;
    float x = abs(gap) / width;
    bite = max(bite, depth * (1.0 - smoothstep(0.5, 1.0, x)) * (0.86 + 0.14 * sin(a * 37.0 + fi)));
  }
  return bite;
}

float recordEdge(float a) {
  float inset = 0.0;
  if (hasFx(FX_FILTER)) inset += 0.085 * (1.0 - sqrt(abs(cos(6.0 * a)))) * growIn(FX_FILTER);
  if (hasFx(FX_SWIRL)) inset += 0.095 * fract(a * 8.0 / PI2 + 1.0 / 24.0) * growIn(FX_SWIRL);
  if (hasFx(FX_CRUSH)) inset += 0.13 * recordBite(a) * growIn(FX_CRUSH);
  return min(inset, 0.15);
}

float recordRidges(float r) {
  float first = smoothstep(0.582, 0.592, r) * (1.0 - smoothstep(0.618, 0.628, r));
  float second = smoothstep(0.642, 0.652, r) * (1.0 - smoothstep(0.678, 0.688, r));
  return max(first, second);
}

float recordThickness(int cut) {
  if (cut == 1) return 1.3;
  if (cut == 2) return 1.25;
  if (cut == 3) return 0.6;
  if (cut == 4) return 1.55;
  return 1.0;
}

float recordLift(float r, int cut, float part) {
  float lift = 0.0;
  if (cut == 1) lift += 0.045 * smoothstep(0.59, 0.695, r);
  if (cut == 2) lift -= 0.028 * (1.0 - smoothstep(RECORD_LABEL, 0.64, r));
  if (hasFx(FX_REVERB) && part < 0.5) lift += 0.022 * growIn(FX_REVERB) * recordRidges(r);
  return lift;
}

vec3 recordShape(vec3 p, inout vec3 n) {
  p *= uInflate;
  vRecord = position;
  vPart = part;
  vUp = n.y;
  vBite = 0.0;
  vWave = 0.0;
  float r = length(p.xz);
  float a = atan(p.z, p.x);
  vec2 dir = r > 1e-5 ? p.xz / r : vec2(1.0, 0.0);
  vec2 across = vec2(-dir.y, dir.x);
  float folded = 1.0;

  if (part > 3.5 && part < 4.5) {
    float t = freshness(FX_WIDE) - 1.0;
    float unfold = 1.0 + 2.2 * t * t * t + 1.2 * t * t;
    r = mix(RECORD_EDGE * 0.92, r, unfold) * (1.0 + 0.07 * uPulse);
    p.xz = dir * r;
  } else {
    int cut = int(uCut + 0.5);
    if (part > 5.5 && cut != 4) folded = 0.0;
    if (part > 4.5 && part < 5.5) {
      float t = freshness(FX_SPACE) - 1.0;
      float unfold = 1.0 + 2.2 * t * t * t + 1.2 * t * t;
      r = mix(RECORD_EDGE * 0.9, r, unfold) + 0.025 * uPulse * step(RECORD_EDGE + 0.02, r);
    } else {
      p.y *= recordThickness(cut);
      float side = clamp(p.y / 0.01, -1.0, 1.0);
      float lift = recordLift(r, cut, part);
      p.y += side * lift;
      if (abs(n.y) > 0.5) {
        float slope = (recordLift(r + 0.002, cut, part) - recordLift(r - 0.002, cut, part)) / 0.004;
        n = normalize(n - vec3(dir.x, 0.0, dir.y) * slope * abs(n.y));
      }
    }
    if (hasFx(FX_FILTER) || hasFx(FX_SWIRL) || hasFx(FX_CRUSH)) {
      float reach = clamp((r - RECORD_CUT) / (RECORD_EDGE - RECORD_CUT), 0.0, 1.0);
      float inset = recordEdge(a);
      if (hasFx(FX_CRUSH)) vBite = recordBite(a) * reach;
      float turn = (recordEdge(a + 0.004) - recordEdge(a - 0.004)) / 0.008 * reach;
      vec2 outward = normalize(dir * max(r, 0.1) + across * turn);
      vec2 local = vec2(dot(n.xz, dir), dot(n.xz, across));
      n.xz = local.x * outward + local.y * vec2(-outward.y, outward.x);
      r -= inset * reach;
    }
    p.xz = dir * r;
  }

  if (hasFx(FX_WARP)) {
    float phase = 2.0 * a - uTime * 2.6 + uSeed;
    float reachR = min(r, RECORD_EDGE);
    float k = 0.075 / (RECORD_EDGE * RECORD_EDGE);
    float lift = k * reachR * reachR * growIn(FX_WARP);
    float wave = sin(phase);
    p.y += lift * wave;
    vWave = wave * lift / 0.075;
    float dr = r < RECORD_EDGE ? 2.0 * k * r * wave : 0.0;
    float da = lift * 2.0 * cos(phase);
    vec2 across = vec2(-dir.y, dir.x);
    vec2 slope = dir * dr + across * (r > 1e-3 ? da / r : 0.0);
    n = normalize(n - vec3(slope.x, 0.0, slope.y) * n.y);
  }
  return p * folded;
}
`;

const FRAGMENT_GLSL = `
${SHARED_GLSL}
uniform sampler2D uLabel;
uniform vec3 uLayer;
uniform vec4 uPress;
uniform float uGlow;

const vec3 FX_COLOURS[${FX_IDS.length}] = vec3[${FX_IDS.length}](${FX_IDS.map((id) => glslColor(accent(id))).join(', ')});
#define C_CRUSH ${glslColor(accent('crush'))}
#define C_WARP ${glslColor(accent('warp'))}
#define C_SWIRL ${glslColor(accent('swirl'))}
#define C_SHADE ${glslColor(accent('filter'))}
#define C_ECHO ${glslColor(accent('reverb'))}
#define C_SPACE ${glslColor(accent('space'))}
#define C_WIDE ${glslColor(accent('wide'))}
#define C_METAL ${glslColor('#e8eefc')}

float rHash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(rHash2(i), rHash2(i + vec2(1.0, 0.0)), u.x), mix(rHash2(i + vec2(0.0, 1.0)), rHash2(i + vec2(1.0, 1.0)), u.x), u.y);
}
float rFbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) { sum += amp * rNoise(p); p = p * 2.03 + 17.1; amp *= 0.5; }
  return sum;
}
float rCells(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 site = o + vec2(rHash2(cell + o), rHash2(cell + o + 31.7)) - f;
    float d = dot(site, site);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return sqrt(d2) - sqrt(d1);
}

vec3 recordPressing(vec2 xz, float r) {
  vec3 black = vec3(0.012, 0.013, 0.018);
  vec3 tint = uLayer;
  int style = int(uPress.x + 0.5);
  float s = uPress.y;
  if (style == 1) {
    return mix(tint * 0.2, tint * 0.1, smoothstep(0.3, 0.72, r)) + black;
  }
  if (style == 2) {
    vec2 q = xz * 2.4 + s * 40.0;
    q += vec2(rFbm(q + 3.1), rFbm(q - 1.7)) * 1.8;
    float m = rFbm(q);
    return mix(black, tint * 0.24, smoothstep(0.44, 0.56, m)) + tint * 0.08 * smoothstep(0.62, 0.72, m);
  }
  if (style == 3) {
    vec2 p = xz * 9.0 + s * 53.0;
    vec2 cell = floor(p);
    vec3 colour = black;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 id = cell + vec2(float(x), float(y));
      vec2 centre = id + vec2(rHash2(id), rHash2(id + 7.3));
      float size = 0.12 + 0.3 * rHash2(id + 2.1);
      float fleck = 1.0 - smoothstep(size * 0.8, size, length(p - centre));
      vec3 paint = rHash2(id + 4.4) > 0.8 ? vec3(0.3) : tint * 0.32;
      colour = mix(colour, paint, fleck * step(0.35, rHash2(id + 9.9)));
    }
    return colour;
  }
  if (style == 4) {
    float angle = s * PI2;
    float side = dot(xz, vec2(cos(angle), sin(angle)));
    return mix(black, tint * 0.19, smoothstep(-0.006, 0.006, side));
  }
  if (style == 5) {
    return mix(tint * 0.3, black, smoothstep(0.3, 0.7, r));
  }
  return black;
}

vec3 recordAlbedo;
vec3 recordEmit;
float recordRough;
float recordMetal;

void recordPaint() {
  vec2 xz = vRecord.xz;
  float r = length(xz);
  float a = atan(xz.y, xz.x);
  int part = int(vPart + 0.5);
  bool shaded = hasFx(FX_FILTER);
  recordEmit = vec3(0.0);
  recordMetal = 0.0;

  if (part == 1) {
    vec2 uv = vec2(xz.x, vUp >= 0.0 ? -xz.y : xz.y) / (2.0 * RECORD_LABEL) + 0.5;
    vec3 art = texture2D(uLabel, uv).rgb;
    recordAlbedo = art * 0.2;
    recordEmit = art * (shaded ? 0.45 : 0.95);
    recordRough = 0.6;
    return;
  }
  if (part == 2) {
    vec3 rim = uLayer;
    rim = mix(rim, C_CRUSH, smoothstep(0.05, 0.4, vBite));
    rim = mix(rim, C_WARP, 0.55 * max(vWave, 0.0) * float(hasFx(FX_WARP)));
    recordAlbedo = rim;
    recordEmit = rim * uGlow;
    if (uFresh != 0) {
      for (int i = 0; i < ${FX_IDS.length}; i++) {
        if ((uFresh & (1 << i)) == 0) continue;
        float fade = 1.0 - freshness(1 << i);
        recordEmit += FX_COLOURS[i] * fade * fade * 3.0;
      }
    }
    recordRough = 0.38;
    recordMetal = 0.1;
    return;
  }
  if (part == 3 || part == 6) {
    recordAlbedo = C_METAL * 0.8;
    recordEmit = C_METAL * (shaded ? 0.12 : 0.35);
    recordRough = 0.28;
    recordMetal = 0.85;
    return;
  }
  if (part == 4) {
    recordAlbedo = C_WIDE;
    recordEmit = C_WIDE * (1.5 + 1.1 * uPulse) * (shaded ? 0.5 : 1.0);
    recordRough = 0.4;
    return;
  }
  if (part == 5) {
    float point = smoothstep(RECORD_EDGE - 0.02, RECORD_EDGE + 0.14, r);
    float twinkle = 0.7 + 0.3 * sin(uTime * 4.0 + floor(a / PI2 * 16.0 + 0.5) * 2.3);
    recordAlbedo = C_SPACE;
    recordEmit = mix(C_SPACE, vec3(1.0), point * 0.45) * (0.9 + 1.4 * point * twinkle + 0.6 * uPulse) * (shaded ? 0.5 : 1.0);
    recordRough = 0.35;
    return;
  }

  vec3 colour = recordPressing(xz, r);
  bool face = abs(vUp) > 0.5;
  float grooved = face ? smoothstep(RECORD_LABEL + 0.03, RECORD_LABEL + 0.045, r) * (1.0 - smoothstep(0.655, 0.67, r)) : 0.0;

  float grooveFreq = 1300.0;
  float grooveAa = 1.0 - smoothstep(0.2, 0.8, fwidth(r * grooveFreq / PI2));
  float groove = 0.5 + 0.5 * sin(r * grooveFreq);
  float rough = mix(0.32, 0.5, mix(0.5, groove, grooveAa)) * grooved + 0.3 * (1.0 - grooved);
  float bands = uPress.z;
  for (int i = 0; i < 5; i++) {
    if (float(i) >= bands) break;
    float at = RECORD_LABEL + 0.06 + (float(i) + 1.0) * (0.3 / (bands + 1.0)) + (recordHash(uPress.w + float(i)) - 0.5) * 0.03;
    float gap = (1.0 - smoothstep(0.004, 0.009, abs(r - at))) * grooved;
    rough = mix(rough, 0.12, gap);
    colour *= 1.0 - 0.45 * gap;
  }
  recordRough = rough;
  recordMetal = 0.12;

  float ring = grooved;
  if (hasFx(FX_SWIRL)) {
    float spin = a / PI2 * 3.0 + log(max(r, 0.05)) * 2.2 - uTime * 0.7;
    float arm = 1.0 - smoothstep(0.06, 0.2, abs(fract(spin) - 0.5));
    float wound = growIn(FX_SWIRL);
    arm *= smoothstep(0.72 - wound * 0.45, 0.76 - wound * 0.45, r) * wound;
    recordEmit += C_SWIRL * arm * ring * (0.75 + 0.35 * uPulse + 1.5 * (1.0 - wound));
    colour = mix(colour, C_SWIRL * 0.25, arm * ring * 0.5);
  }
  if (hasFx(FX_CRUSH)) {
    float lines = 1.0 - smoothstep(0.0, 0.05, rCells(xz * 3.4 + uSeed));
    float crushed = freshness(FX_CRUSH);
    float reach = smoothstep(0.44, 0.64, r) * (0.35 + 0.65 * smoothstep(0.0, 0.35, vBite)) * growIn(FX_CRUSH);
    recordEmit += C_CRUSH * lines * reach * (face ? 1.0 : 0.0) * (0.8 + 0.7 * uPulse + 3.0 * (1.0 - crushed));
    colour = mix(colour, C_CRUSH * 0.2, lines * reach * 0.6);
    recordEmit += C_CRUSH * 1.2 * smoothstep(0.05, 0.3, vBite) * (face ? 0.0 : 1.0);
  }
  if (hasFx(FX_WARP)) {
    float crest = max(vWave, 0.0) * (2.0 - growIn(FX_WARP));
    recordEmit += C_WARP * crest * crest * 0.7;
  }
  if (hasFx(FX_SPACE)) {
    vec2 p = xz * 16.0;
    vec2 id = floor(p);
    vec2 centre = id + 0.2 + 0.6 * vec2(rHash2(id + 1.3), rHash2(id + 8.1));
    float star = (1.0 - smoothstep(0.0, 0.09, length(p - centre))) * step(0.72, rHash2(id));
    float twinkle = 0.45 + 0.55 * sin(uTime * 3.3 + rHash2(id + 3.7) * 40.0);
    recordEmit += mix(C_SPACE, vec3(1.0), 0.4) * star * twinkle * 1.6 * ring * growIn(FX_SPACE);
  }
  if (hasFx(FX_REVERB)) {
    float echo = pow(0.5 + 0.5 * sin(r * 42.0 - uBeat * PI2), 10.0) * growIn(FX_REVERB);
    recordEmit += C_ECHO * echo * ring * 0.45;
  }
  if (shaded) {
    float smoked = growIn(FX_FILTER);
    float grey = dot(colour, vec3(0.2126, 0.7152, 0.0722));
    colour = mix(colour, mix(colour, vec3(grey), 0.5) * 0.5, smoked);
    recordRough = mix(recordRough, 0.78, 0.8 * smoked);
    recordEmit *= 1.0 - 0.45 * smoked;
    float haze = 0.55 + 0.45 * rFbm(xz * 3.0 + vec2(uTime * 0.12, -uTime * 0.07));
    recordEmit += C_SHADE * 0.07 * haze;
  }

  if (face && uFx != 0 && r > RECORD_LABEL && r < RECORD_LABEL + 0.07) {
    int count = 0;
    for (int i = 0; i < ${FX_IDS.length}; i++) if ((uFx & (1 << i)) != 0) count++;
    int k = 0;
    for (int i = 0; i < ${FX_IDS.length}; i++) {
      if ((uFx & (1 << i)) == 0) continue;
      float at = PI * 0.5 + (float(k) - float(count - 1) * 0.5) * 0.2;
      vec2 centre = vec2(cos(at), vUp >= 0.0 ? -sin(at) : sin(at)) * (RECORD_LABEL + 0.042);
      float size = 0.025 * (1.0 + 0.8 * (1.0 - freshness(1 << i)));
      float pip = 1.0 - smoothstep(size - 0.003, size + 0.003, length(xz - centre));
      colour = mix(colour, FX_COLOURS[i] * 0.4, pip);
      recordEmit = mix(recordEmit, FX_COLOURS[i] * 1.8, pip);
      k++;
    }
  }
  recordAlbedo = colour;
}
`;

const EMISSIVE_GLSL = `
totalEmissiveRadiance = recordEmit;
if (hasFx(FX_FILTER) && vPart < 1.5) {
  float grazing = 1.0 - abs(dot(normal, normalize(vViewPosition)));
  totalEmissiveRadiance += C_SHADE * (0.08 + 0.55 * grazing * grazing * grazing) * growIn(FX_FILTER);
}
`;

function shapeVertex(shader: WebGLProgramParametersWithUniforms, standard: boolean) {
  shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${VERTEX_GLSL}`);
  if (standard) {
    shader.vertexShader = shader.vertexShader
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3( normal );\nvec3 recordPosition = recordShape( position, objectNormal );')
      .replace('#include <begin_vertex>', 'vec3 transformed = recordPosition;');
  } else {
    shader.vertexShader = shader.vertexShader
      .replace('#include <begin_vertex>', 'vec3 recordNormal = vec3( normal );\nvec3 transformed = recordShape( position, recordNormal );');
  }
}

const sightings = new Map<string, { mask: number; seen: number; fresh: number; at: number }>();
const SIGHTING_WINDOW = 4;
const SIGHTING_LIMIT = 200;

export function freshMarks(key: string, mask: number): { fresh: number; at: number } {
  const now = recordClock.time.value;
  const last = sightings.get(key);
  let fresh = 0;
  let at = 0;
  if (last && last.mask === mask) {
    fresh = last.fresh;
    at = last.at;
  } else if (last && now - last.seen < SIGHTING_WINDOW) {
    fresh = mask & ~last.mask;
    at = now;
  }
  sightings.delete(key);
  sightings.set(key, { mask, seen: now, fresh, at });
  while (sightings.size > SIGHTING_LIMIT) {
    const oldest = sightings.keys().next();
    if (oldest.done) break;
    sightings.delete(oldest.value);
  }
  return { fresh, at };
}

export type RecordLook = {
  role: SampleRole;
  key: string;
  label: Texture;
  fx: number;
  fresh: number;
  freshAt: number;
  fading: boolean;
};

export type RecordMaterials = {
  body: MeshStandardMaterial;
  outline: MeshBasicMaterial;
  turn: number;
  setGlow: (glow: number) => void;
  dispose: () => void;
};

const PRESSING_STYLES = 6;
const RECORD_CUTS = 5;

export function createRecordMaterials(look: RecordLook): RecordMaterials {
  const seed = hashString(look.key);
  const shared = {
    uTime: recordClock.time,
    uBeat: recordClock.beat,
    uPulse: recordClock.pulse,
    uFx: { value: look.fx },
    uSeed: { value: (seed % 1000) / 13.7 },
    uFresh: { value: look.fresh },
    uFreshAt: { value: look.freshAt },
    uCut: { value: (seed >>> 13) % RECORD_CUTS },
  };
  const uniforms = {
    ...shared,
    uInflate: { value: [1, 1, 1] },
    uLabel: { value: look.label },
    uLayer: { value: new Color(LAYER_COLORS[look.role] ?? LAYER_COLORS.SPECIAL) },
    uPress: {
      value: new Vector4(
        seed % PRESSING_STYLES,
        ((seed >>> 3) % 997) / 997,
        2 + ((seed >>> 7) % 4),
        ((seed >>> 11) % 101) / 7,
      ),
    },
    uGlow: { value: 1 },
  };

  const body = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.4,
    metalness: 0.12,
    envMapIntensity: 0.85,
    transparent: look.fading,
  });
  body.name = 'record';
  body.userData.record = uniforms;
  body.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shapeVertex(shader, true);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_GLSL}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\nrecordPaint();\ndiffuseColor.rgb = recordAlbedo;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = recordRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = recordMetal;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${EMISSIVE_GLSL}`);
  };
  body.customProgramCacheKey = () => 'record-body';

  const outline = new MeshBasicMaterial({ color: new Color('#05060a'), side: BackSide, transparent: look.fading });
  outline.name = 'record-outline';
  const outlineUniforms = { ...shared, uInflate: { value: [1.05, 1.35, 1.05] } };
  outline.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, outlineUniforms);
    shapeVertex(shader, false);
  };
  outline.customProgramCacheKey = () => 'record-outline';

  return {
    body,
    outline,
    turn: ((seed >>> 5) % 360) * (Math.PI / 180),
    setGlow: (glow) => {
      uniforms.uGlow.value = glow;
    },
    dispose: () => {
      body.dispose();
      outline.dispose();
    },
  };
}

export const echoGeometry = new PlaneGeometry(RECORD_RADIUS * 3.3, RECORD_RADIUS * 3.3);
export const echoMaterial = new ShaderMaterial({
  uniforms: { uBeat: recordClock.beat },
  transparent: true,
  depthWrite: false,
  side: DoubleSide,
  blending: AdditiveBlending,
  forceSinglePass: true,
  toneMapped: false,
  vertexShader: `
    varying vec2 vPlane;
    void main() {
      vPlane = position.xy;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float uBeat;
    varying vec2 vPlane;
    void main() {
      float r = length(vPlane) / ${RECORD_RADIUS.toFixed(3)};
      float light = 0.0;
      for (int i = 0; i < 2; i++) {
        float age = fract(uBeat * 0.5 + float(i) * 0.5);
        float at = 1.03 + age * 0.5;
        float width = 0.018 + age * 0.025;
        light += exp(-pow((r - at) / width, 2.0)) * pow(1.0 - age, 2.0);
      }
      if (light < 0.004) discard;
      gl_FragColor = vec4(${glslColor(accent('reverb'), 1.25)} * light, 1.0);
    }
  `,
});

const SPARKS = 36;

export const spaceGeometry = (() => {
  const geometry = new BufferGeometry();
  const position = new Float32Array(SPARKS * 3);
  const seed = new Float32Array(SPARKS);
  let state = 7;
  const random = () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
  for (let i = 0; i < SPARKS; i += 1) {
    const angle = (i / SPARKS) * Math.PI * 2 + random() * 0.4;
    const radius = RECORD_RADIUS * (1.12 + random() * 0.38);
    position[i * 3] = Math.cos(angle) * radius;
    position[i * 3 + 1] = (random() - 0.5) * 0.55;
    position[i * 3 + 2] = Math.sin(angle) * radius;
    seed[i] = random();
  }
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('seed', new BufferAttribute(seed, 1));
  geometry.computeBoundingSphere();
  return geometry;
})();

export const spaceMaterial = new ShaderMaterial({
  uniforms: { uTime: recordClock.time, uPulse: recordClock.pulse, uScale: recordClock.pointScale },
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  toneMapped: false,
  vertexShader: `
    uniform float uTime;
    uniform float uPulse;
    uniform float uScale;
    attribute float seed;
    varying float vTwinkle;
    void main() {
      float turn = uTime * (0.35 + seed * 0.3);
      float c = cos(turn);
      float s = sin(turn);
      vec3 p = vec3(position.x * c - position.z * s, position.y + sin(uTime * 1.3 + seed * 20.0) * 0.06, position.x * s + position.z * c);
      vec4 view = modelViewMatrix * vec4(p, 1.0);
      vTwinkle = 0.45 + 0.55 * sin(uTime * (2.0 + seed * 3.0) + seed * 40.0);
      float size = (0.13 + 0.1 * seed) * (1.0 + 0.4 * uPulse);
      gl_PointSize = max(1.5, size * uScale / -view.z);
      gl_Position = projectionMatrix * view;
    }
  `,
  fragmentShader: `
    varying float vTwinkle;
    void main() {
      vec2 p = gl_PointCoord * 2.0 - 1.0;
      float core = 1.0 - smoothstep(0.0, 0.55, length(p));
      float glint = (1.0 - smoothstep(0.0, 0.12, abs(p.x))) * (1.0 - abs(p.y)) + (1.0 - smoothstep(0.0, 0.12, abs(p.y))) * (1.0 - abs(p.x));
      float light = (core + glint * 0.6) * vTwinkle;
      if (light < 0.01) discard;
      gl_FragColor = vec4(mix(${glslColor(accent('space'), 1.6)}, vec3(1.8), core * 0.5) * light, 1.0);
    }
  `,
});
