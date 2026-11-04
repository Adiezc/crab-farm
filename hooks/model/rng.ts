// Seeded chance, so every session and every redraw of a day agree on what the farm does. Never Math.random.

/** A 32-bit hash of the parts (FNV-1a over their text, then a final mix). */
export const hash32 = (...parts: (string | number)[]): number => {
  let h = 0x811c9dc5
  const text = parts.join('\u001f')
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** A small, fast generator of numbers in [0, 1) from a seed. */
export const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A number in [0, 1) from the parts: one roll, no generator to keep. */
export const roll = (...parts: (string | number)[]): number => hash32(...parts) / 4294967296

/** One of the rows, each as likely as its weight, picked by `r` in [0, 1). Rows of no weight are never picked. */
export const weightedPick = <T>(rows: readonly { item: T; weight: number }[], r: number): T => {
  const total = rows.reduce((n, row) => n + Math.max(0, row.weight), 0)
  if (rows.length === 0) throw new Error('weightedPick: no rows')
  let left = Math.min(Math.max(r, 0), 0.999999999) * total
  for (const row of rows) {
    if (row.weight <= 0) continue
    if (left < row.weight) return row.item
    left -= row.weight
  }
  const last = [...rows].reverse().find(row => row.weight > 0) ?? rows[rows.length - 1]
  return (last as { item: T }).item
}
