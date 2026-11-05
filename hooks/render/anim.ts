// The animation recipe proven in a browser before it was written, generalised to any number of poses and props.
// Everything is CSS locked to the wall clock: loops are anchored to the epoch, one-shots to their beat-snapped start,
// both written as a negative animation-delay, so a freshly generated picture resumes exactly where the last one was.
// Every move steps on whole world pixels on the shared 125 ms beat. The attributes always hold the present, so with
// animation off (reduced motion, or a host drawing it still) the picture is still correct.

import { BEAT, beat, SPRITE_SIZES } from '../contracts'
import type { Actor, Ft, IconId, Leg, Model, Motion, Ms, Pose, Prop, Pt, SpriteId } from '../contracts'
import { HAT_DY } from '../art'
import { at } from '../model/jobs'
import { hash32 } from '../model/rng'

/** SVG user units per world px: the picture is drawn in clodfarm's HD units. */
export const HD = 2

const n3 = (v: number): string => String(+v.toFixed(3))
const mod = (a: number, m: number): number => ((a % m) + m) % m

/** The negative delay, in seconds, that puts a loop of `period` seconds at its phase now: (now/1000 + offset) mod period. */
export const loopDelay = (period: number, offset: number, now: Ms): number =>
  period > 0 ? +(-mod(now / 1000 + offset, period)).toFixed(3) || 0 : 0

// ---- shared classes ----

// The shared loops, each phase-locked to the epoch by a CSS variable the document sets from its own `now`
// (phaseVars), so every actor flips on the same beat. Walk frames swap every 4 beats and work frames every 8, as the
// terminal's do; breathing is a one-pixel hop on four slow periods, picked per actor so neighbours differ.
const WALK = 1
const WORK = 2
const BREATH = [2.4, 2.6, 2.8, 3.2] as const
const BUBBLE = 2.2

/** The `--` variables that lock the shared loops to the wall clock at `now`, for the document's root rule. */
export const phaseVars = (now: Ms): string =>
  `--f:${loopDelay(WALK, 0, now)}s;--k:${loopDelay(WORK, 0, now)}s;--u:${loopDelay(BUBBLE, 0, now)}s;` +
  BREATH.map((p, i) => `--b${i}:${loopDelay(p, 0, now)}s`).join(';')

/**
 * The CSS every picture carries once: frame swaps, breathing, the bubble's bob, and the reduced-motion switch.
 * Base styles show frame A only, so `animation:none` leaves a clean still. `still` motion has no CSS at all.
 */
export const sharedCss = (motion: Motion): string => {
  if (motion === 'still') return ''
  return '@keyframes sA{50%{opacity:0}}@keyframes sB{50%{opacity:1}}@keyframes br{50%{transform:translateY(-2px)}}' +
    '@keyframes bu{50%{transform:translateY(-2px)}}' +
    `.fA{animation:sA ${WALK}s step-end var(--f) infinite}.fB{opacity:0;animation:sB ${WALK}s step-end var(--f) infinite}` +
    `.kA{animation:sA ${WORK}s step-end var(--k) infinite}.kB{opacity:0;animation:sB ${WORK}s step-end var(--k) infinite}` +
    `.bb{animation:bu ${BUBBLE}s step-end var(--u) infinite}` +
    BREATH.map((p, i) => `.b${i}{animation:br ${p}s step-end var(--b${i}) infinite}`).join('') +
    '@media (prefers-reduced-motion:reduce){*{animation:none!important}}'
}

// ---- where an actor is ----

type Track = { start: number; end: number; leg: Leg }

// The legs as times within the actor's own animation: a loop's from 0, a one-shot's from its beat-snapped first start.
const tracksOf = (a: Actor): { tracks: Track[]; origin: number; dur: number } => {
  const legs = [...a.legs].sort((p, q) => p.t0 - q.t0)
  const origin = a.loop ? 0 : beat(legs[0]?.t0 ?? 0)
  const tracks = legs.map(leg => {
    const start = (a.loop ? leg.t0 : beat(leg.t0)) - origin
    return { start, end: start + leg.beats * BEAT, leg }
  })
  const dur = a.loop ? a.loop.period * 1000 : Math.max(0, ...tracks.map(t => t.end))
  return { tracks, origin, dur }
}

