import * as THREE from 'three';
import { chordName, progression } from '../music/chords';
import type { ChordGlass, ScaleName } from '../scene/types';
import { h } from './dom';

/** Floating chip above each chord glass naming the chord it is letting through right now. */
export class ChordLabels {
  readonly el = h('div.sl-chords', { 'aria-live': 'off' });
  private chips = new Map<string, { node: HTMLElement; name: HTMLElement; roman: HTMLElement; notes: HTMLElement }>();
  private v = new THREE.Vector3();

  update(
    glasses: ChordGlass[],
    beat: number | null,
    settings: { scale: ScaleName; root: number },
    toWorld: (g: ChordGlass) => THREE.Vector3,
    /** Notes of the current chord whose light crosses the glass and reaches a receptor. */
    notesOf: (g: ChordGlass) => string[],
    camera: THREE.Camera,
    width: number,
    height: number,
  ): void {
    const seen = new Set<string>();
    for (const g of glasses) {
      if (!g.enabled) continue;
      seen.add(g.id);
      let chip = this.chips.get(g.id);
      if (!chip) {
        const name = h('span.sl-chord-name');
        const roman = h('span.sl-chord-roman');
        const notes = h('span.sl-chord-notes');
        const node = h('span.sl-chord', {}, name, roman, notes);
        this.el.append(node);
        chip = { node, name, roman, notes };
        this.chips.set(g.id, chip);
      }
      const roots = progression(g.progression);
      const bpc = Math.max(0.25, Number(g.beatsPerChord));
      const idx = beat === null ? 0 : Math.floor(beat / bpc) % roots.length;
      const c = chordName(roots[idx]!, settings.scale, settings.root);
      if (chip.name.textContent !== c.name) {
        chip.name.textContent = c.name;
        chip.roman.textContent = c.roman;
        chip.node.classList.remove('sl-chord-pop');
        void chip.node.offsetWidth;
        chip.node.classList.add('sl-chord-pop');
      }
      const notes = notesOf(g).join(' ');
      if (chip.notes.textContent !== notes) chip.notes.textContent = notes;
      this.v.copy(toWorld(g)).project(camera);
      const x = (this.v.x * 0.5 + 0.5) * width;
      const y = (-this.v.y * 0.5 + 0.5) * height;
      chip.node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    }
    for (const [id, chip] of this.chips) {
      if (seen.has(id)) continue;
      chip.node.remove();
      this.chips.delete(id);
    }
  }
}
