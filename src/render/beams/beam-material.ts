import * as THREE from 'three';
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
uniform float uMode;
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
  vWorld = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uMode;
uniform float uGain;
uniform float uLevel;
varying float vT;
varying float vOffset;
varying vec4 vWidth;
varying vec3 vColor;
varying vec4 vParams;
varying vec4 vPulse;
varying vec3 vWorld;
${SIMPLEX_GLSL}
void main() {
  float len = vParams.y;
  float s = vT * len;
  float phys = abs(vWidth.x + vWidth.y * s);
  float fan = mix(vWidth.z, vWidth.w, vT);
  float w = max(${MIN_WIDTH.toFixed(3)}, max(phys, fan));
  float radiance = min(vParams.x * ${BASE_WIDTH.toFixed(3)} / w, 7.0);
  float level = uLevel;

  // Slow drifting density field: light scattering in slightly hazy air.
  float n1 = snoise(vWorld * 0.9 + vec3(0.0, uTime * 0.07, uTime * 0.05));
  float n2 = snoise(vWorld * 3.1 - vec3(uTime * 0.11, 0.0, uTime * 0.04));
  float haze = clamp(0.8 + 0.35 * n1 + 0.15 * n2, 0.25, 1.6);

  if (uMode < 0.5) {
    float x = vOffset / w;
    float core = exp(-x * x * 7.0);
    // Glow scales with the beam's own width so neighbouring fan rays keep their colour.
    float glow = exp(-x * x * 0.9);
    // Wide, faint scatter halo: what makes the beam read as light in hazy air.
    float halo = exp(-abs(vOffset) / (0.09 + w * 0.8));
    vec3 c = vColor * radiance * level * (core * 1.25 + glow * 0.16 * haze) + vColor * halo * 0.05 * haze * level * min(vParams.x * 6.0, 1.0);
    // Very bright cores desaturate towards white, like an overexposed laser line.
    c += vec3(core * max(radiance * level - 1.3, 0.0) * 0.25);
    gl_FragColor = vec4(c * uGain, 1.0);
  } else {
    float r = 0.35 + w * 1.5;
    float spill = exp(-vOffset * vOffset / (r * r));
    float energy = vParams.x * level * min(${BASE_WIDTH.toFixed(3)} / max(w, 0.22), 1.0);
    gl_FragColor = vec4(vColor * energy * spill * 0.075 * mix(0.7, 1.2, haze) * uGain, 1.0);
  }
}`;

export function createBeamMaterial(mode: 'beam' | 'spill'): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uMode: { value: mode === 'beam' ? 0 : 1 },
      uGain: { value: 1 },
      uLevel: { value: 0.75 },
    },
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });
}
