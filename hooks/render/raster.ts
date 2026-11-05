// The terminal's pixel farm: the same world as the SVG, drawn as ▀ cells (top pixel the foreground, bottom the
// background) in a Raster, one terminal pixel per s world px. Actors stand where `at` puts them, as in the SVG; the
// picture is tinted for the sky and the season; signs, the board and bubbles keep their own colours, above the
// night, as the SVG draws them. Pure; buffers are reused per camera size.

import { BEAT, SPRITE_SIZES } from '../contracts'
import type { Actor, Board, DrawList, IconId, Pose, Prop, Pt, Season, Sign, SkyStep, SpriteId, Static, TermLayer } from '../contracts'
import type { Fx } from '../../types'
import { HAT_DY } from '../art'
import { TERM_PALETTE, termLayer, termSprite } from '../art_term'
import { at } from '../model/jobs'
import { PLOTS, PLOT_H } from '../model/layout'
import { actorTime, stillState } from './anim'
import type { TermCamera } from './camera'
import { SIGN_TEXT_W, WOOD, boardBox, fontText, textWidth } from './text'

/** The terminal art a frame is drawn from: art_term.ts in the plugin, small fixtures in tests. */
export type TermArt = {
  palette: readonly number[]
  layer: (layer: 'bg' | 'fg', s: 2 | 3 | 4) => TermLayer
  sprite: (id: SpriteId, s: 2 | 3 | 4) => TermLayer | undefined
}

const ART: TermArt = { palette: TERM_PALETTE, layer: termLayer, sprite: termSprite }
const CLEAR = 255
const HALF_BLOCK = 0x2580

// ---- colour ----

const hex = (c: string): number => parseInt(c.slice(1), 16)

// The colours the renderer draws itself: the signs' and the board's wood, the board's lamp, the bubbles. They sit at
// the top of the index space, above the art's palette, and are never tinted: like the SVG's signs, board and bubbles,
// they read the same at noon and at midnight.
const OWN_COLOURS = {
  edge: hex(WOOD.edge), plank: hex(WOOD.plank), light: hex(WOOD.light), gold: hex(WOOD.gold), cream: hex(WOOD.cream),
  red: 0xff4a3d, green: 0x7cfc9a, amber: 0xf5a524, white: 0xfbfaf5, sleep: 0xa9bdf5, heart: 0xff7fa8,
} as const
type Own = keyof typeof OWN_COLOURS
const OWN_KEYS = Object.keys(OWN_COLOURS) as Own[]
/** The art palette may use indices below this; the renderer's own colours take the rest, up to 254. */
export const OWN_BASE = CLEAR - OWN_KEYS.length
const OWN = Object.fromEntries(OWN_KEYS.map((k, i) => [k, OWN_BASE + i])) as Record<Own, number>

const SKY: Record<SkyStep, { mul: readonly [number, number, number]; add: readonly [number, number, number] }> = {
  night: { mul: [0.3, 0.36, 0.55], add: [6, 10, 34] },
  predawn: { mul: [0.5, 0.55, 0.72], add: [14, 14, 34] },
  sunrise: { mul: [0.95, 0.78, 0.74], add: [34, 12, 18] },
  morning: { mul: [0.98, 0.98, 0.94], add: [6, 6, 0] },
  day: { mul: [1, 1, 1], add: [0, 0, 0] },
  golden: { mul: [1, 0.9, 0.7], add: [26, 12, 0] },
  sunset: { mul: [0.92, 0.68, 0.62], add: [30, 4, 10] },
  dusk: { mul: [0.55, 0.5, 0.68], add: [12, 6, 30] },
}

const byte = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v))

