import { expect, test } from 'claude-code/testing'
import type { Actor, DrawList, Season, SkyStep, SpriteId, Static, TermLayer } from '../contracts'
import { TERM_PALETTE } from '../art_term'
import { at } from '../model/jobs'
import { actorTime } from './anim'
import { termCamera } from './camera'
import { OWN_BASE, base64, rasterFrame, termLines, tint } from './raster'
import type { TermArt } from './raster'

// ---- fixtures: a small hand-made terminal art set ----

const PAL = [
  0x5f8f3a, 0x6fa046, 0x4f7a30, // grass
  0x8a5a32, 0x6b4426,           // soil
  0x3f7fbf,                     // pond
  0x2f5a22,                     // hedge
  0xd04a2a, 0x1a1a1a,           // crab, eyes
  0xe8c84a,                     // coin, straw
  0xf0e8d0,                     // cream
]
const CRAB = 0xd04a2a
const EYE = 0x1a1a1a
const STRAW = 0xe8c84a
const CREAM = 0xf0e8d0

const layerOf = (w: number, h: number, f: (x: number, y: number) => number): TermLayer => {
  const px = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = f(x, y)
  return { w, h, px }
}
const paint = (rows: string[]): TermLayer => {
  const w = rows[0]?.length ?? 0
  return layerOf(w, rows.length, (x, y) => {
    const c = rows[y]?.[x] ?? '.'
    return c === '.' ? 255 : parseInt(c, 16)
  })
}
// Crabs keep the world sprite's proportions: two empty rows on top, where the hat goes.
const SPR: Partial<Record<string, TermLayer>> = {
  crab_stand: paint(['.....', '.....', '.777.', '78787', '77777', '7.7.7']),
  crab_walk1: paint(['.....', '.....', '.777.', '78777', '77777', '.7.7.']),
  crab_walk2: paint(['.....', '.....', '.777.', '78787', '77777', '7...7']),
  crab_look: paint(['.777.', '78787', '77777', '7.7.7']), // cropped to the body: no rows kept for the hat
  hat_straw: paint(['.999.', '99999']),
  crop_ripe_0: paint(['2', '9']),
  coin_0: paint(['9']), coin_1: paint(['a']), coin_2: paint(['9']), coin_3: paint(['a']),
  well: paint(['aaaa', '4..4', '4554', '4444']),
}
const FIX: TermArt = {
  palette: PAL,
  layer: (layer, s) => {
    const w = Math.ceil(180 / s)
    const h = Math.ceil(250 / s)
    if (layer === 'fg') return layerOf(w, h, (_x, y) => (y >= h - 2 ? 6 : 255))
    return layerOf(w, h, (x, y) => {
      const wx = x * s, wy = y * s
      if (wx >= 57 && wx < 139 && wy >= 109 && wy < 193) return 3 + ((x + y) % 2)
      if ((wx - 50) ** 2 / 576 + (wy - 219) ** 2 / 121 < 1) return 5
      return (x * 7 + y * 3) % 3
    })
  },
  sprite: (id, _s) => SPR[id],
}

const T0 = 1_700_000_000_000
const dl = (over: Partial<DrawList> = {}): DrawList => ({
  now: T0, ft: T0, motion: 'full', lod: 0, sky: 'day', season: 'spring', weather: null,
  events: [], statics: [], actors: [], signs: [], board: { isWorking: false, isAsking: false, rows: [] }, fx: [],
  zones: [], alt: 'Crab Farm.', ...over,
})
const crab = (id: string, from: { x: number; y: number }, to: { x: number; y: number }, beats = 16, more: Partial<Actor> = {}): Actor => ({
  id, kind: 'crab', clock: 'farm', hat: 'hat_straw',
  frames: { stand: ['crab_stand', 'crab_stand'], walk: ['crab_walk1', 'crab_walk2'] },
  legs: [{ t0: T0, beats, from, to, pose: from.x === to.x && from.y === to.y ? 'stand' : 'walk' }],
  still: to, ...more,
})
/** An actor that only stands, drawn with one frame: what a moving actor should look like at that spot. */
const statue = (p: { x: number; y: number }, frame: SpriteId): Actor => ({
  id: 'st', kind: 'animal', clock: 'wall', frames: { stand: [frame, frame] }, legs: [], still: p,
})

// ---- decoding the cells back, as the terminal would ----

