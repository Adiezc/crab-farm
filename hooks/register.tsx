import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Critter, Farm, Farmer, Task } from '../types'
import { BG, FG, ICONS, LAYOUT, SPRITES, WORLD } from './art'

// A purely visual farm in clodfarm's look: it only listens to what Claude already does and draws it.
// No model calls, no tools for the model, so it costs nothing to run.
// Every task of this session is a Claude with its own plot; the subagents spawned for it are the little helpers on it.
// A task starts where the app's task list says one does (scope first_task or new_task); a continuation stays with the current Claude.
// Light by design: state is written only when the drawing would change, and only the busy Claude animates.

const PANE = 'crab-farm'
const TITLE = 'Crab Farm'
const MAX_CRITTERS = 24
const MAX_TASKS_KEPT = 24
const MAX_HELPERS_SHOWN = 3
// How wide a sign's words may run, in world pixels: from the plot's edge to the next Claude's bubble.
const SIGN_TEXT_W = 33

const farm = atom({ plugin: 'crab-farm', key: 'farm' } as const, {
  isWorking: false,
  turnId: '',
  turnText: '',
  toolsAtTurnStart: 0,
  taskCount: 0,
  harvest: 0,
} as Farm)
const tasks = atom({ plugin: 'crab-farm', key: 'tasks' } as const, [] as Task[])
const critters = atom({ plugin: 'crab-farm', key: 'critters' } as const, [] as Critter[])

// --- drawing ------------------------------------------------------------
// Everything is placed in clodfarm's HD pixels (world pixels × 2) on the baked meadow.

const HD = WORLD.HD
const VW = WORLD.W * HD
const VH = WORLD.H * HD
const INK = '#1c1a24'
const WOOD = { edge: '#3b2416', plank: '#9b6b3f', seam: '#7d532f', light: '#c08a55', gold: '#e8b85c', goldLight: '#f6d58c', cream: '#f6e7c1' }

