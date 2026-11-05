import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { configOf, fromV12, modelOf, projectOf, spinnerWord, statsText } from './register'
import { emptyLive, reduce } from './model/world'
import type { WorldCtx } from './model/world'
import { YARD, home, resolve, route } from './model/layout'
import { emptyBank } from './model/progress'
import { signName } from './render/text'

// The farm wired into the engine: every surface draws it, a whole session moves it, the store keeps it.
// Each hook the test registers stands for the engine beneath the plugin; mock.clock answers $.clock, and a Map the
// test can read answers $.store.

const T0 = new Date(2026, 10, 5, 10).getTime()
const PLAN = 'mcp__ccd_turn__update_plan'
const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const
const PANE = {
  plugin: 'crab-farm', component: 'Pane', requestId: 'crab-farm',
  props: { title: 'Crab Farm', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const ctx: WorldCtx = { owned: 0, route, resolve, home, yard: YARD }

/**
 * The engine beneath the plugin, answered from memory. `writes` counts the farm's `live` writes. With `isNarrow`, the
 * first open (the unasked one at session start) waits unplaced, as below 144 terminal columns; later ones are placed.
 */
const engine = (on: On, store: Record<string, unknown> = {}, ids = ['sess-1', 'sess-2'], isNarrow = false) => {
  const clock = mock.clock(on, { now: T0 })
  // The store, kept here so a test can read what the farm left in it.
  const kept = new Map<string, unknown>(Object.entries(store))
  on('store.get', (_, e) => ({ value: kept.get(e.key) }) as never)
  on('store.set', (_, e) => { kept.set(e.key, JSON.parse(JSON.stringify(e.value)) as unknown); return { value: undefined } as never })
  on('store.delete', (_, e) => { kept.delete(e.key); return { value: undefined } as never })
  on('store.keys', () => ({ value: [...kept.keys()] }) as never)
  const open = new Map<string, boolean>()
  const seen = { writes: 0, panes: 0, blits: 0, opens: 0 }
  let sid = ids[0] ?? 'sess'
  on('state.set', (_, e, next) => { if ((e as { key?: string }).key === 'live') seen.writes++; return next(e) })
  on('command.register', () => ({ value: { command: 'farm' } }))
  on('ui.open', (_, e) => {
    const isPlaced = !isNarrow || seen.opens++ > 0
    open.set(e.id, isPlaced)
    return { value: isPlaced ? { isPlaced } : { isPlaced, reason: 'unasked below 144 columns (120 now)' } }
  })
  on('ui.close', (_, e) => { open.delete(e.id); return { value: undefined } })
  on('ui.panes', () => {
    seen.panes++
    return { value: [...open].map(([id, isPlaced]) => ({ id, title: 'Crab Farm', isShown: isPlaced, isFocused: false, isPlaced })) } as never
  })
  on('ui.blit', () => { seen.blits++; return { value: {} } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: sid }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('classic.SessionStart', () => ({}))
  on('tool.call', () => ({ result: {} }))
  on('tool.check', () => ({ decision: 'ask' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('agent.spawn', () => ({ agentId: 'ag1', model: 'claude-haiku-5-5' }))
  return { clock, open, seen, kept, next: () => { sid = ids[1] ?? 'sess-next' } }
}

test('the pane draws on every surface: a picture where there is Svg, cells and words in the terminal', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/Users/me/crab-farm', surface: 'desktop', isInteractive: true })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const svgs = await ui.findAll({ type: 'Svg' })
    if (surface === 'terminal') {
      expect(svgs.length).toBe(0)
      const raster = await ui.find({ type: 'Raster' })
      expect(raster?.key).toBe('farm')
      expect(await ui.find({ type: 'Text', text: /CRAB FARM/ })).toBeDefined()
    } else {
      const farm = svgs[0]?.props as { source: string; alt: string; width?: number } | undefined
      expect(farm?.source.startsWith('<svg')).toBe(true)
      expect(farm?.source.length).toBeLessThan(131_072)
      expect(farm?.alt).toContain('Crab Farm')
      // The hover cards sit over the picture where a pointer can rest on it.
      expect(svgs.length).toBe(surface === 'mobile' ? 1 : 2)
      if (surface !== 'mobile') expect((svgs[1]?.props as { isInteractive?: boolean }).isInteractive).toBe(true)
      // A width on the desktop's grid; none in VS Code and on the phone, so the picture fits the panel.
      expect(farm?.width).toBe(surface === 'desktop' ? 450 : undefined)
    }
    await ui.unmount()
  }
})

test('the narrow panel crops to the play area, and the hover cards can be turned off', { options: { hover: false } }, async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode', props: { ...PANE.props, bodyColumns: 30 } })
  const svgs = await ui.findAll({ type: 'Svg' })
  expect(svgs.length).toBe(1)
  expect((svgs[0]?.props as { source: string }).source).toContain('viewBox="44 40 272 432"')
  await ui.unmount()
})

test('the text farm keeps 1.2\'s list in the terminal', { options: { terminalStyle: 'text' } }, async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ turnId: 't1', text: 'Lets test crab farm' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /Lets test crab/ }))?.text).toContain('thinking')
  await ui.unmount()
})

