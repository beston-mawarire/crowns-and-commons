// Small things both games share: repeatable random numbers and the players' colours.

export type Rng = () => number;

/** A small, fast random number generator that gives the same numbers for the same seed. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const COLORS = [
  { id: "crimson", hex: "#c0392b" },
  { id: "blue", hex: "#2456a6" },
  { id: "green", hex: "#2e7d4f" },
  { id: "gold", hex: "#c9950c" },
  { id: "purple", hex: "#6b3fa0" },
  { id: "teal", hex: "#148a8a" },
  { id: "orange", hex: "#d2691e" },
  { id: "rose", hex: "#c2477f" },
];