type Plot = { x: number; y: number; w: number; h: number }
type Stage = 'none' | 'seed' | 'sprout' | 'grow' | 'ripe' | 'wilt'
type Sky = 'day' | 'dawn' | 'dusk' | 'night'

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}.` : s)

const modelKey = (model: string): 'haiku' | 'sonnet' | 'opus' | 'fable' => {
  const m = model.toLowerCase()
  return m.includes('haiku') ? 'haiku' : m.includes('sonnet') ? 'sonnet' : m.includes('fable') ? 'fable' : 'opus'
}

// One sprite at world coordinates; `cls` lets CSS swap frames.
const img = (key: string, x: number, y: number, w: number, h: number, cls = ''): string =>
  `<image href="${SPRITES[key] ?? ''}" x="${x * HD}" y="${y * HD}" width="${w * HD}" height="${h * HD}"${cls ? ` class="${cls}"` : ''}/>`

// Two frames that alternate, as clodfarm animates its critters.
const flip = (a: string, b: string, x: number, y: number, w: number, h: number, delay = 0): string =>
  `<g style="animation-delay:-${delay}s">${img(a, x, y, w, h, 'fa')}${img(b, x, y, w, h, 'fb')}</g>`

const box = (x: number, y: number, w: number, h: number, fill: string, extra = ''): string =>
  `<rect x="${x * HD}" y="${y * HD}" width="${w * HD}" height="${h * HD}" fill="${fill}"${extra}/>`

const shadow = (cx: number, cy: number, rx: number): string =>
  `<ellipse cx="${cx * HD}" cy="${cy * HD}" rx="${rx * HD}" ry="${rx * 0.4 * HD}" fill="rgba(20,30,10,.28)"/>`

// A 3×5 pixel font, so names and numbers are as crisp as the sprites: each glyph is its rows, top to bottom.
const GLYPHS: Record<string, string> = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', '0': '111101101101111', '1': '010110010010111', '2': '110001010100111', '3': '110001010001110',
  '4': '101101111001001', '5': '111100110001110', '6': '011100111101111', '7': '111001010010010', '8': '111101111101111',
  '9': '111101111001110', '-': '000000111000000', '.': '000000000000010', "'": '010010000000000', '+': '000010111010000',
  '?': '110001010000010', '/': '001001010100100', ' ': '000000000000000',
}

// What the font can draw: capitals, accents dropped, anything else gone.
const fontText = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().split('').filter(c => GLYPHS[c] !== undefined).join('')

// Letters advance four pixels, a space two, so words sit close.
const advance = (ch: string): number => (ch === ' ' ? 2 : 4)
const textWidth = (s: string): number => Math.max(0, s.split('').reduce((n, ch) => n + advance(ch), 0) - 1)

// One path per string, a row's lit run at a time; `shade` sits a pixel lower for depth.
const pixelText = (x: number, y: number, text: string, fill: string, shade?: string): string => {
  let d = ''
  let cx = x
  for (const ch of text) {
    const g = GLYPHS[ch] ?? ''
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 3; c++) {
        if (g[r * 3 + c] !== '1' || (c > 0 && g[r * 3 + c - 1] === '1')) continue
        let e = c
        while (e < 3 && g[r * 3 + e] === '1') e++
        d += `M${(cx + c) * HD} ${(y + r) * HD}h${(e - c) * HD}v${HD}h-${(e - c) * HD}z`
      }
    cx += advance(ch)
  }
  if (!d) return ''
  return (shade ? `<path d="${d}" fill="${shade}" transform="translate(0 ${HD / 2})"/>` : '') + `<path d="${d}" fill="${fill}"/>`
}

// Crops: two staggered rows of three, as clodfarm's drawCrops lays them out.
const crops = (p: Plot, stage: Stage, seed: number, glow: boolean): string => {
  if (stage === 'none') return ''
  const out: string[] = []
  for (let row = 0; row < 2; row++)
    for (let k = 0; k < 3; k++) {
      const x = p.x + 6 + k * 9 + row * 4
      const y = row ? p.y + p.h - 1 : p.y + 8
      const sway = stage === 'grow' || stage === 'ripe' ? `crop_${stage}_${(k + row + seed) % 3}` : `crop_${stage}_1`
      out.push(img(sway, x - 2.5, y - 9, 5, 9, glow ? 'glow' : ''))
    }
  return out.join('')
}

// A pixel speech bubble: notched corners, a one-pixel inked edge, a stepped tail.
const bubble = (cx: number, bottom: number, icon: string, alert = false): string => {
  const w = 12
  const h = 10
  const x = cx - w / 2
  const y = bottom - h - 2
  const fill = alert ? '#ffe7a8' : '#fbfaf5'
  return '<g class="bub">' +
    box(x + 1, y, w - 2, h, INK) + box(x, y + 1, w, h - 2, INK) + box(x + 1, y + 1, w - 2, h - 2, fill) +
    box(cx - 2, y + h - 1, 1, 2, INK) + box(cx + 1, y + h - 1, 1, 2, INK) + box(cx - 1, y + h - 1, 2, 2, fill) + box(cx - 1, y + h + 1, 2, 1, INK) +
    `<image href="${ICONS[icon] ?? ''}" x="${(x + 2) * HD}" y="${(y + 1) * HD}" width="${8 * HD}" height="${8 * HD}"/>` +
    '</g>'
}

// A wooden plank under a plot naming its task; the current task's is gold.
const sign = (x: number, y: number, text: string, isCurrent: boolean): string => {
  const w = textWidth(text) + 5
  const h = 8
  return box(x + 1, y + h, w - 1, 1, 'rgba(20,30,10,.3)') +
    box(x, y, w, h, WOOD.edge) +
    box(x + 0.5, y + 0.5, w - 1, h - 1, isCurrent ? WOOD.gold : WOOD.plank) +
    box(x + 0.5, y + 0.5, w - 1, 0.5, isCurrent ? WOOD.goldLight : WOOD.light) +
    (isCurrent ? pixelText(x + 2.5, y + 1.5, text, WOOD.edge) : pixelText(x + 2.5, y + 1.5, text, WOOD.cream, WOOD.edge))
}

// The farm's notice board, hung from the trees in the top-right corner: a lamp lit while Claude works, and the counts.
const board = (working: boolean, rows: [string, number][]): string => {
  const title = 'CRAB FARM'
  const bw = Math.max(textWidth(title) + 7, ...rows.map(([l, n]) => textWidth(l) + 4 + textWidth(String(n)))) + 8
  const bh = 9 + rows.length * 7 + 2
  const x = WORLD.W - 6 - bw
  const y = 5
  const lamp = working ? '#7cfc9a' : '#f5a524'
  const parts = [
    box(x + 4, 0, 1, y, WOOD.edge), box(x + bw - 5, 0, 1, y, WOOD.edge),
    box(x + 1, y + bh, bw - 1, 1, 'rgba(10,20,10,.3)'),
    box(x, y, bw, bh, WOOD.edge),
    box(x + 0.5, y + 0.5, bw - 1, bh - 1, WOOD.plank),
    box(x + 0.5, y + 0.5, bw - 1, 0.5, WOOD.light),
    ...Array.from({ length: Math.floor(bh / 8) }, (_, k) => box(x + 0.5, y + 8 * (k + 1), bw - 1, 0.5, WOOD.seam)),
    pixelText(x + 3, y + 2.5, title, '#ffd772', WOOD.edge),
    working ? `<circle cx="${(x + bw - 4.5) * HD}" cy="${(y + 5) * HD}" r="${3 * HD}" fill="${lamp}" opacity=".3"/>` : '',
    box(x + bw - 6, y + 3.5, 3, 3, WOOD.edge), box(x + bw - 5.5, y + 4, 2, 2, lamp),
    box(x + 3, y + 9, bw - 6, 0.5, WOOD.seam),
  ]
  rows.forEach(([label, n], i) => {
    const ty = y + 11 + i * 7
    parts.push(pixelText(x + 3, ty, label, WOOD.cream, WOOD.edge))
    parts.push(pixelText(x + bw - 3 - textWidth(String(n)), ty, String(n), '#fff4d6', WOOD.edge))
  })
  return parts.join('')
}

// Light by the hour: a wash over the world at dawn, dusk and night, and fireflies after dark.
const skyAt = (hour: number): Sky => (hour < 5 || hour >= 21 ? 'night' : hour < 8 ? 'dawn' : hour >= 18 ? 'dusk' : 'day')
const WASH: Record<Sky, string> = { day: '', dawn: 'rgba(255,179,138,.12)', dusk: 'rgba(255,138,61,.16)', night: 'rgba(20,28,70,.46)' }
const FIREFLIES = [[38, 96], [150, 100], [96, 128], [44, 166], [152, 170], [100, 206], [70, 84], [138, 74]] as const

const CSS = `<style>
image{image-rendering:pixelated}
.fa{animation:fa .9s steps(1) infinite}.fb{opacity:0;animation:fb .9s steps(1) infinite}
@keyframes fa{50%{opacity:0}}@keyframes fb{50%{opacity:1}}
.bub{animation:bob 2.2s steps(2) infinite}@keyframes bob{50%{transform:translateY(-2px)}}
.glow{animation:glow 2.6s ease-in-out infinite}@keyframes glow{50%{opacity:.82}}
.ff{animation:ff 3.2s ease-in-out infinite;opacity:0}@keyframes ff{40%,60%{opacity:1}}
@media (prefers-reduced-motion: reduce){*{animation:none!important}.fb{opacity:0}.ff{opacity:.7}}
</style>`

// A task's crops grow with its tool calls and bloom once its turn has ended.
const plotStage = (f: Farmer): Stage => {
  if (f.status === 'asleep' || f.tools === 0) return 'none'
  if (f.status !== 'working') return 'ripe'
  return f.tools < 3 ? 'seed' : f.tools < 8 ? 'sprout' : 'grow'
}

// The session's tasks as Claudes, each with the running subagents spawned for it; the newest is current.
const asFarmers = (list: Task[], crit: Critter[]): Farmer[] =>
  list.map((t, i) => ({
    id: t.id,
    name: t.name,
    status: t.status,
    tools: t.tools,
    startedAt: t.startedAt,
    helpers: crit.filter(c => c.taskId === t.id && c.status === 'running').map(c => ({ label: c.label, model: c.model })),
    isCurrent: i === list.length - 1,
  }))

// Who gets the plots: the newest tasks, seated in the order they started.
const seat = (all: Farmer[], plots: number): Farmer[] =>
  [...all].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id)).slice(-plots)

// Words a sign skips, so it keeps the ones that say what the task is.
const FILLER = new Set('a an and the to of on in for with it its is be me my we us you i so now ok okay just please can could would will lets let let\'s hey hi want need like make this that'.split(' '))

// A task's name as its sign spells it: whole words that fit, filler left out unless nothing else is left.
const signName = (name: string, max = SIGN_TEXT_W): string => {
  const words = fontText(name).split(/\s+/).filter(Boolean)
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

const IDLE: Farmer = { id: 'idle', name: 'claude', status: 'asleep', tools: 0, startedAt: 0, helpers: [] }

const sceneSvg = (farmers: Farmer[], harvest: number, taskCount = farmers.length, hour = 12): string => {
  const world: string[] = [`<image href="${BG}" x="0" y="0" width="${VW}" height="${VH}"/>`]
  const ui: string[] = []
  const plots = LAYOUT.plots as readonly Plot[]
  const shown = farmers.length ? seat(farmers, plots.length) : [IDLE]

  shown.forEach((f, i) => world.push(crops(plots[i] as Plot, plotStage(f), i, f.status === 'waiting')))

  // Each Claude stands at the left of its plot: typing at a laptop, waiting for its person, resting after its task, or asleep before the first.
  shown.forEach((f, i) => {
    const p = plots[i] as Plot
    const x = p.x - 15
    const y = p.y - 6
    world.push(shadow(x + 8, y + 17.5, 6))
    if (f.status === 'working') {
      world.push(flip('claude_type', 'claude_stand', x, y, 16, 18, i * 0.2))
      world.push(flip('laptop_0', 'laptop_1', p.x - 4, p.y + 8, 9, 7, i * 0.2 + 0.45))
      ui.push(bubble(x + 8, y - 1, 'terminal'))
    } else if (f.status === 'waiting') {
      // Standing still: only the bubble bobs, so a waiting Claude never flickers.
      world.push(img('claude_stand', x, y, 16, 18))
      ui.push(bubble(x + 8, y - 1, 'ask', true))
    } else {
      // Finished or not yet started: a still, sleeping Claude, which costs the pane nothing to keep drawn.
      world.push(img('claude_sleep', x, y, 16, 18))
      if (f.status === 'asleep') ui.push(bubble(x + 8, y + 3, 'zzz'))
    }
  })

  // Its subagents: little helpers along the top of its plot, each in its model's colour.
  shown.forEach((f, i) => {
    const p = plots[i] as Plot
    f.helpers.slice(0, MAX_HELPERS_SHOWN).forEach((h, k) => {
      const x = p.x + 3 + k * 9
      const y = p.y - 8
      world.push(shadow(x + 5, y + 8, 4))
      world.push(flip(`mini_${modelKey(h.model)}_1`, `mini_${modelKey(h.model)}_0`, x, y, 10, 8, i * 0.3 + k * 0.25))
    })
    const extra = f.helpers.length - MAX_HELPERS_SHOWN
    if (extra > 0) ui.push(pixelText(p.x + 3 + MAX_HELPERS_SHOWN * 9 + 1, p.y - 6, `+${extra}`, '#fff4d6', INK))
  })

  // Under each plot, a sign with its task's name, starting past the plot's edge to clear the bubble of the Claude below.
  shown.forEach((f, i) => {
    const p = plots[i] as Plot
    ui.push(sign(p.x, p.y + p.h + 2, signName(f.name || 'claude'), f.isCurrent ?? false))
  })

  world.push(`<image href="${FG}" x="0" y="${WORLD.fgY * HD}" width="${VW}" height="${VH - WORLD.fgY * HD}"/>`)

  const sky = skyAt(hour)
  if (WASH[sky]) world.push(`<rect width="${VW}" height="${VH}" fill="${WASH[sky]}"/>`)
  if (sky === 'night')
    FIREFLIES.forEach(([fx, fy], k) =>
      world.push(`<g class="ff" style="animation-delay:-${(k * 0.83) % 3.2}s"><circle cx="${fx * HD}" cy="${fy * HD}" r="${2.5 * HD}" fill="#e9ff8a" opacity=".22"/>${box(fx - 0.5, fy - 0.5, 1, 1, '#f4ffb0')}</g>`),
    )
  // A soft dark edge pulls the eye to the plots.
  world.push(`<rect width="${VW}" height="${VH}" fill="url(#vig)"/>`)

  const helpers = farmers.reduce((n, f) => n + f.helpers.length, 0)
  ui.push(board(farmers.some(f => f.status === 'working'), [['TASKS', taskCount], ['HELPERS', helpers], ['HARVEST', harvest]]))

  const defs = '<defs><radialGradient id="vig" cx="50%" cy="52%" r="70%"><stop offset="62%" stop-color="#0c140a" stop-opacity="0"/><stop offset="100%" stop-color="#0c140a" stop-opacity=".38"/></radialGradient></defs>'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${VW}" height="${VH}" viewBox="0 0 ${VW} ${VH}">${CSS}${defs}${world.join('')}<g shape-rendering="crispEdges">${ui.join('')}</g></svg>`
}

