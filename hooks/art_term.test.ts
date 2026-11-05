import { expect, test } from 'claude-code/testing'
import { SPRITE_SIZES } from './contracts'
import type { SpriteId, TermLayer } from './contracts'
import { TERM_BANDS, TERM_PALETTE, termLayer, termSprite } from './art_term'

// The terminal's baked art (scripts/term_art.py): whole layers, every sprite at every scale, a crab that reads.

const SCALES = [2, 3, 4] as const
const IDS = Object.keys(SPRITE_SIZES) as SpriteId[]
const at = (l: TermLayer, x: number, y: number): number => l.px[y * l.w + x] ?? 255
const colour = (i: number): number => TERM_PALETTE[i] ?? -1
const lum = (c: number): number => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255)

test('the meadow covers the world at every scale, and the hedge stands at its foot', async () => {
  for (const s of SCALES) {
    const bg = termLayer('bg', s)
    const fg = termLayer('fg', s)
    expect([bg.w, bg.h]).toEqual([Math.ceil(180 / s), Math.ceil(250 / s)])
    expect([fg.w, fg.h]).toEqual([bg.w, bg.h])
    expect(bg.px.every((v) => v < TERM_PALETTE.length)).toBe(true)
    // Clear above the hedge (world y 217), drawn all along its foot.
    expect(at(fg, 10, Math.floor(200 / s))).toBe(255)
    expect(Array.from({ length: fg.w }, (_, x) => at(fg, x, Math.floor(240 / s))).every((v) => v !== 255)).toBe(true)
  }
})

test('every sprite has a picture at every scale, about its world size, on the palette', async () => {
  for (const id of IDS) {
    const [w, h] = SPRITE_SIZES[id]
    for (const s of SCALES) {
      const l = termSprite(id, s)
      expect(l !== undefined).toBe(true)
      if (!l) continue
      expect(l.px.length).toBe(l.w * l.h)
      expect(Math.abs(l.w - Math.ceil(w / s)) <= 1 && Math.abs(l.h - Math.ceil(h / s)) <= 1).toBe(true)
      expect(l.px.every((v) => v === 255 || v < TERM_PALETTE.length)).toBe(true)
    }
  }
})

test('a crab at s = 3 shows its body colour, two eyes apart, and legs', async () => {
  const crab = termSprite('crab_stand', 3)!
  const all = Array.from(crab.px).filter((v) => v !== 255).map(colour)
  expect(all).toContain(0xd97757) // the body
  const eyes: number[] = []
  let legs = 0
  for (let y = 0; y < crab.h; y++) for (let x = 0; x < crab.w; x++) {
    const v = at(crab, x, y)
    if (v === 255) continue
    if (colour(v) === 0x231815) eyes.push(x)
    if (y === crab.h - 1 && lum(colour(v)) < 200) legs++
  }
  expect(eyes.length).toBe(2)
  expect(Math.abs(eyes[1]! - eyes[0]!)).toBeGreaterThan(1)
  expect(legs).toBe(2)
})

test('the palette has room for the renderer, and the bands index real colours', async () => {
  expect(TERM_PALETTE.length).toBeLessThan(200)
  expect(new Set(TERM_PALETTE).size).toBe(TERM_PALETTE.length)
  expect(colour(TERM_BANDS.hat[1])).toBe(0xc0392b)
  expect(colour(TERM_BANDS.haiku[0])).toBe(0x64a6ff)
  const straw = termSprite('hat_straw', 3)!
  expect(Array.from(straw.px)).toContain(TERM_BANDS.hat[1])
})

test('the art decodes once and is cached', async () => {
  const t = performance.now()
  for (let i = 0; i < 1000; i++) termSprite(IDS[i % IDS.length]!, SCALES[i % 3]!)
  expect(performance.now() - t).toBeLessThan(50)
  expect(termLayer('bg', 3)).toBe(termLayer('bg', 3))
})
