import { expect, test } from 'claude-code/testing'
import { SPRITES } from './art'
import { applyPlan, asFarmers, countCall, finishPlan, helpStep, plotStage, rehome, sceneSvg, seat, signName, taskName, timeKey } from './register'
import type { Critter12 as Critter, Farmer, Plan12 as Plan } from '../types'

const count = (s: string, part: string): number => s.split(part).length - 1

const models = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1']
const farmer = (i: number, over: Partial<Farmer> = {}): Farmer => ({
  id: `1:${i}`, name: `Step <${i}> & co`, status: (['done', 'waiting', 'working', 'pending'] as const)[i % 4] ?? 'done',
  tools: i * 2,
  helpers: Array.from({ length: i % 5 }, (_, k) => ({ label: `h${k}`, model: models[k % 4] ?? '' })), ...over,
})
const plan = (...statuses: ('pending' | 'in_progress' | 'completed')[]): Plan =>
  ({ seq: 1, steps: statuses.map((status, i) => ({ name: `step ${i + 1}`, status, tools: 0 })) })

test('every step is a Claude with its own plot, helpers on it, under the Svg size cap', async () => {
  const all = Array.from({ length: 6 }, (_, i) => farmer(i, { isCurrent: i === 2 }))
  const svg = sceneSvg(all, 3, 2)
  expect(svg.startsWith('<svg')).toBe(true)
  // Helpers 1 to 4 a plot, three drawn at most, each two frames: the haiku helper leads every plot that has one.
  expect(count(svg, `href="${SPRITES.mini_haiku_1}"`)).toBe(4)
  expect(count(svg, `href="${SPRITES.mini_sonnet_1}"`)).toBe(3)
  expect(svg).not.toContain('<text')
  expect(svg.length).toBeLessThan(131072)
})

test('the farm is washed by the hour, with fireflies only at night', async () => {
  expect(sceneSvg([], 0, 0, 13)).not.toContain('class="ff"')
  expect(sceneSvg([], 0, 0, 23)).toContain('class="ff"')
  expect(sceneSvg([], 0, 0, 23)).toContain('rgba(20,28,70')
})

test('only the busy Claude animates', async () => {
  const still = sceneSvg([farmer(0, { status: 'done', helpers: [] }), farmer(1, { status: 'pending', helpers: [] })], 0)
  expect(still).not.toContain('class="fa"')
  expect(still).not.toContain('class="bub"')
  expect(sceneSvg([farmer(0, { status: 'working', tools: 3, helpers: [] })], 0)).toContain('class="fa"')
})

test('neighbouring frames step out of time, the delay on the frames that animate', async () => {
  const svg = sceneSvg([farmer(0, { status: 'working', tools: 3, helpers: [] }), farmer(1, { status: 'working', tools: 3, helpers: [] })], 0)
  expect(svg).toContain('class="fa" style="animation-delay:-0.2s"')
  expect(svg).toContain('class="fb" style="animation-delay:-0.65s"')
  expect(svg).not.toContain('<g style="animation-delay')
})

test('a plan of eight shows six plots, keeping the step in progress in view', async () => {
  const all = asFarmers(plan('completed', 'completed', 'completed', 'completed', 'completed', 'in_progress', 'pending', 'pending'), [], true)
  expect(seat(all, 6).map(f => f.id)).toEqual(['1:2', '1:3', '1:4', '1:5', '1:6', '1:7'])
  expect(seat(all.slice(0, 4), 6).length).toBe(4)
})

test('steps read as done, working or waiting, and next', async () => {
  const p = plan('completed', 'in_progress', 'pending')
  expect(asFarmers(p, [], true).map(f => f.status)).toEqual(['done', 'working', 'pending'])
  expect(asFarmers(p, [], false).map(f => f.status)).toEqual(['done', 'waiting', 'pending'])
  expect(asFarmers(p, [], true).map(f => f.isCurrent)).toEqual([false, true, false])
})

test('a subagent helps only on the step it was spawned in, while it runs', async () => {
  const crit: Critter[] = [
    { id: '1', step: '1:0', label: 'x', model: 'claude-haiku-5-5', status: 'running' },
    { id: '2', step: '1:1', label: 'y', model: 'claude-opus-5-5', status: 'running' },
    { id: '3', step: '1:1', label: 'z', model: 'claude-opus-5-5', status: 'done' },
    { id: '4', step: '0:1', label: 'old', model: 'claude-opus-5-5', status: 'running' },
  ]
  const [a, b] = asFarmers(plan('completed', 'in_progress'), crit, true)
  expect(a?.helpers.map(h => h.label)).toEqual(['x'])
  // One still running from a plan since replaced helps on the step in progress.
  expect(b?.helpers.map(h => h.label)).toEqual(['y', 'old'])
  expect(asFarmers(plan('completed', 'completed', 'pending'), crit.slice(3), true)[2]?.helpers.map(h => h.label)).toEqual(['old'])
})

