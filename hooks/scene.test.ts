import { expect, test } from 'claude-code/testing'
import { asFarmers, sceneSvg, seat, signName, taskName } from './register'
import type { Critter, Farmer, Task } from '../types'

const models = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1']
const farmer = (i: number, over: Partial<Farmer> = {}): Farmer => ({
  id: `t${i}`, name: `Task <${i}> & co`, status: (['done', 'waiting', 'working'] as const)[i % 3] ?? 'done',
  tools: i * 2, startedAt: 100 + i,
  helpers: Array.from({ length: i % 5 }, (_, k) => ({ label: `h${k}`, model: models[k % 4] ?? '' })), ...over,
})

test('every task is a Claude with its own plot, helpers on it, under the Svg size cap', async () => {
  const all = Array.from({ length: 6 }, (_, i) => farmer(i, { isCurrent: i === 5 }))
  const svg = sceneSvg(all, 3, 9)
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
  const done = sceneSvg([farmer(0, { status: 'done', helpers: [] })], 0, 1)
  expect(done).not.toContain('class="fa"')
  expect(sceneSvg([farmer(0, { status: 'working', helpers: [] })], 0, 1)).toContain('class="fa"')
})

test('the newest tasks get the plots, seated in start order', async () => {
  const all = Array.from({ length: 8 }, (_, i) => farmer(i))
  expect(seat(all, 6).map(f => f.id)).toEqual(['t2', 't3', 't4', 't5', 't6', 't7'])
})

test('a subagent helps only on the task it was spawned for, while it runs', async () => {
  const task = (id: string, status: Task['status']): Task => ({ id, name: id, startedAt: 1, turnId: id, tools: 0, status })
  const crit: Critter[] = [
    { id: '1', taskId: 'a', label: 'x', model: 'claude-haiku-5-5', status: 'running' },
    { id: '2', taskId: 'b', label: 'y', model: 'claude-opus-5-5', status: 'running' },
    { id: '3', taskId: 'b', label: 'z', model: 'claude-opus-5-5', status: 'done' },
  ]
  const [a, b] = asFarmers([task('a', 'done'), task('b', 'working')], crit)
  expect(a?.helpers.length).toBe(1)
  expect(b?.helpers.map(h => h.label)).toEqual(['y'])
  expect(a?.isCurrent).toBe(false)
  expect(b?.isCurrent).toBe(true)
})

test('a task is named after its prompt, never the app\'s reminders', async () => {
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

test('a new task gets a new Claude, a continuation stays with the current one', async ($, on) => {
  on('command.register', () => ({ value: { command: 'farm' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('agent.spawn', () => ({ agentId: 'ag1', model: 'claude-haiku-5-5' }))

  const plan = 'mcp__ccd_turn__update_plan'
  const turn = async (turnId: string, text: string, scope: string) => {
    await $.turn.start({ turnId, text })
    await $.tool.call({ tool: plan, items: [], scope })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
  }
  const end = (turnId: string) => $.turn.complete({ turnId, reason: 'answer', text: '' } as never)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await turn('1', 'Lets test crab farm', 'first_task')
  await end('1')
  await turn('2', 'add more claudes please', 'continuation')
  await $.agent.spawn({ tool_use_id: 'u1', prompt: 'p', description: 'look around', subagentType: 'Explore' } as never)
  await end('2')
  await turn('3', 'now write the readme', 'new_task')

  // The terminal's lines read the farm back: two Claudes, the helper on the first task's plot.
  const ui = await $.ui.mount({
    plugin: 'crab-farm', component: 'Pane', requestId: 'crab-farm', surface: 'terminal',
    props: { title: 'Crab Farm', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  expect((await ui.find({ type: 'Text', text: /Crab Farm/ }))?.text).toContain('2 tasks')
  expect((await ui.find({ type: 'Text', text: /Lets test crab/ }))?.text).toContain('done · 1 helpers')
  expect((await ui.find({ type: 'Text', text: /now write the/ }))?.text).toContain('working')
  await ui.unmount()
})