test('a whole session: a plan, errands, a helper, an ask, an answer, a wrap-up, and coins that stay', async ($, on) => {
  const { seen, next } = engine(on)
  const stats = async (): Promise<string> => (await $.command.run({ command: 'farm', args: 'stats' } as never)).text ?? ''
  const alt = async (): Promise<string> => {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const a = ((await ui.find({ type: 'Svg' }))?.props as { alt: string }).alt
    await ui.unmount()
    return a
  }
  const call = async (tool: string, args: Record<string, unknown>): Promise<number> => {
    const before = seen.writes
    await $.tool.call({ tool, ...args } as never)
    return seen.writes - before
  }

  await $.session.start({ cwd: '/Users/me/crab-farm', surface: 'desktop', isInteractive: true })
  await $.turn.start({ turnId: 't1', text: 'Rework the farm' })
  // Each call writes the farm at most twice: once as it starts, once more if its errand holds until it returns.
  const planWrites = await call(PLAN, { scope: 'first_task', items: [
    { content: 'Read the source', status: 'in_progress' },
    { content: 'Rework the plots', status: 'pending' },
    { content: 'Ship it', status: 'pending' },
  ] })
  expect(planWrites).toBeGreaterThanOrEqual(1)
  expect(planWrites).toBeLessThanOrEqual(2)
  for (const [tool, args] of [['Read', { file_path: '/a/b.ts' }], ['Edit', { file_path: '/a/b.ts', old_string: 'a', new_string: 'b' }], ['Bash', { command: 'npm test' }]] as const) {
    expect(await call(tool, args)).toBeLessThanOrEqual(2)
  }
  expect(await alt()).toContain('now "Read the source"')

  await call(PLAN, { advance: true })
  await $.agent.spawn({ tool_use_id: 'u-agent', prompt: 'p', description: 'look around', subagentType: 'Explore' } as never)
  expect(await stats()).toMatch(/Rework the plots: .*1 helper/)
  await $.turn.complete({ turnId: 'ta', agentId: 'ag1', reason: 'answer', answer: '', durationMs: 1, isAborted: false } as never)

  // Asked: the farm waits on the person; the call returns and it goes on.
  await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' }, tool_use_id: 'u-ask', approver: 'person' })
  expect(await alt()).toContain('needs your OK')
  expect(await stats()).toContain('needs your OK (Bash)')
  await call('Bash', { command: 'rm -rf build' })
  expect(await alt()).not.toContain('needs your OK')

  await call('mcp__ccd_turn__wrap_up', { recap: 'done' })
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'done', durationMs: 1, isAborted: false } as never)
  const s = await stats()
  expect(s).toContain('3 of 3 steps done')
  expect(s).toMatch(/This session: .* 7 tool calls/)
  // Two steps saw work: each brings in a harvest; every call and the helper's crates add coins.
  const coins = Number(/Crab Farm · ([\d,]+) coins/.exec(s)?.[1]?.replace(/,/g, '') ?? 0)
  expect(coins).toBeGreaterThanOrEqual(7 + 2 * 10)
  expect(s).toMatch(/Harvests 2 /)

  // /clear: the session's ledger is closed, a new one starts at nothing, and the farm keeps every coin.
  await $.session.end({ reason: 'clear', sessionId: 'sess-1' } as never)
  next()
  await $.classic.SessionStart({ source: 'clear' })
  const after = await stats()
  expect(after).toContain(`Crab Farm · ${coins.toLocaleString('en-US')} coins`)
  expect(after).toContain('This session: 0 of 0 steps done · 0 tool calls')
})

test('a subagent\'s own calls write nothing; its Task tools still move the shared list', async ($, on) => {
  const { seen } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const before = seen.writes
  await $.tool.call({ tool: 'Read', file_path: '/x', agentId: 'ag9' } as never)
  expect(seen.writes).toBe(before)
})