test('steps of the same name keep their own progress', async () => {
  const p: Plan = { seq: 1, steps: [
    { name: 'Run tests', status: 'completed', tools: 5, startedAt: 10, doneAt: 20 },
    { name: 'Fix bug', status: 'in_progress', tools: 2, startedAt: 20 },
    { name: 'Run tests', status: 'pending', tools: 0 },
  ] }
  const items = { items: p.steps.map(s => ({ content: s.name, status: s.status })) }
  const q = applyPlan(p, items, 30)
  expect(q.steps.map(s => [s.tools, s.startedAt, s.doneAt])).toEqual([[5, 10, 20], [2, 20, undefined], [0, undefined, undefined]])
  expect(asFarmers(q, [], true).map(f => f.isFresh)).toEqual([true, false, false])
  const crit: Critter[] = [{ id: '1', step: '1:2', label: 'second', model: 'claude-haiku-5-5', status: 'running' }]
  expect(rehome(crit, p, q).map(c => c.step)).toEqual(['2:2'])
})

test('the task list moves the plan as the app does', async () => {
  const p = applyPlan({ seq: 0, steps: [] }, { items: [{ content: 'Read', status: 'in_progress' }, { content: 'Write', status: 'pending' }, { content: 'Ship', status: 'pending' }] })
  expect(p.seq).toBe(1)
  expect(p.steps.map(s => s.status)).toEqual(['in_progress', 'pending', 'pending'])
  const q = applyPlan(p, { advance: true })
  expect(q.steps.map(s => s.status)).toEqual(['completed', 'in_progress', 'pending'])
  const r = applyPlan(q, { done: [2], start: 3 })
  expect(r.steps.map(s => s.status)).toEqual(['completed', 'completed', 'in_progress'])
  expect(applyPlan(r, { start: 1 }).steps.map(s => s.status)).toEqual(['in_progress', 'completed', 'pending'])
})

test('a step in progress reads as asking while a call waits on the person, stopped after a stopped turn', async () => {
  const p = plan('completed', 'in_progress')
  expect(asFarmers(p, [], true, { isAsking: true })[1]?.status).toBe('asking')
  expect(asFarmers(p, [], false, { isStopped: true })[1]?.status).toBe('stopped')
  expect(asFarmers(p, [], false, { isAsking: true })[1]?.status).toBe('waiting')
})

test('steps are stamped as they start and finish, and the last one finished celebrates', async () => {
  const p = applyPlan({ seq: 0, steps: [] }, { items: [{ content: 'A', status: 'in_progress' }, { content: 'B', status: 'pending' }] }, 1000)
  expect(p.steps[0]?.startedAt).toBe(1000)
  const q = applyPlan(p, { advance: true }, 2000)
  expect(q.steps.map(s => [s.startedAt, s.doneAt])).toEqual([[1000, 2000], [2000, undefined]])
  expect(asFarmers(q, [], true).map(f => f.isFresh)).toEqual([true, false])
  const r = finishPlan(q, 3000)
  expect(r.steps.map(s => s.doneAt)).toEqual([2000, 3000])
  expect(asFarmers(r, [], false).map(f => f.isFresh)).toEqual([false, true])
})

test('a list sent again mid-task keeps each step\'s crops, stamps and celebration', async () => {
  const items = (...s: [string, string][]) => ({ items: s.map(([content, status]) => ({ content, status })) })
  const p = applyPlan({ seq: 0, steps: [] }, items(['A', 'in_progress'], ['B', 'pending']), 1000)
  const q = applyPlan(countCall(countCall(applyPlan(p, { advance: true }, 2000))), {}, 2000)
  expect(q.steps.map(s => s.tools)).toEqual([0, 2])
  const r = applyPlan(q, items(['A', 'completed'], ['B', 'in_progress'], ['C', 'pending']), 3000)
  expect(r.seq).toBe(q.seq + 1)
  expect(r.steps.map(s => [s.tools, s.startedAt, s.doneAt])).toEqual([[0, 1000, 2000], [2, 2000, undefined], [0, undefined, undefined]])
  expect(asFarmers(r, [], true).map(f => f.isFresh)).toEqual([true, false, false])
  // A step the new list finishes is stamped then.
  expect(applyPlan(r, items(['A', 'completed'], ['B', 'completed'], ['C', 'in_progress']), 4000).steps.map(s => s.doneAt)).toEqual([2000, 4000, undefined])
})