const atob64 = (s: string): Uint8Array => {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const clean = s.replace(/=+$/, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let bits = 0, acc = 0, j = 0
  for (const ch of clean) {
    acc = ((acc << 6) | A.indexOf(ch)) & 0xffffff
    bits += 6
    if (bits >= 8) { bits -= 8; out[j++] = (acc >> bits) & 255 }
  }
  return out
}
const cellsOf = (b64: string): Uint32Array => {
  const bytes = atob64(b64)
  const dv = new DataView(bytes.buffer)
  const out = new Uint32Array(bytes.length / 4)
  for (let i = 0; i < out.length; i++) out[i] = dv.getUint32(i * 4, true)
  return out
}
const pairs = (words: Uint32Array): number => {
  const seen = new Set<string>()
  for (let i = 0; i < words.length; i += 3) seen.add(`${words[i + 1]}:${words[i + 2]}`)
  return seen.size
}
/** The colour of terminal pixel (x, y) in the frame. */
const pixel = (words: Uint32Array, cols: number, x: number, y: number): number =>
  words[((y >> 1) * cols + x) * 3 + 1 + (y & 1)] ?? -1
/** Every colour in the frame's top rows (y < rows), as a set. */
const coloursIn = (words: Uint32Array, cols: number, rows: number): Set<number> => {
  const out = new Set<number>()
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) out.add(pixel(words, cols, x, y))
  return out
}

const bytes = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0))
const S3 = termCamera(60, 45) // s = 3, the whole world, 60 × 42
const frame = (d: DrawList, art: TermArt | undefined = FIX, cam = S3): Uint32Array => cellsOf(rasterFrame(d, cam, art).cells)

// ---- the cells ----

test('base64 matches the standard vectors and round-trips any bytes', async () => {
  const want = ['', 'Zg==', 'Zm8=', 'Zm9v', 'Zm9vYg==', 'Zm9vYmE=', 'Zm9vYmFy']
  for (let n = 0; n <= 6; n++) expect(base64(bytes('foobar'.slice(0, n)))).toBe(want[n])
  let seed = 7
  for (const n of [1, 2, 3, 100, 1001, 30_240]) {
    const b = new Uint8Array(n)
    for (let i = 0; i < n; i++) { seed = (seed * 1103515245 + 12345) >>> 0; b[i] = seed >>> 24 }
    const s = base64(b)
    expect(s.length).toBe(Math.ceil(n / 3) * 4)
    expect(Array.from(atob64(s))).toEqual(Array.from(b))
  }
})

test('a frame is cols x rows x 16 characters of half-block cells, at every scale', async () => {
  for (const [c, r] of [[60, 45], [40, 30], [90, 70], [30, 20], [56, 30], [12, 4], [0, 0]] as const) {
    const cam = termCamera(c, r)
    for (const art of [FIX, undefined]) {
      const { cells } = rasterFrame(dl({ actors: [crab('a', { x: 90, y: 150 }, { x: 90, y: 150 }, 16, { bubble: 'terminal' })] }), cam, art)
      expect(cells.length).toBe(cam.cols * cam.rows * 16)
      const words = cellsOf(cells)
      for (let i = 0; i < words.length; i += 3) {
        if (words[i] !== 0x2580) throw new Error(`cell ${i / 3} is not U+2580`)
        if (words[i + 1]! > 0xffffff || words[i + 2]! > 0xffffff) throw new Error(`cell ${i / 3} has no colour`)
      }
    }
  }
})

// ---- placing things ----

test('a crab stands where its feet are, its hat on its head, and the hedge draws in front', async () => {
  const words = frame(dl({ actors: [crab('a', { x: 90, y: 150 }, { x: 90, y: 150 })] }))
  // Feet at (90, 150) → terminal pixel (30, 50); the 5 × 6 body spans x 28–32, y 44–49, the hat its top two rows.
  expect(pixel(words, 60, 30, 46)).toBe(CRAB)
  expect(pixel(words, 60, 29, 47)).toBe(EYE)
  expect(pixel(words, 60, 30, 44)).toBe(STRAW)
  expect(pixel(words, 60, 28, 45)).toBe(STRAW)
  expect(pixel(words, 60, 30, 50)).not.toBe(CRAB)
  expect(pixel(words, 60, 10, 83)).toBe(0x2f5a22)
})

