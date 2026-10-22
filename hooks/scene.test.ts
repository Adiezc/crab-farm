import { expect, test } from 'claude-code/testing'
import { applyPlan, asFarmers, sceneSvg, seat, signName, taskName } from './register'
import type { Critter, Farmer, Plan } from '../types'

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
  expect(svg).not.toContain('<text')
  expect(svg.length).toBeLessThan(131072)
})

test('the farm is washed by the hour, with fireflies only at night', async () => {
  expect(sceneSvg([], 0, 0, 13)).not.toContain('class="ff"')
  expect(sceneSvg([], 0, 0, 23)).toContain('class="ff"')
  expect(sceneSvg([], 0, 0, 23)).toContain('rgba(20,28,70')
})

test('only the busy Claude animates', async () => {
  expect(sceneSvg([farmer(0, { status: 'done', helpers: [] }), farmer(1, { status: 'pending', helpers: [] })], 0)).not.toContain('class="fa"')
  expect(sceneSvg([farmer(0, { status: 'working', helpers: [] })], 0)).toContain('class="fa"')
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
  expect(b?.helpers.map(h => h.label)).toEqual(['y'])
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
  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'done' })
  expect(await line(/Crab Farm/)).toContain('3/3 steps')
})
