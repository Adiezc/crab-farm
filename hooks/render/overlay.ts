// The hover cards: a second, interactive SVG laid exactly over the farm, the same size and viewBox, that draws nothing
// until the pointer rests on a plot, a helper strip, a build, the scaffold or the board. Then a cream card shows what
// it is doing. Only what the app's sanitizer keeps: rect, text, title, style, g; no image, no outside href.
// It depends on state alone, never on the time, so a heartbeat redraw makes the same bytes and the frame survives.

import type { DrawList, Zone } from '../contracts'
import { HD } from './anim'

const VW = 180 * HD
const VH = 250 * HD
const NARROW = { x: 22 * HD, y: 20 * HD, w: 136 * HD, h: 216 * HD } as const
/** The most the overlay may weigh: zones past it are left out. */
export const OVERLAY_MAX = 20_000

const FONT = 9
const LINE = 11
const CHAR = 5.45
const PAD = 4

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const n2 = (v: number): string => String(+v.toFixed(1))

/** A card for one zone: its hit area, a native tooltip, and the card itself, hidden until hovered. */
const zoneSvg = (z: Zone, frame: { x: number; y: number; w: number; h: number }): string => {
  const [zx, zy, zw, zh] = z.rect.map(v => v * HD) as [number, number, number, number]
  const lines = z.lines.slice(0, 4).filter(Boolean)
  if (!lines.length) return ''
  const w = Math.min(frame.w - 4, Math.ceil(Math.max(...lines.map(l => l.length)) * CHAR + PAD * 2))
  const h = lines.length * LINE + PAD * 2 - 2
  // Below its zone in the upper half of the picture, above it in the lower half; always inside the frame.
  const isLower = zy + zh / 2 > frame.y + frame.h / 2
  let y = isLower ? zy - h - 3 : zy + zh + 3
  y = Math.min(Math.max(y, frame.y + 2), frame.y + frame.h - h - 2)
  let x = zx + zw / 2 - w / 2
  x = Math.min(Math.max(x, frame.x + 2), frame.x + frame.w - w - 2)
  const text = lines.map((l, i) => `<text x="${n2(x + PAD)}" y="${n2(y + PAD + FONT - 1 + i * LINE)}">${esc(l)}</text>`).join('')
  return `<g class="z"><rect class="h" x="${n2(zx)}" y="${n2(zy)}" width="${n2(zw)}" height="${n2(zh)}"/>` +
    `<title>${esc(lines.join(' · '))}</title>` +
    `<g class="c"><rect x="${n2(x)}" y="${n2(y)}" width="${n2(w)}" height="${n2(h)}"/>${text}</g></g>`
}

let memo: { key: string; svg: string } | undefined

/**
 * The hover overlay for a draw list: one zone per plot, helper strip, build, the next build and the board. The same
 * zones make the same bytes, whatever the time.
 */
export const hoverSvg = (dl: DrawList, view?: { narrow: boolean }): string => {
  const narrow = view?.narrow === true
  const key = `${narrow ? 'n' : 'w'}${JSON.stringify(dl.zones)}`
  if (memo?.key === key) return memo.svg
  const frame = narrow ? NARROW : { x: 0, y: 0, w: VW, h: VH }
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${frame.x} ${frame.y} ${frame.w} ${frame.h}" ` +
    `width="${narrow ? 360 : VW}" height="${narrow ? Math.round((360 * frame.h) / frame.w) : VH}">` +
    `<style>.h{fill:#fff;fill-opacity:0}.c{visibility:hidden}.z:hover .c{visibility:visible}` +
    `.c rect{fill:#fbf3dc;stroke:#1c1a24;stroke-width:1}text{font:${FONT}px ui-monospace,monospace;fill:#1c1a24}</style>`
  let body = ''
  for (const z of dl.zones) {
    const part = zoneSvg(z, frame)
    if (head.length + body.length + part.length + 6 > OVERLAY_MAX) break
    body += part
  }
  const svg = `${head}${body}</svg>`
  memo = { key, svg }
  return svg
}
