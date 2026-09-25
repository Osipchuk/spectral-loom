import { DEFAULT_SETTINGS, DEFAULT_TABLE, PARAMS } from '../defaults';
import type { ElementKind, ElementOf, SceneModel } from '../types';

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Deterministic element builder for hand-authored demo scenes. */
function el<K extends ElementKind>(
  kind: K,
  id: string,
  x: number,
  y: number,
  rotDeg: number,
  params: Partial<ElementOf<K>> = {},
): ElementOf<K> {
  return {
    ...(structuredClone(PARAMS[kind]) as object),
    id,
    kind,
    pos: { x, y },
    rotation: rad(rotDeg),
    enabled: true,
    ...params,
  } as ElementOf<K>;
}

export interface DemoScene {
  id: string;
  title: string;
  blurb: string;
  scene: SceneModel;
}

function scene(name: string, elements: SceneModel['elements'], settings: Partial<SceneModel['settings']> = {}): SceneModel {
  return { version: 1, name, table: { ...DEFAULT_TABLE }, settings: { ...DEFAULT_SETTINGS, ...settings }, elements };
}

export const DEMO_SCENES: DemoScene[] = [
  {
    id: 'bench',
    title: 'Optics bench',
    blurb: 'A prism fans white light into a rainbow; a lens folds it back to white. The lower prism turns light around by total internal reflection.',
    scene: scene('Optics bench', [
      el('emitter', 'e1', 3, 20, 0),
      el('prism', 'p1', 10, 20, 70, { size: 4 }),
      el('lens', 'l1', 26.4, 8.1, -40, { aperture: 5, focal: 6 }),
      el('emitter', 'e2', 20, 25, 0, { spectrum: { kind: 'band', minNm: 560, maxNm: 640 } }),
      el('prism', 'p2', 30, 25, 120, { size: 3.5 }),
      el('mirror', 'm1', 40, 12, 135, { length: 3 }),
    ]),
  },
];