/** The time, in the actor's own legs' terms, that `now`/`ft` stand for: a loop's phase, else farm or wall time. */
export const actorTime = (a: Actor, now: Ms, ft: Ft): number => {
  const t = a.clock === 'farm' ? ft : now
  return a.loop ? -loopDelay(a.loop.period, a.loop.offset, t) * 1000 : t
}

const isMove = (leg: Leg): boolean => leg.from.x !== leg.to.x || leg.from.y !== leg.to.y

/**
 * Where a still picture puts an actor: its meaningful spot, the current leg's destination in its act pose. A crab
 * walking to water is drawn at the plot pouring, never mid-path.
 */
export const stillState = (a: Actor, t: number): { pt: Pt; pose: Pose; face: 1 | -1; prop?: Prop } => {
  const legs = [...a.legs].sort((p, q) => p.t0 - q.t0)
  let i = legs.findIndex((l, k) => l.t0 <= t && (legs[k + 1]?.t0 ?? Infinity) > t)
  if (i < 0) i = t < (legs[0]?.t0 ?? 0) ? 0 : legs.length - 1
  let leg = legs[i]
  // Past a walk, look ahead to where it is going and what it does there.
  while (leg && (leg.pose === 'walk' || isMove(leg)) && legs[i + 1]) leg = legs[++i]
  const pt = a.still ?? (leg ? leg.to : { x: 0, y: 0 })
  const pose = !leg || leg.pose === 'walk' || leg.pose === 'carry' ? 'stand' : leg.pose
  const face = leg ? at(legs, leg.t0 + leg.beats * BEAT - 1).face : 1
  return { pt, pose, face, ...(leg?.prop ? { prop: leg.prop } : {}) }
}

/** Where an actor is drawn at `now`: what its attributes hold, the picture with animation off. */
export const presentOf = (a: Actor, now: Ms, ft: Ft, motion: Motion): { pt: Pt; pose: Pose; face: 1 | -1; prop?: Prop } => {
  const t = actorTime(a, now, ft)
  if (motion === 'still' || a.legs.length === 0) return stillState(a, t)
  const p = at(a.legs, t)
  return { pt: p.pt, pose: p.pose, face: p.face, ...(p.prop ? { prop: p.prop } : {}) }
}

// ---- sprites ----

const size = (id: SpriteId): readonly [number, number] => SPRITE_SIZES[id] ?? [0, 0]

/** A sprite drawn with its feet (bottom centre) at the origin, through the document's symbol for it. */
const spriteUse = (use: (id: SpriteId) => string, id: SpriteId, cls = '', dx = 0, dy = 0): string => {
  const [w, h] = size(id)
  return `<use href="#${use(id)}" x="${n3((dx - w / 2) * HD)}" y="${n3((dy - h) * HD)}" width="${w * HD}" height="${h * HD}"${cls ? ` class="${cls}"` : ''}/>`
}

/** A sprite placed by its top-left corner in world px, as statics are. */
export const placeUse = (use: (id: SpriteId) => string, id: SpriteId, x: number, y: number, extra = ''): string => {
  const [w, h] = size(id)
  return `<use href="#${use(id)}" x="${n3(x * HD)}" y="${n3(y * HD)}" width="${w * HD}" height="${h * HD}"${extra}/>`
}

// Where each held prop sits, from the feet in world px (its bottom-left corner), and whether it turns with the
// holder: tools in the hand turn, loads carried overhead stay as they are.
const PROP_AT: Readonly<Record<Prop, { dx: number; dy: number; turns: boolean }>> = {
  hoe: { dx: 3, dy: -2, turns: true }, can: { dx: 4, dy: -3, turns: true }, bucket: { dx: 4, dy: -2, turns: true },
  magnifier: { dx: 5, dy: -7, turns: true }, sack: { dx: -3, dy: -16, turns: false }, crate: { dx: -3, dy: -16, turns: false },
  letter: { dx: 4, dy: -5, turns: true }, basket: { dx: -3, dy: -16, turns: false }, book: { dx: 3, dy: -6, turns: true },
  hammer: { dx: 5, dy: -6, turns: true }, lantern: { dx: 6, dy: -4, turns: true }, rod: { dx: 4, dy: -8, turns: true },
  crank: { dx: 5, dy: -2, turns: true }, umbrella: { dx: -6, dy: -16, turns: false },
}
const PROP_B: Partial<Record<Prop, SpriteId>> = { hoe: 'prop_hoe_2', can: 'prop_can_2', hammer: 'prop_hammer_2' }