/** A daylight colour as it looks at this sky step in this season. Foliage turns in autumn and frosts in winter. */
export function tint(rgb: number, sky: SkyStep, season: Season): number {
  let r = (rgb >> 16) & 255
  let g = (rgb >> 8) & 255
  let b = rgb & 255
  const isLeafy = g > r && g > b
  if (season === 'summer' && isLeafy) {
    r = r * 1.06 + 4
    b = b * 0.9
  } else if (season === 'autumn' && isLeafy) {
    const nr = g * 1.05 + 20
    const ng = (r + g) * 0.42
    r = nr
    g = ng
    b = b * 0.7
  } else if (season === 'winter') {
    // Snow on the leaves and the grass, and a little grey everywhere else.
    const k = isLeafy ? 0.6 : 0.15
    r += (226 - r) * k
    g += (232 - g) * k
    b += (238 - b) * k
  }
  const sk = SKY[sky]
  return (byte(r * sk.mul[0] + sk.add[0]) << 16) | (byte(g * sk.mul[1] + sk.add[1]) << 8) | byte(b * sk.mul[2] + sk.add[2])
}

// One palette per art palette, sky and season: 256 entries, so an index never needs a bounds check. Index 255 (clear)
// never reaches it: the meadow under every pixel is opaque.
const tinted = new WeakMap<readonly number[], Map<string, Uint32Array>>()
function paletteFor(pal: readonly number[], sky: SkyStep, season: Season): Uint32Array {
  let m = tinted.get(pal)
  if (!m) { m = new Map(); tinted.set(pal, m) }
  const key = `${sky}/${season}`
  let out = m.get(key)
  if (!out) {
    out = new Uint32Array(256)
    const base = pal[0] ?? 0
    for (let i = 0; i < OWN_BASE; i++) out[i] = tint(pal[i] ?? base, sky, season)
    OWN_KEYS.forEach((k, i) => { out![OWN_BASE + i] = OWN_COLOURS[k] })
    out[CLEAR] = out[0]!
    m.set(key, out)
  }
  return out
}

// ---- the art, memoised: the art module may decode its layers on every call ----

type Memo = { layers: Map<string, TermLayer>; sprites: Map<string, TermLayer | null> }
const memos = new WeakMap<TermArt, Memo>()
const memoOf = (art: TermArt): Memo => {
  let m = memos.get(art)
  if (!m) { m = { layers: new Map(), sprites: new Map() }; memos.set(art, m) }
  return m
}
const layerOf = (art: TermArt, layer: 'bg' | 'fg', s: 2 | 3 | 4): TermLayer => {
  const m = memoOf(art).layers
  const key = `${layer}${s}`
  let l = m.get(key)
  if (!l) { l = art.layer(layer, s); m.set(key, l) }
  return l
}
const spriteOf = (art: TermArt, id: SpriteId, s: 2 | 3 | 4): TermLayer | undefined => {
  const m = memoOf(art).sprites
  const key = `${id}@${s}`
  let l = m.get(key)
  if (l === undefined) { l = art.sprite(id, s) ?? null; m.set(key, l) }
  return l ?? undefined
}

// ---- base64, written out: Uint8Array.prototype.toBase64 may not exist in every runtime ----

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64C = Uint8Array.from(B64, (c) => c.charCodeAt(0))
let b64buf = new Uint8Array(0)

/** Standard padded base64 of the bytes. */
export function base64(bytes: Uint8Array): string {
  const n = bytes.length
  const outLen = Math.ceil(n / 3) * 4
  if (b64buf.length < outLen) b64buf = new Uint8Array(outLen)
  const o = b64buf
  let j = 0
  let i = 0
  for (; i + 2 < n; i += 3) {
    const v = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!
    o[j++] = B64C[v >> 18]!
    o[j++] = B64C[(v >> 12) & 63]!
    o[j++] = B64C[(v >> 6) & 63]!
    o[j++] = B64C[v & 63]!
  }
  if (i < n) {
    const has2 = i + 1 < n
    const v = (bytes[i]! << 16) | (has2 ? bytes[i + 1]! << 8 : 0)
    o[j++] = B64C[v >> 18]!
    o[j++] = B64C[(v >> 12) & 63]!
    o[j++] = has2 ? B64C[(v >> 6) & 63]! : 61
    o[j++] = 61
  }
  let s = ''
  for (let k = 0; k < outLen; k += 8192) {
    s += String.fromCharCode.apply(null, o.subarray(k, Math.min(outLen, k + 8192)) as unknown as number[])
  }
  return s
}