test('a hat sits on the head however the art pads the body', async () => {
  const looker = crab('a', { x: 90, y: 150 }, { x: 90, y: 150 }, 16, { frames: { stand: ['crab_look', 'crab_look'] } })
  const words = frame(dl({ actors: [looker] }))
  // The 5 × 4 body spans rows 46–49 with its eyes on row 47; the hat takes rows 44–45, above them.
  expect(pixel(words, 60, 29, 47)).toBe(EYE)
  expect(pixel(words, 60, 30, 46)).toBe(CRAB)
  expect(pixel(words, 60, 28, 45)).toBe(STRAW)
  expect(pixel(words, 60, 30, 44)).toBe(STRAW)
})

test('statics stand on their bottom edge, nearer ones over farther ones', async () => {
  const well: Static = { sprite: 'well', at: { x: 83, y: 140 } } // 14 × 17: bottom centre (90, 157)
  const words = frame(dl({ statics: [well], actors: [crab('a', { x: 90, y: 160 }, { x: 90, y: 160 })] }))
  // The crab's feet are lower than the well's base, so the crab is drawn over it.
  expect(pixel(words, 60, 30, 50)).toBe(CRAB)
  // Feet higher up than the well's base: the well covers the crab's legs.
  const behind = frame(dl({ statics: [well], actors: [crab('a', { x: 90, y: 154 }, { x: 90, y: 154 })] }))
  expect(pixel(behind, 60, 28, 50)).toBe(0x6b4426)
  expect(pixel(behind, 60, 30, 50)).toBe(0x3f7fbf)
})

test('a ghost is drawn as every other pixel, and a drooping crop loses its top', async () => {
  const words = frame(dl({ statics: [{ sprite: 'well', at: { x: 83, y: 140 }, filter: 'ghost' }] }))
  expect(pixel(words, 60, 28, 48)).toBe(CREAM)
  expect(pixel(words, 60, 29, 48)).not.toBe(CREAM)
  const crop = (filter?: 'droop'): Static => ({ sprite: 'crop_ripe_0', at: { x: 88, y: 141 }, ...(filter ? { filter } : {}) })
  // 5 × 9 at (88, 141): bottom centre (90.5, 150) → x 30, rows 48–49.
  expect(pixel(frame(dl({ statics: [crop()] })), 60, 30, 48)).toBe(0x4f7a30)
  expect(pixel(frame(dl({ statics: [crop('droop')] })), 60, 30, 48)).not.toBe(0x4f7a30)
  expect(pixel(frame(dl({ statics: [crop('droop')] })), 60, 30, 49)).toBe(STRAW)
})

// ---- time ----

test('a walking crab moves with farm time, counts as a mover, and holds still once there', async () => {
  const walk = crab('w', { x: 60, y: 150 }, { x: 120, y: 150 }, 60)
  const a = rasterFrame(dl({ actors: [walk], ft: T0 + 1000 }), S3, FIX)
  const b = rasterFrame(dl({ actors: [walk], ft: T0 + 4000 }), S3, FIX)
  expect(a.movers).toBe(1)
  expect(a.hash).not.toBe(b.hash)
  expect(rasterFrame(dl({ actors: [walk], ft: T0 + 1000 }), S3, FIX).hash).toBe(a.hash)
  // Mid-walk at x 68 it is drawn exactly as a crab standing there in its first walk frame.
  const mid = rasterFrame(dl({ actors: [{ ...walk, hat: undefined }], ft: T0 + 1000 }), S3, FIX)
  expect(mid.hash).toBe(rasterFrame(dl({ actors: [statue({ x: 68, y: 150 }, 'crab_walk1')] }), S3, FIX).hash)
  // Done walking: nothing moves, the frame holds.
  const done1 = rasterFrame(dl({ actors: [walk], ft: T0 + 60_000, now: T0 + 60_000 }), S3, FIX)
  const done2 = rasterFrame(dl({ actors: [walk], ft: T0 + 61_000, now: T0 + 60_500 }), S3, FIX)
  expect(done1.movers).toBe(0)
  expect(done1.hash).toBe(done2.hash)
})

