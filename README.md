# Spectral Loom

An optical music instrument for the browser. Place prisms, mirrors, lenses, filters,
modulators and punched loom cards on a dark table; a continuous beam of light travels
through them, and where it lands, it plays.

- **Light is always on.** Rhythm is a swell of brightness travelling along the beam at a
  slow scene speed of light, so distance is time: a prism fan arrives as a strum, a
  mirror corridor returns echoes.
- **Colour is pitch.** Wavelength maps to a scale degree; a wide receptor hears a chord.
- **One envelope for light and sound.** The ADSR that shapes a note also shapes the swell
  of the light carrying it, evaluated on the audio clock.

## What's on the table

- **Elements**: emitter, prism, mirror / beam splitter, lens, colour filter, Euclidean
  modulator, loom card (punched melody), receptor (pad, pluck, bell or **drums** — on a drum
  receptor colour picks the drum: red kick … violet open hat), blocker. Hover a palette item
  for what it does to light and to the music.
- **Loom card editor**: select a card to open a piano roll whose rows are exactly the
  pitches (or drums) its light reaches. Click to punch, drag to hold, presets, *Compose*.
- **Tutorial**: the default start is an empty table and a two-minute guided build.
- **Demos**: Afterglow (original, with drums), Gymnopédie No. 1, Ode to Joy, Canon in D,
  Prelude in C, Euclid kit, Prism strum, Echo corridor, Three against five.
- **The world reacts**: the table stands on a miniature island in a lake. Mood (scale,
  tempo, note density, instruments) drives the weather — aurora, rain, snow, mist, wind in
  the trees, fireflies — and the colour of the moonlight. `?weather=aurora|rain|snow|mist`
  pins it.

## Run

```bash
npm install
npm run dev          # http://127.0.0.1:5199 (?demo=afterglow|gymnopedie|ode|canon|prelude|euclid|strum|echo|poly|bench)
npm test             # optics, timing, pitch, demo-scene checks
npm run build        # → dist/ (relative paths, drop anywhere)
```

## Embed

The build is a self-contained static folder with relative asset paths. Two options:

**iframe** (full isolation, recommended for a blog):

```html
<iframe src="/demos/spectral-loom/index.html?demo=canon" loading="lazy"
        style="width:100%;aspect-ratio:16/9;border:0" allow="autoplay"
        title="Spectral Loom — an optical music instrument"></iframe>
```

**module** (same page): `mount(container, { demo: 'ode' })` from `src/embed.ts` returns
`{ loadDemo, loadScene, destroy }`. All styles are scoped under `.sl-root`; keyboard
shortcuts only listen while the demo has focus; the wheel is captured only over an element;
rendering pauses off-screen; `destroy()` releases WebGL and audio.

## Layout

```
src/optics   pure 2D ray tracing: Cauchy dispersion, Snell/TIR, Schlick Fresnel, thin lens
src/music    wavelength → scale degree → MIDI, score notation for loom cards
src/timing   Bjorklund, pulse sources, arrival + quantization, visual pulse layout (3 Hz rule)
src/audio    Tone.js instruments, look-ahead scheduler on the audio clock, WAV export
src/render   three.js: spectral beams shader, glass, table, atmosphere, bloom/ACES
src/ui       palette, inspector, transport, pointer/keyboard interaction
src/scene    serializable model, JSON save/load, demo scenes
```

Music in the demos: Beethoven's *Ode to Joy*, Pachelbel's *Canon in D* and Bach's
*Prelude in C, BWV 846* — all public domain, arranged as loom cards.