// ---- the canvas: palette indices for the view, one byte per terminal pixel ----

type Bufs = { idx: Uint8Array; words: Uint32Array; bytes: Uint8Array }
const bufs = new Map<string, Bufs>()
function bufsFor(cols: number, rows: number): Bufs {
  const key = `${cols}x${rows}`
  let b = bufs.get(key)
  if (!b) {
    if (bufs.size > 16) bufs.clear()
    const words = new Uint32Array(cols * rows * 3)
    b = { idx: new Uint8Array(cols * rows * 2), words, bytes: new Uint8Array(words.buffer) }
    bufs.set(key, b)
  }
  return b
}

// Little-endian words: the Raster wants little-endian u32s, and so does every machine this runs on; check once.
const isLE = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1

/** The view being drawn: `idx` is W × H terminal pixels, (ox, oy) the view's top-left in terminal pixels of the world. */
type Canvas = { idx: Uint8Array; W: number; H: number; ox: number; oy: number; s: 2 | 3 | 4 }

/** Stamp a layer with its top-left at view pixel (left, top). `ghost` draws every other pixel; `cut` skips top rows. */
function stamp(cv: Canvas, l: TermLayer, left: number, top: number, flip = false, ghost = false, cut = 0): void {
  const { idx, W, H } = cv
  for (let y = cut; y < l.h; y++) {
    const ty = top + y
    if (ty < 0 || ty >= H) continue
    for (let x = 0; x < l.w; x++) {
      const tx = left + x
      if (tx < 0 || tx >= W || (ghost && ((tx + cv.ox + ty + cv.oy) & 1) === 1)) continue
      const v = l.px[y * l.w + (flip ? l.w - 1 - x : x)] ?? CLEAR
      if (v !== CLEAR) idx[ty * W + tx] = v
    }
  }
}

/** Fill a world rectangle [x, x + w) × [y, y + h) with one colour, on whole terminal pixels. */
function fillWorld(cv: Canvas, x: number, y: number, w: number, h: number, v: number): void {
  const { s, W, H } = cv
  const x0 = Math.max(0, Math.round(x / s) - cv.ox)
  const x1 = Math.min(W, Math.max(Math.round(x / s) + 1, Math.round((x + w) / s)) - cv.ox)
  const y0 = Math.max(0, Math.round(y / s) - cv.oy)
  const y1 = Math.min(H, Math.max(Math.round(y / s) + 1, Math.round((y + h) / s)) - cv.oy)
  for (let ty = y0; ty < y1; ty++) cv.idx.fill(v, ty * W + x0, ty * W + Math.max(x0, x1))
}

/** A layer's top-left in view pixels when its bottom centre stands at world point (wx, wy). */
const feetLeft = (cv: Canvas, l: TermLayer, wx: number): number => Math.round(wx / cv.s - l.w / 2) - cv.ox
const feetTop = (cv: Canvas, l: TermLayer, wy: number): number => Math.round(wy / cv.s) - l.h - cv.oy

type Item = { y: number; draw: (cv: Canvas) => void }
type Marker = { x: number; top: number; colour: number }

/**
 * One terminal frame of the draw list: the meadow; statics, signs, actors and effects in feet order at their places
 * now; the hedge in front; the board and the bubble markers on top. `hash` (FNV-1a of the cells) tells the blit loop
 * whether anything changed; `movers` counts what will change on its own (walkers, loops, live effects) in view.
 */