test('walk frames swap on the wall clock every four beats while walking', async () => {
  const walk = crab('w', { x: 60, y: 150 }, { x: 60, y: 150 }, 60)
  walk.legs = [{ t0: T0, beats: 60, from: { x: 60, y: 150 }, to: { x: 60, y: 150 }, pose: 'walk', isOpen: true }]
  const at0 = rasterFrame(dl({ actors: [walk], ft: T0 + 1000, now: T0 + 1000 }), S3, FIX).hash
  const at1 = rasterFrame(dl({ actors: [walk], ft: T0 + 1000, now: T0 + 1500 }), S3, FIX).hash
  const at2 = rasterFrame(dl({ actors: [walk], ft: T0 + 1000, now: T0 + 2000 }), S3, FIX).hash
  expect(at0).not.toBe(at1)
  expect(at0).toBe(at2)
})

test('a loop is drawn at its phase, as the SVG computes it, on the wall or the farm clock', async () => {
  const loop = (clock: 'wall' | 'farm', offset: number): Actor => ({
    id: 'h', kind: 'animal', clock, frames: { walk: ['crab_walk1', 'crab_walk1'] }, loop: { period: 4, offset },
    legs: [
      { t0: 0, beats: 16, from: { x: 60, y: 150 }, to: { x: 124, y: 150 }, pose: 'walk' },
      { t0: 2000, beats: 16, from: { x: 124, y: 150 }, to: { x: 60, y: 150 }, pose: 'walk' },
    ],
  })
  // Four px a beat: one second into the loop is x 92, a second and a half x 108; at three seconds it is coming back.
  for (const [clock, offset, now, ft, x, face] of [
    ['wall', 0, T0 + 1000, T0, 92, 1], ['wall', 0.5, T0 + 1000, T0, 108, 1], ['wall', 0, T0 + 3000, T0, 92, -1],
    ['farm', 0, T0 + 1000, T0, 60, 1], ['farm', 0, T0, T0 + 1500, 108, 1],
  ] as const) {
    const a = loop(clock, offset)
    const r = rasterFrame(dl({ actors: [a], now, ft }), S3, FIX)
    const want = at(a.legs, actorTime(a, now, ft))
    expect([want.pt.x, want.face]).toEqual([x, face])
    expect(r.movers).toBe(1)
    // Facing right, it is drawn exactly as a statue at that spot; facing left, mirrored: its one eye on the right.
    if (face === 1) expect(r.hash).toBe(rasterFrame(dl({ actors: [statue(want.pt, 'crab_walk1')] }), S3, FIX).hash)
    else expect([pixel(cellsOf(r.cells), 60, 29, 47), pixel(cellsOf(r.cells), 60, 31, 47)]).toEqual([CRAB, EYE])
  }
})

test('under still motion an actor stands at its meaningful spot, never mid-path', async () => {
  const walker: Actor = {
    ...crab('w', { x: 60, y: 150 }, { x: 120, y: 150 }, 60), still: undefined,
    legs: [
      { t0: T0, beats: 60, from: { x: 60, y: 150 }, to: { x: 120, y: 150 }, pose: 'walk' },
      { t0: T0 + 7500, beats: 40, from: { x: 120, y: 150 }, to: { x: 120, y: 150 }, pose: 'work', prop: 'can' },
    ],
  }
  const s1 = rasterFrame(dl({ actors: [walker], ft: T0 + 1000, motion: 'still' }), S3, FIX)
  const s2 = rasterFrame(dl({ actors: [walker], ft: T0 + 3000, now: T0 + 500, motion: 'still' }), S3, FIX)
  expect(s1.movers).toBe(0)
  expect(s1.hash).toBe(s2.hash)
  const words = cellsOf(s1.cells)
  expect(pixel(words, 60, 40, 48)).toBe(CRAB) // at the plot, x 120
  expect(pixel(words, 60, 22, 48)).not.toBe(CRAB) // not at x 68, where full motion has it
})

test('while Claude asks, everything on farm time holds still and wall-clock life goes on', async () => {
  const walk = crab('w', { x: 60, y: 150 }, { x: 120, y: 150 }, 60)
  const critter: Actor = { ...statue({ x: 30, y: 60 }, 'crab_walk1'), loop: { period: 4, offset: 0 },
    legs: [{ t0: 0, beats: 32, from: { x: 30, y: 60 }, to: { x: 30, y: 60 }, pose: 'stand' }] }
  const asking = { isWorking: true, isAsking: true, rows: [] }
  const a = rasterFrame(dl({ actors: [walk], board: asking, ft: T0 + 1000, now: T0 + 5000 }), S3, FIX)
  const b = rasterFrame(dl({ actors: [walk], board: asking, ft: T0 + 1000, now: T0 + 5500 }), S3, FIX)
  expect(a.movers).toBe(0)
  expect(a.hash).toBe(b.hash)
  expect(rasterFrame(dl({ actors: [walk, critter], board: asking, ft: T0 + 1000 }), S3, FIX).movers).toBe(1)
})

