export const VISIBLE_MIN_NM = 400;
export const VISIBLE_MAX_NM = 700;
const VISIBLE_SPAN = VISIBLE_MAX_NM - VISIBLE_MIN_NM;

/** Undispersed light carries a band; after the first prism it becomes monochromatic rays. */
export type RayLight = { kind: 'band'; minNm: number; maxNm: number } | { kind: 'mono'; nm: number };

export const WHITE: RayLight = { kind: 'band', minNm: VISIBLE_MIN_NM, maxNm: VISIBLE_MAX_NM };

/**
 * Wavelength samples (bin centres) used when a band is dispersed. A full white band
 * gets `raysPerFullSpectrum` rays; narrower bands get proportionally fewer, at least 3.
 */
export function sampleBand(minNm: number, maxNm: number, raysPerFullSpectrum: number): number[] {
  const count = Math.max(3, Math.round((raysPerFullSpectrum * (maxNm - minNm)) / VISIBLE_SPAN));
  const step = (maxNm - minNm) / count;
  return Array.from({ length: count }, (_, i) => minNm + step * (i + 0.5));
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

export function centroidNm(light: RayLight): number {
  return light.kind === 'mono' ? light.nm : (light.minNm + light.maxNm) / 2;
}