// A task is named after the first words of the prompt that started it; its sign picks from these.
const taskName = (text: string, n: number): string =>
  text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .join(' ') || `task ${n}`

export { asFarmers, sceneSvg, seat, signName, taskName, VW, VH }

// --- wiring ---------------------------------------------------------------

// The app's task list marks a request's place in the session: these two start a task of their own.
const isTaskStart = (tool: string, scope: unknown): boolean =>
  tool.includes('ccd_turn') && tool.endsWith('__update_plan') && (scope === 'first_task' || scope === 'new_task')

// A new Claude for a new task; the ones before it are done.
async function startTask($: EngineInterface): Promise<void> {
  const f = await update($, farm, g => ({ ...g, taskCount: g.taskCount + 1, toolsAtTurnStart: 0 }))
  const n = f.taskCount
  const task: Task = { id: `t${n}`, name: taskName(f.turnText, n), startedAt: n, turnId: f.turnId, tools: 0, status: f.isWorking ? 'working' : 'waiting' }
  await update($, tasks, list => [...list.map((t): Task => ({ ...t, status: 'done' })), task].slice(-MAX_TASKS_KEPT))
}

// Changes only the newest task.
const updateCurrent = ($: EngineInterface, fn: (t: Task) => Task) =>
  update($, tasks, list => list.map((t, i) => (i === list.length - 1 ? fn(t) : t)))

