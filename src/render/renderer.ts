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
import { Diorama } from './diorama';
import { BeamLayer } from './beams/beam-layer';
import { createElementView, ElementViews } from './elements/element-views';
import { Materials } from './elements/materials';
import { TableFrame, yawFor } from './frame';
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
      float ca = 0.0015 * r2;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv - c * ca).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv + c * ca).b;
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(luma), col, 1.12);
      col *= mix(1.0, 0.6, smoothstep(0.12, 0.6, r2 * 1.5));
      // Static-per-frame film grain hides banding in the dark gradients.
      float n = hash(vUv * uResolution + fract(uTime) * 97.0) - 0.5;
      col += n * 0.006;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export interface CameraAngles {
  azimuth: number;
  polar: number;
  /** 1 frames the whole table; larger is closer. */
  zoom: number;
  /** Point on the table the camera looks at (world x/z offset from the table centre). */
  panX: number;
  panZ: number;
}

export const ZOOM_LIMITS = { min: 0.85, max: 3.2 };

export type Quality = 'eco' | 'balanced' | 'high';

/**
 * What each quality level costs. High is the default. Balanced keeps the look (real glass,
 * full anti-aliasing) at a slightly lower resolution on high-DPI screens. Eco drops the
 * extra full-scene pass that real glass transmission needs and draws at 30 fps.
 */
export const QUALITY: Record<Quality, { maxPixelRatio: number; samples: number; shadows: number; transmission: boolean; motes: number; grass: boolean; fps: number }> = {
  eco: { maxPixelRatio: 1, samples: 2, shadows: 0, transmission: false, motes: 700, grass: true, fps: 30 },
  balanced: { maxPixelRatio: 1.5, samples: 4, shadows: 1024, transmission: true, motes: 1500, grass: true, fps: 60 },
  high: { maxPixelRatio: 2, samples: 4, shadows: 2048, transmission: true, motes: 2200, grass: true, fps: 60 },
};

