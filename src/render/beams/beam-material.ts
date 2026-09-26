import * as THREE from 'three';
import { PULSES_PER_CHANNEL } from '../../timing/visual';
import { BASE_WIDTH, MIN_WIDTH } from './beam-geometry';

// Ashima/Stefan Gustavson 3D simplex noise (MIT).
export const SIMPLEX_GLSL = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

const VERT = /* glsl */ `
attribute vec3 aDir;
attribute vec2 aCorner;
attribute vec4 aWidth;
attribute vec3 aColor;
attribute vec4 aParams;
attribute vec4 aPulse;
attribute float aEnv;
uniform float uMode;
varying float vEnv;
varying float vT;
varying float vOffset;
varying vec4 vWidth;
varying vec3 vColor;
varying vec4 vParams;
varying vec4 vPulse;
varying vec3 vWorld;
void main() {
  vec3 p = position;
  vec3 side;
  if (uMode < 0.5) {
    // Billboard around the segment axis so the beam reads as a volume from any angle.
    side = normalize(cross(aDir, normalize(cameraPosition - p)));
  } else {
    side = normalize(cross(aDir, vec3(0.0, 1.0, 0.0)));
    p.y = 0.004;
  }
  float extent = aParams.z * (uMode < 0.5 ? 1.0 : 2.2);
  p += side * aCorner.y * extent;
  vT = aCorner.x;
  vOffset = aCorner.y * extent;
  vWidth = aWidth;
  vColor = aColor;
  vParams = aParams;
  vPulse = aPulse;
  vEnv = aEnv;
  vWorld = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uMode;
uniform float uGain;
uniform float uBase;
uniform float uAudioTime;
uniform float uLightSpeed;
uniform float uPulsesOn;
uniform sampler2D uPulses;
uniform sampler2D uNoise;
uniform vec4 uEnv[5];
varying float vEnv;
varying float vT;
varying float vOffset;
varying vec4 vWidth;
varying vec3 vColor;
varying vec4 vParams;
varying vec4 vPulse;
varying vec3 vWorld;

// Same shape as envelopeAt() in audio/instruments.ts: linear attack, exponential decay
// to sustain, exponential release. Plateaus (merged fast pulses) hold at full level.
float envAt(vec4 e, float hold, float dt, bool plateau) {
  float relAt = max(hold, e.x);
  float t = min(dt, relAt);
  float lvl = t < e.x ? t / e.x : (plateau ? 1.0 : e.z + (1.0 - e.z) * exp(-(t - e.x) / e.y));
  if (dt > relAt) lvl *= exp(-(dt - relAt) / e.w);
  return lvl;
}

/**
 * Swell at this point of the beam: the max (never the sum) over pulses of the envelope,
 * delayed by the light travel time from the pulse source. Evaluated on the audio clock.
 */
float swellAt(float s) {
  float ch = floor(vPulse.z + 0.5);
  if (uPulsesOn < 0.5 || ch < 0.0) return 0.0;
  vec4 e = uEnv[int(floor(vEnv + 0.5))];
  float delay = (s - vPulse.y) / uLightSpeed + vPulse.w * vT;
  float tau = uAudioTime - delay;
  int row = int(ch);
  // Pulses are sorted by launch time: binary-search the last one launched before tau,
  // then look back over a few recent ones. Keeps the per-pixel cost at ~10 fetches.
  int lo = 0;
  int hi = ${PULSES_PER_CHANNEL};
  for (int k = 0; k < 7; k++) {
    if (lo >= hi) break;
    int mid = (lo + hi) / 2;
    vec4 p = texelFetch(uPulses, ivec2(mid, row), 0);
    if (p.w > 0.5 && p.x <= tau) lo = mid + 1; else hi = mid;
  }
  float E = 0.0;
  for (int j = 1; j <= 4; j++) {
    int i = lo - j;
    if (i < 0) break;
    vec4 p = texelFetch(uPulses, ivec2(i, row), 0);
    E = max(E, envAt(e, p.y, tau - p.x, p.z < 0.0) * abs(p.z));
  }
  return E;
}

void main() {
  float len = vParams.y;
  float s = vT * len;
  float phys = abs(vWidth.x + vWidth.y * s);
  float fan = mix(vWidth.z, vWidth.w, vT);
  float w = max(${MIN_WIDTH.toFixed(3)}, max(phys, fan));
  float radiance = min(vParams.x * ${BASE_WIDTH.toFixed(3)} / w, 7.0);
  float E = swellAt(vPulse.x + s);
  // Never dark: a base glow plus the swell, base + depth ≤ 1 by construction.
  float level = uBase + (1.0 - uBase) * E;

  // Slow drifting density field (tileable noise texture): light in slightly hazy air.
  vec2 q = vWorld.xz;
  float n1 = texture2D(uNoise, q * 0.045 + vec2(uTime * 0.004, uTime * 0.003)).r;
  float n2 = texture2D(uNoise, q * 0.16 - vec2(uTime * 0.011, -uTime * 0.006)).r;
  float haze = clamp(0.45 + 0.8 * n1 + 0.35 * n2, 0.3, 1.6);

  if (uMode < 0.5) {
    float x = vOffset / w;
    float core = exp(-x * x * 7.0);
    // Glow scales with the beam's own width so neighbouring fan rays keep their colour.
    // The swell also widens the glow, so it reads as breathing rather than blinking.
    float glow = exp(-x * x * 0.9 / (1.0 + 2.5 * E));
    float halo = exp(-abs(vOffset) / (0.09 + w * 0.8));
    vec3 c = vColor * radiance * level * (core * (1.35 + 1.1 * E) + glow * (0.1 + 0.45 * E) * haze);
    c += vColor * halo * (0.025 + 0.12 * E) * haze * level * min(vParams.x * 6.0, 1.0);
    // Bright cores desaturate towards white, like an overexposed laser line.
    c += vec3(core * (max(radiance * level - 1.3, 0.0) * 0.25 + E * E * 0.35 * min(radiance, 1.5)));
    gl_FragColor = vec4(c * uGain, 1.0);
  } else {
    float r = 0.35 + w * 1.5;
    float spill = exp(-vOffset * vOffset / (r * r));
    float energy = vParams.x * level * min(${BASE_WIDTH.toFixed(3)} / max(w, 0.22), 1.0);
    gl_FragColor = vec4(vColor * energy * spill * (0.04 + 0.08 * E) * mix(0.8, 1.1, haze) * uGain, 1.0);
  }
}`;