test('helpers move with their step when the list is sent again', async () => {
  const before: Plan = { seq: 1, steps: [{ name: 'A', status: 'completed', tools: 0 }, { name: 'B', status: 'in_progress', tools: 0 }] }
  const after: Plan = { seq: 2, steps: [{ name: 'Z', status: 'completed', tools: 0 }, { name: 'B', status: 'in_progress', tools: 0 }, { name: 'C', status: 'pending', tools: 0 }] }
  const crit: Critter[] = [
    { id: '1', step: '1:1', label: 'on B', model: 'claude-haiku-5-5', status: 'running' },
    { id: '2', step: '1:0', label: 'on A', model: 'claude-haiku-5-5', status: 'running' },
    { id: '3', step: '1:1', label: 'gone', model: 'claude-haiku-5-5', status: 'done' },
  ]
  expect(rehome(crit, before, after).map(c => c.step)).toEqual(['2:1', '2:1', '1:1'])
  expect(asFarmers(after, rehome(crit, before, after), true)[1]?.helpers.map(h => h.label)).toEqual(['on B', 'on A'])
  expect(rehome(crit, before, before)).toBe(crit)
})

test('a call past full growth writes nothing, and a helper with no step in progress goes to the next one', async () => {
  const p = plan('in_progress')
  let q = p
  for (let k = 0; k < 8; k++) q = countCall(q)
  expect(q.steps[0]?.tools).toBe(8)
  expect(countCall(q)).toBe(q)
  expect(countCall(plan('completed'))).toEqual(plan('completed'))
  expect(helpStep(plan('completed', 'in_progress', 'pending'))).toBe('1:1')
  expect(helpStep(plan('completed', 'pending', 'pending'))).toBe('1:1')
  expect(helpStep(plan('completed', 'completed'))).toBe('1:1')
})

test('crops grow with time as well as tool calls, and wilt when the turn stopped', async () => {
  const p: Plan = { seq: 1, steps: [{ name: 'a', status: 'in_progress', tools: 0, startedAt: 0 }] }
  const at = (min: number, m = {}) => asFarmers(p, [], false, { now: min * 60000, ...m })
  expect(at(20)[0]?.minutes).toBe(20)
  const stage = (min: number, m = {}) => { const f = at(min, m)[0]; return f ? plotStage(f) : undefined }
  expect([stage(0), stage(1), stage(2), stage(14), stage(15)]).toEqual(['none', 'none', 'sprout', 'sprout', 'grow'])
  expect(stage(20, { isStopped: true })).toBe('wilt')
  expect(stage(0, { isStopped: true })).toBe('none')
  expect(sceneSvg(at(20, { isStopped: true }), 0)).toContain('filter="url(#dry)"')
  expect(sceneSvg(at(0, { isStopped: true }), 0)).not.toContain('filter="url(#dry)"')
})

test('crops grow by tool calls at 1, 3 and 8, and the thinking Claude has dots', async () => {
  const f = (tools: number): Farmer => ({ id: '1:0', name: 'a', status: 'working', tools, helpers: [] })
  expect([0, 1, 2, 3, 7, 8, 40].map(n => plotStage(f(n)))).toEqual(['none', 'seed', 'seed', 'sprout', 'sprout', 'grow', 'grow'])
  expect(sceneSvg([f(0)], 0)).toContain(`href="${SPRITES.laptop_2}"`)
  expect(sceneSvg([f(0)], 0)).not.toContain('class="fa"')
})

test('the clock redraws only when the light or a crop would change', async () => {
  const p: Plan = { seq: 1, steps: [{ name: 'a', status: 'in_progress', tools: 0, startedAt: 0 }] }
  const key = (min: number, hour: number) => timeKey(asFarmers(p, [], true, { now: min * 60000 }), hour)
  expect(key(3, 12)).toBe(key(10, 12))
  expect(key(1, 12)).not.toBe(key(3, 12))
  expect(key(3, 12)).not.toBe(key(3, 19))
  expect(key(3, 4)).not.toBe(key(3, 5))
  expect(key(3, 8)).not.toBe(key(3, 7))
})

