/**
 * Bjorklund's algorithm: distribute `hits` onsets as evenly as possible over `steps`,
 * then rotate left by `rotate`. E(3,8) = x..x..x. , E(5,8) = x.xx.xx.
 */
export function bjorklund(steps: number, hits: number, rotate = 0): boolean[] {
  const n = Math.max(0, Math.floor(steps));
  const k = Math.max(0, Math.min(n, Math.floor(hits)));
  if (n === 0) return [];
  let groups: number[][] = Array.from({ length: k }, () => [1]);
  let rest: number[][] = Array.from({ length: n - k }, () => [0]);
  if (k === 0) return rotateLeft(rest.flat().map(Boolean), rotate);
  while (rest.length > 1) {
    const m = Math.min(groups.length, rest.length);
    const merged = groups.slice(0, m).map((g, i) => [...g, ...rest[i]!]);
    const leftover = groups.length > m ? groups.slice(m) : rest.slice(m);
    groups = merged;
    rest = leftover;
  }
  return rotateLeft([...groups.flat(), ...rest.flat()].map(Boolean), rotate);
}

function rotateLeft<T>(a: T[], r: number): T[] {
  if (a.length === 0) return a;
  const s = ((Math.floor(r) % a.length) + a.length) % a.length;
  return [...a.slice(s), ...a.slice(0, s)];
}