test('1.2\'s harvest becomes the gift: 31 harvests start the farm at 310 coins and five builds', async ($, on) => {
  engine(on, { harvest: 31 })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const s = (await $.command.run({ command: 'farm', args: 'stats' } as never)).text ?? ''
  expect(s).toContain('Crab Farm · 310 coins · 5 of 12 builds')
  expect(s).toContain('Harvests 31 ')
  expect(s).toContain('Next build: Cat')
})

test('/farm hides the pane and brings it back, and /farm stats answers in words', async ($, on) => {
  const { open } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(open.has('crab-farm')).toBe(true)
  expect((await $.command.run({ command: 'farm', args: '' } as never)).text).toContain('closed')
  expect(open.has('crab-farm')).toBe(false)
  expect((await $.command.run({ command: 'farm', args: '' } as never)).text).toContain('opened')
  expect(open.has('crab-farm')).toBe(true)
  const s = (await $.command.run({ command: 'farm', args: 'stats' } as never)).text ?? ''
  expect(s).toContain('Crab Farm · 0 coins · 0 of 12 builds')
  expect(s).toContain('Next build: Scarecrow')
  expect(open.has('crab-farm')).toBe(true)
})

test('on a narrow terminal the first /farm shows the farm that waits unplaced, rather than closing it', async ($, on) => {
  const { open } = engine(on, {}, undefined, true)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(open.get('crab-farm')).toBe(false)
  expect((await $.command.run({ command: 'farm', args: '' } as never)).text).toBe('Crab Farm opened.')
  expect(open.get('crab-farm')).toBe(true)
  expect((await $.command.run({ command: 'farm', args: '' } as never)).text).toContain('closed')
})

test('a /resume in the session goes on under the new id: the heartbeat beats, and every coin is counted once', async ($, on) => {
  const { clock, seen, kept, next } = engine(on)
  const coins = async (): Promise<number> =>
    Number(/Crab Farm · ([\d,]+) coins/.exec((await $.command.run({ command: 'farm', args: 'stats' } as never)).text ?? '')?.[1]?.replace(/,/g, '') ?? -1)
  const work = async (turnId: string, n: number): Promise<void> => {
    await $.turn.start({ turnId, text: 'read some files' })
    for (let i = 0; i < n; i++) await $.tool.call({ tool: 'Read', file_path: `/f${turnId}${i}` } as never)
    await $.turn.complete({ turnId, reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false } as never)
  }
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await work('t1', 6)
  const first = await coins()
  expect(first).toBeGreaterThan(0)

  await $.session.end({ reason: 'resume', sessionId: 'sess-1' } as never)
  next()
  await $.classic.SessionStart({ source: 'resume' })
  expect(await coins()).toBe(first)
  await work('t2', 3)
  const total = await coins()
  expect(total).toBeGreaterThan(first)
  const panes = seen.panes
  await clock.advance(30_000)
  expect(seen.panes - panes).toBe(1)

  await $.session.end({ reason: 'prompt_input_exit', sessionId: 'sess-2' } as never)
  const ledgers = [...kept].filter(([k]) => k.startsWith('led:')).map(([k, v]) => [k, (v as { totals: { coins: number } }).totals.coins] as const)
  expect(ledgers.map(([k]) => k).sort()).toEqual(['led:sess-1', 'led:sess-2'])
  // Every coin once: the two ledgers and the dawn basket hold all the farm has.
  const baskets = [...kept].filter(([k]) => k.startsWith('b:')).reduce((n, [, v]) => n + (v as number), 0)
  expect(ledgers.reduce((n, [, c]) => n + c, 0) + baskets).toBe(total)
})

test('session.start twice arms one heartbeat, which looks at the pane every 30 s', async ($, on) => {
  const { clock, seen } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const panes = seen.panes
  await clock.advance(30_000)
  expect(seen.panes - panes).toBe(1)
  await clock.advance(30_000)
  expect(seen.panes - panes).toBe(2)
  await ui.unmount()
})

test('the spinner says the farm\'s job only when asked to', { options: { spinnerWords: true } }, async ($, on) => {
  engine(on)
  // The engine's own spinner, beneath the plugin: it draws the word it is handed.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{(e.props as { word: string }).word}</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ turnId: 't1', text: 'water the plots' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  const ui = await $.ui.mount({ plugin: 'crab-farm', component: 'Spinner', requestId: 'main', surface: 'terminal', props: { word: 'Sauteing', message: null, suffix: '…', mode: 'tool-use' } })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('Sprinkling')
  await ui.unmount()
})