test('the farm gets new states drawn, bales for the harvest and lit windows at night', async () => {
  const one = (over: Partial<Farmer>) => sceneSvg([farmer(0, { helpers: [], tools: 3, ...over })], 0)
  const drawn = (['asking', 'stopped', 'working', 'waiting', 'done', 'pending'] as const).map(status => one({ status }))
  expect(new Set(drawn).size).toBe(drawn.length)
  expect(one({ status: 'asking' })).toContain(`href="${SPRITES.laptop_0}"`)
  expect(one({ status: 'asking' })).not.toContain('class="fa"')
  expect(one({ status: 'asking' })).toContain('#ffe7a8')
  expect(one({ status: 'stopped' })).toContain(`href="${SPRITES.claude_blink}"`)
  expect(one({ status: 'done', isFresh: true })).toContain(`href="${SPRITES.claude_happy}"`)
  expect(one({ status: 'done' })).toContain(`href="${SPRITES.claude_sleep}"`)
  const bales = (harvest: number) => count(sceneSvg([], harvest, 0, 13), '#8a5a1e') / 2
  expect([0, 4, 5, 14, 15, 29, 30, 99].map(bales)).toEqual([0, 0, 1, 1, 2, 2, 3, 3])
  expect(sceneSvg([], 0, 0, 23)).toContain('#ffd77a')
  expect(sceneSvg([], 0, 0, 19)).toContain('#ffd77a')
  expect(sceneSvg([], 0, 0, 13)).not.toContain('#ffd77a')
  expect(sceneSvg([], 0, 0, 6)).toContain('rgba(255,179,138')
  expect(sceneSvg([], 0, 0, 19)).toContain('rgba(255,138,61')
})

test('a plan of one step is named after its prompt, never the app\'s reminders', async () => {
  expect(taskName('<system-reminder>The user said</system-reminder>Lets test crab farm see', 1)).toBe('Lets test crab farm see')
  expect(taskName('', 4)).toBe('task 4')
})

test('a sign spells whole words that fit, filler left out', async () => {
  expect(signName('Lets test crab farm see how it looks')).toBe('TEST CRAB')
  expect(signName('Work on the farm to make it look nicer')).toBe('WORK FARM')
  expect(signName('add more claudes')).toBe('ADD MORE')
  expect(signName('the it')).toBe('THE IT')
  expect(signName('internationalisation')).toBe('INTERNAT')
  expect(signName('Café über')).toBe('CAFE UBER')
})

