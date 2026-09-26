import type { ElementKind } from '../scene/types';

/** What each element does to light, and what that does to the music. */
export const ELEMENT_INFO: Record<ElementKind, { light: string; music: string }> = {
  emitter: {
    light: 'A lamp that shines a continuous beam of white (or coloured) light.',
    music: 'Its pulse is the metronome: every beat sends a swell of brightness down the beam. “Drone” breathes once a bar.',
  },
  prism: {
    light: 'Glass that bends violet more than red, fanning white light into a rainbow.',
    music: 'Turns one note into many: each colour is a pitch, red low, violet high. A receptor across the fan hears a chord.',
  },
  mirror: {
    light: 'Reflects light. As a beam splitter it reflects part and lets the rest through.',
    music: 'Lengthens the path, so the note arrives later. Two splitters facing each other make echoes that fade.',
  },
  lens: {
    light: 'Bends light towards (or away from) a focus. A lens can gather a rainbow back into one white point.',
    music: 'Concentrated light plays louder and brighter; spread-out light sounds soft and muffled. Put a receptor at the focus for a bright chord.',
  },
  filter: {
    light: 'Coloured glass: passes only a band of wavelengths.',
    music: 'Removes notes. Narrow the band to thin a chord down to a few pitches.',
  },
  modulator: {
    light: 'A ring the beam passes through. It re-times the swells on the light after it.',
    music: 'Replaces the rhythm with a Euclidean pattern: hits spread as evenly as possible over the steps (3 in 8 is a tresillo).',
  },
  loom: {
    light: 'A punched card across a rainbow. Its holes let swells through on chosen colours only.',
    music: 'Plays a written melody: each hole is a note at a step. This is how the classics are played.',
  },
  receptor: {
    light: 'Catches light that hits its front slit.',
    music: 'The instrument. Every colour it catches is a note; wide apertures catch chords. Tilt it across a rainbow to strum. As Drums, colour picks the drum: red kick, then tom, snare, clap, hat, violet open hat.',
  },
  chord: {
    light: 'Stained glass that sits across a rainbow and follows a chord progression: on each chord, swells pass only on the colours of that chord’s notes.',
    music: 'Harmony without a punch card: pick a progression (C – G – Am – F …) and how long each chord lasts. The name of the current chord glows above the glass.',
  },
  comb: {
    light: 'An interference comb: light passes only on evenly spaced bright fringes and leaves as thin lines. White light meeting it splits into a few sharp colours, like a diffraction grating.',
    music: 'Turns a smeared cluster of neighbouring notes into a clean chord with space between the notes. More fringes, more notes; phase slides which notes.',
  },
  blocker: {
    light: 'Absorbs light completely.',
    music: 'Silence: mutes whatever is behind it.',
  },
};
