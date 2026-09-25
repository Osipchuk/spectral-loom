import * as THREE from 'three';
import type { SceneElement } from '../scene/types';
import { yawFor, type TableFrame } from './frame';

const ACCENT = new THREE.Color(0.55, 0.75, 1.0);

/** Selection ring with a rotation knob, plus a faint hover ring. Lies flat on the table. */
export class Gizmo {
  readonly group = new THREE.Group();
  readonly knob: THREE.Mesh;
  private ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private hover: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private arm: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private knobDot: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private selected = new THREE.Group();
  private radius = 1;

  constructor(private frame: TableFrame) {
    const mat = (opacity: number): THREE.MeshBasicMaterial =>
      new THREE.MeshBasicMaterial({
        color: ACCENT,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 96), mat(0.55));
    this.ring.rotation.x = -Math.PI / 2;
    this.arm = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.03), mat(0.35));
    this.arm.rotation.x = -Math.PI / 2;
    this.knobDot = new THREE.Mesh(new THREE.CircleGeometry(0.13, 32), mat(0.9));
    this.knobDot.rotation.x = -Math.PI / 2;
    this.knob = new THREE.Mesh(new THREE.CircleGeometry(0.4, 16), new THREE.MeshBasicMaterial({ visible: false }));
    this.knob.rotation.x = -Math.PI / 2;
    this.knob.userData.handle = 'rotate';
    this.selected.add(this.ring, this.arm, this.knobDot, this.knob);
    this.selected.position.y = 0.012;
    this.selected.visible = false;

    this.hover = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 96), mat(0.18));
    this.hover.rotation.x = -Math.PI / 2;
    this.hover.position.y = 0.011;
    this.hover.visible = false;
    this.group.add(this.selected, this.hover);
  }

  setSelected(el: SceneElement | null, radius: number): void {
    this.selected.visible = !!el;
    if (!el) return;
    if (radius !== this.radius) {
      this.radius = radius;
      this.ring.geometry.dispose();
      this.ring.geometry = new THREE.RingGeometry(radius - 0.035, radius, 96);
    }
    this.frame.toWorld(el.pos, 0.012, this.selected.position);
    this.selected.rotation.y = yawFor(el.rotation);
    const knobR = radius + 0.35;
    this.arm.scale.x = knobR - radius;
    this.arm.position.set(radius + (knobR - radius) / 2, 0, 0);
    this.knobDot.position.set(knobR, 0, 0);
    this.knob.position.set(knobR, 0.001, 0);
    this.selected.updateMatrixWorld(true);
  }

  setHover(el: SceneElement | null, radius: number): void {
    this.hover.visible = !!el;
    if (!el) return;
    this.frame.toWorld(el.pos, 0.011, this.hover.position);
    this.hover.scale.setScalar(radius);
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}