test('each step of the task list gets a Claude, and its subagents help on its plot', async ($, on) => {
  on('command.register', () => ({ value: { command: 'farm' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('agent.spawn', () => ({ agentId: 'ag1', model: 'claude-haiku-5-5' }))

  const planTool = 'mcp__ccd_turn__update_plan'
  const pane = () => $.ui.mount({
    plugin: 'crab-farm', component: 'Pane', requestId: 'crab-farm', surface: 'terminal',
    props: { title: 'Crab Farm', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  const line = async (text: RegExp) => {
    const ui = await pane()
    const found = (await ui.find({ type: 'Text', text }))?.text ?? ''
    await ui.unmount()
    return found
  }

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ turnId: '1', text: 'Lets test crab farm' })
  expect(await line(/Lets test crab/)).toContain('working')

  await $.tool.call({ tool: planTool, scope: 'continuation', items: [
    { content: 'Read the source', status: 'in_progress' },
    { content: 'Rework the plots', status: 'pending' },
    { content: 'Ship it', status: 'pending' },
  ] })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: planTool, advance: true })
  await $.agent.spawn({ tool_use_id: 'u1', prompt: 'p', description: 'look around', subagentType: 'Explore' } as never)

  expect(await line(/Crab Farm/)).toContain('1/3 steps')
  expect(await line(/Read the source/)).toContain('done')
  expect(await line(/Rework the plots/)).toContain('working · 1 helpers')
  expect(await line(/Ship it/)).toContain('next')

  await $.turn.complete({ turnId: '1', reason: 'answer', text: '' } as never)
  expect(await line(/Rework the plots/)).toContain('waiting for you')

  await $.turn.start({ turnId: '2', text: 'go on' })
  await $.turn.complete({ turnId: '2', reason: 'aborted', text: '' } as never)
  expect(await line(/Rework the plots/)).toContain('stopped')

  await $.turn.start({ turnId: '3', text: 'go on' })
  expect(await line(/Rework the plots/)).toContain('working')
  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'done' })
  expect(await line(/Crab Farm/)).toContain('3/3 steps')
  await $.turn.complete({ turnId: '3', reason: 'answer', text: '' } as never)

  // Turns 1 and 3 called tools and ended well; the subagent never reported back, so it brought nothing in.
  expect(await line(/Crab Farm/)).toContain('🌸 2')

  // A later turn with no task list is a new plan of one step, worked on, its helpers on its plot.
  await $.turn.start({ turnId: '4', text: 'fix the typo in README' })
  expect(await line(/fix the typo/)).toContain('working')
  await $.agent.spawn({ tool_use_id: 'u2', prompt: 'p', description: 'find it', subagentType: 'Explore' } as never)
  expect(await line(/fix the typo/)).toContain('1 helpers')
  expect(await line(/Crab Farm/)).toContain('0/1 steps')
})

test('helpers follow a re-sent list, one with no id leaves with its turn, and the next prompt gets its own Claude', async ($, on) => {
  let ids = ['ag1']
  on('store.get', () => ({ value: 0 }) as never)
  on('store.set', () => ({ value: undefined }) as never)
  on('clock.every', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: { command: 'farm' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('agent.spawn', () => { const agentId = ids.shift(); return (agentId ? { agentId, model: 'claude-haiku-5-5' } : { model: 'claude-haiku-5-5' }) as never })

  const planTool = 'mcp__ccd_turn__update_plan'
  const line = async (text: RegExp) => {
    const ui = await $.ui.mount({
      plugin: 'crab-farm', component: 'Pane', requestId: 'crab-farm', surface: 'terminal',
      props: { title: 'Crab Farm', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
    })
    const found = (await ui.find({ type: 'Text', text }))?.text ?? ''
    await ui.unmount()
    return found
  }
  const spawn = (id: string) => $.agent.spawn({ tool_use_id: id, prompt: 'p', description: id, subagentType: 'Explore' } as never)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ turnId: '1', text: 'explain the farm' })
  await $.tool.call({ tool: planTool, scope: 'first_task', items: [{ content: 'Read', status: 'completed' }, { content: 'Draw', status: 'in_progress' }] })
  await spawn('u1')
  ids = []
  await spawn('u2')
  expect(await line(/Draw/)).toContain('2 helpers')

  // The list again, a step added in front: both helpers stay with Draw.
  await $.tool.call({ tool: planTool, scope: 'continuation', items: [{ content: 'Plan', status: 'completed' }, { content: 'Read', status: 'completed' }, { content: 'Draw', status: 'in_progress' }] })
  expect(await line(/Draw/)).toContain('2 helpers')

  // The turn ends: the helper with no id goes, the one still running stays.
  const end = (turnId: string) => $.turn.complete({ turnId, reason: 'answer', answer: '', text: '' } as never)
  await end('1')
  expect(await line(/Draw/)).toContain('1 helpers')

  // A step the task list left in progress carries on into the next turn, until the turn wraps up.
  await $.turn.start({ turnId: '2', text: 'go on' })
  expect(await line(/Draw/)).toContain('working · 1 helpers')
  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'done' })
  await end('2')

  // Then a prompt with no task list gets its own Claude, the running helper with it; and so does the next prompt,
  // though the turn before never wrapped up.
  await $.turn.start({ turnId: '3', text: 'quick question' })
  expect(await line(/quick question/)).toContain('working · 1 helpers')
  expect(await line(/Draw/)).toBe('')
  await end('3')
  await $.turn.start({ turnId: '4', text: 'rename the barn' })
  expect(await line(/rename the barn/)).toContain('working · 1 helpers')
  expect(await line(/quick question/)).toBe('')
})

test('/farm hides the pane and brings it back', async ($, on) => {
  const open = new Set<string>()
  on('command.register', () => ({ value: { command: 'farm' } }))
  on('ui.open', (_, e) => { open.add(e.id); return { value: { isPlaced: true } } })
  on('ui.close', (_, e) => { open.delete(e.id); return { value: undefined } })
  on('ui.panes', () => ({ value: [...open].map(id => ({ id })) }) as never)
  on('store.get', () => ({ value: 7 }) as never)
  on('clock.every', () => ({ value: undefined }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(open.has('crab-farm')).toBe(true)
  expect((await $.command.run({ command: 'farm' } as never)).text).toContain('closed')
  expect(open.has('crab-farm')).toBe(false)
  expect((await $.command.run({ command: 'farm' } as never)).text).toContain('opened')
  expect(open.has('crab-farm')).toBe(true)
})