test('coins float up for two seconds, then are gone', async () => {
  const fx = [{ n: 1, kind: 'coins' as const, at: { x: 90, y: 60 }, t0: T0 }]
  const empty = rasterFrame(dl(), S3, FIX)
  expect(rasterFrame(dl({ fx, ft: T0 + 100 }), S3, FIX).movers).toBe(1)
  expect(rasterFrame(dl({ fx, ft: T0 + 100 }), S3, FIX).hash).not.toBe(empty.hash)
  expect(rasterFrame(dl({ fx, ft: T0 + 2500 }), S3, FIX).hash).toBe(empty.hash)
})

// ---- the three answers: which step, what state, how far ----

test('a bubble is one cell of colour above the head, red when Claude asks, the same by night', async () => {
  const words = (bubble: Actor['bubble'], isAsking = false, sky: SkyStep = 'day'): Uint32Array =>
    frame(dl({ sky, actors: [crab('a', { x: 90, y: 150 }, { x: 90, y: 150 }, 16, { ...(bubble ? { bubble } : {}), isAsking })] }))
  // Head (hat) top at row 44; a pixel's gap, then the whole cell of rows 40–41 (cell row 20) at column 30.
  const cell = (w: Uint32Array): [number, number] => [w[(20 * 60 + 30) * 3 + 1]!, w[(20 * 60 + 30) * 3 + 2]!]
  expect(cell(words('terminal'))).toEqual([0xfbfaf5, 0xfbfaf5])
  expect(cell(words('terminal', false, 'night'))).toEqual([0xfbfaf5, 0xfbfaf5])
  expect(cell(words('ask'))).toEqual([0xf5a524, 0xf5a524])
  expect(cell(words('zzz'))).toEqual([0xa9bdf5, 0xa9bdf5])
  expect(cell(words(undefined, true))).toEqual([0xff4a3d, 0xff4a3d])
  expect(cell(words(undefined))[0]).not.toBe(0xfbfaf5)
  expect(pixel(words('terminal'), 60, 30, 42)).not.toBe(0xfbfaf5)
})

test('each step has its plank under its plot, the step in progress a gold one', async () => {
  const signs = [{ plot: 0, text: 'Read the source', isCurrent: false }, { plot: 3, text: 'Ship it', isCurrent: true }]
  const words = frame(dl({ signs, sky: 'night' }))
  // Plot 0 at (57, 109): the plank runs from (57, 127), 8 tall, over terminal rows 42–44 from column 19.
  expect(pixel(words, 60, 21, 42)).toBe(0x9b6b3f)
  expect(pixel(words, 60, 19, 43)).toBe(0x3b2416)
  expect(pixel(words, 60, 22, 44)).toBe(0x3b2416)
  // Plot 3 at (109, 143): gold, from (109, 161), column 36, rows 54–56.
  expect(pixel(words, 60, 38, 54)).toBe(0xe8b85c)
  expect(pixel(words, 60, 38, 56)).toBe(0x3b2416)
  // The planks keep their colour at night, like the SVG's.
  expect(pixel(frame(dl({ signs })), 60, 38, 54)).toBe(0xe8b85c)
})

test('the board hangs at the top right with its lamp: green working, red asking, amber at rest', async () => {
  const lampIn = (isWorking: boolean, isAsking: boolean): Set<number> =>
    coloursIn(frame(dl({ board: { isWorking, isAsking, rows: [['STEPS', '2/6'], ['COINS', '1,270']], next: { sprite: 'well', progress: 0.5 } } })), 60, 20)
  expect(lampIn(true, false).has(0x7cfc9a)).toBe(true)
  expect(lampIn(true, true).has(0xff4a3d)).toBe(true)
  expect(lampIn(true, true).has(0x7cfc9a)).toBe(false)
  expect(lampIn(false, false).has(0xf5a524)).toBe(true)
  expect(lampIn(false, false).has(0x9b6b3f)).toBe(true)
})

// ---- colour and cost ----

