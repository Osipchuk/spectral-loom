import * as THREE from 'three';
import type { RayTree } from '../optics/types';
import { hazeNoiseTexture, SIMPLEX_GLSL } from './beams/beam-material';
import { CALM_NIGHT, type Weather } from '../music/mood';
import { BEAM_HEIGHT, type TableFrame } from './frame';
import { lightToRGB } from './spectral-color';

const MAX_LIT_SEGMENTS = 192;
const MOTE_COUNT = 2200;

/** Deterministic PRNG so the room looks the same on every load. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const BACK_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  // Full-screen quad pinned to the far plane: always behind the table.
  gl_Position = vec4(position.xy, 0.99999, 1.0);
}`;

const BACK_FRAG = /* glsl */ `
uniform float uTime;
uniform vec2 uAspect;
uniform vec2 uParallax;
uniform float uEnergy;
uniform float uHorizon;
uniform vec4 uWeather; // aurora, rain, snow, mist
uniform float uClouds;
uniform sampler2D uNoise;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float nz(vec2 q) { return texture2D(uNoise, q).r; }
float fbm(vec2 q) { return nz(q) * 0.5 + nz(q * 2.03 + 0.31) * 0.3 + nz(q * 4.07 + 0.73) * 0.2; }

// Mountain ridge height above the horizon at horizontal position x.
float ridge(float x, float seed, float scale) {
  float r = fbm(vec2(x * 0.11 * scale + seed, seed * 0.37));
  float jag = nz(vec2(x * 0.9 * scale + seed * 3.1, 0.5)) * 0.25;
  return pow(r, 1.6) * 0.9 + jag * 0.15;
}

vec3 aurora(vec2 p, float y) {
  vec3 acc = vec3(0.0);
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float x = p.x * (0.9 + fk * 0.25) + fk * 3.7;
    float wave = fbm(vec2(x * 0.18, uTime * 0.012 + fk * 0.4));
    float centre = 0.10 + 0.12 * wave + fk * 0.035;
    float d = (y - centre) / (0.035 + 0.05 * wave);
    // Curtains: bright lower hem, long soft fade upwards, vertical rays.
    float curtain = exp(-d * d * (d < 0.0 ? 6.0 : 0.6));
    float rays = 0.55 + 0.45 * nz(vec2(x * 2.2, uTime * 0.03 + fk));
    float fade = smoothstep(0.0, 0.3, wave);
    vec3 col = mix(vec3(0.15, 1.0, 0.55), vec3(0.35, 0.55, 1.0), clamp(d * 0.35 + fk * 0.3, 0.0, 1.0));
    col = mix(col, vec3(0.85, 0.35, 1.0), clamp(d * 0.2 - 0.3, 0.0, 1.0));
    acc += col * curtain * rays * fade;
  }
  return acc;
}

vec3 sky(vec2 p, float y, bool reflected) {
  vec3 top = vec3(0.004, 0.006, 0.018);
  vec3 hor = mix(vec3(0.025, 0.04, 0.085), vec3(0.05, 0.055, 0.065), uClouds);
  vec3 c = mix(hor, top, smoothstep(0.0, 0.5, y));
  // Stars, twinkling, hidden by cloud.
  vec2 g = p * 70.0;
  vec2 id = floor(g);
  float h = hash(id);
  vec2 off = vec2(hash(id + 1.7), hash(id + 3.1)) - 0.5;
  float star = step(0.975, h) * smoothstep(0.09, 0.0, length(fract(g) - 0.5 - off * 0.6));
  star *= 0.55 + 0.45 * sin(uTime * (0.8 + h * 3.0) + h * 40.0);
  c += vec3(0.75, 0.82, 1.0) * star * (1.0 - uClouds) * smoothstep(0.01, 0.15, y) * 0.8;
  // Moon with a soft halo.
  vec2 moon = vec2(0.22 * uAspect.x, 0.13);
  float md = length(vec2(p.x, y) - moon);
  float disc = reflected ? 0.0 : smoothstep(0.022, 0.019, md) * 0.75;
  c += vec3(0.9, 0.92, 1.0) * (disc + exp(-md * 10.0) * 0.07) * (1.0 - uClouds * 0.7);
  c += aurora(p, y) * uWeather.x * (0.55 + 0.45 * uEnergy) * (1.0 - uClouds * 0.6) * 0.5;
  // Drifting cloud bank.
  float cl = fbm(vec2(p.x * 0.35 + uTime * 0.004, y * 1.6));
  c = mix(c, vec3(0.03, 0.035, 0.045) + hor * 0.5, smoothstep(0.45, 0.75, cl) * uClouds * 0.9);
  return c;
}

vec3 landscape(vec2 p, float y, bool reflected) {
  vec3 c = sky(p, max(y, 0.0), reflected);
  // Two ridges: far (bluish, misty, lit by the sky) and near (almost black).
  float far = 0.05 + 0.13 * ridge(p.x + uParallax.x * 0.2, 1.3, 1.0);
  float near = 0.02 + 0.07 * ridge(p.x + uParallax.x * 0.45, 7.9, 1.6);
  vec3 skyGlow = vec3(0.1, 0.35, 0.25) * uWeather.x * 0.12;
  vec3 farCol = mix(vec3(0.022, 0.03, 0.058), vec3(0.055, 0.062, 0.085), uWeather.w) + skyGlow;
  // A faint moonlit rim on the far ridge.
  float rim = smoothstep(far - 0.006, far, y) * step(y, far) * 0.6;
  if (y < far) c = mix(farCol + vec3(0.05, 0.055, 0.07) * rim, c, 0.12 * uWeather.w);
  if (y < near) c = vec3(0.006, 0.008, 0.014) + skyGlow * 0.3;
  return c;
}

void main() {
  float hy = uHorizon + uParallax.y * 0.35;
  vec2 p = vec2((vUv.x - 0.5) * uAspect.x + uParallax.x * 0.15, vUv.y);
  float y = vUv.y - hy;
  vec3 col;
  if (y >= 0.0) {
    col = landscape(p, y, false);
  } else {
    // Below the horizon the 3D lake covers the screen; this is only a fallback.
    col = landscape(p, 0.0, true) * 0.5;
  }
  // Mist hugging the horizon.
  vec3 mistCol = vec3(0.07, 0.08, 0.11);
  col = mix(col, mistCol, uWeather.w * 0.7 * exp(-abs(y) * 9.0));
  // Rain streaks.
  // Rain: thin slanted streaks in many columns, each column at its own speed and phase.
  vec2 rp = vec2(p.x * 380.0 + vUv.y * 40.0, vUv.y * 2.2);
  float cid = floor(rp.x);
  float cx = abs(fract(rp.x) - 0.5);
  float ph = fract(rp.y + uTime * (1.8 + hash(vec2(cid, 3.0)) * 1.2) + hash(vec2(cid, 2.0)));
  float streak = step(0.965, hash(vec2(cid, 1.0))) * smoothstep(0.5, 0.15, cx) * smoothstep(0.0, 0.04, ph) * smoothstep(0.22, 0.04, ph);
  col += vec3(0.4, 0.45, 0.55) * streak * uWeather.y * 0.3;
  // Snow: three layers of slowly falling, swaying flakes.
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float sc = 18.0 + fk * 14.0;
    vec2 sp = vec2(p.x * sc + sin(uTime * 0.3 + vUv.y * 6.0 + fk) * 0.6, vUv.y * sc * 0.6 + uTime * (0.5 + fk * 0.25));
    vec2 sid = floor(sp);
    vec2 so = vec2(hash(sid), hash(sid + 5.0)) - 0.5;
    float flake = step(0.82, hash(sid + 11.0)) * smoothstep(0.12, 0.0, length(fract(sp) - 0.5 - so * 0.5));
    col += vec3(0.8, 0.85, 0.95) * flake * uWeather.z * (0.25 - fk * 0.05);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const MOTE_VERT = /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform float uPixelRatio;
uniform sampler2D uSegs;
uniform float uSegCount;
varying vec3 vLight;
varying float vSeed;
${SIMPLEX_GLSL}
void main() {
  vec3 p = position;
  // Brownian drift: slow noise advection plus gentle sinking.
  float t = uTime * 0.05;
  p += vec3(
    snoise(vec3(aSeed * 13.1, t, 0.0)),
    snoise(vec3(0.0, aSeed * 7.7, t)) * 0.5 - 0.15 * fract(t * 0.3 + aSeed),
    snoise(vec3(t, 0.0, aSeed * 5.3))
  ) * 0.9;
  vec3 light = vec3(0.0);
  for (int i = 0; i < ${MAX_LIT_SEGMENTS}; i++) {
    if (float(i) >= uSegCount) break;
    vec4 ab = texelFetch(uSegs, ivec2(i, 0), 0);
    vec4 cw = texelFetch(uSegs, ivec2(i, 1), 0);
    vec3 a = vec3(ab.x, ${BEAM_HEIGHT.toFixed(3)}, ab.y);
    vec3 b = vec3(ab.z, ${BEAM_HEIGHT.toFixed(3)}, ab.w);
    vec3 ba = b - a;
    float h = clamp(dot(p - a, ba) / max(dot(ba, ba), 1e-5), 0.0, 1.0);
    vec3 q = p - a - ba * h;
    float r = 0.12 + cw.w;
    light += cw.rgb * exp(-dot(q, q) / (r * r));
  }
  vLight = light;
  vSeed = aSeed;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float lit = clamp(length(light), 0.0, 1.5);
  gl_PointSize = (1.5 + 3.5 * lit) * uPixelRatio * (34.0 / -mv.z) * (0.6 + fract(aSeed * 91.7) * 0.8);
}`;

