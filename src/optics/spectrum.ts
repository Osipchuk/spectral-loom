export const VISIBLE_MIN_NM = 400;
export const VISIBLE_MAX_NM = 700;
const VISIBLE_SPAN = VISIBLE_MAX_NM - VISIBLE_MIN_NM;

/** Undispersed light carries a band; after the first prism it becomes monochromatic rays. */
export type RayLight = { kind: 'band'; minNm: number; maxNm: number } | { kind: 'mono'; nm: number };

export const WHITE: RayLight = { kind: 'band', minNm: VISIBLE_MIN_NM, maxNm: VISIBLE_MAX_NM };

const C_NM_THZ = 299792.458;

/** Optical frequency in THz. */
export function frequencyTHz(nm: number): number {
  return C_NM_THZ / nm;
}

/**
 * Wavelength samples used when a band is dispersed. Samples are spaced evenly in
 * log-frequency (i.e. evenly in pitch), so every scale degree of the pitch mapping gets
 * at least one ray whenever there are at least as many rays as degrees. A full white band
 * gets `raysPerFullSpectrum` rays; narrower bands get proportionally fewer, at least 3.
 */
export function sampleBand(minNm: number, maxNm: number, raysPerFullSpectrum: number): number[] {
  const count = Math.max(3, Math.round((raysPerFullSpectrum * (maxNm - minNm)) / VISIBLE_SPAN));
  const fLo = frequencyTHz(maxNm);
  const ratio = frequencyTHz(minNm) / fLo;
  return Array.from({ length: count }, (_, i) => C_NM_THZ / (fLo * ratio ** ((i + 0.5) / count)));
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

const FILTER_EDGE_NM = 12;

/** Soft-edged bandpass transmission for a single wavelength. */
export function filterTransmission(nm: number, minNm: number, maxNm: number): number {
  return (
    smoothstep(minNm - FILTER_EDGE_NM, minNm + FILTER_EDGE_NM, nm) *
    (1 - smoothstep(maxNm - FILTER_EDGE_NM, maxNm + FILTER_EDGE_NM, nm))
  );
}

/** Apply a bandpass to light. Returns the new light and its power gain, or null if blocked. */
export function filterLight(light: RayLight, minNm: number, maxNm: number): { light: RayLight; gain: number } | null {
  if (light.kind === 'mono') {
    const gain = filterTransmission(light.nm, minNm, maxNm);
    return gain > 0 ? { light, gain } : null;
  }
  const lo = Math.max(light.minNm, minNm);
  const hi = Math.min(light.maxNm, maxNm);
  if (hi - lo < 2) return null;
  return { light: { kind: 'band', minNm: lo, maxNm: hi }, gain: (hi - lo) / (light.maxNm - light.minNm) };
}

/** Position of a wavelength in pitch space: 0 at deep red (700 nm) … 1 at violet (400 nm). */
export function pitchPosition(nm: number): number {
  const lo = frequencyTHz(VISIBLE_MAX_NM);
  const hi = frequencyTHz(VISIBLE_MIN_NM);
  return Math.log2(frequencyTHz(nm) / lo) / Math.log2(hi / lo);
}

export function positionToNm(p: number): number {
  const lo = frequencyTHz(VISIBLE_MAX_NM);
  const hi = frequencyTHz(VISIBLE_MIN_NM);
  return C_NM_THZ / (lo * (hi / lo) ** p);
}

/** Interference comb transmission: sharp bright fringes, dark in between. */
export function combTransmission(nm: number, fringes: number, phase: number): number {
  const x = Math.cos(Math.PI * (pitchPosition(nm) * fringes + phase));
  return (x * x) ** 10;
}

/** Wavelengths of the comb's bright fringes that fall inside [minNm, maxNm]. */
export function combPeaks(minNm: number, maxNm: number, fringes: number, phase: number): number[] {
  const pLo = pitchPosition(maxNm);
  const pHi = pitchPosition(minNm);
  const out: number[] = [];
  for (let k = Math.ceil(pLo * fringes + phase); k <= Math.floor(pHi * fringes + phase); k++) {
    const p = (k - phase) / fringes;
    if (p >= pLo && p <= pHi) out.push(positionToNm(p));
  }
  return out;
}

export function centroidNm(light: RayLight): number {
  return light.kind === 'mono' ? light.nm : (light.minNm + light.maxNm) / 2;
}