export function rasterFrame(dl: DrawList, cam: TermCamera, art: TermArt = ART): { cells: string; hash: number; movers: number } {
  const { s, cols, rows } = cam
  const W = cols
  const H = rows * 2
  const ox = Math.round(cam.view.x / s)
  const oy = Math.round(cam.view.y / s)
  const { idx, words, bytes } = bufsFor(cols, rows)
  const cv: Canvas = { idx, W, H, ox, oy, s }

  // The meadow: copy the view, holding the edge pixel past the world's edge.
  const bg = layerOf(art, 'bg', s)
  for (let y = 0; y < H; y++) {
    const sy = Math.min(bg.h - 1, Math.max(0, oy + y)) * bg.w
    for (let x = 0; x < W; x++) {
      const v = bg.px[sy + Math.min(bg.w - 1, Math.max(0, ox + x))] ?? 0
      idx[y * W + x] = v === CLEAR ? 0 : v
    }
  }

  const inView = (wx: number, wy: number): boolean => {
    const x = wx / s - ox
    const y = wy / s - oy
    return x > -8 && x < W + 8 && y > -2 && y < H + 12
  }

  const items: Item[] = []
  const markers: Marker[] = []
  for (const st of dl.statics) staticItem(items, st, art, s)
  for (const g of dl.signs) signItem(items, g)
  let movers = 0
  for (const a of dl.actors) movers += actorItem(items, markers, a, dl, art, s, inView)
  for (const f of dl.fx) movers += fxItem(items, f, dl, art, s, inView)
  items.sort((p, q) => p.y - q.y)
  for (const it of items) it.draw(cv)

  // The hedge in front.
  const fg = layerOf(art, 'fg', s)
  for (let y = 0; y < H; y++) {
    const sy = oy + y
    if (sy < 0 || sy >= fg.h) continue
    for (let x = 0; x < W; x++) {
      const sx = ox + x
      if (sx < 0 || sx >= fg.w) continue
      const v = fg.px[sy * fg.w + sx] ?? CLEAR
      if (v !== CLEAR) idx[y * W + x] = v
    }
  }

  // On top, as the SVG draws them: the board, then each bubble as one cell of colour.
  drawBoard(cv, dl.board)
  for (const m of markers) {
    if (m.x < 0 || m.x >= W) continue
    for (const y of [m.top, m.top + 1]) if (y >= 0 && y < H) idx[y * W + m.x] = m.colour
  }

  // Colour and pack: [U+2580, top, bottom] per cell, hashed as we go.
  const pal = paletteFor(art.palette, dl.sky, dl.season)
  let h = 0x811c9dc5
  let k = 0
  for (let r = 0; r < rows; r++) {
    const top = 2 * r * W
    const bot = top + W
    for (let c = 0; c < cols; c++) {
      const fgc = pal[idx[top + c]!]!
      const bgc = pal[idx[bot + c]!]!
      words[k++] = HALF_BLOCK
      words[k++] = fgc
      words[k++] = bgc
      h = Math.imul(h ^ fgc, 0x01000193)
      h = Math.imul(h ^ bgc, 0x01000193)
    }
  }
  if (!isLE) for (let i = 0; i < words.length; i++) {
    const v = words[i]!
    words[i] = ((v & 255) << 24) | ((v >> 8 & 255) << 16) | ((v >> 16 & 255) << 8) | (v >>> 24)
  }
  return { cells: base64(bytes), hash: h >>> 0, movers }
}

// ---- things on the ground ----

function staticItem(items: Item[], st: Static, art: TermArt, s: 2 | 3 | 4): void {
  if (st.opacity !== undefined && st.opacity < 0.2) return
  const l = spriteOf(art, st.sprite, s)
  if (!l) return
  const [w, h] = SPRITE_SIZES[st.sprite] ?? [0, 0]
  const fx = st.at.x + w / 2
  const fy = st.at.y + h
  // A ghost (the next build's scaffold, a fading visitor) is drawn as every other pixel. A drooping crop loses its
  // top row: the terminal's version of the SVG's sag.
  const ghost = st.filter === 'ghost' || (st.opacity !== undefined && st.opacity < 0.75)
  const cut = (st.filter === 'droop' || st.filter === 'dry') && l.h > 1 ? 1 : 0
  items.push({ y: fy, draw: (cv) => stamp(cv, l, feetLeft(cv, l, fx), feetTop(cv, l, fy), st.flip === true, ghost, cut) })
}

