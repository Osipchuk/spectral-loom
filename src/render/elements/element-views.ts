import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { EMITTER_HALF, MODULATOR_RADIUS, prismVertices } from '../../optics/geometry';
import type { SceneElement } from '../../scene/types';
import { BEAM_HEIGHT, yawFor, type TableFrame } from '../frame';
import { bandToRGB, type RGB } from '../spectral-color';
import { CARD_BOTTOM, CARD_HEIGHT, createCardSurface, type CardSurface } from './loom-card';
import type { Materials } from './materials';

export const INSTRUMENT_COLORS: Record<string, RGB> = {
  pad: [0.55, 0.42, 1.0],
  pluck: [1.0, 0.62, 0.28],
  bell: [0.35, 0.9, 1.0],
  drums: [1.0, 0.38, 0.42],
};

/**
 * Local frame of every view: +x is the element's facing direction, +z runs along a
 * line-like element, +y is up. The group's yaw maps it onto the table.
 */
export interface ElementView {
  id: string;
  group: THREE.Group;
  /** Invisible proxy used for picking; carries userData.elementId. */
  pick: THREE.Mesh;
  /** Radius of the selection ring. */
  radius: number;
  paramsKey: string;
  /** Per-view dynamic materials (glows that react to music), owned by the view. */
  dynamic: {
    slit?: THREE.MeshBasicMaterial;
    dots?: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[];
    aperture?: THREE.MeshBasicMaterial;
    card?: CardSurface;
  };
  dispose(): void;
}

function paramsKey(el: SceneElement): string {
  const { pos: _p, rotation: _r, id: _i, ...rest } = el;
  return JSON.stringify(rest);
}

function shapeGeometry(points: { x: number; y: number }[], height: number, bevel = 0.03): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p.x, p.y)));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 24,
  });
  // Shape XY → table plane (x, z); extrusion along −y, then lift onto the tabletop.
  geo.rotateX(Math.PI / 2);
  geo.translate(0, height - bevel, 0);
  return geo;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, cast = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

function post(mats: Materials, x: number, z: number, h: number): THREE.Mesh {
  const m = mesh(new THREE.CylinderGeometry(0.045, 0.06, h, 12), mats.anodized);
  m.position.set(x, h / 2, z);
  return m;
}

function foot(mats: Materials, x: number, z: number): THREE.Mesh {
  const m = mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.06, 20), mats.anodized);
  m.position.set(x, 0.03, z);
  return m;
}

function lensProfile(aperture: number, focal: number): { x: number; y: number }[] {
  const half = aperture / 2;
  const steps = 28;
  const converging = focal > 0;
  const power = Math.min(1, 3.5 / Math.max(1.2, Math.abs(focal)));
  const center = converging ? 0.12 + 0.55 * power : 0.07;
  const edge = converging ? 0.05 : 0.07 + 0.45 * power;
  const right: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const y = -half + (aperture * i) / steps;
    const k = (y / half) ** 2;
    right.push({ x: (center + (edge - center) * k) / 2, y });
  }
  const left = right.map((p) => ({ x: -p.x, y: p.y })).reverse();
  return [...right, ...left];
}

