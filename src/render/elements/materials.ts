import * as THREE from 'three';

/** Shared materials for element meshes; created once per renderer and disposed with it. */
export class Materials {
  readonly glass = new THREE.MeshPhysicalMaterial({
    color: 0xeef4ff,
    metalness: 0,
    roughness: 0.06,
    transmission: 1,
    thickness: 1.2,
    ior: 1.52,
    dispersion: 2.5,
    attenuationColor: new THREE.Color(0xdfeaff),
    attenuationDistance: 6,
    specularIntensity: 1,
    clearcoat: 0.6,
    clearcoatRoughness: 0.05,
    envMapIntensity: 2.2,
    transparent: false,
    depthWrite: false,
  });

  readonly chrome = new THREE.MeshPhysicalMaterial({
    color: 0xe8edf3,
    metalness: 1,
    roughness: 0.06,
    envMapIntensity: 1.6,
  });

  readonly splitter = new THREE.MeshPhysicalMaterial({
    color: 0xe6ecf5,
    metalness: 0.55,
    roughness: 0.05,
    transmission: 0.55,
    thickness: 0.1,
    ior: 1.5,
    envMapIntensity: 1.4,
    depthWrite: false,
  });

  readonly anodized = new THREE.MeshPhysicalMaterial({
    color: 0x3a3e47,
    metalness: 0.8,
    roughness: 0.34,
    clearcoat: 0.3,
    clearcoatRoughness: 0.4,
    envMapIntensity: 0.8,
  });

  readonly brass = new THREE.MeshPhysicalMaterial({
    color: 0xb08a55,
    metalness: 1,
    roughness: 0.3,
    envMapIntensity: 0.9,
  });

  /** Grating glass: thin-film iridescence gives the rainbow sheen of a real grating. */
  readonly comb = new THREE.MeshPhysicalMaterial({
    color: 0xd8e2ff,
    metalness: 0.3,
    roughness: 0.12,
    transmission: 0.6,
    thickness: 0.05,
    ior: 1.5,
    iridescence: 1,
    iridescenceIOR: 1.45,
    iridescenceThicknessRange: [250, 900],
    envMapIntensity: 2.2,
    depthWrite: false,
  });

  readonly velvet = new THREE.MeshStandardMaterial({ color: 0x060608, roughness: 1, metalness: 0 });

  readonly ghost = new THREE.MeshBasicMaterial({
    color: 0x5a6070,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });

  readonly pick = new THREE.MeshBasicMaterial({ visible: false });

  private tinted = new Map<string, THREE.Material>();

  /** Coloured filter glass, cached per band. */
  filterGlass(rgb: [number, number, number]): THREE.MeshPhysicalMaterial {
    const key = rgb.map((c) => c.toFixed(2)).join(',');
    let m = this.tinted.get(key) as THREE.MeshPhysicalMaterial | undefined;
    if (!m) {
      const max = Math.max(...rgb, 1e-3);
      const c = new THREE.Color(rgb[0] / max, rgb[1] / max, rgb[2] / max);
      m = new THREE.MeshPhysicalMaterial({
        color: c,
        metalness: 0,
        roughness: 0.12,
        transmission: 0.85,
        thickness: 0.15,
        ior: 1.5,
        attenuationColor: c,
        attenuationDistance: 0.4,
        emissive: c,
        emissiveIntensity: 0.08,
        envMapIntensity: 1.2,
        depthWrite: false,
      });
      if (!this.transmission) {
        m.transmission = 0;
        m.transparent = true;
        m.opacity = 0.6;
      }
      this.tinted.set(key, m);
    }
    return m;
  }

  /** Emissive material for glowing parts; colour is linear and may exceed 1 (HDR). */
  glow(rgb: [number, number, number], strength: number): THREE.MeshBasicMaterial {
    const key = `glow:${rgb.map((c) => c.toFixed(2)).join(',')}:${strength.toFixed(2)}`;
    let m = this.tinted.get(key) as THREE.MeshBasicMaterial | undefined;
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: new THREE.Color(rgb[0] * strength, rgb[1] * strength, rgb[2] * strength) });
      this.tinted.set(key, m);
    }
    return m;
  }

  /**
   * Real transmission renders the scene an extra time. Without it, glass is drawn as a
   * clear, reflective, slightly transparent surface — close in look, far cheaper.
   */
  setTransmission(on: boolean): void {
    const glassy: [THREE.MeshPhysicalMaterial, number, number][] = [
      [this.glass, 1, 0.3],
      [this.splitter, 0.55, 0.55],
      [this.comb, 0.6, 0.5],
    ];
    for (const [m, transmission, opacity] of glassy) {
      m.transmission = on ? transmission : 0;
      m.transparent = !on;
      m.opacity = on ? 1 : opacity;
      m.needsUpdate = true;
    }
    for (const m of this.tinted.values()) {
      if (!(m instanceof THREE.MeshPhysicalMaterial)) continue;
      m.transmission = on ? 0.85 : 0;
      m.transparent = !on;
      m.opacity = on ? 1 : 0.6;
      m.needsUpdate = true;
    }
    this.transmission = on;
  }

  private transmission = true;

  dispose(): void {
    for (const m of [this.glass, this.chrome, this.splitter, this.comb, this.anodized, this.brass, this.velvet, this.ghost, this.pick]) m.dispose();
    for (const m of this.tinted.values()) m.dispose();
    this.tinted.clear();
  }
}
