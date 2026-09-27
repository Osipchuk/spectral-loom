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
- **Your tables are kept**: every demo you change, your own canvas and the tutorial table are
  saved in the browser as you go (Continue on the start screen). *New* starts an empty
  canvas, *Undo*/*Redo* (Ctrl+Z / Ctrl+Shift+Z) step through your edits, *Restore original*
  puts a changed demo back as written — and can be undone too.
- **Timeline**: the position bar next to Play rewinds or skips the whole song (every card
  and ring together); pause holds the position. In the card editor, *From the top* and the
  step slider move just that card against the others (its phase is saved with the scene).
- **Demos**: Afterglow (original, with drums), Gymnopédie No. 1, Ode to Joy, Canon in D,
  Prelude in C, Euclid kit, Prism strum, Dub corridor (dub techno: drums, pad chord glass, bass card and a corridor of mirrors for echoes), Three against five, Optics bench (a spinning lens flings two rainbows round a ring of coloured stations).
- **The world reacts**: the table stands on a miniature island in a lake. Mood (scale,
  tempo, note density, instruments) drives the weather — aurora, rain, snow, mist, wind in
  the trees, fireflies — and the colour of the moonlight. `?weather=aurora|rain|snow|mist`
  pins it.

## How the light plays

The card says **when**, the light says **what**. A loom card stores **slots**: holes at fixed
places along the card. A hole plays whatever colour crosses that place now, so turning a
prism slides the rainbow under the holes and the same card plays other notes; moving the
card toward the prism lets one slot catch two colours. On top of that:

- what a card lets through in one step sounds **together**, pulled to the grid **softly**
  (flat near grid lines, continuous everywhere) when the step's first light arrives: a chord
  punched on a card is struck, not strummed, however the slit is tilted, and no nudge throws
  it across the grid; light from a lamp or glass keeps its strum (red before violet);
- a lens delays light as a real one does (thicker in the middle), so a rainbow it gathers
  to a point arrives together;
- every note gets its own loudness and tone from the **irradiance** of its own light (a
  lens that gathers a colour makes that note louder and brighter), and its own place in
  the stereo field: a receptor's notes spread from low to high across it, the low side
  being where the red end of its slit points on screen. Every synth voice has its own
  filter and panner, so the notes of one chord sit apart;
- a slot's edges are soft: each ray stands for the strip of card up to its neighbours, so
  a colour slides from one slot into the next gradually, and an open slot plays the
  strongest colour falling through it (one note per hole, never a clash of seconds);
- a new card is written in notes and is cut the moment it is dropped into light, so it
  plays what it says there; after that the glass decides.

*Cut to light* in the card editor freezes what you hear: it re-cuts the slots around the
colours crossing the card now, one colour per slot, keeping the notes currently playing.

**Clockwork (moving optics).** Any element with a direction can *Swing* (rock ± degrees
over N bars) or *Turn* (degrees per bar) by itself — Motion in the right panel. Each pulse
plays the glass as it stood when it set off (sampled every sixteenth); the light on screen
follows continuously. A swinging prism sweeps the rainbow along a card, and the same holes
play a line that bends up and down on its own.

**Scores are written in notes.** The demos are authored with cards that hold pitches
(`DemoScene.authored`) and cut into slots on first use, one slot per pitch exactly where
that colour crosses the card (`layOutScore` in `src/scene/cards.ts`), with receptor
distances trimmed by a fraction of a cell so every voice starts on the grid. Scene files
with cards written in pitches (including files from the first engine) are cut the same way
when loaded. `tests/cards.test.ts` checks that every demo keeps its notes and starts on the
grid, and that turning an element never makes a note jump in time (under 4 ms).
`tests/motion.test.ts` covers the clockwork.

## Run

```bash
npm install
npm run dev          # http://127.0.0.1:5199 (?demo=afterglow|gymnopedie|ode|canon|prelude|euclid|strum|echo|poly|bench)
npm test             # optics, timing, pitch, demo-scene checks
npm run build        # → dist/ (relative paths, drop anywhere)
```

### Film

`src/capture/film.ts` scripts a half-minute social cut (captions on screen, camera close on
each idea); `timeline.ts` the first film. Both are deterministic, so they are recorded frame
by frame with the soundtrack rendered offline:

```bash
npx playwright install chromium   # once
npm run dev                       # in another terminal
npm run film -- --film light-plays --out docs/video/spectral-loom-social.mp4
```

Use a machine with a GPU (software rendering takes seconds per frame and a lot of memory);
`--headed` shows the browser, `--size 1080x1080` records a square cut. Needs ffmpeg.

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

---

If Spectral Loom made you smile: [☕ buy me a coffee](https://buymeacoffee.com/evgenyosipchuk).
