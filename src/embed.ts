import { App } from './app';
import { DEMO_SCENES } from './scene/demos';
import { parseScene } from './scene/serialize';
import type { SceneModel } from './scene/types';
import './ui/styles.css';

export interface MountOptions {
  /** Demo to open (see DEMO_SCENES ids), or a full scene. Defaults to the welcome screen. */
  demo?: string;
  scene?: SceneModel | string;
}

export interface SpectralLoomHandle {
  loadScene(scene: SceneModel | string): void;
  loadDemo(id: string): void;
  destroy(): void;
}

/**
 * Public entry point. Renders the instrument inside `container` (which should have a
 * size; the demo fills it) and returns a handle whose destroy() releases WebGL and audio.
 */
export function mount(container: HTMLElement, opts: MountOptions = {}): SpectralLoomHandle {
  const demo = DEMO_SCENES.find((d) => d.id === opts.demo);
  // No scene and no demo: open on an empty table with the welcome screen and tutorial.
  const app = opts.scene
    ? new App(container, { scene: parseScene(opts.scene), demoId: null })
    : demo
      ? new App(container, { scene: parseScene(demo.scene), demoId: demo.id })
      : new App(container, {});

  if (new URLSearchParams(location.search).has('debug')) {
    // Test hook for headless checks: render a demo offline and return WAV bytes as base64.
    (window as unknown as Record<string, unknown>).__spectralLoom = {
      app,
      async renderDemoWav(id: string): Promise<string> {
        app.loadDemo(id);
        const blob = await app.renderLoopWav();
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(bin);
      },
    };
  }

  return {
    loadScene: (s) => app.loadScene(parseScene(s)),
    loadDemo: (id) => app.loadDemo(id),
    destroy: () => app.destroy(),
  };
}