/** Tileable value noise, a few octaves, built once and shared by all beams. */
let noiseTexture: THREE.DataTexture | null = null;
export function hazeNoiseTexture(): THREE.DataTexture {
  if (noiseTexture) return noiseTexture;
  const N = 128;
  const data = new Uint8Array(N * N * 4);
  let seed = 12345;
  const rand = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const acc = new Float32Array(N * N);
  let amp = 1;
  let total = 0;
  for (const cells of [4, 8, 16, 32]) {
    const grid = Array.from({ length: cells * cells }, rand);
    const g = (x: number, y: number): number => grid[((y + cells) % cells) * cells + ((x + cells) % cells)]!;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const fx = (x / N) * cells;
        const fy = (y / N) * cells;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = fx - x0;
        const ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const v = (g(x0, y0) * (1 - sx) + g(x0 + 1, y0) * sx) * (1 - sy) + (g(x0, y0 + 1) * (1 - sx) + g(x0 + 1, y0 + 1) * sx) * sy;
        acc[y * N + x]! += v * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < N * N; i++) {
    const v = Math.round((acc[i]! / total) * 255);
    data.set([v, v, v, 255], i * 4);
  }
  noiseTexture = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  noiseTexture.wrapS = noiseTexture.wrapT = THREE.RepeatWrapping;
  noiseTexture.magFilter = THREE.LinearFilter;
  noiseTexture.minFilter = THREE.LinearFilter;
  noiseTexture.needsUpdate = true;
  return noiseTexture;
}

export type BeamSharedUniforms = Record<'uAudioTime' | 'uLightSpeed' | 'uPulsesOn' | 'uPulses' | 'uEnv' | 'uBase' | 'uNoise', THREE.IUniform>;

export function createSharedUniforms(): BeamSharedUniforms {
  return {
    uBase: { value: 0.42 },
    uNoise: { value: hazeNoiseTexture() },
    uAudioTime: { value: 0 },
    uLightSpeed: { value: 6 },
    uPulsesOn: { value: 0 },
    uPulses: { value: null },
    uEnv: { value: [new THREE.Vector4(0.08, 0.2, 0, 0.3), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
  };
}

/** Per-material uniforms are own; pulse/clock uniforms are shared objects across all beams. */
export function createBeamMaterial(mode: 'beam' | 'spill', shared: BeamSharedUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uMode: { value: mode === 'beam' ? 0 : 1 },
      uGain: { value: 1 },
      ...shared,
    },
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });
}
