import * as THREE from 'three';
import type { RayTree } from '../optics/types';
import { SIMPLEX_GLSL } from './beams/beam-material';
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
varying vec2 vUv;
${SIMPLEX_GLSL}
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  vec2 uv = (vUv - 0.5) * uAspect;
  float t = uTime;
  // Velvet room: a low indigo glow behind the table, fading to black at the edges.
  float r = length(uv - vec2(0.0, 0.08));
  vec3 col = mix(vec3(0.030, 0.030, 0.060), vec3(0.004, 0.004, 0.008), smoothstep(0.0, 0.95, r));
  // Two layers of slow smoke drifting at different depths (parallax with the camera).
  vec2 p1 = uv * 1.6 + uParallax * 0.15;
  vec2 p2 = uv * 3.2 + uParallax * 0.35;
  float s1 = snoise(vec3(p1, t * 0.018)) * 0.5 + 0.5;
  float s2 = snoise(vec3(p2 + 7.0, t * 0.027)) * 0.5 + 0.5;
  float smoke = pow(s1, 2.2) * 0.8 + pow(s2, 3.0) * 0.5;
  vec3 tintA = vec3(0.16, 0.07, 0.22);
  vec3 tintB = vec3(0.04, 0.12, 0.20);
  vec3 tintC = vec3(0.20, 0.10, 0.04);
  vec3 tint = mix(mix(tintA, tintB, s2), tintC, smoothstep(0.55, 0.9, s1) * 0.5);
  col += tint * smoke * (0.22 + 0.25 * uEnergy) * smoothstep(1.1, 0.2, r);
  // Out-of-focus lights far away: discs with a faint rim, drifting very slowly.
  for (int i = 0; i < 26; i++) {
    float fi = float(i);
    float depth = 0.3 + hash(fi * 3.1) * 0.7;
    vec2 c = vec2(hash(fi * 1.7) - 0.5, hash(fi * 2.3) - 0.5) * uAspect * 1.15;
    c += uParallax * depth * 0.25;
    c += vec2(sin(t * 0.03 + fi), cos(t * 0.025 + fi * 1.3)) * 0.01;
    float rad = mix(0.012, 0.055, hash(fi * 4.7)) * (1.3 - depth * 0.5);
    float d = length(uv - c);
    float disc = smoothstep(rad, rad * 0.45, d);
    float rim = smoothstep(rad * 0.5, rad * 0.9, d) * disc * 0.35;
    vec3 bc = mix(vec3(1.0, 0.62, 0.32), vec3(0.45, 0.62, 1.0), hash(fi * 5.9));
    bc = mix(bc, vec3(0.85, 0.45, 0.95), step(0.8, hash(fi * 6.3)));
    float tw = 0.75 + 0.25 * sin(t * (0.2 + hash(fi) * 0.4) + fi * 11.0);
    col += bc * (disc * 0.6 + rim) * 0.045 * tw * (0.6 + 0.8 * uEnergy);
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
  gl_FragColor = vec4((ambient + vLight * 4.0 * glint) * soft, 1.0);
}`;

/**
 * The room around the table: a dark gradient dome with slow haze, out-of-focus lights in
 * the distance, and dust motes floating above the table that catch the beams.
 */
export class Atmosphere {
  readonly group = new THREE.Group();
  private back: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private energy = 0;
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
    const u = this.back.material.uniforms;
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
