// A draw list as one SVG for the desktop app, VS Code and mobile: the meadow, then everything in it by the depth of
// its feet, the hedge in front, the weather and the light of the hour, and the signs, bubbles and board on top.
// Sprites are symbols cut from one atlas image, only the ones this picture uses. Pure.
// A governor keeps the document under 100,000 characters by dropping detail one level at a time (spec 4.3).

import { SPRITE_SIZES } from '../contracts'
import type { Actor, DrawList, Motion, SpriteId, Static } from '../contracts'
import type { Fx } from '../../types'
import { ATLAS, ATLAS_SIZE, BG, FG, SYMBOLS, WORLD } from '../art'
import { moonPhase } from '../model/clock'
import { PLOTS, PLOT_H, PLOT_W } from '../model/layout'
import { HD, actorParts, bubbleSvg, loopDelay, phaseVars, placeUse, presentOf, sharedCss } from './anim'
import { BOARD_AT, GLYPHS, boardSvg, glyphDefs, glyphId, signSvg, textUse } from './text'
import type { BoardAnchor } from './text'
import { FX_MS } from './scene'

/** The level of detail the governor aims under, and the size it never passes. */
export const TARGET = 100_000
export const CAP = 131_072

const VW = WORLD.W * HD
const VH = WORLD.H * HD
/** The narrow panel's crop (world x 22–158, y 20–236), and where the board hangs inside it. */
const NARROW = { x: 22, y: 20, w: 136, h: 216 } as const
const NARROW_BOARD: BoardAnchor = { right: 156, top: 21 }

const n2 = (v: number): string => String(+v.toFixed(2))
const box = (x: number, y: number, w: number, h: number, fill: string, extra = ''): string =>
  `<rect x="${n2(x * HD)}" y="${n2(y * HD)}" width="${n2(w * HD)}" height="${n2(h * HD)}" fill="${fill}"${extra}/>`

// ---- the light of the hour ----

const WASH: Readonly<Record<string, string>> = {
  night: 'rgba(20,28,70,.46)', predawn: 'rgba(60,60,120,.30)', sunrise: 'rgba(255,179,138,.14)',
  golden: 'rgba(255,200,120,.10)', sunset: 'rgba(255,138,61,.16)', dusk: 'rgba(70,50,110,.30)',
}
const isDark = (sky: string): boolean => sky === 'night' || sky === 'predawn' || sky === 'dusk'

// Stars over the tree line and the moon above the barn, both where the meadow's top edge is darkest.
const STARS = [[6, 3], [19, 8], [31, 2], [44, 6], [63, 3], [79, 9], [92, 4], [104, 2], [8, 14], [27, 15], [70, 15], [86, 18],
  [101, 12], [3, 24], [160, 64], [172, 72], [166, 98], [176, 120], [4, 60], [12, 46], [176, 150], [6, 190]] as const
const FIREFLIES = [[38, 96], [150, 100], [96, 128], [44, 166], [152, 170], [100, 206], [70, 84], [138, 74]] as const

// The barn's loft window and its lantern, lit at dusk and after dark (1.2's).
const BARN_PANES = [[52.5, 37, 3, 6], [56.5, 37, 3.5, 6]] as const
const barnLights = (isNight: boolean): string =>
  `<g opacity="${isNight ? 1 : 0.6}"><circle cx="${56.25 * HD}" cy="${40 * HD}" r="${6 * HD}" fill="#ffc861" opacity=".1"/>` +
  `<circle cx="${68 * HD}" cy="${51.5 * HD}" r="${3.5 * HD}" fill="#ffc861" opacity=".18"/>` +
  BARN_PANES.map(([x, y, w, h]) => box(x, y, w, h, '#ffd77a', ' opacity=".75"')).join('') + box(67, 50.25, 2, 2.5, '#fff1b8') + '</g>'

/** The moon in its real phase: a pale disc and a shadow disc slid across it. */
const moonSvg = (phase: number): string => {
  const cx = 28 * HD, cy = 14 * HD, r = 4 * HD
  // 0 new, .5 full: the shadow slides from over the disc, off one side, and back over from the other.
  const off = phase < 0.5 ? (1 - phase * 2) * 2 * r : (phase * 2 - 1) * -2 * r
  return `<circle cx="${cx}" cy="${cy}" r="${r + 3}" fill="#fff6d0" opacity=".12"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="#f4eccb"/>` +
    (Math.abs(off) < 2 * r ? `<circle cx="${n2(cx + off)}" cy="${cy}" r="${r}" fill="#1b2147" opacity=".85"/>` : '')
}