/** A plot's sign: a plank under the plot, gold for the step in progress, its words as darker strokes. */
function signItem(items: Item[], sign: Sign): void {
  const plot = PLOTS[sign.plot]
  if (!plot) return
  const text = fontText(sign.text)
  if (!text.trim()) return
  const x = plot.x
  const y = plot.y + PLOT_H + 2
  const w = Math.min(textWidth(text), SIGN_TEXT_W) + 5
  const h = 8
  items.push({
    y: y + h,
    draw: (cv) => {
      // In whole terminal pixels from its top-left, so every plank is the same height: an edge round the sides and
      // the bottom, the plank or gold inside.
      const { s, idx, W, H } = cv
      const left = Math.round(x / s) - cv.ox
      const right = Math.round((x + w) / s) - cv.ox
      const top = Math.round(y / s) - cv.oy
      const rows = Math.max(2, Math.round(h / s))
      const fill = sign.isCurrent ? OWN.gold : OWN.plank
      for (let ty = top; ty < top + rows; ty++) {
        if (ty < 0 || ty >= H) continue
        for (let tx = Math.max(0, left); tx < Math.min(W, right); tx++) {
          const isEdge = ty === top + rows - 1 || tx === left || tx === right - 1
          idx[ty * W + tx] = isEdge ? OWN.edge : fill
        }
      }
      // The words, where the plank is tall enough: a stroke under each letter, a gap at each space.
      if (rows < 3) return
      const ty = top + ((rows - 1) >> 1)
      if (ty < 0 || ty >= H) return
      const ink = sign.isCurrent ? OWN.edge : OWN.cream
      let cx = x + 2.5
      for (const ch of text) {
        if (ch !== ' ') {
          const tx = Math.round((cx + 1.5) / s) - cv.ox
          if (tx > left && tx < right - 1 && tx < W && tx >= 0) idx[ty * W + tx] = ink
        }
        cx += ch === ' ' ? 2 : 4
      }
    },
  })
}

/** The notice board, hung at the top right as the SVG hangs it: ropes, a plank, a lamp and a bar toward the next build. */
function drawBoard(cv: Canvas, board: Board): void {
  const { x, y, w, h } = boardBox(board)
  const { s } = cv
  fillWorld(cv, x + 4, 0, 1, y, OWN.edge)
  fillWorld(cv, x + w - 5, 0, 1, y, OWN.edge)
  fillWorld(cv, x, y, w, h, OWN.edge)
  fillWorld(cv, x + s, y + s, w - 2 * s, h - 2 * s, OWN.plank)
  // The title in gold and one cream stroke per row: there is no room for letters, the header row says it in words.
  fillWorld(cv, x + 3, y + 3, Math.min(textWidth('CRAB FARM'), w - 12), 1, OWN.gold)
  board.rows.forEach(([label, value], i) => {
    const ty = y + 12 + i * 7
    if (ty + 2 > y + h - s) return
    fillWorld(cv, x + 3, ty, textWidth(fontText(label)), 1, OWN.cream)
    const vw = textWidth(fontText(value))
    fillWorld(cv, x + w - 3 - vw, ty, vw, 1, OWN.cream)
  })
  const lamp = board.isAsking ? OWN.red : board.isWorking ? OWN.green : OWN.amber
  fillWorld(cv, x + w - 7, y + 3, 3, 3, lamp)
  if (board.next) {
    const p = Math.max(0, Math.min(1, board.next.progress))
    const bw = w - 6
    fillWorld(cv, x + 3, y + h - 4, bw, 1.5, OWN.edge)
    if (p > 0) fillWorld(cv, x + 3, y + h - 4, Math.max(s, p * bw), 1.5, OWN.gold)
  }
}

// ---- actors ----

// Where each held prop sits from the feet, in world px (its bottom-left corner), and whether it turns with its holder:
// the same places as anim.ts draws them. Tools in the hand turn; loads carried overhead stay as they are.
const PROP_AT: Readonly<Record<Prop, { dx: number; dy: number; turns: boolean }>> = {
  hoe: { dx: 3, dy: -2, turns: true }, can: { dx: 4, dy: -3, turns: true }, bucket: { dx: 4, dy: -2, turns: true },
  magnifier: { dx: 5, dy: -7, turns: true }, sack: { dx: -3, dy: -16, turns: false }, crate: { dx: -3, dy: -16, turns: false },
  letter: { dx: 4, dy: -5, turns: true }, basket: { dx: -3, dy: -16, turns: false }, book: { dx: 3, dy: -6, turns: true },
  hammer: { dx: 5, dy: -6, turns: true }, lantern: { dx: 6, dy: -4, turns: true }, rod: { dx: 4, dy: -8, turns: true },
  crank: { dx: 5, dy: -2, turns: true }, umbrella: { dx: -6, dy: -18, turns: false },
}
const PROP_B: Partial<Record<Prop, SpriteId>> = { hoe: 'prop_hoe_2', can: 'prop_can_2', hammer: 'prop_hammer_2' }

