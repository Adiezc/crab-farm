// The farm's lettering: a 3×5 pixel font placed glyph by glyph, the plot signs and the notice board.
// Each glyph is one path in <defs> with no fill of its own, so a line of text is drawn once and its shade is a <use>.

import type { Board, Sign } from '../contracts'
import { hash32 } from '../model/rng'

const HD = 2
const INK = '#1c1a24'
export const WOOD = { edge: '#3b2416', plank: '#9b6b3f', seam: '#7d532f', light: '#c08a55', gold: '#e8b85c', goldLight: '#f6d58c', cream: '#f6e7c1' }

/** A 3×5 pixel font, as crisp as the sprites: each glyph is its rows, top to bottom. */
export const GLYPHS: Readonly<Record<string, string>> = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', '0': '111101101101111', '1': '010110010010111', '2': '110001010100111', '3': '110001010001110',
  '4': '101101111001001', '5': '111100110001110', '6': '011100111101111', '7': '111001010010010', '8': '111101111101111',
  '9': '111101111001110', '-': '000000111000000', '.': '000000000000010', "'": '010010000000000', '+': '000010111010000',
  '?': '110001010000010', '/': '001001010100100', ',': '000000000010100', '!': '010010010000010', ' ': '000000000000000',
}

// Ids for glyphs that are not letters or digits, kept short and safe for any sanitizer.
const PUNCT: Readonly<Record<string, string>> = { '-': 'm', '.': 'd', "'": 'q', '+': 'p', '?': 'k', '/': 's', ',': 'c', '!': 'x' }
export const glyphId = (ch: string): string => `g${PUNCT[ch] ?? ch}`

/** What the font can draw: capitals, accents dropped, anything else gone. */
export const fontText = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().split('').filter(c => GLYPHS[c] !== undefined).join('')

// Letters advance four pixels, a space two, so words sit close.
const advance = (ch: string): number => (ch === ' ' ? 2 : 4)

/** Width in world px of text already in the font. */
export const textWidth = (s: string): number => Math.max(0, s.split('').reduce((n, ch) => n + advance(ch), 0) - 1)

/** How wide a sign's words may run, in world px: from the plot's edge to the next crab's bubble. */
export const SIGN_TEXT_W = 33

// Words a sign skips, so it keeps the ones that say what the step is.
const FILLER = new Set('a an and the to of on in for with it its is be me my we us you i so now ok okay just please can could would will lets let let\'s hey hi want need like make this that'.split(' '))

/** A step's name as its sign spells it: whole words that fit, filler left out unless nothing else is left. */
export const signName = (name: string, max = SIGN_TEXT_W): string => {
  // The font has no _ or :, so they part words (snake_case, a: b) rather than run them together.
  const words = fontText(name.replace(/[_:]/g, ' ')).split(/\s+/).filter(Boolean)
  const kept = words.filter(w => !FILLER.has(w.toLowerCase()))
  const pick = kept.length ? kept : words
  let out = ''
  for (const w of pick) {
    const next = out ? `${out} ${w}` : w
    if (textWidth(next) > max) break
    out = next
  }
  return out || (pick[0] ?? '').slice(0, Math.floor((max + 1) / 4))
}

// A glyph as one path in HD units, a row's lit run at a time.
const glyphPath = (g: string): string => {
  let d = ''
  for (let r = 0; r < 5; r++)
    for (let c = 0; c < 3; c++) {
      if (g[r * 3 + c] !== '1' || (c > 0 && g[r * 3 + c - 1] === '1')) continue
      let e = c
      while (e < 3 && g[r * 3 + e] === '1') e++
      d += `M${c * HD} ${r * HD}h${(e - c) * HD}v${HD}h${-(e - c) * HD}z`
    }
  return d
}

/** The <defs> paths for every glyph that `used` contains, once each. */
export const glyphDefs = (used: string): string => {
  const seen = new Set<string>()
  let out = ''
  for (const ch of used) {
    const g = GLYPHS[ch]
    if (g === undefined || seen.has(ch) || !g.includes('1')) continue
    seen.add(ch)
    out += `<path id="${glyphId(ch)}" d="${glyphPath(g)}"/>`
  }
  return out
}