async function togglePane($: EngineInterface): Promise<boolean> {
  const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
  if (isOpen) await $.ui.close({ id: PANE })
  else await $.ui.open({ id: PANE, title: TITLE })
  return !isOpen
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'farm', description: 'Show or hide Crab Farm, a pixel farm of this session\'s tasks and their helpers' })
    const harvest = Number((await $.store.get('harvest')) ?? 0)
    await update($, farm, f => ({ ...f, harvest }))
    // Opens with every session; closing it (its X or /farm) lasts for this session only.
    // With no screen attached (a headless run) there is nothing to open it on.
    void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
    return started
  })

  on('command.run', { command: 'farm' }, async $ => {
    const isOpen = await togglePane($)
    return { text: isOpen ? 'Crab Farm opened.' : 'Crab Farm closed for this session. /farm brings it back.' }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const current = (await read($, tasks)).at(-1)
      await update($, farm, g => ({ ...g, isWorking: true, turnId: e.turnId, turnText: e.text, toolsAtTurnStart: current?.tools ?? 0 }))
      // The first prompt always gets a Claude; after that, the task list decides.
      if (!current) await startTask($)
      else await updateCurrent($, t => ({ ...t, status: 'working' }))
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId === undefined) {
      // A turn that did some work is a crop brought in.
      const did = ((await read($, tasks)).at(-1)?.tools ?? 0) > (await read($, farm)).toolsAtTurnStart
      const f = await update($, farm, g => ({ ...g, isWorking: false, harvest: g.harvest + (did ? 1 : 0) }))
      if (did) await $.store.set('harvest', f.harvest)
      await updateCurrent($, t => ({ ...t, status: 'waiting' }))
      return next(e)
    }
    const isDone = e.reason === 'answer'
    let matched = false
    await update($, critters, list =>
      list.map((c): Critter => {
        if (c.agentId !== agentId || c.status !== 'running') return c
        matched = true
        return { ...c, status: isDone ? 'done' : 'failed' }
      }),
    )
    if (matched && isDone) {
      const f = await update($, farm, g => ({ ...g, harvest: g.harvest + 1 }))
      await $.store.set('harvest', f.harvest)
    }
    return next(e)
  })

  // Only the main loop's calls touch state: a subagent's would redraw the pane for nothing it shows.
  // The farm never stands in a tool's way: whatever goes wrong here, the call goes on.
  on('tool.call', async ($, e, next) => {
    if (e.agentId) return next(e)
    try {
      if (isTaskStart(e.tool, (e as unknown as { scope?: unknown }).scope)) {
        const f = await read($, farm)
        const current = (await read($, tasks)).at(-1)
        // A task already started this turn (the session's first prompt) is the one the list means.
        if (current?.turnId !== f.turnId) await startTask($)
      }
      await updateCurrent($, t => ({ ...t, tools: t.tools + 1 }))
    } catch {
      // A missed count costs a sprout, never the call.
    }
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined) return started
    const current = await read($, tasks).catch(() => [] as Task[])
    const critter: Critter = {
      id: started.agentId ?? e.tool_use_id,
      agentId: started.agentId,
      taskId: current.at(-1)?.id ?? '',
      label: e.description,
      model: started.model ?? '',
      status: 'running',
    }
    await update($, critters, list => [...list.filter(c => c.id !== critter.id), critter].slice(-MAX_CRITTERS)).catch(() => undefined)
    return started
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const f = await read($, farm)
    const farmers = asFarmers(await read($, tasks), await read($, critters))

    if (e.surface !== 'terminal' && 'Svg' in ui) {
      const { Svg } = ui
      const W = Math.max(260, Math.min(720, (e.props.bodyColumns || 40) * 8 - 8))
      const current = farmers.at(-1)
      const hour = new Date().getHours()
      const alt = `Crab Farm: ${f.taskCount} tasks${current ? `, now ${current.name}, ${current.status}` : ''}, ${f.harvest} harvested`
      return (
        <Box flexDirection="column">
          <Svg source={sceneSvg(farmers, f.harvest, f.taskCount, hour)} alt={alt} width={W} height={Math.round((W * VH) / VW)} />
        </Box>
      )
    }

    // The terminal has no pictures: the same farm in a few lines.
    const word = { working: 'working', waiting: 'waiting for you', done: 'done', asleep: 'asleep' } as const
    const icon = { working: '🌱', waiting: '🌸', done: '🧺', asleep: '💤' } as const
    return (
      <Box flexDirection="column">
        <Text>🦀 Crab Farm · {f.taskCount} tasks · 🌸 {f.harvest}</Text>
        {(farmers.length ? farmers.slice(-LAYOUT.plots.length) : [IDLE]).map(x => (
          <Text key={x.id} dimColor={x.status !== 'working'}>
            {icon[x.status]} {clip(x.name || 'Claude', 30)} · {word[x.status]}
            {x.helpers.length ? ` · ${x.helpers.length} helpers` : ''}
          </Text>
        ))}
      </Box>
    )
  })
}
