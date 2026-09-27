import * as THREE from 'three';
import type { RayTree } from '../optics/types';
import { hazeNoiseTexture, SIMPLEX_GLSL } from './beams/beam-material';
import { CALM_NIGHT, WEATHER_KEYS, type Weather } from '../music/mood';
import { BEAM_HEIGHT, type TableFrame } from './frame';
import { lightToRGB } from './spectral-color';

const MAX_LIT_SEGMENTS = 192;
const MOTE_COUNT = 2200;

/**
 * How long (seconds, time constant) each weather quantity takes to follow the music: the
 * light turns over half a minute, wind and sea over a few seconds, lightning charge quickly.
 */
const EASE_S: Record<keyof Weather, number> = {
  aurora: 6,
  rain: 5,
  snow: 6,
  mist: 8,
  clouds: 7,
  wind: 4,
  fireflies: 6,
  warmth: 30,
  dusk: 35,
  waves: 5,
  lightning: 2,
};

const rgb = (r: number, g: number, b: number): THREE.Color => new THREE.Color(r, g, b);
/** Sky colours at the corners of the time-of-day plane (linear, before tone mapping). */
const SKY = {
  night: { top: rgb(0.004, 0.006, 0.018), mid: rgb(0.022, 0.035, 0.075), hor: rgb(0.025, 0.04, 0.085), sun: rgb(0, 0, 0) },
  dawn: { top: rgb(0.03, 0.045, 0.085), mid: rgb(0.1, 0.14, 0.16), hor: rgb(0.3, 0.19, 0.21), sun: rgb(1.0, 0.78, 0.62) },
  sunset: { top: rgb(0.025, 0.025, 0.07), mid: rgb(0.2, 0.075, 0.1), hor: rgb(0.48, 0.19, 0.06), sun: rgb(1.0, 0.52, 0.18) },
  overcast: rgb(0.05, 0.055, 0.065),
  overcastDusk: rgb(0.06, 0.035, 0.02),
};

/** Simple mode's weather: a calm, clear night whatever the music, so the light never changes. */
function simpleWeather(_target: Weather, out: Weather): Weather {
  return Object.assign(out, CALM_NIGHT, { aurora: 0, mist: 0, clouds: 0, fireflies: 0, rain: 0, snow: 0, lightning: 0, waves: 0, dusk: 0 });
}

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
  // Full-screen quad pinned to the far plane: always behind the table. It is drawn after the
  // other opaque objects with the depth test on, so only the sky nothing covers is shaded.
  gl_Position = vec4(position.xy, 0.99999, 1.0);
}`;

const BACK_FRAG = /* glsl */ `
uniform float uTime;
uniform vec2 uAspect;
uniform vec2 uParallax;
uniform float uEnergy;
uniform float uHorizon;
uniform vec4 uWeather; // aurora, rain, snow, mist
uniform vec4 uWeather2; // dusk, warmth, wind, flash
uniform float uClouds;
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uHor;
uniform vec3 uSun;
uniform vec2 uDrift; // clouds, snow: wind-carried distance, integrated on the CPU
uniform vec2 uBolt; // x on screen, seed
uniform sampler2D uNoise;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float nz(vec2 q) { return texture2D(uNoise, q).r; }
float fbm(vec2 q) { return nz(q) * 0.5 + nz(q * 2.03 + 0.31) * 0.3 + nz(q * 4.07 + 0.73) * 0.2; }

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
  float dusk = uWeather2.x;
  float flash = uWeather2.w;
  // Gradient: horizon band (orange at sunset, pink at dawn, blue-grey at night) up to the zenith.
  vec3 c = y < 0.12 ? mix(uHor, uMid, smoothstep(0.0, 0.12, y)) : mix(uMid, uTop, smoothstep(0.12, 0.5, y));
  // Stars, twinkling, hidden by cloud and by the low sun.
  vec2 g = p * 70.0;
  vec2 id = floor(g);
  float h = hash(id);
  vec2 off = vec2(hash(id + 1.7), hash(id + 3.1)) - 0.5;
  float star = step(0.975, h) * smoothstep(0.09, 0.0, length(fract(g) - 0.5 - off * 0.6));
  star *= 0.55 + 0.45 * sin(uTime * (0.8 + h * 3.0) + h * 40.0);
  c += vec3(0.75, 0.82, 1.0) * star * (1.0 - uClouds) * (1.0 - dusk) * smoothstep(0.01, 0.15, y) * 0.8;
  // Moon with a soft halo; it fades as the sun comes to the horizon.
  float night = 1.0 - smoothstep(0.3, 0.85, dusk);
  vec2 moon = vec2(0.22 * uAspect.x, 0.13);
  float md = length(vec2(p.x, y) - moon);
  float disc = reflected ? 0.0 : smoothstep(0.022, 0.019, md) * 0.75;
  c += vec3(0.9, 0.92, 1.0) * (disc + exp(-md * 10.0) * 0.07) * (1.0 - uClouds * 0.7) * night;
  // Low sun on the opposite side: a big soft disc resting on the far hills and a wide glow.
  vec2 sun = vec2(-0.3 * uAspect.x, 0.035);
  float sd = length((vec2(p.x, y) - sun) * vec2(1.0, 1.25));
  float sunDisc = reflected ? 0.0 : smoothstep(0.034, 0.03, sd) * 2.2;
  c += uSun * (sunDisc + exp(-sd * 7.0) * 0.35 + exp(-sd * 2.2) * 0.12) * dusk * (1.0 - uClouds * 0.75);
  // Weather that is exactly zero is skipped: it would only add zero (see Atmosphere.update).
  if (uWeather.x > 0.0) c += aurora(p, y) * uWeather.x * (0.55 + 0.45 * uEnergy) * (1.0 - uClouds * 0.6) * 0.5;
  // Drifting cloud bank; storm wind drags it along. At dusk the undersides catch the sun.
  float cover = 0.0;
  if (uClouds > 0.0) {
    float cl = fbm(vec2(p.x * 0.35 + uDrift.x, y * 1.6));
    cover = smoothstep(0.45, 0.75, cl) * uClouds * 0.9;
    vec3 cloudCol = vec3(0.03, 0.035, 0.045) + uHor * 0.5 + uSun * dusk * 0.12 * smoothstep(0.35, 0.0, y) * (1.0 - uClouds * 0.5);
    c = mix(c, cloudCol, cover);
  }
  // Lightning: the clouds light up from inside, and a jagged bolt drops to the hills.
  if (flash > 0.01) {
    c += vec3(0.32, 0.35, 0.48) * flash * (0.2 + 1.2 * cover + 0.3 * smoothstep(0.4, 0.0, y));
    if (!reflected) {
      float jag = (nz(vec2(y * 5.0, uBolt.y)) - 0.5) * 0.14 + (nz(vec2(y * 21.0, uBolt.y + 0.37)) - 0.5) * 0.04;
      float d = abs(p.x - uBolt.x - jag);
      float top = 0.24 + 0.1 * hash(vec2(uBolt.y, 1.0));
      float on = step(y, top);
      c += vec3(0.8, 0.85, 1.0) * (smoothstep(0.0035, 0.0, d) * 2.5 + exp(-d * 45.0) * 0.25) * on * flash;
    }
  }
  return c;
}