export const CAMERA_LIMITS = { azimuth: 0.42, polarMin: 0.42, polarMax: 0.86 };

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.5, 1000);
  readonly frame: TableFrame;
  readonly beams: BeamLayer;
  readonly glows: Glows;
  readonly views: ElementViews;
  readonly gizmo: Gizmo;
  readonly atmosphere: Atmosphere;
  readonly diorama: Diorama;
  private key: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private sky = { top: new THREE.Color(), horizon: new THREE.Color(), fog: new THREE.Color(), moon: new THREE.Color() };
  readonly angles: CameraAngles = { azimuth: 0, polar: 0.66, zoom: 1, panX: 0, panZ: 0 };
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private finish: ShaderPass;
  private materials = new Materials();
  private table: Table;
  private envTarget: THREE.WebGLRenderTarget;
  private size = new THREE.Vector2(1, 1);
  /** Screen space (CSS px) covered by UI panels; the table is framed in what remains. */
  private insets = { left: 0, right: 0, top: 0, bottom: 0 };
  private basePixelRatio = Math.min(window.devicePixelRatio, 1);
  quality: Quality = 'high';
  private pixelRatio = this.basePixelRatio;

  constructor(
    readonly canvas: HTMLCanvasElement,
    scene: SceneModel,
    quality: Quality = 'high',
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

    this.hemi = new THREE.HemisphereLight(0x8a96b8, 0x0a0a0c, 0.6);
    this.scene.add(this.hemi);
    const key = new THREE.DirectionalLight(0xfff1e0, 1.5);
    this.key = key;
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
    this.diorama = new Diorama(scene.table.w, scene.table.h);
    this.scene.fog = new THREE.Fog(0x05070d, 70, 330);
    this.scene.add(this.atmosphere.group, this.diorama.group, this.table.group, this.views.group, this.beams.group, this.glows.group, this.gizmo.group);

    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.38, 0.3, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.finish = new ShaderPass(FinishShader);
    this.composer.addPass(this.finish);
    this.setQuality(quality);
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
    const floor = Math.min(0.75, this.basePixelRatio);
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

  /** Switch the quality level at runtime (resolution, AA, shadows, glass, particles). */
  setQuality(q: Quality): void {
    this.quality = q;
    const cfg = QUALITY[q];
    this.basePixelRatio = Math.min(window.devicePixelRatio, cfg.maxPixelRatio);
    this.pixelRatio = this.basePixelRatio;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.composer.setPixelRatio(this.pixelRatio);
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      rt.samples = cfg.samples;
      rt.dispose();
    }
    this.renderer.shadowMap.enabled = cfg.shadows > 0;
    this.key.castShadow = cfg.shadows > 0;
    if (cfg.shadows > 0) {
      this.key.shadow.mapSize.set(cfg.shadows, cfg.shadows);
      this.key.shadow.map?.dispose();
      this.key.shadow.map = null;
    }
    this.materials.setTransmission(cfg.transmission);
    this.atmosphere.setMoteCount(cfg.motes);
    this.diorama.setGrass(cfg.grass);
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
    const d = (Math.max(dW, dH) * 1.04) / this.angles.zoom;
    this.clampPan();
    const target = new THREE.Vector3(this.angles.panX, 0, 0.6 + this.angles.panZ);
    this.camera.position.set(
      target.x + d * Math.sin(polar) * Math.sin(azimuth),
      target.y + d * Math.cos(polar),
      target.z + d * Math.sin(polar) * Math.cos(azimuth),
    );
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
  }

  /** Keep the view over the table when zoomed in; centred when fully zoomed out. */
  private clampPan(): void {
    const a = this.angles;
    const k = Math.max(0, 1 - 1 / a.zoom);
    const mx = (this.frame.w / 2) * k;
    const mz = (this.frame.h / 2) * k;
    a.panX = Math.min(mx, Math.max(-mx, a.panX));
    a.panZ = Math.min(mz, Math.max(-mz, a.panZ));
  }

  syncScene(scene: SceneModel): void {
    this.views.sync(scene.elements);
  }

  setTree(tree: RayTree, now: number, crossfade: boolean, visual?: VisualLayout): void {
    this.beams.setTree(tree, now, crossfade, { visual });
    this.glows.setTree(tree);
    this.atmosphere.setTree(tree);
  }

  private ghost: THREE.Group | null = null;
  /** Pick proxy of the tutorial ghost, if one is shown. */
  ghostPick: THREE.Object3D | null = null;
  private ghostDispose: (() => void) | null = null;

  /** A translucent "place it here" hint for the tutorial, or null to clear it. */
  setGhost(el: SceneModel['elements'][number] | null): void {
    if (this.ghost) {
      this.scene.remove(this.ghost);
      this.ghostDispose?.();
      this.ghost = null;
      this.ghostPick = null;
    }
    if (!el) return;
    const view = createElementView({ ...el, enabled: false }, this.materials);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(view.radius - 0.06, view.radius, 96),
      new THREE.MeshBasicMaterial({ color: 0x9fc4ff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.015;
    view.group.add(ring);
    // The ghost looks like an element, so people grab it: keep a (bigger) pick box on it.
    view.pick.userData = { ghost: true };
    view.pick.scale.multiplyScalar(1.4);
    this.ghostPick = view.pick;
    this.frame.toWorld(el.pos, 0, view.group.position);
    view.group.rotation.y = yawFor(el.rotation);
    this.ghost = view.group;
    this.ghost.userData.ring = ring;
    this.ghostDispose = () => {
      view.dispose();
      ring.geometry.dispose();
      ring.material.dispose();
    };
    this.scene.add(this.ghost);
  }

  private tmpV = new THREE.Vector3();

  /**
   * Light the miniature world from the weather: warm golden moonlight for bright music,
   * cold blue for dark, dimmer under cloud, tinted green-violet while the aurora is up.
   */
  private applyWeather(time: number): void {
    const w = this.atmosphere.current;
    const cold = new THREE.Color(0.55, 0.65, 1.0);
    const warm = new THREE.Color(1.0, 0.82, 0.58);
    this.key.color.copy(cold).lerp(warm, w.warmth);
    this.key.intensity = 1.6 * (1 - 0.55 * w.clouds) * (0.8 + 0.4 * w.warmth);
    this.hemi.color.setRGB(0.45 + 0.1 * w.warmth, 0.52 + 0.35 * w.aurora * 0.5, 0.75 - 0.2 * w.warmth);
    this.hemi.intensity = 0.45 + 0.35 * w.aurora + 0.1 * w.snow;
    this.sky.top.setRGB(0.004, 0.006, 0.02);
    this.sky.horizon.setRGB(0.03 + 0.03 * w.clouds + 0.02 * w.warmth, 0.045 + 0.03 * w.clouds + 0.05 * w.aurora, 0.09 + 0.02 * w.clouds);
    this.sky.fog.copy(this.sky.horizon).lerp(new THREE.Color(0.07, 0.08, 0.1), w.mist * 0.6);
    this.sky.moon.copy(this.key.color).multiplyScalar(1 - 0.7 * w.clouds);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(this.sky.fog);
    fog.near = 70 - 40 * w.mist - 20 * w.rain;
    fog.far = 330 - 150 * w.mist - 100 * w.rain;
    this.diorama.update(time, w, this.pixelRatio, this.sky);
    // Where the far water meets the sky on screen.
    this.tmpV.set(this.camera.position.x, -1.75, this.camera.position.z - 600).project(this.camera);
    this.atmosphere.setHorizon(this.tmpV.y * 0.5 + 0.5);
  }

  /** Musical energy 0…1 for the room to breathe with. */
  energy = 0;

  render(time: number, now: number): void {
    if (this.ghost) {
      const ring = this.ghost.userData.ring as THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
      const k = 0.5 + 0.5 * Math.sin(now * 3);
      ring.material.opacity = 0.25 + 0.5 * k;
      ring.scale.setScalar(1 + 0.06 * k);
    }
    this.beams.update(time, now);
    this.atmosphere.update(time, this.pixelRatio, this.energy, this.size.x / Math.max(1, this.size.y), new THREE.Vector2(this.angles.azimuth, this.angles.polar - 0.66));
    this.applyWeather(time);
    this.finish.uniforms.uTime!.value = time;
    this.composer.render();
  }

  dispose(): void {
    this.setGhost(null);
    this.diorama.dispose();
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