/** A bubble's colour: red asks for your OK, amber is your move, blue a nap, pink a chat; every job icon is white. */
const markerOf = (a: Actor): number | undefined => {
  if (a.isAsking) return OWN.red
  const icon: IconId | undefined = a.bubble
  if (!icon) return undefined
  return icon === 'alert' ? OWN.red : icon === 'ask' ? OWN.amber : icon === 'zzz' ? OWN.sleep : icon === 'heart' ? OWN.heart : OWN.white
}

// A sprite's first and last rows with anything drawn, so a hat lands on a head however the art pads its sprites.
const opaque = new WeakMap<TermLayer, { first: number; last: number }>()
const rowsOf = (l: TermLayer): { first: number; last: number } => {
  let r = opaque.get(l)
  if (!r) {
    let first = l.h
    let last = -1
    for (let y = 0; y < l.h; y++) {
      for (let x = 0; x < l.w; x++) {
        if ((l.px[y * l.w + x] ?? CLEAR) !== CLEAR) { first = Math.min(first, y); last = y; break }
      }
    }
    r = last < 0 ? { first: 0, last: l.h - 1 } : { first, last }
    opaque.set(l, r)
  }
  return r
}

/** The frame pair a pose draws with, falling back to standing, as anim.ts does. */
const framesOf = (a: Actor, pose: Pose): readonly [SpriteId, SpriteId] | undefined =>
  a.frames[pose] ?? a.frames.stand ?? Object.values(a.frames)[0]

/**
 * An actor where it is now: a farm-time timeline at `dl.ft`, a loop at its phase (anim.ts's `actorTime`), or, under
 * `still`, at its meaningful spot (anim.ts's `stillState`). Returns 1 when it will move or change frame on its own.
 */