void main() {
  float hy = uHorizon + uParallax.y * 0.35;
  vec2 p = vec2((vUv.x - 0.5) * uAspect.x + uParallax.x * 0.15, vUv.y);
  float y = vUv.y - hy;
  float wind = uWeather2.z;
  vec3 col;
  if (y >= 0.0) {
    col = sky(p, y, false);
  } else {
    // Below the horizon the 3D lake covers the screen; this is only a fallback.
    col = sky(p, 0.0, true) * 0.5;
  }
  // Mist hugging the horizon, tinted by the sky; a gale thins it into torn streaks.
  if (uWeather.w > 0.0) {
    vec3 mistCol = mix(vec3(0.07, 0.08, 0.11), uHor * 0.7 + vec3(0.02), uWeather2.x * 0.7);
    float tear = mix(1.0, smoothstep(0.35, 0.7, nz(vec2(p.x * 0.8 - uDrift.x * 6.0, y * 14.0))), smoothstep(0.5, 1.0, wind));
    col = mix(col, mistCol, uWeather.w * 0.7 * exp(-abs(y) * 9.0) * tear);
  }
  // Rain: thin streaks in many columns, each at its own speed and phase, slanting with the wind.
  if (uWeather.y > 0.0) {
    vec2 rp = vec2(p.x * 380.0 + vUv.y * (40.0 + 260.0 * wind * wind), vUv.y * 2.2);
    float cid = floor(rp.x);
    float cx = abs(fract(rp.x) - 0.5);
    float ph = fract(rp.y + uTime * (1.8 + hash(vec2(cid, 3.0)) * 1.2) + hash(vec2(cid, 2.0)));
    float streak = step(0.965, hash(vec2(cid, 1.0))) * smoothstep(0.5, 0.15, cx) * smoothstep(0.0, 0.04, ph) * smoothstep(0.22, 0.04, ph);
    col += (vec3(0.4, 0.45, 0.55) + uWeather2.w * 0.8) * streak * uWeather.y * 0.3;
  }
  // Snow: three layers of falling, swaying flakes; in a blizzard they stream sideways.
  if (uWeather.z > 0.0) {
    for (int k = 0; k < 3; k++) {
      float fk = float(k);
      float sc = 18.0 + fk * 14.0;
      vec2 sp = vec2(p.x * sc + sin(uTime * 0.3 + vUv.y * 6.0 + fk) * 0.6 - uDrift.y * sc * (0.6 + fk * 0.2), vUv.y * sc * 0.6 + uTime * (0.5 + fk * 0.25));
      vec2 sid = floor(sp);
      vec2 so = vec2(hash(sid), hash(sid + 5.0)) - 0.5;
      float flake = step(0.82 - 0.1 * uWeather.z, hash(sid + 11.0)) * smoothstep(0.12, 0.0, length(fract(sp) - 0.5 - so * 0.5));
      col += vec3(0.8, 0.85, 0.95) * flake * uWeather.z * (0.25 - fk * 0.05);
    }
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
  /** Current weather, eased towards the target at each quantity's own pace. */
  private weather: Weather = { ...CALM_NIGHT };
  private target: Weather = { ...CALM_NIGHT };
  private lastTime: number | null = null;
  /** Wind-carried distance for clouds (x) and backdrop snow (y), wrapped where the pattern repeats. */
  private drift = new THREE.Vector2();
  private flashT0 = -Infinity;
  private flashAmp = 0;
  private flashSoft = false;
  private reducedMotion: MediaQueryList | null = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  private day = new THREE.Color();
  private grey = new THREE.Color();
  /** Sky colours this frame, shared with the lake, fog and lights. */
  readonly palette = { top: new THREE.Color(), mid: new THREE.Color(), horizon: new THREE.Color(), sun: new THREE.Color() };
  /** Lightning brightness this frame, 0…~1. */
  flash = 0;

  /** The eased weather currently shown. */
  get current(): Weather {
    return this.weather;
  }

  /** Screen height (0 bottom … 1 top) of the true horizon, so painted hills sit on the water. */
  setHorizon(y: number): void {
    this.back.material.uniforms.uHorizon!.value = y;
  }

  setWeather(w: Weather, immediate = false): void {
    Object.assign(this.target, w);
    if (immediate) Object.assign(this.weather, this.simple ? simpleWeather(w, this.simpleTarget) : w);
  }

  /**
   * A lightning flash of the given strength (0…1): two or three quick flickers and a bolt.
   * With reduced motion it is a single soft, dim glow at most every eight seconds.
   */
  strike(strength: number): void {
    if (this.simple) return;
    const now = this.lastTime ?? 0;
    const soft = this.reducedMotion?.matches ?? false;
    if (soft && now - this.flashT0 < 8) return;
    this.flashT0 = now;
    this.flashSoft = soft;
    this.flashAmp = soft ? strength * 0.2 : strength;
    const u = this.back.material.uniforms;
    const aspect = (u.uAspect!.value as THREE.Vector2).x;
    (u.uBolt!.value as THREE.Vector2).set((Math.random() - 0.5) * aspect * 0.8, Math.random() * 10);
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
          uWeather2: { value: new THREE.Vector4(0, 0.5, 0.12, 0) },
          uClouds: { value: 0.15 },
          uTop: { value: new THREE.Color() },
          uMid: { value: new THREE.Color() },
          uHor: { value: new THREE.Color() },
          uSun: { value: new THREE.Color() },
          uDrift: { value: new THREE.Vector2() },
          uBolt: { value: new THREE.Vector2() },
          uNoise: { value: hazeNoiseTexture() },
        },
        depthWrite: false,
        depthTest: true,
      }),
    );
    this.back.frustumCulled = false;
    // Last among the opaque objects (before anything transparent): what they cover is skipped.
    this.back.renderOrder = 1000;

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
  setTree(tree: RayTree, steady: (segmentId: number) => boolean = () => true): void {
    const segs = tree.segments
      .filter((g) => steady(g.id))
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

  private simple = false;
  private simpleTarget: Weather = { ...CALM_NIGHT };

  /**
   * Simple mode: no sky, no dust, and a still, unchanging light (no weather, no lightning).
   * The renderer shows the table alone on a plain background.
   */
  setSimple(on: boolean): void {
    if (on === this.simple) return;
    this.simple = on;
    this.group.visible = !on;
    if (on) {
      Object.assign(this.weather, simpleWeather(this.target, this.simpleTarget));
      this.flashT0 = -Infinity;
    }
  }

  /** Draw only the first `n` motes (quality setting). */
  setMoteCount(n: number): void {
    this.motes.geometry.setDrawRange(0, Math.min(n, MOTE_COUNT));
  }

  /**
   * Ease the weather towards its target, advance wind drift and lightning, recolour the sky.
   * @param energy current musical loudness 0…1 (smoothed here), makes the room breathe
   * @param aspect viewport width/height
   * @param parallax camera orbit offset, for depth in the backdrop
   */
  update(time: number, pixelRatio: number, energy = 0, aspect = 1, parallax?: THREE.Vector2): void {
    const dt = this.lastTime === null ? 0 : Math.min(0.25, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    this.energy += (Math.min(1, energy) - this.energy) * 0.05;
    const w = this.weather;
    const target = this.simple ? simpleWeather(this.target, this.simpleTarget) : this.target;
    for (const k of WEATHER_KEYS) {
      w[k] += (target[k] - w[k]) * (1 - Math.exp(-dt / EASE_S[k]));
      // Arrive exactly: easing alone never reaches the target, so a sky that has settled would
      // still change by a hair every frame (moving the key light, so redrawing the shadows),
      // and weather fading to nothing would never be exactly zero for the shaders to skip.
      if (Math.abs(target[k] - w[k]) < 1e-4) w[k] = target[k];
    }
    this.drift.x = (this.drift.x + dt * (0.004 + 0.06 * w.wind * w.wind)) % 100;
    this.drift.y = (this.drift.y + dt * 0.3 * w.wind * w.wind) % 5;
    this.updateFlash(time);
    this.updatePalette();
    const u = this.back.material.uniforms;
    (u.uWeather!.value as THREE.Vector4).set(w.aurora, w.rain, w.snow, w.mist);
    (u.uWeather2!.value as THREE.Vector4).set(w.dusk, w.warmth, w.wind, this.flash);
    (u.uTop!.value as THREE.Color).copy(this.palette.top);
    (u.uMid!.value as THREE.Color).copy(this.palette.mid);
    (u.uHor!.value as THREE.Color).copy(this.palette.horizon);
    (u.uSun!.value as THREE.Color).copy(this.palette.sun);
    (u.uDrift!.value as THREE.Vector2).copy(this.drift);
    u.uClouds!.value = w.clouds;
    u.uTime!.value = time;
    u.uEnergy!.value = this.energy;
    (u.uAspect!.value as THREE.Vector2).set(aspect, 1);
    if (parallax) (u.uParallax!.value as THREE.Vector2).copy(parallax);
    this.motes.material.uniforms.uTime!.value = time;
    this.motes.material.uniforms.uPixelRatio!.value = pixelRatio;
  }

  /** Flickers: a bright stroke, a second one a beat later, a faint third; soft mode just glows out. */
  private updateFlash(time: number): void {
    const t = time - this.flashT0;
    if (!(t >= 0 && t < 2.5)) {
      this.flash = 0;
      return;
    }
    const a = this.flashAmp;
    this.flash = this.flashSoft
      ? a * Math.min(1, t * 4) * Math.exp(-t * 1.5)
      : a * Math.min(1.2, Math.exp(-t * 10) + (t > 0.13 ? 0.75 * Math.exp(-(t - 0.13) * 9) : 0) + (t > 0.32 ? 0.45 * Math.exp(-(t - 0.32) * 12) : 0));
  }

  /** Night, dawn or sunset by `dusk` and `warmth`, greyed under cloud and dimmed by rain. */
  private updatePalette(): void {
    const w = this.weather;
    const p = this.palette;
    const warm = THREE.MathUtils.smoothstep(w.warmth, 0.3, 0.7);
    const dim = 1 - 0.3 * w.rain;
    this.grey.copy(SKY.overcast).lerp(SKY.overcastDusk, w.dusk);
    this.day.lerpColors(SKY.dawn.hor, SKY.sunset.hor, warm);
    p.horizon.lerpColors(SKY.night.hor, this.day, w.dusk).lerp(this.grey, w.clouds * (1 - 0.3 * w.dusk)).multiplyScalar(dim);
    this.day.lerpColors(SKY.dawn.mid, SKY.sunset.mid, warm);
    p.mid.lerpColors(SKY.night.mid, this.day, w.dusk).lerp(this.grey, w.clouds * 0.8).multiplyScalar(dim);
    this.day.lerpColors(SKY.dawn.top, SKY.sunset.top, warm);
    this.grey.multiplyScalar(0.3);
    p.top.lerpColors(SKY.night.top, this.day, w.dusk).lerp(this.grey, w.clouds * 0.5).multiplyScalar(dim);
    p.sun.lerpColors(SKY.dawn.sun, SKY.sunset.sun, warm);
  }

  dispose(): void {
    for (const o of [this.back, this.motes]) {
      o.geometry.dispose();
      o.material.dispose();
    }
    this.segTexture.dispose();
  }
}