const n = (v: number): string => String(+v.toFixed(2))

/**
 * Text at world (x, y), its top-left, in the font: one <use> per glyph. With a shade, the glyphs are drawn once in the
 * shade half a pixel lower, and again in `fill` by a single <use> of that group.
 */
export const textUse = (x: number, y: number, text: string, fill: string, shade?: string): string => {
  let glyphs = ''
  let cx = x
  for (const ch of text) {
    const g = GLYPHS[ch]
    if (g !== undefined && g.includes('1')) glyphs += `<use href="#${glyphId(ch)}" x="${n(cx * HD)}" y="${n(y * HD)}"/>`
    cx += advance(ch)
  }
  if (!glyphs) return ''
  if (!shade) return `<g fill="${fill}">${glyphs}</g>`
  const id = `t${(hash32(x, y, text, fill, shade) % 60466176).toString(36)}`
  return `<g fill="${shade}" transform="translate(0 1)"><g id="${id}">${glyphs}</g></g><use href="#${id}" fill="${fill}"/>`
}

const rect = (x: number, y: number, w: number, h: number, fill: string, extra = ''): string =>
  `<rect x="${n(x * HD)}" y="${n(y * HD)}" width="${n(w * HD)}" height="${n(h * HD)}" fill="${fill}"${extra}/>`

/** A wooden plank under a plot naming its step in a few words; the step in progress has a gold one. */
export const signSvg = (sign: Sign, plot: { x: number; y: number; w: number; h: number }): string => {
  const text = signName(sign.text)
  if (!text.trim()) return ''
  const x = plot.x
  const y = plot.y + plot.h + 2
  const w = textWidth(text) + 5
  const h = 8
  return rect(x + 1, y + h, w - 1, 1, 'rgba(20,30,10,.3)') +
    rect(x, y, w, h, WOOD.edge) +
    rect(x + 0.5, y + 0.5, w - 1, h - 1, sign.isCurrent ? WOOD.gold : WOOD.plank) +
    rect(x + 0.5, y + 0.5, w - 1, 0.5, sign.isCurrent ? WOOD.goldLight : WOOD.light) +
    (sign.isCurrent ? textUse(x + 2.5, y + 1.5, text, WOOD.edge) : textUse(x + 2.5, y + 1.5, text, WOOD.cream, WOOD.edge))
}

// ---- the project's sign by the gate ----

/** The plot a Sign names when it is the project's sign by the gate, not a step's. */
export const PROJECT_PLOT = -1
/** How wide the project's name may run, in world px: nine letters. */
export const PROJECT_TEXT_W = 35
/** The sign's right edge and the ground its posts stand on: just past the south lane's end, clear of the mailbox. */
const GATE_SIGN = { right: 157, ground: 218 } as const

/**
 * A folder name as the sign spells it: its words (split at spaces, dashes, underscores and dots) that fit, whole, as
 * a step's sign keeps them; a first word too long for the sign is cut. A name is all words, so none is filler.
 */
export const projectName = (name: string, max = PROJECT_TEXT_W): string => {
  const words = fontText(name.replace(/[-_.]+/g, ' ')).split(/\s+/).filter(Boolean)
  let out = ''
  for (const w of words) {
    const next = out ? `${out} ${w}` : w
    if (textWidth(next) > max) break
    out = next
  }
  return out || (words[0] ?? '').slice(0, Math.floor((max + 1) / 4))
}

/** The project sign's plank in world px (its posts stand below it, to the ground), and its words; none for no name. */
export const projectSign = (name: string): { x: number; y: number; w: number; h: number; text: string } | undefined => {
  const text = projectName(name)
  if (!text.trim()) return undefined
  const w = textWidth(text) + 5
  const h = 8
  return { x: GATE_SIGN.right - w, y: GATE_SIGN.ground - h - 3, w, h, text }
}

