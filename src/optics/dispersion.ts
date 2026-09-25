import { dot, madd, scale, type Vec2 } from './vec2';

/** BK7-like Cauchy coefficients, λ in micrometres. */
export const CAUCHY_A = 1.5046;
export const CAUCHY_B = 0.0042;
const REF_UM = 0.55;

/**
 * Cauchy index n(λ) = A + B/λ². Exaggerating dispersion multiplies B, but we pin
 * n(550 nm) so the slider only widens the fan instead of also bending the whole beam.
 */
export function refractiveIndex(nm: number, dispersionScale = 1): number {
  const um = nm / 1000;
  const b = CAUCHY_B * dispersionScale;
  return CAUCHY_A + b / (um * um) - (b - CAUCHY_B) / (REF_UM * REF_UM);
}

/** Mirror-reflect direction d about unit normal n. */
export function reflect(d: Vec2, n: Vec2): Vec2 {
  return madd(d, n, -2 * dot(d, n));
}

/**
 * Snell refraction. `n` must be the unit surface normal facing against `d`
 * (dot(d, n) < 0); eta = n1 / n2. Returns null on total internal reflection.
 */
export function refract(d: Vec2, n: Vec2, eta: number): Vec2 | null {
  const cosI = -dot(n, d);
  const k = 1 - eta * eta * (1 - cosI * cosI);
  if (k < 0) return null;
  return madd(scale(d, eta), n, eta * cosI - Math.sqrt(k));
}

/** Schlick's Fresnel reflectance; returns 1 for total internal reflection. */
export function schlick(cosI: number, n1: number, n2: number): number {
  let cos = Math.abs(cosI);
  if (n1 > n2) {
    const eta = n1 / n2;
    const sin2T = eta * eta * (1 - cos * cos);
    if (sin2T > 1) return 1;
    cos = Math.sqrt(1 - sin2T);
  }
  const r0 = ((n1 - n2) / (n1 + n2)) ** 2;
  return r0 + (1 - r0) * (1 - cos) ** 5;
}