/** One season's tint on the meadow: autumn ochre, winter cold and pale. Spring and summer cost nothing. */
const SEASON_MATRIX: Readonly<Record<string, string>> = {
  autumn: '1.06 .04 0 0 .02 .02 .93 0 0 0 0 0 .9 0 0 0 0 0 1 0',
  winter: '.82 .14 .04 0 .04 .06 .86 .06 0 .05 .06 .1 .86 0 .09 0 0 0 1 0',
}
const DRY = '.5 .45 .1 0 .06 .38 .4 .1 0 .03 .2 .22 .06 0 0 0 0 0 1 0'
// Droop: the dry matrix at 30%, so a stopped step's crops sag and recover, never turning to straw.
const DROOP = DRY.split(' ').map((v, i) => n2(0.3 * Number(v) + 0.7 * ([0, 6, 12, 18].includes(i) ? 1 : 0))).join(' ')

// ---- weather ----

const weatherSvg = (dl: DrawList, isLive: boolean, css: string[]): { defs: string; svg: string } => {
  const w = dl.weather
  if (!w) return { defs: '', svg: '' }
  if (w.kind === 'rain' || w.kind === 'snow') {
    const isRain = w.kind === 'rain'
    const tile = isRain
      ? box(2, 1, 0.5, 2.5, '#cfe3ff', ' opacity=".55"') + box(10, 9, 0.5, 2.5, '#cfe3ff', ' opacity=".5"') + box(6, 13, 0.5, 2, '#cfe3ff', ' opacity=".4"')
      : box(3, 2, 1, 1, '#fff') + box(11, 7, 1, 1, '#fff', ' opacity=".85"') + box(6, 13, 1, 1, '#fff', ' opacity=".7"')
    const period = isRain ? 0.5 : 4
    if (isLive) css.push(`@keyframes wf{to{transform:translate(${isRain ? -4 : 8}px,32px)}}.wf{animation:wf ${period}s steps(${isRain ? 4 : 16}) ${loopDelay(period, 0, dl.now)}s infinite}`)
    return {
      defs: `<pattern id="wp" width="32" height="32" patternUnits="userSpaceOnUse">${tile}</pattern>`,
      svg: (isRain ? `<rect width="${VW}" height="${VH}" fill="rgba(40,52,78,.16)"/>` : '') +
        `<rect class="wf" x="-32" y="-32" width="${VW + 64}" height="${VH + 64}" fill="url(#wp)"/>`,
    }
  }
  if (w.kind === 'fog') return { defs: '<linearGradient id="fg" x2="0" y2="1"><stop offset="0" stop-color="#eef2f0" stop-opacity=".55"/><stop offset="1" stop-color="#eef2f0" stop-opacity=".18"/></linearGradient>', svg: `<rect width="${VW}" height="${VH}" fill="url(#fg)"/>` }
  if (w.kind === 'cloudy') {
    // Two cloud shadows cross the field in 40 s, every 3½ minutes, a minute and a half apart.
    if (isLive) css.push(`@keyframes cs{0%{transform:translateX(-120px)}19%,100%{transform:translateX(${VW + 120}px)}}` +
      `.cs{animation:cs 210s linear infinite}.cs0{animation-delay:${loopDelay(210, 0, dl.now)}s}.cs1{animation-delay:${loopDelay(210, 95, dl.now)}s}`)
    const cloud = (k: number, y: number): string =>
      `<g class="cs cs${k}"${isLive ? '' : ' opacity="0"'}><ellipse cx="0" cy="${y}" rx="70" ry="22" fill="rgba(20,30,40,.13)"/><ellipse cx="40" cy="${y + 8}" rx="46" ry="16" fill="rgba(20,30,40,.1)"/></g>`
    return { defs: '', svg: `<rect width="${VW}" height="${VH}" fill="rgba(60,70,80,.06)"/>` + cloud(0, 220) + cloud(1, 380) }
  }
  return { defs: '', svg: '' }
}

const rainbowSvg = (): string =>
  ['#ff6b6b', '#ffb36b', '#fff27a', '#7be08a', '#6bb8ff', '#a98bff'].map((c, i) =>
    `<path d="M${-20 + i * 4} 200A${200 - i * 4} ${170 - i * 4} 0 0 1 ${380 - i * 4} 200" fill="none" stroke="${c}" stroke-width="4" opacity=".16"/>`).join('')

// ---- effects ----