const propSvg = (use: (id: SpriteId) => string, prop: Prop, isFrozen: boolean): string => {
  const { dx, dy } = PROP_AT[prop]
  const a = `prop_${prop}` as SpriteId
  const b = PROP_B[prop]
  const draw = (id: SpriteId, cls: string): string => {
    const [w, h] = size(id)
    return `<use href="#${use(id)}" x="${dx * HD}" y="${(dy - h) * HD}" width="${w * HD}" height="${h * HD}"${cls ? ` class="${cls}"` : ''}/>`
  }
  return !b || isFrozen ? draw(a, '') : draw(a, 'kA') + draw(b, 'kB')
}

// ---- the model's hat band ----

/** Each model's colour as a hue, carried on a crab's `hue` as on the minis: the band its hat wears while it drives. */
export const MODEL_HUE: Readonly<Record<Model, number>> = { haiku: 214, sonnet: 266, opus: 44, fable: 334 }
/** The minis' bands, light over mid over shadow (art-src palette.py: BLUE, PURPLE, GOLD, PINK). */
export const MODEL_BAND: Readonly<Record<Model, readonly [string, string, string]>> = {
  haiku: ['#64a6ff', '#3b7dd8', '#1557b2'], sonnet: ['#a474e0', '#7b4bb7', '#552591'],
  opus: ['#fbcb46', '#d2a21d', '#6b4a07'], fable: ['#ff98c8', '#e06f9f', '#ba4979'],
}
/** The model whose colour is nearest a hue. */
export const modelOfHue = (hue: number): Model => {
  const gap = (h: number): number => { const d = Math.abs(mod(hue, 360) - h); return Math.min(d, 360 - d) }
  return (Object.keys(MODEL_HUE) as Model[]).reduce((best, m) => (gap(MODEL_HUE[m]) < gap(MODEL_HUE[best]) ? m : best), 'opus')
}

// Where each hat's band runs, in HD px of its 32 × 16 cell: rows of [x, y, w] painted light, mid, shadow. The straw
// hat's red band, the beanie's cuff, the hood's trim and a ribbon round the flower crown.
const BANDS: Partial<Record<SpriteId, readonly (readonly [number, number, number])[]>> = {
  hat_straw: [[9, 9, 14], [9, 10, 14], [10, 11, 12]],
  hat_beanie: [[5, 12, 22], [5, 13, 22], [5, 14, 22]],
  hat_hood: [[7, 8, 18], [7, 9, 17]],
  hat_crown: [[9, 12, 14], [9, 13, 14]],
}

/** A hat's band in the model's colour, as rects over the hat whose top-left is at world (x, y). */
export const hatBand = (hat: SpriteId, hue: number, x: number, y: number): string => {
  const rows = BANDS[hat]
  if (!rows) return ''
  const model = modelOfHue(hue)
  // Gold on straw would vanish: opus's band there is its mid gold between two rows of its shadow.
  const own = MODEL_BAND[model]
  const band = model === 'opus' && hat === 'hat_straw' ? [own[2], own[1], own[2]] : own
  return `<g class="mb">${rows.map(([bx, by, bw], i) =>
    `<rect x="${n3(x * HD + bx)}" y="${n3(y * HD + by)}" width="${bw}" height="1" fill="${band[i] ?? band[1]}"/>`).join('')}</g>`
}

// ---- the recipe ----

type Key = { pct: number; css: string }

const pctOf = (ms: number, dur: number): number => (dur > 0 ? +((ms / dur) * 100).toFixed(3) : 0)

// A discrete track keeps only the keyframes where its value changes (step-end holds each until the next), plus a
// one-shot's 100% keyframe: without it `both` would hold the underlying attribute, the state at generation time.
const discrete = (marks: { pct: number; v: string }[], isLoop: boolean): Key[] => {
  const out: Key[] = []
  for (const m of marks) {
    const last = out[out.length - 1]
    if (last && last.pct === m.pct) { last.css = m.v; continue }
    if (last && last.css === m.v) continue
    out.push({ pct: m.pct, css: m.v })
  }
  const end = out[out.length - 1]
  if (!isLoop && end && end.pct < 100) out.push({ pct: 100, css: end.css })
  return out
}