export function createElementView(el: SceneElement, mats: Materials): ElementView {
  const group = new THREE.Group();
  const dynamic: ElementView['dynamic'] = {};
  const owned: THREE.Material[] = [];
  let pickSize: [number, number] = [1, 1];
  let radius = 1;
  const disabled = !el.enabled;
  const m = (mat: THREE.Material): THREE.Material => (disabled ? mats.ghost : mat);

  switch (el.kind) {
    case 'prism': {
      const pts = prismVertices({ x: 0, y: 0 }, 0, el.size);
      const body = mesh(shapeGeometry(pts, 1.15, 0.04), m(mats.glass));
      body.renderOrder = 0;
      group.add(body);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(body.geometry, 25),
        new THREE.LineBasicMaterial({ color: 0x9fb8ff, transparent: true, opacity: disabled ? 0.06 : 0.14, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      owned.push(edges.material);
      group.add(edges);
      pickSize = [el.size * 0.9, el.size * 0.9];
      radius = el.size / Math.sqrt(3) + 0.5;
      break;
    }

    case 'mirror': {
      const slab = mesh(new RoundedBoxGeometry(0.09, 1.0, el.length, 2, 0.03), m(el.splitter ? mats.splitter : mats.chrome));
      slab.position.y = 0.58;
      group.add(slab);
      const rail = mesh(new RoundedBoxGeometry(0.16, 0.07, el.length + 0.1, 2, 0.02), m(mats.anodized));
      rail.position.y = 0.06;
      group.add(rail, foot(mats, 0, -el.length / 2 + 0.2), foot(mats, 0, el.length / 2 - 0.2));
      pickSize = [0.7, el.length];
      radius = el.length / 2 + 0.5;
      break;
    }

    case 'lens': {
      const body = mesh(shapeGeometry(lensProfile(el.aperture, el.focal), 1.05, 0.02), m(mats.glass));
      group.add(body);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(body.geometry, 40),
        new THREE.LineBasicMaterial({ color: 0xa8c4ff, transparent: true, opacity: disabled ? 0.05 : 0.12, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      owned.push(edges.material);
      group.add(edges);
      const holder = mesh(new RoundedBoxGeometry(0.3, 0.1, el.aperture + 0.3, 2, 0.03), m(mats.anodized));
      holder.position.y = 0.05;
      group.add(holder);
      pickSize = [0.9, el.aperture];
      radius = el.aperture / 2 + 0.5;
      break;
    }

    case 'filter': {
      const rgb = bandToRGB(el.minNm, el.maxNm);
      const pane = mesh(new RoundedBoxGeometry(0.07, 0.9, el.length, 2, 0.02), m(mats.filterGlass(rgb)));
      pane.position.y = 0.52;
      group.add(pane);
      const rail = mesh(new RoundedBoxGeometry(0.16, 0.08, el.length + 0.1, 2, 0.02), m(mats.brass));
      rail.position.y = 0.04;
      group.add(rail);
      pickSize = [0.7, el.length];
      radius = el.length / 2 + 0.5;
      break;
    }

    case 'chord': {
      // Stained glass: panes of spectral colour between lead lines.
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 64;
      const g = c.getContext('2d')!;
      const panes = 7;
      for (let i = 0; i < panes; i++) {
        const [r, gg, b] = bandToRGB(700 - (300 * (i + 1)) / panes, 700 - (300 * i) / panes);
        const max = Math.max(r, gg, b, 1e-3);
        g.fillStyle = `rgb(${Math.round((r / max) * 200)},${Math.round((gg / max) * 200)},${Math.round((b / max) * 200)})`;
        g.fillRect((i * c.width) / panes, 0, c.width / panes, c.height);
      }
      g.fillStyle = '#1a1510';
      for (let i = 0; i <= panes; i++) g.fillRect((i * c.width) / panes - 2, 0, 4, c.height);
      g.fillRect(0, 0, c.width, 4);
      g.fillRect(0, c.height - 4, c.width, 4);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const glassMat = new THREE.MeshPhysicalMaterial({
        map: tex,
        transparent: true,
        opacity: 0.8,
        roughness: 0.2,
        metalness: 0,
        emissive: new THREE.Color(0xffffff),
        emissiveMap: tex,
        emissiveIntensity: disabled ? 0 : 0.18,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      owned.push(glassMat);
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(el.length, 0.85), disabled ? mats.ghost : glassMat);
      pane.rotation.y = Math.PI / 2;
      pane.position.y = 0.52;
      group.add(pane);
      const frame = mesh(new RoundedBoxGeometry(0.12, 0.07, el.length + 0.2, 2, 0.02), m(mats.brass));
      frame.position.y = 0.06;
      const top = frame.clone();
      top.position.y = 0.98;
      group.add(frame, top);
      for (const z of [-(el.length / 2 + 0.08), el.length / 2 + 0.08]) {
        const side = mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.95, 10), m(mats.brass));
        side.position.set(0, 0.52, z);
        group.add(side);
      }
      pickSize = [0.7, el.length];
      radius = el.length / 2 + 0.5;
      group.userData.texture = tex;
      break;
    }

    case 'comb': {
      const pane = mesh(new RoundedBoxGeometry(0.06, 0.95, el.length, 2, 0.02), m(mats.comb));
      pane.position.y = 0.55;
      group.add(pane);
      // Fine rulings: a few dark lines across the glass.
      const rulings = new THREE.Group();
      const n = Math.max(4, el.fringes * 2);
      for (let i = 0; i < n; i++) {
        const line = mesh(new THREE.BoxGeometry(0.075, 0.9, 0.012), m(mats.anodized), false);
        line.position.set(0, 0.55, -el.length / 2 + ((i + 0.5) * el.length) / n);
        rulings.add(line);
      }
      group.add(rulings);
      const frame = mesh(new RoundedBoxGeometry(0.16, 0.08, el.length + 0.2, 2, 0.02), m(mats.anodized));
      frame.position.y = 0.04;
      const top = frame.clone();
      top.position.y = 1.06;
      group.add(frame, top);
      pickSize = [0.7, el.length];
      radius = el.length / 2 + 0.5;
      break;
    }

    case 'blocker': {
      const block = mesh(new RoundedBoxGeometry(0.35, 0.95, el.length, 3, 0.06), m(mats.velvet));
      block.position.y = 0.475;
      group.add(block);
      pickSize = [0.8, el.length];
      radius = el.length / 2 + 0.5;
      break;
    }

    case 'emitter': {
      const { along, across } = EMITTER_HALF;
      const body = mesh(new RoundedBoxGeometry(along * 2, 0.78, across * 2, 4, 0.12), m(mats.anodized));
      body.position.set(-along, 0.42, 0);
      group.add(body);
      for (let i = 0; i < 4; i++) {
        const fin = mesh(new RoundedBoxGeometry(0.06, 0.82, across * 2 + 0.06, 1, 0.02), mats.anodized);
        fin.position.set(-along * 2 + 0.25 + i * 0.16, 0.42, 0);
        group.add(fin);
      }
      const bezel = mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.1, 32), mats.brass);
      bezel.rotation.z = Math.PI / 2;
      bezel.position.set(0.03, BEAM_HEIGHT, 0);
      group.add(bezel);
      const rgb: RGB = el.spectrum.kind === 'white' ? [1, 1, 1] : bandToRGB(el.spectrum.minNm, el.spectrum.maxNm);
      const aperture = new THREE.MeshBasicMaterial({ color: new THREE.Color(...rgb).multiplyScalar(disabled ? 0.05 : 3) });
      owned.push(aperture);
      dynamic.aperture = aperture;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.16, 32), aperture);
      disc.rotation.y = Math.PI / 2;
      disc.position.set(0.085, BEAM_HEIGHT, 0);
      group.add(disc);
      const led = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 12, 8),
        mats.glow(disabled ? [0.3, 0.05, 0.05] : [0.3, 1, 0.5], disabled ? 1 : 3),
      );
      led.position.set(-along * 2 + 0.2, 0.83, across - 0.18);
      group.add(led);
      pickSize = [along * 2, across * 2];
      group.userData.pickOffsetX = -along;
      radius = along * 2 + 0.3;
      break;
    }

    case 'receptor': {
      const depth = 0.55;
      const body = mesh(new RoundedBoxGeometry(depth, 0.8, el.aperture + 0.2, 3, 0.07), m(mats.anodized));
      body.position.set(-depth / 2 - 0.02, 0.4, 0);
      group.add(body);
      const rgb = INSTRUMENT_COLORS[el.instrument] ?? [1, 1, 1];
      const slit = new THREE.MeshBasicMaterial({ color: new THREE.Color(...rgb).multiplyScalar(disabled ? 0.03 : 0.35) });
      owned.push(slit);
      dynamic.slit = slit;
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(el.aperture, 0.16), slit);
      strip.rotation.y = Math.PI / 2;
      strip.position.set(0.001, BEAM_HEIGHT, 0);
      group.add(strip);
      const lip = mesh(new RoundedBoxGeometry(0.08, 0.06, el.aperture + 0.2, 1, 0.02), mats.brass);
      lip.position.set(0.0, BEAM_HEIGHT + 0.14, 0);
      const lip2 = lip.clone();
      lip2.position.y = BEAM_HEIGHT - 0.14;
      group.add(lip, lip2);
      pickSize = [0.8, el.aperture + 0.2];
      group.userData.pickOffsetX = -depth / 2;
      radius = el.aperture / 2 + 0.5;
      break;
    }

    case 'loom': {
      const surface = createCardSurface(el.length);
      dynamic.card = surface;
      const paper = new THREE.MeshStandardMaterial({
        map: surface.texture,
        alphaMap: surface.alpha,
        transparent: true,
        roughness: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      owned.push(paper);
      const card = new THREE.Mesh(new THREE.PlaneGeometry(el.length, CARD_HEIGHT), disabled ? mats.ghost : paper);
      card.rotation.y = Math.PI / 2;
      card.position.y = CARD_BOTTOM + CARD_HEIGHT / 2;
      group.add(card);
      const rail = mesh(new RoundedBoxGeometry(0.14, 0.07, el.length + 0.3, 2, 0.02), m(mats.brass));
      rail.position.y = CARD_BOTTOM - 0.02;
      const top = rail.clone();
      top.position.y = CARD_BOTTOM + CARD_HEIGHT + 0.03;
      group.add(rail, top);
      for (const z of [-(el.length / 2 + 0.12), el.length / 2 + 0.12]) {
        const roller = mesh(new THREE.CylinderGeometry(0.07, 0.07, CARD_HEIGHT + 0.16, 16), m(mats.anodized));
        roller.position.set(0, CARD_BOTTOM + CARD_HEIGHT / 2, z);
        group.add(roller);
      }
      pickSize = [0.7, el.length];
      radius = el.length / 2 + 0.5;
      break;
    }

    case 'modulator': {
      const ring = mesh(new THREE.TorusGeometry(MODULATOR_RADIUS, 0.05, 12, 64), m(mats.brass));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = BEAM_HEIGHT;
      group.add(ring);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
        group.add(post(mats, Math.cos(a) * MODULATOR_RADIUS, Math.sin(a) * MODULATOR_RADIUS, BEAM_HEIGHT));
      }
      dynamic.dots = [];
      for (let i = 0; i < el.steps; i++) {
        const a = (i / el.steps) * Math.PI * 2;
        const dotMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
        owned.push(dotMat);
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), dotMat);
        dot.position.set(Math.cos(a) * (MODULATOR_RADIUS + 0.2), BEAM_HEIGHT, -Math.sin(a) * (MODULATOR_RADIUS + 0.2));
        group.add(dot);
        dynamic.dots.push(dot);
      }
      pickSize = [MODULATOR_RADIUS * 2.4, MODULATOR_RADIUS * 2.4];
      radius = MODULATOR_RADIUS + 0.55;
      break;
    }
  }

  const pick = new THREE.Mesh(new THREE.BoxGeometry(pickSize[0], 1.2, pickSize[1]), mats.pick);
  pick.position.set((group.userData.pickOffsetX as number | undefined) ?? 0, 0.6, 0);
  pick.userData.elementId = el.id;
  group.add(pick);

  return {
    id: el.id,
    group,
    pick,
    radius,
    paramsKey: paramsKey(el),
    dynamic,
    dispose() {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose();
      });
      for (const mat of owned) mat.dispose();
      dynamic.card?.texture.dispose();
      (group.userData.texture as THREE.Texture | undefined)?.dispose();
      dynamic.card?.alpha.dispose();
    },
  };
}

