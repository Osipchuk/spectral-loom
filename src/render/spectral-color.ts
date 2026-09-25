import { VISIBLE_MAX_NM, VISIBLE_MIN_NM, type RayLight } from '../optics/spectrum';

export type RGB = [number, number, number];

/** Piecewise gaussian from Wyman, Sloan & Shirley (2013). */
function g(x: number, mu: number, s1: number, s2: number): number {
  const t = (x - mu) / (x < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
}

/** CIE 1931 2° colour-matching functions, multi-lobe analytic fit. */
export function cieXYZ(nm: number): RGB {
  const x = 1.056 * g(nm, 599.8, 37.9, 31.0) + 0.362 * g(nm, 442.0, 16.0, 26.7) - 0.065 * g(nm, 501.1, 20.4, 26.2);
  const y = 0.821 * g(nm, 568.8, 46.9, 40.5) + 0.286 * g(nm, 530.9, 16.3, 31.1);
  const z = 1.217 * g(nm, 437.0, 11.8, 36.0) + 0.681 * g(nm, 459.0, 26.0, 13.8);
  return [x, y, z];
}

export function xyzToLinearSRGB([x, y, z]: RGB): RGB {
  return [
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.204 * y + 1.057 * z,
  ];
}

/**
 * Pure spectral colours lie outside sRGB. Instead of clipping channels (which bands the
 * rainbow into flat hues) we desaturate towards equal-luminance grey just enough to
 * bring the colour into gamut.
 */
function toGamut(rgb: RGB): RGB {
  const lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  const min = Math.min(...rgb);
  if (min >= 0 || lum <= 0) return rgb.map((c) => Math.max(0, c)) as RGB;
  const k = lum / (lum - min);
  return rgb.map((c) => Math.max(0, lum + (c - lum) * k)) as RGB;
}

const TABLE_STEP = 1;
const TABLE: RGB[] = [];
let WHITE_BALANCE: RGB = [1, 1, 1];

(function buildTable(): void {
  const sum: RGB = [0, 0, 0];
  for (let nm = VISIBLE_MIN_NM; nm <= VISIBLE_MAX_NM; nm += TABLE_STEP) {
    const c = toGamut(xyzToLinearSRGB(cieXYZ(nm)));
    // Keep the far ends of the spectrum visible: physically they are almost black.
    const y = cieXYZ(nm)[1];
    const lift = 1 / Math.max(0.35, Math.sqrt(y));
    const lifted: RGB = [c[0] * lift, c[1] * lift, c[2] * lift];
    TABLE.push(lifted);
    sum[0] += lifted[0];
    sum[1] += lifted[1];
    sum[2] += lifted[2];
  }
  // Balance so that the average over the visible range is exactly white: a dispersed
  // fan recombined by a lens then returns to neutral white.
  const n = TABLE.length;
  WHITE_BALANCE = [n / sum[0], n / sum[1], n / sum[2]];
})();

/** Linear sRGB for a wavelength, white-balanced so that the full spectrum averages to (1,1,1). */
export function wavelengthToRGB(nm: number): RGB {
  const f = (Math.min(VISIBLE_MAX_NM, Math.max(VISIBLE_MIN_NM, nm)) - VISIBLE_MIN_NM) / TABLE_STEP;
  const i = Math.min(TABLE.length - 2, Math.floor(f));
  const t = f - i;
  const a = TABLE[i]!;
  const b = TABLE[i + 1]!;
  return [0, 1, 2].map((k) => (a[k]! + (b[k]! - a[k]!) * t) * WHITE_BALANCE[k]!) as RGB;
}

/** Average colour of a band (white for the full visible range). */
export function bandToRGB(minNm: number, maxNm: number): RGB {
  const steps = Math.max(2, Math.round((maxNm - minNm) / 4));
  const acc: RGB = [0, 0, 0];
  for (let i = 0; i < steps; i++) {
    const c = wavelengthToRGB(minNm + ((maxNm - minNm) * (i + 0.5)) / steps);
    acc[0] += c[0];
    acc[1] += c[1];
    acc[2] += c[2];
  }
  return [acc[0] / steps, acc[1] / steps, acc[2] / steps];
}

export function lightToRGB(light: RayLight): RGB {
  return light.kind === 'mono' ? wavelengthToRGB(light.nm) : bandToRGB(light.minNm, light.maxNm);
}
