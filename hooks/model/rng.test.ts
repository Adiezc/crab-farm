import { expect, test } from 'claude-code/testing'
import { hash32, mulberry32, roll, weightedPick } from './rng'

test('a hash is the same for the same parts and differs for others', async () => {
  expect(hash32(7, 'well', '2026-11-04')).toBe(hash32(7, 'well', '2026-11-04'))
  expect(hash32(7, 'well', '2026-11-04')).not.toBe(hash32(7, 'well', '2026-11-05'))
  expect(hash32('ab', 'c')).not.toBe(hash32('a', 'bc'))
  expect(hash32(1)).toBeGreaterThanOrEqual(0)
  expect(hash32(1)).toBeLessThan(2 ** 32)
})

test('the generator repeats from a seed and spreads evenly', async () => {
  const a = mulberry32(42)
  const b = mulberry32(42)
  for (let i = 0; i < 10; i++) expect(a()).toBe(b())
  const next = mulberry32(9)
  const buckets = new Array(10).fill(0) as number[]
  const n = 100_000
  for (let i = 0; i < n; i++) {
    const r = next()
    expect(r >= 0 && r < 1).toBe(true)
    buckets[Math.floor(r * 10)] = (buckets[Math.floor(r * 10)] ?? 0) + 1
  }
  for (const c of buckets) expect(Math.abs(c / n - 0.1)).toBeLessThan(0.003)
})

test('rolls spread evenly over their parts', async () => {
  let low = 0
  const n = 100_000
  for (let i = 0; i < n; i++) if (roll(3, 'day', i) < 0.25) low++
  expect(Math.abs(low / n - 0.25)).toBeLessThan(0.0075)
})

test('a weighted pick follows the weights and never picks a row of no weight', async () => {
  const rows = [{ item: 'tend', weight: 20 }, { item: 'nap', weight: 0 }, { item: 'fish', weight: 60 }, { item: 'wander', weight: 20 }]
  const seen: Record<string, number> = {}
  const n = 100_000
  const next = mulberry32(1)
  for (let i = 0; i < n; i++) { const k = weightedPick(rows, next()); seen[k] = (seen[k] ?? 0) + 1 }
  expect(seen.nap).toBeUndefined()
  expect(Math.abs((seen.fish ?? 0) / n - 0.6)).toBeLessThan(0.03 * 0.6 + 0.005)
  expect(Math.abs((seen.tend ?? 0) / n - 0.2)).toBeLessThan(0.01)
  expect(weightedPick(rows, 0)).toBe('tend')
  expect(weightedPick(rows, 1)).toBe('wander')
})