const fxSvg = (f: Fx, dl: DrawList, use: (id: SpriteId) => string, css: string[], isLive: boolean, k: number): string => {
  const age = dl.ft - f.t0
  const dur = FX_MS[f.kind] ?? 2_000
  if (age < 0 || age >= dur) return ''
  const id = `x${k}`
  const run = (keys: string): void => { css.push(`@keyframes ${id}{${keys}}.${id}{animation:${id} ${dur / 1000}s linear ${n2(-age / 1000)}s 1 both}`) }
  const at = (sprite: SpriteId, dx = 0, dy = 0): string => {
    const [w, h] = SPRITE_SIZES[sprite]
    return placeUse(use, sprite, f.at.x - w / 2 + dx, f.at.y - h + dy)
  }
  const swap = (a: SpriteId, b: SpriteId): string => (isLive ? at(a).replace('/>', ' class="fA"/>') + at(b).replace('/>', ' class="fB"/>') : at(a))
  if (f.kind === 'puddle') {
    if (isLive) run(`0%{opacity:.85}80%{opacity:.6}100%{opacity:0}`)
    return `<g${isLive ? ` class="${id}"` : ''} opacity="${n2(0.85 * (1 - age / dur))}">${at('puddle', 0, 2)}</g>`
  }
  if (!isLive) return ''
  if (f.kind === 'coins') {
    // The coins float up a pixel a beat, then fade.
    run(`0%{transform:translateY(0);animation-timing-function:steps(10)}62%{opacity:1}100%{transform:translateY(-20px);opacity:0}`)
    const text = `+${f.value ?? 0}`
    return `<g class="${id}">${at('coin_0', -5, -18)}${textUse(f.at.x - 1, f.at.y - 26, text, '#ffe27a', '#5a3a10')}</g>`
  }
  run('0%,70%{opacity:1}100%{opacity:0}')
  const pair: Readonly<Record<string, readonly [SpriteId, SpriteId]>> = {
    sparkle: ['sparkle_0', 'sparkle_1'], golden: ['sparkle_0', 'sparkle_1'], confetti: ['confetti_0', 'confetti_1'], compost: ['dust_0', 'dust_1'],
  }
  const [a, b] = pair[f.kind] ?? ['sparkle_0', 'sparkle_1']
  return `<g class="${id}">${swap(a, b)}</g>`
}

// ---- the governor's levels ----

const isMoving = (a: Actor): boolean => a.legs.some(l => l.from.x !== l.to.x || l.from.y !== l.to.y)

/** An actor drawn in place: where it is now, its frames still swapping, its walking dropped. */
const inPlace = (a: Actor, dl: DrawList): Actor => {
  const p = presentOf(a, dl.now, dl.ft, dl.motion)
  const frames = a.frames[p.pose] ? { ...a.frames, stand: a.frames[p.pose] as readonly [SpriteId, SpriteId] } : a.frames
  const { loop: _loop, ...rest } = a
  void _loop
  return { ...rest, frames, legs: [], still: p.pt }
}

/** The plot a helper works on, from its id (`h<plot><n>`). */
const helperPlot = (a: Actor): number => (a.kind === 'mini' && a.id[0] === 'h' ? Number(a.id[1] ?? 0) : -1)

type Drawn = { actors: Actor[]; extra: Map<number, number>; motion: Motion; stars: number; fireflies: boolean }

/** What a level of detail keeps (spec 4.3): each level drops more, the last draws everything still. */
const detail = (dl: DrawList, lod: number): Drawn => {
  let actors = dl.actors
  const extra = new Map<number, number>()
  if (lod >= 1) actors = actors.filter(a => a.kind !== 'event')
  if (lod >= 2) actors = actors.map(a => ((a.kind === 'critter' || a.kind === 'animal') && isMoving(a) ? inPlace(a, dl) : a))
  if (lod >= 3) {
    actors = actors.filter(a => !(a.kind === 'mini' && !a.loop && helperPlot(a) >= 0 && a.legs.some(l => l.pose === 'carry')))
    actors = actors.map(a => (a.kind === 'crab' && a.id[0] === 'i' ? inPlace(a, dl) : a.kind === 'mini' && a.loop ? inPlace(a, dl) : a))
  }
  // Helpers fold to three a plot (one from level 4), the rest a +N beside them.
  const perPlot = lod >= 4 ? 1 : 3
  const seen = new Map<number, number>()
  actors = actors.filter(a => {
    const p = helperPlot(a)
    if (p < 0) return true
    const n = (seen.get(p) ?? 0) + 1
    seen.set(p, n)
    if (n <= perPlot) return true
    extra.set(p, (extra.get(p) ?? 0) + 1)
    return false
  })
  return { actors, extra, motion: lod >= 5 ? 'still' : dl.motion, stars: lod >= 1 ? 2 : 1, fireflies: lod < 1 }
}

// ---- the document ----

type Item = { y: number; svg: string }