const keyframes = (name: string, keys: Key[]): string => `@keyframes ${name}{${keys.map(k => `${k.pct}%{${k.css}}`).join('')}}`

/** The frame pair an actor draws a pose with, falling back to standing. */
const framesOf = (a: Actor, pose: Pose): readonly [SpriteId, SpriteId] | undefined =>
  a.frames[pose] ?? a.frames.stand ?? Object.values(a.frames)[0]

const breathOf = (a: Actor): string => `b${hash32(a.id) % BREATH.length}`

/** Poses drawn while moving: their frames swap at walking pace. */
const isStride = (p: Pose): boolean => p === 'walk' || p === 'carry'

/**
 * A move as keyframe marks that land on the same whole pixels at the same beats as `at`: full-speed steps, then a
 * last shorter step when the distance is not a multiple of the speed, then a hold for any beats left.
 */
const moveMarks = (k: Track): { ms: number; p: Pt; steps?: number }[] => {
  const { from, to, beats } = k.leg
  const dx = to.x - from.x, dy = to.y - from.y
  const len = Math.max(Math.abs(dx), Math.abs(dy))
  if (len === 0 || beats === 0) return [{ ms: k.start, p: from }, { ms: k.end, p: to }]
  const speed = Math.ceil(len / beats)
  const full = Math.floor(len / speed)
  const rest = len - full * speed
  const along = (d: number): Pt => ({ x: from.x + Math.round((dx * d) / len), y: from.y + Math.round((dy * d) / len) })
  const out: { ms: number; p: Pt; steps?: number }[] = [{ ms: k.start, p: from, steps: full }]
  let ms = k.start + full * BEAT
  if (rest > 0) { out.push({ ms, p: along(full * speed), steps: 1 }); ms += BEAT }
  out.push({ ms, p: to })
  if (ms < k.end) out.push({ ms: k.end, p: to })
  return out
}

/**
 * One actor's markup and its own CSS, and whether that CSS moves it (its bubble rides the same class). `freeze` draws
 * it where it stands now with no CSS at all and no frame swaps: the ask freeze, where farm time stands still.
 */