/** Keeps views in sync with the scene: transforms every call, rebuilds only on param change. */
export class ElementViews {
  readonly group = new THREE.Group();
  private views = new Map<string, ElementView>();

  constructor(
    private frame: TableFrame,
    private mats: Materials,
  ) {}

  sync(elements: SceneElement[]): void {
    const seen = new Set<string>();
    for (const el of elements) {
      seen.add(el.id);
      let view = this.views.get(el.id);
      if (view && view.paramsKey !== paramsKey(el)) {
        this.group.remove(view.group);
        view.dispose();
        view = undefined;
      }
      if (!view) {
        view = createElementView(el, this.mats);
        this.views.set(el.id, view);
        this.group.add(view.group);
      }
      this.frame.toWorld(el.pos, 0, view.group.position);
      view.group.rotation.y = yawFor(el.rotation);
    }
    for (const [id, view] of this.views) {
      if (seen.has(id)) continue;
      this.group.remove(view.group);
      view.dispose();
      this.views.delete(id);
    }
  }

  get(id: string): ElementView | undefined {
    return this.views.get(id);
  }

  all(): IterableIterator<ElementView> {
    return this.views.values();
  }

  pickTargets(): THREE.Object3D[] {
    return [...this.views.values()].map((v) => v.pick);
  }

  dispose(): void {
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
  }
}