const SKIES: SkyStep[] = ['night', 'predawn', 'sunrise', 'morning', 'day', 'golden', 'sunset', 'dusk']
const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter']
const CROPS: SpriteId[] = ['crop_seed', 'crop_sprout', 'crop_grow_0', 'crop_grow_1', 'crop_grow_2', 'crop_ripe_0', 'crop_ripe_1', 'crop_ripe_2']
const BUILDS: SpriteId[] = ['scarecrow', 'coop', 'barrel', 'mailbox', 'bench', 'flowers', 'hive', 'well', 'jetty', 'windmill', 'scaffold_1', 'crate_full', 'bale', 'compost_2']

/** A full farm at work: 36 crops, the builds, six crabs with bubbles walking, helpers, hens, signs, coins. */
const busy = (at0: number): DrawList => dl({
  now: at0, ft: at0,
  statics: [
    ...Array.from({ length: 36 }, (_, i): Static => ({ sprite: CROPS[i % 8]!, at: { x: 58 + (i % 6) * 5 + (i % 12 >= 6 ? 52 : 0), y: 110 + Math.floor(i / 12) * 34 } })),
    ...BUILDS.map((sprite, i): Static => ({ sprite, at: { x: 10 + (i % 5) * 34, y: 30 + Math.floor(i / 5) * 70 }, ...(sprite === 'scaffold_1' ? { opacity: 0.35 } : {}) })),
  ],
  actors: [
    ...Array.from({ length: 6 }, (_, i) => crab(`c${i}`, { x: 50 + (i % 2) * 52, y: 121 + Math.floor(i / 2) * 34 }, { x: 140, y: 80 }, 80,
      { bubble: (['terminal', 'quill', 'magnifier', 'globe', 'ask', 'zzz'] as const)[i]!, frames: { stand: ['crab_stand', 'crab_blink'], walk: ['crab_walk1', 'crab_walk2'], work: ['crab_type', 'crab_crouch'] } })),
    ...Array.from({ length: 6 }, (_, i): Actor => ({ id: `m${i}`, kind: 'mini', clock: 'farm', frames: { work: ['mini_sonnet_0', 'mini_sonnet_1'] },
      legs: [{ t0: at0 - 1000, beats: 80, from: { x: 65 + i * 9, y: 109 }, to: { x: 65 + i * 9, y: 109 }, pose: 'work', isOpen: true }] })),
    ...Array.from({ length: 3 }, (_, i): Actor => ({ id: `h${i}`, kind: 'animal', clock: 'wall', frames: { walk: ['hen_0', 'hen_1'], stand: ['hen_0', 'hen_1'] }, loop: { period: 8, offset: i },
      legs: [{ t0: 0, beats: 32, from: { x: 140, y: 60 + i * 5 }, to: { x: 170, y: 60 + i * 5 }, pose: 'walk' }, { t0: 4000, beats: 32, from: { x: 170, y: 60 + i * 5 }, to: { x: 140, y: 60 + i * 5 }, pose: 'walk' }] })),
  ],
  signs: Array.from({ length: 6 }, (_, i) => ({ plot: i, text: `Step number ${i + 1}`, isCurrent: i === 2 })),
  board: { isWorking: true, isAsking: false, rows: [['STEPS', '3/6'], ['HELPERS', '6'], ['COINS', '1,270']], next: { sprite: 'well', progress: 0.6 } },
  fx: [{ n: 1, kind: 'coins', at: { x: 96, y: 80 }, t0: at0 - 300 }],
})

test('the art palette leaves room for the renderer\'s own colours', async () => {
  expect(TERM_PALETTE.length).toBeLessThanOrEqual(OWN_BASE)
  expect(PAL.length).toBeLessThanOrEqual(OWN_BASE)
})

test('a busy frame stays under 900 colour pairs for every sky and season, at every scale', async () => {
  for (const [c, r] of [[60, 45], [90, 70], [30, 20], [46, 37]] as const) {
    for (const sky of SKIES) for (const season of SEASONS) {
      for (const art of [FIX, undefined]) {
        expect(pairs(frame({ ...busy(T0), sky, season }, art, termCamera(c, r)))).toBeLessThan(900)
      }
    }
  }
})