// ---- the wiring's pure parts ----

test('options read their defaults, and anything unknown is the default', async () => {
  expect(configOf({})).toEqual({ motion: 'full', hemisphere: 'auto', hover: true, terminalStyle: 'pixels', spinnerWords: false })
  expect(configOf({ motion: 'still', hover: false, terminalStyle: 'text', spinnerWords: true, hemisphere: 'south' }))
    .toEqual({ motion: 'still', hemisphere: 'south', hover: false, terminalStyle: 'text', spinnerWords: true })
  expect(configOf({ motion: 'off' }).motion).toBe('full')
})

test('the hat band follows the model family, and the sign the project folder', async () => {
  expect(modelOf('claude-opus-5-5')).toBe('opus')
  expect(modelOf('Sonnet 4.5')).toBe('sonnet')
  expect(modelOf('claude-haiku-5-5[1m]')).toBe('haiku')
  expect(modelOf('gpt-x')).toBeUndefined()
  expect(projectOf('/Users/me/crab-farm/')).toBe('crab-farm')
  expect(projectOf('C:\\work\\barn')).toBe('barn')
})

test('the spinner word is the working crab\'s errand, and nothing between turns', async () => {
  let l = reduce({ ...emptyLive(T0), rev: 1 }, { kind: 'turnStart', turnId: 't', text: 'go' }, T0, ctx)
  l = reduce(l, { kind: 'call', tool: 'Bash', args: { command: 'npm test' }, useId: 'u1' }, T0 + 1000, ctx)
  expect(spinnerWord(l)).toBe('Sprinkling')
  l = reduce(l, { kind: 'turnEnd', reason: 'answer' }, T0 + 2000, ctx)
  expect(spinnerWord(l)).toBeUndefined()
})

test('a 1.2 farm reloaded mid-session keeps its steps, their calls and its running helpers', async () => {
  const fresh = { ...emptyLive(T0), rev: 1 }
  const l = fromV12(fresh,
    { isWorking: true, turnText: 'fix it', turnHadTools: true, taskCount: 2, harvest: 4 },
    { seq: 3, steps: [{ name: 'Read', status: 'completed', tools: 5 }, { name: 'Draw', status: 'in_progress', tools: 2, startedAt: T0 - 60_000 }] },
    [{ id: 'c1', agentId: 'ag1', step: '3:1', label: 'look', model: 'claude-haiku-5-5', status: 'running' }],
    T0, ctx)
  expect(l.plan.steps.map(s => [s.name, s.status, s.calls])).toEqual([['Read', 'completed', 5], ['Draw', 'in_progress', 2]])
  expect(l.plan.steps[0]?.paid).toBe(true)
  expect(l.helpers.map(h => [h.label, h.model])).toEqual([['look', 'haiku']])
  expect(l.turn.isWorking).toBe(true)
  expect(l.tasks).toBe(2)
  expect(fromV12(fresh, { isWorking: false, turnText: '', turnHadTools: false, taskCount: 0, harvest: 0 }, { seq: 0, steps: [] }, [], T0, ctx)).toBe(fresh)
})

test('/farm stats tells the next build and what each crab does', async () => {
  let l = reduce({ ...emptyLive(T0), rev: 1 }, { kind: 'turnStart', turnId: 't', text: 'go' }, T0, ctx)
  l = reduce(l, { kind: 'call', tool: PLAN, args: { items: [{ content: 'Read the source', status: 'in_progress' }, { content: 'Ship it', status: 'pending' }] }, useId: 'u1' }, T0 + 500, ctx)
  l = reduce(l, { kind: 'call', tool: 'Bash', args: { command: 'npm test' }, useId: 'u2' }, T0 + 1000, ctx)
  const s = statsText(l, emptyBank(T0, 1))
  expect(s).toContain('Next build: Scarecrow')
  expect(s).toMatch(/Read the source: sprinkling \(Bash: npm test\)/)
  expect(s).toContain('Ship it: next')
})

test('a sign spells whole words that fit, filler left out', async () => {
  expect(signName('Lets test crab farm see how it looks')).toBe('TEST CRAB')
  expect(signName('Work on the farm to make it look nicer')).toBe('WORK FARM')
  expect(signName('add more claudes')).toBe('ADD MORE')
  expect(signName('internationalisation')).toBe('INTERNAT')
})