export const actorParts = (a: Actor, now: Ms, ft: Ft, motion: Motion, use: (id: SpriteId) => string, freeze = false): { css: string; svg: string; moves: boolean } => {
  const t = actorTime(a, now, ft)
  const frozen = motion === 'still' || freeze
  const { tracks, origin, dur } = tracksOf(a)
  const elapsed = a.loop ? t : t - origin
  const isOver = !a.loop && elapsed >= dur
  const animate = !frozen && a.legs.length > 0 && !isOver && dur > 0

  // The present: what the attributes hold.
  const { pt, pose, face, prop } = presentOf(a, now, ft, freeze && a.legs.length > 0 ? 'full' : motion)

  // What changes over the animation.
  const poses = animate ? [...new Set(tracks.map(k => k.leg.pose))] : [pose]
  if (!poses.includes(pose)) poses.push(pose)
  const props = animate ? [...new Set(tracks.map(k => k.leg.prop).filter((p): p is Prop => !!p))] : prop ? [prop] : []
  if (prop && !props.includes(prop)) props.push(prop)
  const moves = animate && tracks.some(k => isMove(k.leg))

  let css = ''
  if (animate) {
    const isLoop = !!a.loop
    const run = (name: string, tf: string): string =>
      `.${name}{animation:${name} ${n3(dur / 1000)}s ${tf} ${n3(-elapsed / 1000)}s ${isLoop ? 'infinite' : '1 both'}}`
    const base = isLoop ? 0 : origin
    // A loop whose legs start after 0 holds its state at 0 until they do.
    const lead = isLoop && (tracks[0]?.start ?? 0) > 0 ? at(a.legs, 0) : undefined
    const faceAt = (k: Track): number => at(a.legs, base + k.start).face

    if (moves) {
      const marks: { ms: number; p: Pt; steps?: number }[] = []
      if (lead) marks.push({ ms: 0, p: lead.pt })
      for (const k of tracks) marks.push(...moveMarks(k))
      if (isLoop) marks.push({ ms: dur, p: at(a.legs, 0).pt })
      const keys: Key[] = []
      for (const m of marks) {
        const pct = pctOf(Math.min(m.ms, dur), dur)
        const v = `transform:translate(${m.p.x * HD}px,${m.p.y * HD}px)${m.steps ? `;animation-timing-function:steps(${m.steps})` : ''}`
        const last = keys[keys.length - 1]
        if (last && last.pct === pct) last.css = v
        else keys.push({ pct, css: v })
      }
      if (!isLoop && (keys[keys.length - 1]?.pct ?? 0) < 100) {
        const end = tracks[tracks.length - 1]?.leg.to ?? pt
        keys.push({ pct: 100, css: `transform:translate(${end.x * HD}px,${end.y * HD}px)` })
      }
      css += keyframes(`${a.id}m`, keys) + run(`${a.id}m`, 'linear')
    }

    const track = (f: (k: Track) => string, f0: string | undefined): Key[] =>
      discrete([...(f0 !== undefined ? [{ pct: 0, v: f0 }] : []), ...tracks.map(k => ({ pct: pctOf(k.start, dur), v: f(k) }))], isLoop)

    const faces = track(k => `transform:scale(${faceAt(k)},1)`, lead ? `transform:scale(${lead.face},1)` : undefined)
    if (faces.some(k => k.css !== faces[0]?.css)) css += keyframes(`${a.id}f`, faces) + run(`${a.id}f`, 'step-end')

    if (poses.length > 1)
      poses.forEach((p, i) => {
        css += keyframes(`${a.id}p${i}`, track(k => `opacity:${k.leg.pose === p ? 1 : 0}`, lead ? `opacity:${lead.pose === p ? 1 : 0}` : undefined)) +
          run(`${a.id}p${i}`, 'step-end')
      })
    const propChanges = props.length > 1 || (props.length === 1 && tracks.some(k => k.leg.prop !== props[0]))
    if (propChanges)
      props.forEach((p, i) => {
        css += keyframes(`${a.id}r${i}`, track(k => `opacity:${k.leg.prop === p ? 1 : 0}`, lead ? `opacity:${lead.prop === p ? 1 : 0}` : undefined)) +
          run(`${a.id}r${i}`, 'step-end')
      })
  }
  const hasCss = (suffix: string): boolean => css.includes(`.${a.id}${suffix}{`)

  // The pose groups.
  const body = poses.map((p, i) => {
    const fr = framesOf(a, p)
    if (!fr) return ''
    const swap = !frozen && fr[0] !== fr[1]
    const cls = isStride(p) ? ['fA', 'fB'] : ['kA', 'kB']
    let inner = spriteUse(use, fr[0], swap ? cls[0] : '') + (swap ? spriteUse(use, fr[1], cls[1]) : '')
    if (a.hat && a.kind === 'crab') {
      const dy = -size(fr[0])[1] + size(a.hat)[1] + (HAT_DY[p] ?? 0)
      inner += spriteUse(use, a.hat, '', 0, dy)
      // The model's band rides on the hat, in the same group, so it moves and breathes with it.
      if (a.hue !== undefined) inner += hatBand(a.hat, a.hue, -size(a.hat)[0] / 2, dy - size(a.hat)[1])
    }
    // Everything that is not walking breathes, a one-pixel hop on a slow loop.
    const breathes = !frozen && !isStride(p) && (a.kind === 'crab' || a.kind === 'animal' || a.kind === 'mini')
    if (breathes) inner = `<g class="${breathOf(a)}">${inner}</g>`
    const tracked = hasCss(`p${i}`)
    const attrs = `${tracked ? ` class="${a.id}p${i}"` : ''}${p === pose ? '' : ' opacity="0"'}`
    return attrs ? `<g${attrs}>${inner}</g>` : inner
  }).join('')

  const propGroups = (turns: boolean): string => props.map((p, i) => {
    if (PROP_AT[p].turns !== turns) return ''
    const tracked = hasCss(`r${i}`)
    const attrs = `${tracked ? ` class="${a.id}r${i}"` : ''}${p === prop ? '' : ' opacity="0"'}`
    const inner = propSvg(use, p, frozen)
    return attrs ? `<g${attrs}>${inner}</g>` : inner
  }).join('')

  const tint = a.hue !== undefined && a.kind !== 'mini' && a.kind !== 'crab' ? ` style="filter:hue-rotate(${Math.round(a.hue)}deg)"` : ''
  const facer = hasCss('f') || face !== 1
    ? `<g${hasCss('f') ? ` class="${a.id}f"` : ''} transform="scale(${face} 1)"${tint}>${body}${propGroups(true)}</g>`
    : tint ? `<g${tint}>${body}${propGroups(true)}</g>` : body + propGroups(true)
  const mover = `<g${hasCss('m') ? ` class="${a.id}m"` : ''} transform="translate(${pt.x * HD} ${pt.y * HD})">${facer}${propGroups(false)}</g>`
  return { css, svg: mover, moves: hasCss('m') }
}