test('the sky and the season tint the daylight palette', async () => {
  expect(tint(0x5f8f3a, 'day', 'spring')).toBe(0x5f8f3a)
  const lum = (c: number): number => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255)
  for (const c of [...PAL, ...TERM_PALETTE]) {
    if (lum(c) > 150) expect(lum(tint(c, 'night', 'spring'))).toBeLessThan(lum(c))
    for (const sky of SKIES) for (const season of SEASONS) {
      const t = tint(c, sky, season)
      expect(t >= 0 && t <= 0xffffff).toBe(true)
    }
  }
  const leaf = tint(0x5f8f3a, 'day', 'autumn')
  // Green turns olive, as the SVG's autumn matrix turns it: more red, less green, never russet.
  expect((leaf >> 16) & 255).toBeGreaterThan(0x5f)
  expect((leaf >> 8) & 255).toBeLessThan(0x8f)
  expect((leaf >> 8) & 255).toBeGreaterThan((leaf >> 16) & 255)
  const snow = tint(0x5f8f3a, 'day', 'winter')
  expect(lum(snow)).toBeGreaterThan(lum(0x5f8f3a))
})

test('a busy 60 x 42 frame builds in under 5 ms (median of 50)', async () => {
  expect([S3.cols, S3.rows]).toEqual([60, 42])
  for (const art of [undefined, FIX]) {
    const times: number[] = []
    for (let i = 0; i < 60; i++) {
      const d = busy(T0 + i * 250)
      const t = performance.now()
      rasterFrame(d, S3, art)
      if (i >= 10) times.push(performance.now() - t)
    }
    times.sort((a, b) => a - b)
    expect(times[25]!).toBeLessThan(5)
  }
})

// ---- the text rows ----

const board = (isWorking: boolean, isAsking: boolean): DrawList['board'] => ({
  isWorking, isAsking, rows: [['STEPS', '2/6'], ['HELPERS', '2'], ['COINS', '1,270']], next: { sprite: 'well', progress: 0.7 },
})
const talky = (isWorking: boolean, isAsking: boolean): DrawList => dl({
  board: board(isWorking, isAsking),
  signs: [{ plot: 0, text: 'Read the source', isCurrent: false }, { plot: 1, text: 'Rework the plots', isCurrent: true }],
  zones: [{ id: 'p1', rect: [0, 0, 1, 1], lines: ['2/6 REWORK THE PLOTS', 'working', 'SINCE 14:05 · 12 MIN · 14 CALLS · 2 HELPERS'] }],
  alt: 'Crab Farm: 1 of 6 steps done, now "Rework the plots", watering (Bash); 2 helpers; 1,270 coins; next build Well, 70%',
})

test('the text rows read like the spec at full width', async () => {
  expect(termLines(talky(true, false), 120)).toEqual([
    'CRAB FARM · 2/6 · 1,270 COINS · NEXT WELL ▰▰▰▱',
    '▸ Rework the plots · watering (Bash) · 12m · 2 helpers · working',
  ])
  expect(termLines(talky(false, false), 120)[1]).toBe('▸ Rework the plots · 12m · 2 helpers · your move')
  expect(termLines(talky(true, true), 120)[1]).toBe('▸ Rework the plots · watering (Bash) · 12m · 2 helpers · ! needs your OK')
})

test('the next build\'s bar fills a mark per quarter and the last only when it is paid for', async () => {
  const bar = (progress: number, alt = ''): string => termLines(dl({ alt, board: { ...board(false, false), next: { sprite: 'well_pump', progress } } }), 120)[0]!
  expect(bar(0)).toContain('NEXT WELL PUMP ▱▱▱▱')
  expect(bar(0.3)).toContain('▰▱▱▱')
  expect(bar(0.99)).toContain('▰▰▰▱')
  expect(bar(1)).toContain('▰▰▰▰')
  expect(bar(0.5, 'Crab Farm: next build Rain barrel, 50%')).toContain('NEXT RAIN BARREL ▰▰▱▱')
})

test('the text rows fit any width and always say the state', async () => {
  for (let cols = 1; cols <= 100; cols++) {
    for (const [w, a, word] of [[true, false, 'working'], [false, false, 'your move'], [true, true, 'needs your OK']] as const) {
      const lines = termLines(talky(w, a), cols)
      expect(lines.length).toBe(2)
      for (const l of lines) expect(Array.from(l).length <= cols).toBe(true)
      if (cols >= 16) expect(lines[1]!).toContain(word)
      if (cols >= 15) expect(lines[0]!.startsWith('CRAB FARM · 2/6')).toBe(true)
    }
  }
  expect(termLines(dl(), 40)).toEqual(['CRAB FARM', 'your move'])
})
