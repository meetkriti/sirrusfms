// Deterministic PRNG (mulberry32) so the seed produces identical data every run.
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = ReturnType<typeof makeRng>;

export function makeRng(seed: number) {
  const r = mulberry32(seed);
  return {
    next: r,
    chance: (p: number) => r() < p,
    int: (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1)),
    float: (lo: number, hi: number) => lo + r() * (hi - lo),
    pick: <T,>(arr: readonly T[]): T => arr[Math.floor(r() * arr.length)],
    shuffle: <T,>(arr: T[]): T[] => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
  };
}

/** Stable string hash (FNV-1a), used for per-entity deterministic randomness and AI audit input hashes. */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function hashHex(s: string): string {
  return hashStr(s).toString(16).padStart(8, "0");
}