const MOTE_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vLight;
varying float vSeed;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float soft = exp(-r2 * 3.5);
  // Motes glint as they tumble: a slow per-mote flicker, only visible inside the light.
  float glint = 0.55 + 0.45 * sin(uTime * (1.3 + fract(vSeed * 17.0) * 2.0) + vSeed * 60.0);
  vec3 ambient = vec3(0.012, 0.013, 0.02);
  gl_FragColor = vec4((ambient * 0.5 + vLight * 2.6 * glint) * soft, 1.0);
}`;

/**
 * The room around the table: a dark gradient dome with slow haze, out-of-focus lights in
 * the distance, and dust motes floating above the table that catch the beams.
 */
export class Atmosphere {
  readonly group = new THREE.Group();
  private back: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private energy = 0;
  /** Current weather, eased towards the target so the sky changes over several seconds. */
  private weather: Weather = { ...CALM_NIGHT };
  private target: Weather = { ...CALM_NIGHT };

  /** The eased weather currently shown. */
  get current(): Weather {
    return this.weather;
  }

  /** Screen height (0 bottom … 1 top) of the true horizon, so painted hills sit on the water. */
  setHorizon(y: number): void {
    this.back.material.uniforms.uHorizon!.value = y;
  }

  setWeather(w: Weather, immediate = false): void {
    this.target = w;
    if (immediate) this.weather = { ...w };
  }
  private motes: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private segData = new Float32Array(MAX_LIT_SEGMENTS * 2 * 4);
  private segTexture: THREE.DataTexture;

  constructor(private frame: TableFrame) {
    this.back = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader: BACK_VERT,
        fragmentShader: BACK_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uAspect: { value: new THREE.Vector2(1, 1) },
          uParallax: { value: new THREE.Vector2() },
          uEnergy: { value: 0 },
          uHorizon: { value: 0.8 },
          uWeather: { value: new THREE.Vector4(0.08, 0, 0, 0.35) },
          uClouds: { value: 0.15 },
          uNoise: { value: hazeNoiseTexture() },
        },
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.back.frustumCulled = false;
    this.back.renderOrder = -10;

    const rand = rng(7);
    const mPos = new Float32Array(MOTE_COUNT * 3);
    const mSeed = new Float32Array(MOTE_COUNT);
    for (let i = 0; i < MOTE_COUNT; i++) {
      mPos.set([(rand() - 0.5) * (frame.w + 2), 0.05 + rand() ** 1.6 * 3.2, (rand() - 0.5) * (frame.h + 2)], i * 3);
      mSeed[i] = rand();
    }
    const mGeo = new THREE.BufferGeometry();
    mGeo.setAttribute('position', new THREE.BufferAttribute(mPos, 3));
    mGeo.setAttribute('aSeed', new THREE.BufferAttribute(mSeed, 1));
    this.segTexture = new THREE.DataTexture(this.segData, MAX_LIT_SEGMENTS, 2, THREE.RGBAFormat, THREE.FloatType);
    this.segTexture.needsUpdate = true;
    this.motes = new THREE.Points(
      mGeo,
      new THREE.ShaderMaterial({
        vertexShader: MOTE_VERT,
        fragmentShader: MOTE_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uPixelRatio: { value: 1 },
          uSegs: { value: this.segTexture },
          uSegCount: { value: 0 },
        },
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 4;

    this.group.add(this.back, this.motes);
  }

  /** Upload the brightest beam segments; motes near them light up in their colour. */
  setTree(tree: RayTree): void {
    const segs = [...tree.segments]
      .map((g) => ({ g, power: g.group ? g.intensity * Math.min(g.group.count, 6) : g.intensity }))
      .filter((x) => x.power > 0.03 && x.g.length > 0.05)
      .sort((a, b) => b.power - a.power)
      .slice(0, MAX_LIT_SEGMENTS);
    this.segData.fill(0);
    segs.forEach(({ g, power }, i) => {
      const a = this.frame.toWorld(g.start);
      const b = this.frame.toWorld(g.end);
      const rgb = lightToRGB(g.light);
      const k = Math.min(1, power) * 0.5;
      this.segData.set([a.x, a.z, b.x, b.z], i * 4);
      this.segData.set([rgb[0] * k, rgb[1] * k, rgb[2] * k, Math.min(0.6, Math.abs(g.width))], (MAX_LIT_SEGMENTS + i) * 4);
    });
    this.segTexture.needsUpdate = true;
    this.motes.material.uniforms.uSegCount!.value = segs.length;
  }

  /**
   * @param energy current musical loudness 0…1 (smoothed here), makes the room breathe
   * @param aspect viewport width/height
   * @param parallax camera orbit offset, for depth in the backdrop
   */
  update(time: number, pixelRatio: number, energy = 0, aspect = 1, parallax = new THREE.Vector2()): void {
    this.energy += (Math.min(1, energy) - this.energy) * 0.05;
    for (const k of Object.keys(this.weather) as (keyof Weather)[]) this.weather[k] += (this.target[k] - this.weather[k]) * 0.008;
    const u = this.back.material.uniforms;
    (u.uWeather!.value as THREE.Vector4).set(this.weather.aurora, this.weather.rain, this.weather.snow, this.weather.mist);
    u.uClouds!.value = this.weather.clouds;
    u.uTime!.value = time;
    u.uEnergy!.value = this.energy;
    (u.uAspect!.value as THREE.Vector2).set(aspect, 1);
    (u.uParallax!.value as THREE.Vector2).copy(parallax);
    this.motes.material.uniforms.uTime!.value = time;
    this.motes.material.uniforms.uPixelRatio!.value = pixelRatio;
  }

  dispose(): void {
    for (const o of [this.back, this.motes]) {
      o.geometry.dispose();
      o.material.dispose();
    }
    this.segTexture.dispose();
  }
}
