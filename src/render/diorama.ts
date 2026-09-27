import * as THREE from 'three';
import type { Weather } from '../music/mood';
import { hazeNoiseTexture } from './beams/beam-material';

/** Ground level around the table; the tabletop is at y = 0. */
export const GROUND_Y = -1.4;
const WATER_Y = -1.75;
const RAIN_DROPS = 2600;
const SNOW_FLAKES = 3500;
const SPRAY_COUNT = 600;
/** Where the low sun sits (towards the far left hills), for its glitter path on the lake. */
const SUN_DIR = new THREE.Vector3(-0.55, 0.08, -0.83).normalize();

/** Sky colours the lake reflects and the fog takes, set by the renderer every frame. */
export interface DioramaSky {
  top: THREE.Color;
  horizon: THREE.Color;
  fog: THREE.Color;
  moon: THREE.Color;
  sun: THREE.Color;
}

const smooth01 = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Smooth 2D value noise on the CPU for the terrain (same idea as the haze texture). */
function makeNoise2D(seed: number): (x: number, y: number) => number {
  const rand = rng(seed);
  const N = 256;
  const grid = Float32Array.from({ length: N * N }, rand);
  const at = (x: number, y: number): number => grid[(((y % N) + N) % N) * N + (((x % N) + N) % N)]!;
  return (x, y) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
  };
}

/** Distance outside a rounded rectangle centred at the origin (negative inside). */
function roundedRectDist(x: number, z: number, hx: number, hz: number, r: number): number {
  const qx = Math.abs(x) - hx + r;
  const qz = Math.abs(z) - hz + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
}

/**
 * Inject wind into a standard material: displacement grows with height², always downwind in
 * world space (each instance is turned, so the direction is brought into its frame). A gale
 * bends trees hard and lays grass nearly flat; the bend keeps the length, so tips come down.
 */
