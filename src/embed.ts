import { App } from './app';
import { DEMO_SCENES } from './scene/demos';
import { parseScene } from './scene/serialize';
import type { SceneModel } from './scene/types';
import './ui/styles.css';

export interface MountOptions {
  /** Scene to start with; defaults to the first demo. */
  scene?: SceneModel | string;
}

export interface SpectralLoomHandle {
  loadScene(scene: SceneModel | string): void;
  destroy(): void;
}

/**
 * Public entry point. Renders the instrument inside `container` (which should have a
 * size; the demo fills it) and returns a handle whose destroy() releases WebGL and audio.
 */
export function mount(container: HTMLElement, opts: MountOptions = {}): SpectralLoomHandle {
  const initial = opts.scene ? parseScene(opts.scene) : parseScene(DEMO_SCENES[0]!.scene);
  const app = new App(container, { scene: initial });
  return {
    loadScene: (scene) => app.loadScene(parseScene(scene)),
    destroy: () => app.destroy(),
  };
}