const build = (dl: DrawList, lod: number, narrow: boolean): string => {
  const d = detail(dl, lod)
  const motion = d.motion
  const isLive = motion !== 'still'
  const isCalm = motion === 'calm'
  // Sprites become symbols the first time they are drawn; only those are defined.
  const used = new Map<SpriteId, string>()
  const use = (id: SpriteId): string => {
    let s = used.get(id)
    if (!s) { s = `i${used.size.toString(36)}`; used.set(id, s) }
    return s
  }
  const css: string[] = []
  const items: Item[] = []

  // Statics, in place.
  for (const st of dl.statics) items.push({ y: st.at.y + (SPRITE_SIZES[st.sprite]?.[1] ?? 0), svg: staticSvg(st, use, isLive, dl, css) })

  // Actors: the farm's own stand still while Claude asks; the wall clock's carry on.
  const tops: string[] = []
  d.actors.forEach((a0, i) => {
    const a = { ...a0, id: `${/^[a-z]/i.test(a0.id) ? (a0.id[0] as string).toLowerCase() : 'a'}${i}` }
    const freeze = dl.board.isAsking && a.clock === 'farm'
    const parts = actorParts(a, dl.now, dl.ft, motion, use, freeze)
    if (parts.css) css.push(parts.css)
    const p = presentOf(a, dl.now, dl.ft, freeze ? 'full' : motion)
    items.push({ y: p.pt.y, svg: parts.svg })
    if (a.bubble) tops.push(bubbleSvg(a, dl.now, dl.ft, motion, use, parts.moves, freeze))
  })
  items.sort((p, q) => p.y - q.y)

  // The weather and the light of the hour, over the world and under the signs.
  const weather = weatherSvg(dl, isLive, css)
  const sky: string[] = []
  if (dl.events.includes('rainbow') && !isDark(dl.sky)) sky.push(rainbowSvg())
  const wash = WASH[dl.sky]
  if (wash) sky.push(`<rect width="${VW}" height="${VH}" fill="${wash}"/>`)
  if (isDark(dl.sky) || dl.sky === 'sunset') sky.push(barnLights(dl.sky === 'night'))
  if (dl.sky === 'night' || dl.sky === 'predawn') {
    const stars = STARS.filter((_, k) => k % d.stars === 0)
    if (isLive) css.push('@keyframes tw{50%{opacity:.25}}.tw{animation:tw 3s step-end infinite}' +
      [0, 1, 2].map(k => `.t${k}{animation-delay:${loopDelay(3, k, dl.now)}s}`).join(''))
    sky.push(`<g fill="#fff8d8"${dl.sky === 'predawn' ? ' opacity=".5"' : ''}>` + stars.map(([x, y], k) =>
      box(x, y, 1, 1, '#fff8d8', isLive ? ` class="tw t${k % 3}"` : '')).join('') + '</g>')
    if (dl.sky === 'night') sky.push(moonSvg(moonPhase(dl.now)))
  }
  if (d.fireflies && dl.events.includes('fireflies') && (dl.sky === 'night' || dl.sky === 'dusk')) {
    if (isLive && !isCalm) css.push(`@keyframes ff{40%,60%{opacity:1}}.ff{opacity:0;animation:ff 3.2s step-end infinite}` +
      FIREFLIES.map((_, k) => `.ff${k}{animation-delay:${loopDelay(3.2, k * 0.83, dl.now)}s}`).join(''))
    sky.push(FIREFLIES.map(([x, y], k) =>
      `<g class="ff ff${k}"${isLive && !isCalm ? '' : ' opacity=".7"'}><circle cx="${x * HD}" cy="${y * HD}" r="${2.5 * HD}" fill="#e9ff8a" opacity=".22"/>${box(x - 0.5, y - 0.5, 1, 1, '#f4ffb0')}</g>`).join(''))
  }

  // On top: signs, helpers beyond those drawn, effects, bubbles, the board.
  const ui: string[] = []
  for (const s of dl.signs) {
    const p = PLOTS[s.plot]
    if (p) ui.push(signSvg(s, { x: p.x, y: p.y, w: PLOT_W, h: PLOT_H }))
  }
  for (const [plot, n] of d.extra) {
    const p = PLOTS[plot]
    if (p) ui.push(textUse(p.x + 3 + (lod >= 4 ? 1 : 3) * 9 + 1, p.y - 6, `+${n}`, '#fff4d6', '#1c1a24'))
  }
  dl.fx.forEach((f, k) => ui.push(fxSvg(f, dl, use, css, isLive && !(dl.board.isAsking), k)))
  ui.push(...tops)
  ui.push(boardSvg(dl.board, narrow ? NARROW_BOARD : BOARD_AT))
  const top = ui.join('')

  // Only the glyphs and symbols this picture uses.
  const glyphs = new Set<string>()
  for (const m of top.matchAll(/href="#(g[^"]+)"/g)) glyphs.add(m[1] as string)
  const glyphPaths = glyphDefs(Object.keys(GLYPHS).filter(ch => glyphs.has(glyphId(ch))).join(''))
  const symbols = [...used].map(([id, s]) => {
    const r = SYMBOLS[id]
    return r ? `<symbol id="${s}" viewBox="${r.join(' ')}"><use href="#A"/></symbol>` : ''
  }).join('')
  const season = SEASON_MATRIX[dl.season]
  const defs = `<defs><image id="A" href="${ATLAS}" width="${ATLAS_SIZE.w}" height="${ATLAS_SIZE.h}"/>${symbols}${glyphPaths}` +
    '<radialGradient id="vig" cx="50%" cy="52%" r="70%"><stop offset="62%" stop-color="#0c140a" stop-opacity="0"/><stop offset="100%" stop-color="#0c140a" stop-opacity=".38"/></radialGradient>' +
    (season ? `<filter id="sn" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${season}"/></filter>` : '') +
    (dl.statics.some(s => s.filter === 'dry') ? `<filter id="dry" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${DRY}"/></filter>` : '') +
    (dl.statics.some(s => s.filter === 'droop') ? `<filter id="dr" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${DROOP}"/></filter>` : '') +
    weather.defs + '</defs>'

  const style = `<style>svg{image-rendering:pixelated${isLive ? `;${phaseVars(dl.now)}` : ''}}${sharedCss(motion)}${css.join('')}</style>`
  const view = narrow
    ? `viewBox="${NARROW.x * HD} ${NARROW.y * HD} ${NARROW.w * HD} ${NARROW.h * HD}" width="360" height="${Math.round((360 * NARROW.h) / NARROW.w)}"`
    : `viewBox="0 0 ${VW} ${VH}" width="${VW}" height="${VH}"`
  return `<svg xmlns="http://www.w3.org/2000/svg" ${view}>${style}${defs}` +
    `<image href="${BG}" width="${VW}" height="${VH}"${season ? ' filter="url(#sn)"' : ''}/>` +
    items.map(it => it.svg).join('') +
    `<image href="${FG}" y="${WORLD.fgY * HD}" width="${VW}" height="${VH - WORLD.fgY * HD}"/>` +
    weather.svg + sky.join('') + `<rect width="${VW}" height="${VH}" fill="url(#vig)"/>` +
    `<g shape-rendering="crispEdges">${top}</g></svg>`
}