/**
 * One actor as SVG: a mover <g> (translate) → a facer <g> (flip about the feet) → one <g> per pose used, each with
 * its frames A/B on the shared classes. Its keyframes ride along in a <style>. A one-shot past its end, a still
 * motion, or an actor that never changes is drawn with no CSS of its own, in the state its attributes hold.
 */
export const actorSvg = (a: Actor, now: Ms, ft: Ft, motion: Motion, use: (id: SpriteId) => string): string => {
  const { css, svg } = actorParts(a, now, ft, motion, use)
  return (css ? `<style>${css}</style>` : '') + svg
}

// ---- bubbles ----

const INK = '#1c1a24'
const rect = (x: number, y: number, w: number, h: number, fill: string): string =>
  `<rect x="${x * HD}" y="${y * HD}" width="${w * HD}" height="${h * HD}" fill="${fill}"/>`

/** A pixel speech bubble, its tail's tip at the origin: notched corners, an inked edge, a stepped tail. */
export const bubbleFrame = (use: (id: SpriteId) => string, icon: IconId, isAlert: boolean): string => {
  const w = 12
  const h = 10
  const x = -w / 2
  const y = -h - 2
  const fill = isAlert ? '#ffe7a8' : '#fbfaf5'
  return rect(x + 1, y, w - 2, h, INK) + rect(x, y + 1, w, h - 2, INK) + rect(x + 1, y + 1, w - 2, h - 2, fill) +
    rect(-2, y + h - 1, 1, 2, INK) + rect(1, y + h - 1, 1, 2, INK) + rect(-1, y + h - 1, 2, 2, fill) + rect(-1, y + h + 1, 2, 1, INK) +
    placeUse(use, `icon_${icon}` as SpriteId, x + 2, y + 1)
}

/**
 * An actor's bubble, drawn in the picture's top layer so night and weather never hide it. It rides the same mover
 * class as the actor's body, so it follows without CSS of its own. Asking and waiting bubbles hold still.
 */
export const bubbleSvg = (a: Actor, now: Ms, ft: Ft, motion: Motion, use: (id: SpriteId) => string, moverCss = true, freeze = false): string => {
  if (!a.bubble) return ''
  const { pt, pose } = presentOf(a, now, ft, freeze && a.legs.length > 0 ? 'full' : motion)
  const fr = framesOf(a, pose)
  // Over the head: a crab that sits or sleeps is lower, its hat lowered by HAT_DY, and so is its bubble.
  const top = (fr ? size(fr[0])[1] : 18) - (a.hat && a.kind === 'crab' ? HAT_DY[pose] ?? 0 : 0)
  const isAlert = a.isAsking === true || a.bubble === 'alert' || a.bubble === 'ask'
  const bobs = motion !== 'still' && !freeze && !isAlert
  const frame = bubbleFrame(use, a.bubble, isAlert)
  // The bob animates a transform of its own, so it sits inside the group that lifts the bubble over the head.
  const inner = `<g transform="translate(0 ${-(top + 1) * HD})">${bobs ? `<g class="bb">${frame}</g>` : frame}</g>`
  return `<g${moverCss ? ` class="${a.id}m"` : ''} transform="translate(${pt.x * HD} ${pt.y * HD})">${inner}</g>`
}
