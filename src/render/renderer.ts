import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { RayTree } from '../optics/types';
import type { SceneModel } from '../scene/types';
import type { VisualLayout } from '../timing/visual';
import { Atmosphere } from './atmosphere';
import { BeamLayer } from './beams/beam-layer';
import { ElementViews } from './elements/element-views';
import { Materials } from './elements/materials';
import { TableFrame } from './frame';
import { Gizmo } from './gizmo';
import { Glows } from './glows';
import { Table } from './table';

const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uResolution;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      // Faint lateral chromatic aberration towards the corners, like a real lens.
      float ca = 0.004 * r2;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv - c * ca).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv + c * ca).b;
      col *= mix(1.0, 0.42, smoothstep(0.08, 0.55, r2 * 1.5));
      // Static-per-frame film grain hides banding in the dark gradients.
      float n = hash(vUv * uResolution + fract(uTime) * 97.0) - 0.5;
      col += n * 0.012;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export interface CameraAngles {
  azimuth: number;
  polar: number;
}

export const CAMERA_LIMITS = { azimuth: 0.42, polarMin: 0.42, polarMax: 0.86 };

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.5, 600);
  readonly frame: TableFrame;
  readonly beams: BeamLayer;
  readonly glows: Glows;
  readonly views: ElementViews;
  readonly gizmo: Gizmo;
  readonly atmosphere: Atmosphere;
  readonly angles: CameraAngles = { azimuth: 0, polar: 0.66 };
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private finish: ShaderPass;
  private materials = new Materials();
  private table: Table;
  private envTarget: THREE.WebGLRenderTarget;
  private size = new THREE.Vector2(1, 1);
  /** Screen space (CSS px) covered by UI panels; the table is framed in what remains. */
  private insets = { left: 0, right: 0, top: 0, bottom: 0 };
  private basePixelRatio = Math.min(window.devicePixelRatio, 2);
  private pixelRatio = this.basePixelRatio;

  constructor(
    readonly canvas: HTMLCanvasElement,
    scene: SceneModel,
  ) {
    this.frame = new TableFrame(scene.table.w, scene.table.h);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.envTarget = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.6;
    this.scene.background = null;

    this.scene.add(new THREE.HemisphereLight(0x8a96b8, 0x0a0a0c, 0.6));
    const key = new THREE.DirectionalLight(0xfff1e0, 1.5);
    key.position.set(-18, 30, -10);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera;
    sc.left = -scene.table.w / 2 - 2;
    sc.right = scene.table.w / 2 + 2;
    sc.top = scene.table.h / 2 + 2;
    sc.bottom = -scene.table.h / 2 - 2;
    sc.near = 1;
    sc.far = 90;
    key.shadow.radius = 6;
    key.shadow.bias = -0.0005;
    this.scene.add(key);

    this.table = new Table(scene.table.w, scene.table.h);
    this.views = new ElementViews(this.frame, this.materials);
    this.beams = new BeamLayer(this.frame);
    this.glows = new Glows(this.frame);
    this.gizmo = new Gizmo(this.frame);
    this.atmosphere = new Atmosphere(this.frame);
    this.scene.add(this.atmosphere.group, this.table.group, this.views.group, this.beams.group, this.glows.group, this.gizmo.group);

    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.45, 0.75);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.finish = new ShaderPass(FinishShader);
    this.composer.addPass(this.finish);
    this.updateCamera();
  }

  setInsets(insets: { left: number; right: number; top: number; bottom: number }): void {
    this.insets = insets;
    this.updateCamera();
  }

  /**
   * Adaptive resolution: step the pixel ratio down when frames are slow, back up when
   * there is headroom. Called by the app with a smoothed frame time.
   */
  adaptResolution(frameMs: number): void {
    if (new URLSearchParams(location.search).has('fixedres')) return;
    let next = this.pixelRatio;
    // Never render below the display's CSS resolution: a soft image is worse than 45 fps.
    const floor = Math.min(1, this.basePixelRatio);
    if (frameMs > 24 && this.pixelRatio > floor) next = Math.max(floor, this.pixelRatio - 0.25);
    else if (frameMs < 13 && this.pixelRatio < this.basePixelRatio) next = Math.min(this.basePixelRatio, this.pixelRatio + 0.25);
    if (next === this.pixelRatio) return;
    this.pixelRatio = next;
    this.renderer.setPixelRatio(next);
    this.composer.setPixelRatio(next);
    const { x, y } = this.size;
    this.size.set(0, 0);
    this.resize(x, y);
  }

  resize(width: number, height: number): void {
    if (width === this.size.x && height === this.size.y) return;
    this.size.set(width, height);
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.bloom.resolution.set(width, height);
    const pr = this.renderer.getPixelRatio();
    (this.finish.uniforms.uResolution!.value as THREE.Vector2).set(width * pr, height * pr);
    this.camera.aspect = width / height;
    this.updateCamera();
  }

  /** Frames the table for the current aspect ratio and orbit angles. */
  updateCamera(): void {
    const { w, h } = this.frame;
    const { azimuth, polar } = this.angles;
    const { left, right, top, bottom } = this.insets;
    const W = this.size.x;
    const H = this.size.y;
    const availW = Math.max(W * 0.4, W - left - right);
    const availH = Math.max(H * 0.5, H - top - bottom);
    // Shift the principal point so the table centres in the free area between panels.
    this.camera.setViewOffset(W, H, -(left - right) / 2, -(top - bottom) / 2, W, H);
    const vfovFull = THREE.MathUtils.degToRad(this.camera.fov);
    const vfov = 2 * Math.atan(Math.tan(vfovFull / 2) * (availH / H));
    const hfov = 2 * Math.atan(Math.tan(vfovFull / 2) * (availW / H));
    const margin = 1.6;
    const dW = (w / 2 + margin) / Math.tan(hfov / 2);
    const dH = ((h * Math.cos(polar)) / 2 + margin + 0.6) / Math.tan(vfov / 2);
    const d = Math.max(dW, dH) * 1.04;
    const target = new THREE.Vector3(0, 0, 0.6);
    this.camera.position.set(
      target.x + d * Math.sin(polar) * Math.sin(azimuth),
      target.y + d * Math.cos(polar),
      target.z + d * Math.sin(polar) * Math.cos(azimuth),
    );
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
  }

  syncScene(scene: SceneModel): void {
    this.views.sync(scene.elements);
  }

  setTree(tree: RayTree, now: number, crossfade: boolean, visual?: VisualLayout): void {
    this.beams.setTree(tree, now, crossfade, { visual });
    this.glows.setTree(tree);
    this.atmosphere.setTree(tree);
  }

  /** Musical energy 0…1 for the room to breathe with. */
  energy = 0;

  render(time: number, now: number): void {
    this.beams.update(time, now);
    this.atmosphere.update(time, this.pixelRatio, this.energy, this.size.x / Math.max(1, this.size.y), new THREE.Vector2(this.angles.azimuth, this.angles.polar - 0.66));
    this.finish.uniforms.uTime!.value = time;
    this.composer.render();
  }

  dispose(): void {
    this.beams.dispose();
    this.atmosphere.dispose();
    this.glows.dispose();
    this.views.dispose();
    this.gizmo.dispose();
    this.table.dispose();
    this.materials.dispose();
    this.envTarget.dispose();
    this.composer.dispose();
    this.bloom.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