/** The project's name on a plank on two posts by the gate, painted as the plot signs are. */
export const projectSignSvg = (name: string): string => {
  const b = projectSign(name)
  if (!b) return ''
  const { x, y, w, h, text } = b
  const posts = [x + 2, x + w - 3].map(px => rect(px, y + h, 1, 3, WOOD.edge) + rect(px + 1, y + h, 0.5, 3, 'rgba(20,30,10,.3)')).join('')
  return rect(x + 1, y + h + 2.5, w - 1, 0.5, 'rgba(20,30,10,.3)') + posts +
    rect(x, y, w, h, WOOD.edge) +
    rect(x + 0.5, y + 0.5, w - 1, h - 1, WOOD.plank) +
    rect(x + 0.5, y + 0.5, w - 1, 0.5, WOOD.light) +
    textUse(x + 2.5, y + 1.5, text, WOOD.cream, WOOD.edge)
}

/** Where the board hangs: its right edge and top in world px. The narrow panel's crop hangs it inside the crop. */
export type BoardAnchor = { right: number; top: number }
export const BOARD_AT: BoardAnchor = { right: 174, top: 5 }

/** The board's size and place: hung from the trees at the top right. */
export const boardBox = (board: Board, anchor: BoardAnchor = BOARD_AT): { x: number; y: number; w: number; h: number } => {
  const rows = board.rows.map(([l, v]) => [fontText(l), fontText(v)] as const)
  const w = Math.max(textWidth('CRAB FARM') + 7, ...rows.map(([l, v]) => textWidth(l) + 4 + textWidth(v))) + 8
  const h = 9 + rows.length * 7 + 2 + (board.next ? 3 : 0)
  return { x: anchor.right - w, y: anchor.top, w, h }
}

/** The farm's notice board: a lamp (green working, red asking, amber at rest), the counts, a bar toward the next build. */
export const boardSvg = (board: Board, anchor: BoardAnchor = BOARD_AT): string => {
  const { x, y, w, h } = boardBox(board, anchor)
  const lamp = board.isAsking ? '#ff4a3d' : board.isWorking ? '#7cfc9a' : '#f5a524'
  const parts = [
    rect(x + 4, 0, 1, y, WOOD.edge), rect(x + w - 5, 0, 1, y, WOOD.edge),
    rect(x + 1, y + h, w - 1, 1, 'rgba(10,20,10,.3)'),
    rect(x, y, w, h, WOOD.edge),
    rect(x + 0.5, y + 0.5, w - 1, h - 1, WOOD.plank),
    rect(x + 0.5, y + 0.5, w - 1, 0.5, WOOD.light),
    ...Array.from({ length: Math.floor(h / 8) }, (_, k) => rect(x + 0.5, y + 8 * (k + 1), w - 1, 0.5, WOOD.seam)),
    textUse(x + 3, y + 2.5, 'CRAB FARM', '#ffd772', WOOD.edge),
    board.isWorking || board.isAsking ? `<circle cx="${n((x + w - 4.5) * HD)}" cy="${(y + 5) * HD}" r="${3 * HD}" fill="${lamp}" opacity=".3"/>` : '',
    rect(x + w - 6, y + 3.5, 3, 3, WOOD.edge), rect(x + w - 5.5, y + 4, 2, 2, lamp),
    rect(x + 3, y + 9, w - 6, 0.5, WOOD.seam),
  ]
  board.rows.forEach(([label, value], i) => {
    const ty = y + 11 + i * 7
    const v = fontText(value)
    parts.push(textUse(x + 3, ty, fontText(label), WOOD.cream, WOOD.edge))
    parts.push(textUse(x + w - 3 - textWidth(v), ty, v, '#fff4d6', WOOD.edge))
  })
  if (board.next) {
    // A thin bar toward the next build, filled by its progress.
    const by = y + h - 3.5
    const bw = w - 6
    const fill = Math.round(Math.max(0, Math.min(1, board.next.progress)) * bw * 2) / 2
    parts.push(rect(x + 3, by, bw, 1.5, INK))
    if (fill > 0) parts.push(rect(x + 3, by, fill, 1.5, '#ffd772'))
  }
  return parts.join('')
}