function actorItem(items: Item[], markers: Marker[], a: Actor, dl: DrawList, art: TermArt, s: 2 | 3 | 4,
  inView: (x: number, y: number) => boolean): number {
  const isStill = dl.motion === 'still' || a.legs.length === 0
  if (a.legs.length === 0 && !a.still) return 0
  const t = actorTime(a, dl.now, dl.ft)
  let pt: Pt
  let pose: Pose
  let face: 1 | -1 = 1
  let prop: Prop | undefined
  if (isStill) {
    const st = stillState(a, t)
    pt = st.pt
    pose = st.pose
    prop = st.prop
  } else {
    const now = at(a.legs, t)
    pt = now.pt
    pose = now.pose
    face = now.face
    prop = now.prop
  }

  // Live: a loop, or a timeline not yet over (an open act holds until its tool returns). While Claude asks, farm time
  // stands still and so does everything on it.
  let isLive = false
  if (!isStill && !a.isAsking && !(a.clock === 'farm' && dl.board.isAsking)) {
    if (a.loop) isLive = a.loop.period > 0
    else {
      let first = Infinity
      let end = -Infinity
      let isOpen = false
      for (const l of a.legs) {
        first = Math.min(first, l.t0)
        if (l.t0 + l.beats * BEAT >= end) { end = l.t0 + l.beats * BEAT; isOpen = l.isOpen === true }
      }
      isLive = t >= first && (t < end || isOpen)
    }
  }

  const pair = framesOf(a, pose)
  if (!pair) return 0
  // Frames swap on the wall clock, every actor on the same beat: walking every 4 beats, working every 8.
  const every = pose === 'walk' ? 4 * BEAT : 8 * BEAT
  const isB = isLive && Math.floor(dl.now / every) % 2 === 1
  const body = spriteOf(art, isB ? pair[1] : pair[0], s)
  const flip = face === -1
  const hat = a.hat && a.kind === 'crab' ? spriteOf(art, a.hat, s) : undefined
  const propId = prop ? (isB && PROP_B[prop]) || (`prop_${prop}` as SpriteId) : undefined
  const propL = propId ? spriteOf(art, propId, s) : undefined
  const colour = markerOf(a)

  items.push({
    y: pt.y,
    draw: (cv) => {
      const left = body ? feetLeft(cv, body, pt.x) : Math.round(pt.x / s) - cv.ox
      const top = body ? feetTop(cv, body, pt.y) : Math.round(pt.y / s) - cv.oy
      if (body) stamp(cv, body, left, top, flip)
      let head = body ? top + rowsOf(body).first : top
      if (hat) {
        // The hat sits on the head: its lowest drawn row just above the body's highest, lifted per pose (HAT_DY),
        // whatever empty rows either micro sprite carries.
        const hy = head - 1 - rowsOf(hat).last + Math.round((HAT_DY[pose] ?? 0) / s)
        stamp(cv, hat, feetLeft(cv, hat, pt.x), hy, flip)
        head = Math.min(head, hy + rowsOf(hat).first)
      }
      if (propL && prop) {
        const { dx, dy, turns } = PROP_AT[prop]
        const turned = turns && flip
        const px = turned ? Math.round((pt.x - dx) / s) - propL.w - cv.ox : Math.round((pt.x + dx) / s) - cv.ox
        stamp(cv, propL, px, Math.round((pt.y + dy) / s) - propL.h - cv.oy, turned)
      }
      if (colour !== undefined) {
        // One whole cell above the head with a pixel's gap: rows 2r and 2r + 1 of the view.
        let bottom = head - 2
        if ((bottom & 1) === 0) bottom -= 1
        markers.push({ x: body ? left + (body.w >> 1) : left, top: bottom - 1, colour })
      }
    },
  })
  return isLive && inView(pt.x, pt.y) ? 1 : 0
}

// ---- effects ----

const FX_MS = 2000
const FX_SPRITE: Record<Fx['kind'], readonly SpriteId[]> = {
  coins: ['coin_0', 'coin_1', 'coin_2', 'coin_3'],
  sparkle: ['sparkle_0', 'sparkle_1'],
  golden: ['sparkle_0', 'sparkle_1'],
  puddle: ['puddle'],
  confetti: ['confetti_0', 'confetti_1'],
  compost: ['dust_0', 'dust_1'],
}

/** A short effect on farm time: coins float up as they spin, the rest flicker in place; gone after two seconds. */
function fxItem(items: Item[], f: Fx, dl: DrawList, art: TermArt, s: 2 | 3 | 4,
  inView: (x: number, y: number) => boolean): number {
  const age = dl.ft - f.t0
  if (age < 0 || age >= FX_MS) return 0
  const frames = FX_SPRITE[f.kind]
  const isLive = dl.motion !== 'still' && !dl.board.isAsking
  const id = frames[isLive ? Math.floor(age / (2 * BEAT)) % frames.length : 0]
  const l = id ? spriteOf(art, id, s) : undefined
  if (!l) return 0
  const rise = f.kind === 'coins' && isLive ? Math.floor(age / (4 * BEAT)) * s : 0
  // Effects float above everything on the ground.
  items.push({ y: 1e9, draw: (cv) => stamp(cv, l, feetLeft(cv, l, f.at.x), feetTop(cv, l, f.at.y - rise)) })
  return isLive && inView(f.at.x, f.at.y) ? 1 : 0
}

// ---- the text rows under the picture: the terminal's hover ----

const width = (s: string): number => Array.from(s).length
const fit = (s: string, cols: number): string => {
  const cs = Array.from(s)
  if (cs.length <= cols) return s
  return cols <= 0 ? '' : cs.slice(0, cols - 1).join('') + '…'
}

