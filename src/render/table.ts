import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const PX_PER_CELL = 32;

/** Procedural felt-like surface with faint grid dots, drawn once into a canvas. */
function tableTextures(w: number, h: number): { map: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
  const cw = w * PX_PER_CELL;
  const ch = h * PX_PER_CELL;
  const make = (): [HTMLCanvasElement, CanvasRenderingContext2D] => {
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    return [c, c.getContext('2d')!];
  };

  const [colorCanvas, cx] = make();
  cx.fillStyle = '#16181d';
  cx.fillRect(0, 0, cw, ch);
  const img = cx.getImageData(0, 0, cw, ch);
  // Cheap value noise: fine grain plus a few large soft blotches.
  let seed = 1337;
  const rand = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * 7;
    img.data[i] = Math.max(0, img.data[i]! + n);
    img.data[i + 1] = Math.max(0, img.data[i + 1]! + n);
    img.data[i + 2] = Math.max(0, img.data[i + 2]! + n * 1.1);
  }
  cx.putImageData(img, 0, 0);
  for (let i = 0; i < 40; i++) {
    const x = rand() * cw;
    const y = rand() * ch;
    const r = (0.15 + rand() * 0.35) * Math.min(cw, ch);
    const g = cx.createRadialGradient(x, y, 0, x, y, r);
    const dark = rand() > 0.5;
    g.addColorStop(0, dark ? 'rgba(0,0,0,0.10)' : 'rgba(60,66,80,0.06)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    cx.fillStyle = g;
    cx.fillRect(0, 0, cw, ch);
  }
  // Grid dots at cell corners.
  cx.fillStyle = 'rgba(150,160,185,0.16)';
  for (let gx = 1; gx < w; gx++) {
    for (let gy = 1; gy < h; gy++) {
      cx.beginPath();
      cx.arc(gx * PX_PER_CELL, gy * PX_PER_CELL, gx % 4 === 0 && gy % 4 === 0 ? 1.6 : 0.9, 0, Math.PI * 2);
      cx.fill();
    }
  }

  const [roughCanvas, rx] = make();
  rx.fillStyle = '#d8d8d8';
  rx.fillRect(0, 0, cw, ch);
  const rimg = rx.getImageData(0, 0, cw, ch);
  for (let i = 0; i < rimg.data.length; i += 4) {
    const n = (rand() - 0.5) * 50;
    rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = Math.min(255, Math.max(0, 216 + n));
  }
  rx.putImageData(rimg, 0, 0);

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const rough = new THREE.CanvasTexture(roughCanvas);
  rough.anisotropy = 8;
  return { map, rough };
}

export class Table {
  readonly group = new THREE.Group();
  private disposables: { dispose(): void }[] = [];

  constructor(w: number, h: number) {
    const { map, rough } = tableTextures(w, h);
    const topMat = new THREE.MeshStandardMaterial({ map, roughnessMap: rough, roughness: 1, metalness: 0, envMapIntensity: 0.25 });
    const top = new THREE.Mesh(new THREE.PlaneGeometry(w, h), topMat);
    top.rotation.x = -Math.PI / 2;
    top.receiveShadow = true;
    this.group.add(top);

    const rimMat = new THREE.MeshPhysicalMaterial({
      color: 0x101114,
      metalness: 0.6,
      roughness: 0.45,
      clearcoat: 0.5,
      clearcoatRoughness: 0.3,
      envMapIntensity: 0.6,
    });
    const rimH = 0.7;
    const t = 0.6;
    const rims: [number, number, number, number][] = [
      [0, -h / 2 - t / 2, w + 2 * t, t],
      [0, h / 2 + t / 2, w + 2 * t, t],
      [-w / 2 - t / 2, 0, t, h],
      [w / 2 + t / 2, 0, t, h],
    ];
    for (const [x, z, sx, sz] of rims) {
      const rim = new THREE.Mesh(new RoundedBoxGeometry(sx, rimH, sz, 3, 0.1), rimMat);
      rim.position.set(x, rimH / 2 - 0.05, z);
      rim.receiveShadow = true;
      this.group.add(rim);
      this.disposables.push(rim.geometry);
    }

    this.disposables.push(map, rough, topMat, top.geometry, rimMat);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