/** A static sprite: the windmill's blades turn on a slow loop, the rest stand. */
const staticSvg = (st: Static, use: (id: SpriteId) => string, isLive: boolean, dl: DrawList, css: string[]): string => {
  const [w, h] = SPRITE_SIZES[st.sprite] ?? [0, 0]
  const attrs = (st.opacity !== undefined ? ` opacity="${st.opacity}"` : '') +
    (st.filter === 'dry' ? ' filter="url(#dry)"' : st.filter === 'droop' ? ' filter="url(#dr)"' : '')
  if (st.sprite === 'blades') {
    const cx = (st.at.x + w / 2) * HD, cy = (st.at.y + h / 2) * HD
    if (isLive) css.push(`@keyframes bl{to{transform:rotate(360deg)}}.bl{animation:bl 8s steps(8) ${loopDelay(8, 0, dl.now)}s infinite}`)
    return `<g transform="translate(${n2(cx)} ${n2(cy)})"${attrs}><g${isLive ? ' class="bl"' : ''}>${placeUse(use, 'blades', -w / 2, -h / 2)}</g></g>`
  }
  if (st.flip) return `<g transform="scale(-1 1)"${attrs}>${placeUse(use, st.sprite, -st.at.x - w, st.at.y)}</g>`
  return placeUse(use, st.sprite, st.at.x, st.at.y, attrs)
}

/**
 * The farm as one SVG, under the target size: built at the list's level of detail, measured, and built again a
 * level simpler while it is over. `narrow` crops to the play area for VS Code's narrow panel.
 */
export const farmSvg = (dl: DrawList, view?: { narrow: boolean }): { svg: string; lod: number } => {
  const narrow = view?.narrow === true
  let lod = Math.max(0, Math.min(5, dl.lod))
  for (;;) {
    const svg = build(dl, lod, narrow)
    if (svg.length <= TARGET || lod >= 5) return { svg, lod }
    lod++
  }
}