function windy(mat: THREE.MeshStandardMaterial, uniforms: Record<string, THREE.IUniform>, strength: number): void {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;\nuniform float uGust;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 origin = vec4(0.0, 0.0, 0.0, 1.0);
          vec3 wdir = normalize(vec3(1.0, 0.0, 0.25));
          #ifdef USE_INSTANCING
            origin = instanceMatrix * origin;
            wdir = transpose(mat3(instanceMatrix)) * wdir;
            wdir = normalize(vec3(wdir.x, 0.0, wdir.z) + 1e-5);
          #endif
          vec3 side = vec3(-wdir.z, 0.0, wdir.x);
          float ph = origin.x * 0.37 + origin.z * 0.23;
          float h = max(position.y, 0.0);
          float gale = smoothstep(0.45, 1.0, uWind);
          // uGust is the wind's integrated run, so flutter speeds up without phase jumps.
          float gust = 0.6 + 0.4 * sin(uGust * 0.7 + uTime * 0.35 + origin.x * 0.05);
          float sway = (sin(uTime * 1.1 + uGust * 2.0 + ph) * 0.7 + sin(uTime * 2.7 + uGust * 3.5 + ph * 1.9) * 0.3) * gust;
          float lean = uWind * uWind * 0.8 + gale * 3.6 * gust;
          float along = clamp((sway * uWind * (1.0 - 0.5 * gale) + lean) * ${strength.toFixed(3)} * h * h, -0.85 * h, 0.85 * h);
          float across = sway * uWind * ${(strength * 0.35).toFixed(3)} * h * h;
          transformed += wdir * along + side * across;
          transformed.y -= h - sqrt(max(h * h - along * along, 0.0));
        }`,
      );
  };
}

function pineGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.06, 0.09, 0.6, 6);
  trunk.translate(0, 0.3, 0);
  parts.push(trunk);
  const tiers: [number, number, number][] = [
    [0.62, 0.9, 0.55],
    [0.5, 0.8, 1.05],
    [0.36, 0.7, 1.5],
  ];
  for (const [r, hgt, y] of tiers) {
    const cone = new THREE.ConeGeometry(r, hgt, 7);
    cone.translate(0, y + hgt / 2 - 0.2, 0);
    parts.push(cone);
  }
  // Vertex colours: trunk brown, needles dark green getting lighter towards the tips.
  const merged = mergeGeometries(parts);
  const pos = merged.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const trunkish = y < 0.45 && Math.hypot(pos.getX(i), pos.getZ(i)) < 0.1;
    const c = trunkish ? [0.06, 0.04, 0.025] : [0.012 + y * 0.004, 0.035 + y * 0.012, 0.028 + y * 0.006];
    col.set(c, i * 3);
  }
  merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return merged;
}

/** Minimal non-indexed merge (position + normal) so we avoid pulling in BufferGeometryUtils. */
function mergeGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const count = flat.reduce((a, p) => a + p.getAttribute('position').count, 0);
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  let o = 0;
  for (const p of flat) {
    p.computeVertexNormals();
    pos.set(p.getAttribute('position').array as Float32Array, o * 3);
    nor.set(p.getAttribute('normal').array as Float32Array, o * 3);
    o += p.getAttribute('position').count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

const WATER_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const WATER_FRAG = /* glsl */ `
uniform float uTime;
uniform float uWind;
uniform float uRain;
uniform float uAurora;
uniform float uClouds;
uniform float uWaves;
uniform float uFlow; // wind-driven drift of the ripples, integrated on the CPU
uniform float uDusk;
uniform float uFlash;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uMoonDir;
uniform vec3 uMoonColor;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform sampler2D uNoise;
varying vec3 vWorld;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  float t = uTime;
  vec2 q = vWorld.xz;
  // Swell: four wave trains fanned around the wind; their summed slope tilts the normal.
  vec2 wd = normalize(vec2(1.0, 0.25));
  float hs = 0.0;
  vec2 grad = vec2(0.0);
  // Weather that is exactly zero is skipped below: it would only add zero.
  if (uWaves > 0.0) for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float ang = (fi - 1.5) * 0.35;
    vec2 d = vec2(wd.x * cos(ang) - wd.y * sin(ang), wd.x * sin(ang) + wd.y * cos(ang));
    float freq = 0.45 * pow(1.55, fi);
    float amp = pow(1.7, -fi);
    float ph = dot(d, q) * freq - t * sqrt(9.8 * freq) * 0.55 + fi * 1.7;
    hs += amp * sin(ph);
    grad += amp * freq * cos(ph) * d;
  }
  hs /= 2.14;
  // Calm music leaves a mirror; wind, rain and the storm roughen it.
  float k = 0.04 + uWind * 0.3 + uRain * 0.2 + uWaves * 0.8;
  float n1 = texture2D(uNoise, q * 0.035 + vec2(0.006, 0.003) * uFlow).r;
  float n2 = texture2D(uNoise, q * 0.11 - vec2(0.012, -0.009) * uFlow).r;
  float n3 = texture2D(uNoise, q * 0.013 + vec2(0.0, t * 0.002)).r;
  float sw = uWaves * uWaves * 0.45;
  vec3 N = normalize(vec3((n1 - 0.5) * k + (n2 - 0.5) * k * 0.6 - grad.x * sw, 1.0, (n2 - 0.5) * k + (n3 - 0.5) * k * 0.4 - grad.y * sw));
  // Rain rings: expanding circles in a jittered grid.
  float rings = 0.0;
  if (uRain > 0.0 && uWaves < 1.0) {
    vec2 g = q * 0.9;
    vec2 id = floor(g);
    vec2 c = vec2(hash(id), hash(id + 3.7)) * 0.6 + 0.2;
    float rt = fract(t * 0.9 + hash(id + 1.3) * 5.0);
    float ring = abs(length(fract(g) - c) - rt * 0.45);
    rings = smoothstep(0.03, 0.0, ring) * (1.0 - rt) * step(0.45, hash(id + 7.1)) * uRain * (1.0 - uWaves);
  }
  vec3 R = reflect(-V, N);
  // We look down on the lake, so the sky is only ever seen in it: make the reflection rich.
  float fres = 0.08 + 0.92 * pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 sky = mix(uSkyHorizon * 1.6, uSkyTop, clamp(R.y * 1.4, 0.0, 1.0));
  float night = 1.0 - smoothstep(0.3, 0.85, uDusk);
  // Stars.
  vec2 sp = R.xz / max(R.y, 0.05) * 30.0;
  vec2 sid = floor(sp);
  float star = step(0.985, hash(sid)) * smoothstep(0.25, 0.0, length(fract(sp) - 0.5));
  sky += vec3(0.7, 0.75, 0.9) * star * 0.6 * (1.0 - uClouds) * night * (1.0 - uWaves);
  vec2 ap = R.xz / max(R.y, 0.08);
  // Aurora curtains drifting across the reflected sky.
  if (uAurora > 0.0) {
    // Curtains: long bands along one axis, rippling slowly, with fine vertical rays.
    vec2 aq = vWorld.xz * 0.012 + ap * 0.35;
    float wave = texture2D(uNoise, vec2(aq.x * 0.6 + t * 0.003, aq.y * 0.15)).r;
    float bands = smoothstep(0.3, 0.0, abs(fract(aq.y * 0.9 + wave * 1.2 + t * 0.004) - 0.5) - 0.05);
    float rays = 0.5 + 0.5 * texture2D(uNoise, vec2(aq.x * 3.0 + t * 0.01, 0.37)).r;
    vec3 auroraCol = mix(vec3(0.1, 1.0, 0.5), vec3(0.65, 0.35, 1.0), smoothstep(0.3, 0.8, texture2D(uNoise, aq * 0.4 + 0.5).r));
    sky += auroraCol * bands * bands * rays * uAurora * 0.45;
  }
  // Clouds.
  if (uClouds > 0.0) {
    float cl = texture2D(uNoise, vWorld.xz * 0.01 + ap * 0.2 + vec2(t * 0.003, t * 0.001)).r;
    sky = mix(sky, uSkyHorizon * 2.0, smoothstep(0.45, 0.8, cl) * uClouds * 0.9);
  }
  // A rough sea scatters the sky: darker, greyer reflections.
  sky *= 1.0 - 0.35 * uWaves;
  float md = max(dot(R, uMoonDir), 0.0);
  float moon = (pow(md, 600.0) * 6.0 + pow(md, 40.0) * 0.12) * night;
  // The low sun lays a long glittering path across the water.
  float sd = max(dot(R, uSunDir), 0.0);
  float sun = (pow(sd, 400.0) * 5.0 + pow(sd, 24.0) * 0.35 + pow(sd, 4.0) * 0.05) * uDusk * (1.0 - uClouds * 0.7);
  vec3 deep = mix(vec3(0.004, 0.012, 0.018), vec3(0.01, 0.02, 0.022), uWaves);
  vec3 col = deep + sky * fres * 1.3 + uMoonColor * moon + uSunColor * sun + vec3(0.35, 0.4, 0.5) * rings * 0.35;
  // Whitecaps: foam breaks on the crests, torn into patches by noise (none below waves 0.3).
  if (uWaves > 0.3) {
    float crest = smoothstep(0.3, 0.8, hs) * smoothstep(0.3, 0.9, uWaves);
    float breakup = texture2D(uNoise, q * 0.21 + vec2(0.02, 0.005) * uFlow).r;
    float foam = crest * smoothstep(0.42, 0.68, breakup + crest * 0.25);
    vec3 foamCol = uSkyHorizon * 2.5 + uMoonColor * 0.06 * night + uSunColor * 0.08 * uDusk + vec3(0.02) + vec3(0.5, 0.55, 0.7) * uFlash;
    col = mix(col, foamCol, foam * 0.85);
  }
  float dist = length(cameraPosition - vWorld);
  col = mix(col, uFogColor, smoothstep(60.0, 320.0, dist));
  gl_FragColor = vec4(col, 1.0);
}`;

const RAIN_VERT = /* glsl */ `
attribute vec4 aDrop; // x, z, phase, end (0 top / 1 bottom)
uniform float uTime;
uniform float uWind;
varying float vEnd;
void main() {
  float span = 16.0;
  float speed = 14.0;
  float y = mod(aDrop.z * span - uTime * speed, span) - 2.0;
  // Drops slant downwind; in a gale they fly almost sideways, wrapping round the area.
  float gale = smoothstep(0.45, 1.0, uWind);
  float slant = uWind * 0.6 + gale * 2.2;
  float x = mod(aDrop.x + slant * (span - 2.0 - y) * 0.5 + 45.0, 90.0) - 45.0;
  vec3 p = vec3(x, y, aDrop.y);
  // The streak is the drop's motion blur, longer as it flies faster.
  vec3 dir = normalize(vec3(slant, -1.0, uWind * 0.15));
  p += dir * aDrop.w * 0.55 * (1.0 + gale);
  vEnd = aDrop.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const RAIN_FRAG = /* glsl */ `
uniform float uRain;
varying float vEnd;
void main() {
  gl_FragColor = vec4(vec3(0.55, 0.62, 0.75) * uRain * 0.22 * (1.0 - vEnd * 0.7), 1.0);
}`;

const SPECK_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uWind;
uniform float uGust;
uniform float uMode; // 0 snow, 1 fireflies, 2 gale spray
uniform float uPixelRatio;
varying float vGlow;
void main() {
  vec3 p;
  float size = 2.2;
  if (uMode < 0.5) {
    // Snow drifts downwind; in a blizzard it streams across almost level.
    float span = 14.0;
    float y = mod(aSeed.z * span - uTime * (0.6 + aSeed.w * 0.5), span) - 2.0;
    float gale = smoothstep(0.45, 1.0, uWind);
    float x = aSeed.x + sin(uTime * 0.7 + aSeed.w * 30.0) * 0.4 * (1.0 - gale) + (uWind * 0.35 + gale * 1.6) * (span - y) + uGust * 2.0;
    p = vec3(mod(x + 45.0, 90.0) - 45.0, y, aSeed.y);
    vGlow = 1.0;
  } else if (uMode < 1.5) {
    // Fireflies wander slowly and glow in soft, slow pulses (well under 3 Hz).
    float ph = aSeed.w * 40.0;
    p = vec3(
      aSeed.x + sin(uTime * 0.23 + ph) * 1.4,
      ${GROUND_Y.toFixed(2)} + 0.35 + aSeed.z * 1.8 + sin(uTime * 0.41 + ph) * 0.35,
      aSeed.y + cos(uTime * 0.19 + ph * 1.3) * 1.4
    );
    vGlow = pow(0.5 + 0.5 * sin(uTime * (0.6 + aSeed.w) + ph), 3.0);
    size = 3.2;
  } else {
    // Spray and torn leaves flung low over the lake by a gale.
    float x = mod(aSeed.x + uGust * (6.0 + aSeed.w * 6.0) + 45.0, 90.0) - 45.0;
    float y = ${WATER_Y.toFixed(2)} + 0.2 + aSeed.z * aSeed.z * 4.0 + sin(uTime * (2.0 + aSeed.w * 3.0) + aSeed.w * 50.0) * 0.3;
    p = vec3(x, y, aSeed.y);
    vGlow = 0.5 + 0.5 * fract(aSeed.w * 37.0);
    size = 6.0;
  }
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * uPixelRatio * (40.0 / -mv.z);
}`;

const SPECK_FRAG = /* glsl */ `
uniform float uMode;
uniform float uAmount;
uniform vec3 uTint;
varying float vGlow;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  vec3 c;
  float shape;
  if (uMode < 0.5) {
    c = vec3(0.75, 0.8, 0.9) * 0.5;
    shape = exp(-r2 * 3.0);
  } else if (uMode < 1.5) {
    c = vec3(1.0, 0.85, 0.35) * 2.2 * vGlow;
    shape = exp(-r2 * 3.0);
  } else {
    // A short horizontal dash: the streak of something flying past.
    c = uTint * vGlow;
    shape = exp(-(p.x * p.x * 0.8 + p.y * p.y * 18.0));
  }
  gl_FragColor = vec4(c * shape * uAmount, 1.0);
}`;

/**
 * A miniature landscape around the table: an island meadow with pines, grass and rocks in
 * a lake, far hills, and weather — wind, rain, snow, fireflies — driven by the music.
 */
export class Diorama {
  readonly group = new THREE.Group();
  /** uGust is the wind's run (∫ wind dt, weighted towards gales), so wind-driven motion never jumps. */
  private uniforms = { uTime: { value: 0 }, uWind: { value: 0.1 }, uGust: { value: 0 } };
  private water: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private rain: THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private snow: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private fireflies: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private spray: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private lastTime: number | null = null;
  private flow = 0;
  /** Share of the rain, snow and spray particles drawn at full weather (quality setting). */
  private particleScale = 1;
  private disposables: { dispose(): void }[] = [];

  constructor(tableW: number, tableH: number) {
    const rand = rng(42);
    const noise = makeNoise2D(9);
    const hx = tableW / 2;
    const hz = tableH / 2;
    const islandX = hx + 5;
    const islandZ = hz + 4;

    // ------------------------------------------------------------------ terrain
    const terrain = new THREE.PlaneGeometry(420, 320, 280, 220);
    terrain.rotateX(-Math.PI / 2);
    const tp = terrain.getAttribute('position');
    const colors = new Float32Array(tp.count * 3);
    for (let i = 0; i < tp.count; i++) {
      const x = tp.getX(i);
      const z = tp.getZ(i);
      const shore = roundedRectDist(x, z, islandX, islandZ, 6) + (noise(x * 0.12, z * 0.12) - 0.5) * 7;
      const bumps = (noise(x * 0.35 + 50, z * 0.35) - 0.5) * 0.35;
      let y = GROUND_Y + bumps;
      if (shore > 0) y = GROUND_Y - Math.min(1.6, shore * 0.35) + bumps * 0.5;
      // Far hills rise all around, higher behind the table.
      const r = Math.hypot(x, z * 1.3);
      const hill = Math.max(0, r - 70) / 60;
      const ridge = noise(x * 0.025 + 7, z * 0.025) * 0.7 + noise(x * 0.08, z * 0.08 + 3) * 0.3;
      y += Math.min(1, hill) ** 1.5 * (6 + ridge * 26) * (z < 0 ? 1.2 : 0.6);
      tp.setY(i, y);
      const v = noise(x * 0.5, z * 0.5) * 0.3 + 0.85;
      let c: [number, number, number];
      if (y > WATER_Y + 0.12 && shore < 0) c = [0.014 * v, 0.028 * v, 0.018 * v];
      else if (y > WATER_Y - 0.1 && hill < 0.05) c = [0.05 * v, 0.045 * v, 0.036 * v];
      else if (hill > 0.05) c = [0.01 * v, 0.018 * v, 0.02 * v];
      else c = [0.02, 0.03, 0.03];
      colors.set(c, i * 3);
    }
    terrain.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    terrain.computeVertexNormals();
    const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, envMapIntensity: 0.15 });
    const ground = new THREE.Mesh(terrain, terrainMat);
    ground.receiveShadow = true;
    this.group.add(ground);
    this.disposables.push(terrain, terrainMat);

    // Pedestal the table stands on.
    const pedMat = new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 0.7, metalness: 0.1 });
    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(tableW + 1.6, 1.6, tableH + 1.6), pedMat);
    pedestal.position.y = -0.85;
    this.group.add(pedestal);
    this.disposables.push(pedestal.geometry, pedMat);

    // -------------------------------------------------------------------- water
    const waterMat = new THREE.ShaderMaterial({
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      uniforms: {
        uTime: this.uniforms.uTime,
        uWind: this.uniforms.uWind,
        uRain: { value: 0 },
        uAurora: { value: 0 },
        uClouds: { value: 0 },
        uWaves: { value: 0 },
        uFlow: { value: 0 },
        uDusk: { value: 0 },
        uFlash: { value: 0 },
        uSunDir: { value: SUN_DIR },
        uSunColor: { value: new THREE.Color() },
        uSkyTop: { value: new THREE.Color(0.004, 0.006, 0.02) },
        uSkyHorizon: { value: new THREE.Color(0.03, 0.045, 0.09) },
        uMoonDir: { value: new THREE.Vector3(0.35, 0.35, -0.87).normalize() },
        uMoonColor: { value: new THREE.Color(0.9, 0.92, 1.0) },
        uFogColor: { value: new THREE.Color(0.02, 0.03, 0.06) },
        uNoise: { value: hazeNoiseTexture() },
      },
    });
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), waterMat);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = WATER_Y;
    this.group.add(this.water);
    this.disposables.push(this.water.geometry, waterMat);

    // ------------------------------------------------------------ trees & grass
    const onIsland = (x: number, z: number, margin: number): boolean =>
      roundedRectDist(x, z, islandX, islandZ, 6) + (noise(x * 0.12, z * 0.12) - 0.5) * 7 < -margin;
    const nearTable = (x: number, z: number, m: number): boolean => Math.abs(x) < hx + m && Math.abs(z) < hz + m;
    const groundAt = (x: number, z: number): number => GROUND_Y + (noise(x * 0.35 + 50, z * 0.35) - 0.5) * 0.35;

    const treeGeo = pineGeometry();
    const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true, envMapIntensity: 0.2 });
    windy(treeMat, this.uniforms, 0.05);
    const treePlaces: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (let tries = 0; tries < 4000 && treePlaces.length < 90; tries++) {
      const x = (rand() - 0.5) * (islandX * 2 + 4);
      const z = (rand() - 0.5) * (islandZ * 2 + 4);
      if (!onIsland(x, z, 1) || nearTable(x, z, 1.8)) continue;
      // Keep the strip in front of the camera low, so trees never hide the table.
      const front = z > hz;
      const s = front ? 0.35 + rand() * 0.25 : 0.8 + rand() * 1.1;
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      treePlaces.push(m.clone().compose(new THREE.Vector3(x, groundAt(x, z) - 0.05, z), q, new THREE.Vector3(s, s * (0.9 + rand() * 0.4), s)));
    }
    // A treeline on the far hills.
    for (let i = 0; i < 160; i++) {
      const a = Math.PI * (0.05 + rand() * 0.9);
      const r = 95 + rand() * 50;
      const x = Math.cos(a) * r * 1.4 - 0;
      const z = -Math.sin(a) * r;
      const s = 2.5 + rand() * 2.5;
      treePlaces.push(m.clone().compose(new THREE.Vector3(x, -1, z), q.setFromAxisAngle(up, rand() * 6), new THREE.Vector3(s, s, s)));
    }
    const trees = new THREE.InstancedMesh(treeGeo, treeMat, treePlaces.length);
    treePlaces.forEach((tm, i) => trees.setMatrixAt(i, tm));
    trees.castShadow = false;
    this.group.add(trees);
    this.disposables.push(treeGeo, treeMat);

    const blade = new THREE.BufferGeometry();
    blade.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.035, 0, 0, 0.035, 0, 0, 0, 0.42, 0.02]), 3));
    blade.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0.3, 1, 0, 0.3, 1, 0, 0.3, 1]), 3));
    blade.setAttribute('color', new THREE.BufferAttribute(new Float32Array([0.008, 0.02, 0.01, 0.008, 0.02, 0.01, 0.035, 0.07, 0.03]), 3));
    const grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide, envMapIntensity: 0.2 });
    windy(grassMat, this.uniforms, 1.1);
    const grassCount = 6000;
    const grass = new THREE.InstancedMesh(blade, grassMat, grassCount);
    let gi = 0;
    for (let tries = 0; tries < grassCount * 4 && gi < grassCount; tries++) {
      const x = (rand() - 0.5) * (islandX * 2);
      const z = (rand() - 0.5) * (islandZ * 2);
      if (!onIsland(x, z, 0.5) || nearTable(x, z, 0.9)) continue;
      const s = 0.6 + rand() * 0.9;
      grass.setMatrixAt(gi++, m.compose(new THREE.Vector3(x, groundAt(x, z), z), q.setFromAxisAngle(up, rand() * 6.28), new THREE.Vector3(s, s, s)));
    }
    grass.count = gi;
    this.grass = grass;
    this.group.add(grass);
    this.disposables.push(blade, grassMat);

    const rockGeo = new THREE.IcosahedronGeometry(0.5, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.9, flatShading: true });
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 40);
    let ri = 0;
    for (let tries = 0; tries < 800 && ri < 40; tries++) {
      const x = (rand() - 0.5) * (islandX * 2 + 8);
      const z = (rand() - 0.5) * (islandZ * 2 + 8);
      if (nearTable(x, z, 1.5) || (z > hz + 1 && Math.abs(x) < hx)) continue;
      const s = 0.3 + rand() * 1.1;
      rocks.setMatrixAt(ri++, m.compose(new THREE.Vector3(x, groundAt(x, z) - 0.1, z), q.setFromEuler(new THREE.Euler(rand(), rand() * 6, rand())), new THREE.Vector3(s * 1.3, s * 0.7, s)));
    }
    rocks.count = ri;
    this.group.add(rocks);
    this.disposables.push(rockGeo, rockMat);

    // ------------------------------------------------------------------ weather
    const drops = RAIN_DROPS;
    const dropData = new Float32Array(drops * 2 * 4);
    for (let i = 0; i < drops; i++) {
      const x = (rand() - 0.5) * 90;
      const z = (rand() - 0.5) * 70 - 5;
      const ph = rand();
      dropData.set([x, z, ph, 0, x, z, ph, 1], i * 8);
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('aDrop', new THREE.BufferAttribute(dropData, 4));
    rainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(drops * 2 * 3), 3));
    const rainMat = new THREE.ShaderMaterial({
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      uniforms: { uTime: this.uniforms.uTime, uWind: this.uniforms.uWind, uRain: { value: 0 } },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.rain = new THREE.LineSegments(rainGeo, rainMat);
    this.rain.frustumCulled = false;
    this.group.add(this.rain);
    this.disposables.push(rainGeo, rainMat);

    const speck = (count: number, mode: 0 | 1 | 2, area: [number, number], zOff: number): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> => {
      const data = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        let x = (rand() - 0.5) * area[0];
        let z = (rand() - 0.5) * area[1] + zOff;
        if (mode === 1) {
          // Fireflies stay over the meadow, off the table.
          while (nearTable(x, z, 0.5) || !onIsland(x, z, 0)) {
            x = (rand() - 0.5) * area[0];
            z = (rand() - 0.5) * area[1] + zOff;
          }
        }
        data.set([x, z, rand(), rand()], i * 4);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('aSeed', new THREE.BufferAttribute(data, 4));
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      const mat = new THREE.ShaderMaterial({
        vertexShader: SPECK_VERT,
        fragmentShader: SPECK_FRAG,
        uniforms: {
          uTime: this.uniforms.uTime,
          uWind: this.uniforms.uWind,
          uGust: this.uniforms.uGust,
          uTint: { value: new THREE.Color() },
          uMode: { value: mode },
          uAmount: { value: 0 },
          uPixelRatio: { value: 1 },
        },
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      this.disposables.push(geo, mat);
      return pts;
    };
    this.snow = speck(SNOW_FLAKES, 0, [90, 70], -5);
    this.fireflies = speck(140, 1, [islandX * 2, islandZ * 2], 0);
    this.spray = speck(SPRAY_COUNT, 2, [90, 50], -5);
    this.group.add(this.snow, this.fireflies, this.spray);
  }

  /** Draw this share (0…1) of the weather particles; eco keeps fewer. */
  setParticleScale(k: number): void {
    this.particleScale = Math.min(1, Math.max(0.1, k));
  }

  /** @param flash lightning brightness this frame (lights spray and foam; the sky colours already carry it) */
  update(time: number, w: Weather, pixelRatio: number, sky: DioramaSky, flash = 0): void {
    const dt = this.lastTime === null ? 0 : Math.min(0.25, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    const gale = smooth01((w.wind - 0.45) / 0.55);
    this.uniforms.uTime.value = time;
    this.uniforms.uWind.value = w.wind;
    this.uniforms.uGust.value += dt * (w.wind + 3 * w.wind * w.wind * w.wind);
    this.flow += dt * (0.5 + 2 * w.wind + 2 * w.waves);
    const wu = this.water.material.uniforms;
    wu.uRain!.value = w.rain;
    wu.uAurora!.value = w.aurora;
    wu.uClouds!.value = w.clouds;
    wu.uWaves!.value = w.waves;
    wu.uFlow!.value = this.flow;
    wu.uDusk!.value = w.dusk;
    wu.uFlash!.value = flash;
    this.updateMist(w, time, dt, gale);
    (wu.uSkyTop!.value as THREE.Color).copy(sky.top);
    (wu.uSkyHorizon!.value as THREE.Color).copy(sky.horizon);
    (wu.uFogColor!.value as THREE.Color).copy(sky.fog);
    (wu.uMoonColor!.value as THREE.Color).copy(sky.moon);
    (wu.uSunColor!.value as THREE.Color).copy(sky.sun);
    const k = this.particleScale;
    // More weather means more particles, not just brighter ones.
    this.rain.material.uniforms.uRain!.value = w.rain;
    this.rain.visible = w.rain > 0.01;
    this.rain.geometry.setDrawRange(0, Math.floor(RAIN_DROPS * k * (0.25 + 0.75 * w.rain)) * 2);
    this.snow.material.uniforms.uAmount!.value = Math.min(1, w.snow * 1.2);
    this.snow.material.uniforms.uPixelRatio!.value = pixelRatio;
    this.snow.visible = w.snow > 0.01;
    this.snow.geometry.setDrawRange(0, Math.floor(SNOW_FLAKES * k * (0.3 + 0.7 * w.snow)));
    this.fireflies.material.uniforms.uAmount!.value = w.fireflies * (1 - gale);
    this.fireflies.material.uniforms.uPixelRatio!.value = pixelRatio;
    this.fireflies.visible = w.fireflies * (1 - gale) > 0.01;
    const su = this.spray.material.uniforms;
    su.uAmount!.value = gale;
    su.uPixelRatio!.value = pixelRatio;
    (su.uTint!.value as THREE.Color).copy(sky.horizon).multiplyScalar(2.2).addScalar(0.035 + 0.5 * flash);
    this.spray.visible = gale > 0.02;
    this.spray.geometry.setDrawRange(0, Math.floor(SPRAY_COUNT * k * gale));
  }

  private mist: THREE.Sprite[] = [];
  private grass: THREE.InstancedMesh | null = null;

  setGrass(on: boolean): void {
    if (this.grass) this.grass.visible = on;
  }

  /** Soft banks of mist drifting over the water; they thicken with `mist`, a gale stretches and tears them. */
  private updateMist(w: Weather, time: number, dt: number, gale: number): void {
    if (this.mist.length === 0) {
      const tex = mistTexture();
      this.disposables.push(tex);
      const rand = rng(77);
      for (let i = 0; i < 26; i++) {
        const mat = new THREE.SpriteMaterial({ map: tex, color: 0x8090a8, transparent: true, depthWrite: false, opacity: 0 });
        const s = new THREE.Sprite(mat);
        const a = rand() * Math.PI * 2;
        const r = 30 + rand() * 25;
        s.position.set(Math.cos(a) * r * 1.2, WATER_Y + 0.8 + rand() * 1.5, Math.sin(a) * r * 0.8);
        s.scale.set(18 + rand() * 14, 5 + rand() * 3, 1);
        s.userData.phase = rand() * 10;
        s.userData.sx = s.scale.x;
        s.userData.sy = s.scale.y;
        this.mist.push(s);
        this.group.add(s);
        this.disposables.push(mat);
      }
    }
    for (const s of this.mist) {
      const ph = s.userData.phase as number;
      s.position.x += dt * (Math.sin(time * 0.05 + ph) * 0.6 + w.wind * 1.2 + gale * 14);
      if (s.position.x > 80) s.position.x = -80;
      s.scale.set((s.userData.sx as number) * (1 + w.wind * 0.6 + gale * 0.8), (s.userData.sy as number) * (1 - 0.45 * gale), 1);
      const opacity = w.mist * 0.05 * (0.6 + 0.4 * Math.sin(time * 0.1 + ph)) * (1 - 0.5 * gale);
      (s.material as THREE.SpriteMaterial).opacity = opacity;
      // No mist, no draw: 26 large transparent sprites otherwise blend in nothing.
      s.visible = opacity > 0;
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}

function mistTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