/** Join parts with ' · ', dropping the droppable ones (last first) until the line fits. */
const joinFit = (parts: { text: string; keep?: boolean }[], cols: number, sep = ' · '): string => {
  const live = parts.filter((p) => p.text !== '')
  for (;;) {
    const line = live.map((p) => p.text).join(sep)
    if (width(line) <= cols) return line
    let drop = -1
    for (let i = live.length - 1; i >= 0; i--) if (!live[i]!.keep) { drop = i; break }
    if (drop < 0) return fit(line, cols)
    live.splice(drop, 1)
  }
}

const row = (dl: DrawList, label: string): string | undefined =>
  dl.board.rows.find(([k]) => k.trim().toUpperCase() === label)?.[1]

/** The next build's name from its sprite: `well_pump` → WELL PUMP, `scaffold_2` → SCAFFOLD. */
const buildName = (id: string): string => id.replace(/_\d+$/, '').replace(/_/g, ' ').toUpperCase()

/** The state word every surface shares. */
export const stateWord = (dl: DrawList): string =>
  dl.board.isAsking ? '! needs your OK' : dl.board.isWorking ? 'working' : 'your move'

/**
 * The header and status rows of the terminal (spec 7.5), each fitted to `cols`:
 * `CRAB FARM · 2/6 · 1,270 COINS · NEXT WELL ▰▰▰▱` and `▸ Rework the plots · watering (Bash) · 12m · 2 helpers · working`.
 * Always both, header first; with one text row (`termCamera().textRows`), show the last: the status carries the
 * state word, which every width keeps.
 */
export function termLines(dl: DrawList, cols: number): string[] {
  const steps = row(dl, 'STEPS')
  const coins = row(dl, 'COINS') ?? /([\d,.]+) coins/i.exec(dl.alt)?.[1]
  const next = dl.board.next
  let bar = ''
  if (next) {
    const p = Math.max(0, Math.min(1, next.progress))
    // Four marks, the last filled only when the build is paid for: 70% shows ▰▰▰▱.
    const n = p >= 1 ? 4 : Math.min(3, Math.round(p * 4))
    const name = /next build ([^,;]+)/i.exec(dl.alt)?.[1]?.trim().toUpperCase() ?? buildName(next.sprite)
    bar = `NEXT ${name} ${'▰'.repeat(n)}${'▱'.repeat(4 - n)}`
  }
  const header = joinFit([
    { text: 'CRAB FARM', keep: true },
    { text: steps ?? '', keep: true },
    { text: coins ? `${coins} COINS` : '' },
    { text: bar },
  ], cols)

  const alt = /now "([^"]*)"(?:, ([^;]+))?/.exec(dl.alt)
  const current = dl.signs.find((g) => g.isCurrent)
  const name = alt?.[1] ?? current?.text ?? ''
  const job = dl.board.isWorking ? (alt?.[2]?.trim() ?? '') : ''
  const upper = fontText(name)
  const ids = current ? [`p${current.plot}`, `plot${current.plot}`, `plot-${current.plot}`, `sign${current.plot}`] : []
  const zone = dl.zones.find((z) => ids.includes(z.id)) ??
    (upper ? dl.zones.find((z) => z.lines.some((l) => fontText(l).includes(upper))) : undefined)
  const mins = zone?.lines.map((l) => /(\d+) MIN/i.exec(l)?.[1]).find((m) => m !== undefined)
  const helpers = Number(row(dl, 'HELPERS') ?? /(\d+) helpers?/i.exec(dl.alt)?.[1] ?? 0)
  const word = stateWord(dl)
  const tail = [
    { text: job },
    { text: mins ? `${mins}m` : '' },
    { text: helpers > 0 ? `${helpers} helper${helpers === 1 ? '' : 's'}` : '' },
  ]
  // The state word always shows; the step's name shrinks before it goes.
  let status = joinFit([...(name ? [{ text: `▸ ${name}`, keep: true }] : []), ...tail, { text: word, keep: true }], cols)
  if (width(status) > cols || !status.endsWith(word)) {
    const room = cols - width(word) - 3
    status = room >= 4 && name ? `${fit(`▸ ${name}`, room)} · ${word}` : fit(word, cols)
  }
  return [header, status]
}
