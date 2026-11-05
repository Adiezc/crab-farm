import { expect, test } from 'claude-code/testing'
import { countCall, currentStep, emptyPlan, reducePlan, seatSteps, taskName, toEvents, workStep } from './plan'
import type { PlanEvent, PlanItem } from './plan'
import type { Plan, StepStatus } from '../../types'

const PLAN = 'mcp__ccd_turn__update_plan'
const items = (...s: [string, StepStatus][]): PlanItem[] => s.map(([name, status]) => ({ name, status }))
const list = (...s: [string, StepStatus][]): PlanEvent => ({ kind: 'replace', source: 'plan', items: items(...s) })
const apply = (plan: Plan, now: number, ...evs: PlanEvent[]): Plan => evs.reduce((p, ev) => reducePlan(p, ev, now), plan)
const viaTool = (plan: Plan, tool: string, args: Record<string, unknown>, now: number, result?: unknown): Plan =>
  apply(plan, now, ...toEvents(tool, args, result))
const statuses = (p: Plan): StepStatus[] => p.steps.map(s => s.status)
const calls = (p: Plan, n: number, now = 0): Plan => {
  for (let i = 0; i < n; i++) p = countCall(p, currentStep(p)?.id, now)
  return p
}

test('the task list moves the plan as the app does', async () => {
  const p = viaTool(emptyPlan(), PLAN, { items: [{ content: 'Read', status: 'in_progress' }, { content: 'Write', status: 'pending' }, { content: 'Ship', status: 'pending' }] }, 0)
  expect(p.source).toBe('plan')
  expect(statuses(p)).toEqual(['in_progress', 'pending', 'pending'])
  const q = viaTool(p, PLAN, { advance: true }, 0)
  expect(statuses(q)).toEqual(['completed', 'in_progress', 'pending'])
  const r = viaTool(q, PLAN, { done: [2], start: 3 }, 0)
  expect(statuses(r)).toEqual(['completed', 'completed', 'in_progress'])
  expect(statuses(viaTool(r, PLAN, { start: 1 }, 0))).toEqual(['in_progress', 'completed', 'pending'])
  expect(statuses(viaTool(r, 'mcp__ccd_turn__wrap_up', { recap: 'x' }, 0))).toEqual(['completed', 'completed', 'completed'])
  // Its result is not a second plan, and a move with nothing in it is nothing.
  expect(toEvents(PLAN, { items: [] }, { ok: true })).toEqual([])
  expect(toEvents(PLAN, {})).toEqual([])
})

test('steps are stamped as they start and finish', async () => {
  const p = apply(emptyPlan(), 1000, list(['A', 'in_progress'], ['B', 'pending']))
  expect(p.steps[0]?.startedAt).toBe(1000)
  const q = apply(p, 2000, { kind: 'move', advance: true })
  expect(q.steps.map(s => [s.startedAt, s.doneAt])).toEqual([[1000, 2000], [2000, undefined]])
  const r = apply(q, 3000, { kind: 'finish' })
  expect(r.steps.map(s => s.doneAt)).toEqual([2000, 3000])
})

test('steps of the same name keep their own progress', async () => {
  let p = apply(emptyPlan(), 10, list(['Run tests', 'in_progress'], ['Fix bug', 'pending'], ['Run tests', 'pending']))
  p = calls(p, 5, 15)
  p = apply(p, 20, { kind: 'move', advance: true })
  p = calls(p, 2, 25)
  const q = apply(p, 30, list(['Run tests', 'completed'], ['Fix bug', 'in_progress'], ['Run tests', 'pending']))
  expect(q.steps.map(s => [s.id, s.calls, s.startedAt, s.doneAt])).toEqual([
    ['n:0:Run tests', 5, 10, 20], ['n:0:Fix bug', 2, 20, undefined], ['n:1:Run tests', 0, undefined, undefined],
  ])
})

test('a list sent again mid-task keeps each step\'s crops, stamps, seat and pay', async () => {
  let p = apply(emptyPlan(), 1000, list(['A', 'in_progress'], ['B', 'pending']))
  p = apply(p, 2000, { kind: 'move', advance: true })
  p = calls(p, 2, 2500)
  p = { ...p, steps: p.steps.map(s => (s.name === 'A' ? { ...s, paid: true as const } : s)) }
  const r = apply(p, 3000, list(['A', 'completed'], ['B', 'in_progress'], ['C', 'pending']))
  expect(r.rev).toBe(p.rev)
  expect(r.steps.map(s => [s.calls, s.startedAt, s.doneAt, s.paid])).toEqual([[0, 1000, 2000, true], [2, 2000, undefined, undefined], [0, undefined, undefined, undefined]])
  expect(r.seats.slice(0, 3)).toEqual(['n:0:A', 'n:0:B', 'n:0:C'])
  // A step the new list finishes is stamped then; one it moves back loses its finish.
  expect(apply(r, 4000, list(['A', 'completed'], ['B', 'completed'], ['C', 'in_progress'])).steps.map(s => s.doneAt)).toEqual([2000, 4000, undefined])
  expect(apply(r, 4000, list(['A', 'in_progress'], ['B', 'pending'], ['C', 'pending'])).steps[0]?.doneAt).toBeUndefined()
  // The very same list again is the very same plan.
  expect(apply(r, 5000, list(['A', 'completed'], ['B', 'in_progress'], ['C', 'pending']))).toBe(r)
  // A step it drops leaves the plan and frees its seat; the others keep theirs.
  const s = apply(r, 6000, list(['A', 'completed'], ['C', 'in_progress']))
  expect(s.seats.slice(0, 3)).toEqual(['n:0:A', null, 'n:0:C'])
})

test('TodoWrite keeps progress, and its result is the list the app keeps', async () => {
  const todos = (...s: [string, StepStatus][]) => s.map(([content, status]) => ({ content, status, activeForm: `${content}ing` }))
  let p = viaTool(emptyPlan(), 'TodoWrite', { todos: todos(['Read', 'in_progress'], ['Edit', 'pending']) }, 100)
  expect(p.source).toBe('todo')
  expect(p.steps[0]?.doing).toBe('Reading')
  p = calls(p, 3, 150)
  const q = viaTool(p, 'TodoWrite', { todos: [] }, 200, { oldTodos: [], newTodos: todos(['Read', 'completed'], ['Edit', 'in_progress']) })
  expect(q.steps.map(s => [s.calls, s.status])).toEqual([[3, 'completed'], [0, 'in_progress']])
  // Several in progress at once are allowed; the one started last is current.
  const r = viaTool(q, 'TodoWrite', { todos: todos(['Read', 'completed'], ['Edit', 'in_progress'], ['Test', 'in_progress']) }, 300)
  expect(currentStep(r)?.name).toBe('Test')
})

test('TaskCreate makes a step only from its result, and the Task tools keep their own order', async () => {
  expect(toEvents('TaskCreate', { subject: 'Plant' })).toEqual([])
  expect(toEvents('TaskCreate', { subject: 'Plant' }, { error: 'denied' })).toEqual([])
  let p = viaTool(emptyPlan(), 'TaskCreate', { subject: 'Plant', activeForm: 'Planting' }, 10, { task: { id: '2', subject: 'Plant' } })
  p = viaTool(p, 'TaskCreate', { subject: 'Dig' }, 20, { task: { id: '1', subject: 'Dig' } })
  p = viaTool(p, 'TaskCreate', { subject: 'Water' }, 30, { task: { id: '10', subject: 'Water' } })
  expect(p.source).toBe('tasks')
  expect(p.steps.map(s => [s.id, s.name])).toEqual([['k:1', 'Dig'], ['k:2', 'Plant'], ['k:10', 'Water']])
  expect(p.steps[1]?.doing).toBe('Planting')
  // Creating the same id twice changes nothing.
  expect(viaTool(p, 'TaskCreate', { subject: 'Dig' }, 40, { task: { id: '1', subject: 'Dig' } })).toBe(p)
})

test('TaskUpdate moves a task, names an unknown one after its subject, and a deleted one leaves', async () => {
  let p = viaTool(emptyPlan(), 'TaskCreate', {}, 10, { task: { id: '1', subject: 'Dig' } })
  p = viaTool(p, 'TaskUpdate', { taskId: '1', status: 'in_progress' }, 20, { success: true, taskId: '1', updatedFields: ['status'] })
  expect(statuses(p)).toEqual(['in_progress'])
  expect(p.steps[0]?.startedAt).toBe(20)
  // A failed update changes nothing; so does one before it ran.
  expect(viaTool(p, 'TaskUpdate', { taskId: '1', status: 'completed' }, 30, { success: false, taskId: '1', updatedFields: [] })).toBe(p)
  expect(toEvents('TaskUpdate', { taskId: '1', status: 'completed' })).toEqual([])
  p = viaTool(p, 'TaskUpdate', { taskId: '7', subject: 'Fence', status: 'pending' }, 40, { success: true, taskId: '7', updatedFields: [] })
  p = viaTool(p, 'TaskUpdate', { taskId: '9' }, 45, { success: true, taskId: '9', updatedFields: [] })
  expect(p.steps.map(s => s.name)).toEqual(['Dig', 'Fence', 'task 9'])
  p = viaTool(p, 'TaskUpdate', { taskId: '7', status: 'deleted' }, 50, { success: true, taskId: '7', updatedFields: ['status'] })
  expect(p.steps.map(s => s.id)).toEqual(['k:1', 'k:9'])
  expect(p.seats.includes('k:7')).toBe(false)
})

test('TaskList heals the plan by id, keeping progress, and drops what it no longer lists', async () => {
  let p = viaTool(emptyPlan(), 'TaskCreate', {}, 10, { task: { id: '1', subject: 'Dig' } })
  p = viaTool(p, 'TaskCreate', {}, 10, { task: { id: '2', subject: 'Plant' } })
  p = apply(p, 20, { kind: 'update', id: '1', status: 'in_progress' })
  p = calls(p, 4, 25)
  const tasks = [{ id: '1', subject: 'Dig deep', status: 'in_progress', blockedBy: [] }, { id: '3', subject: 'Water', status: 'pending', blockedBy: [] }]
  const q = viaTool(p, 'TaskList', {}, 30, { tasks })
  expect(q.steps.map(s => [s.id, s.name, s.calls, s.startedAt])).toEqual([['k:1', 'Dig deep', 4, 20], ['k:3', 'Water', 0, undefined]])
})

test('the prompt is a plan of one step until a real list arrives, which absorbs it', async () => {
  const p = apply(emptyPlan(), 100, { kind: 'prompt', name: 'fix the barn', turnId: 't1' })
  expect(p.steps.map(s => [s.id, s.status, s.startedAt])).toEqual([['p:t1', 'in_progress', 100]])
  expect(p.seats[0]).toBe('p:t1')
  const worked = calls(p, 3, 150)
  // The first list's step in progress inherits the prompt's calls, its start and its seat: the crab keeps standing.
  const q = apply(worked, 200, list(['Look', 'completed'], ['Fix', 'in_progress'], ['Ship', 'pending']))
  expect(q.rev).toBe(p.rev + 1)
  expect(q.steps.map(s => [s.id, s.calls, s.startedAt])).toEqual([['n:0:Look', 0, undefined], ['n:0:Fix', 3, 100], ['n:0:Ship', 0, undefined]])
  expect(q.seats[0]).toBe('n:0:Fix')
  // With nothing in progress, the first step takes it.
  expect(apply(worked, 200, list(['A', 'pending'], ['B', 'pending'])).steps[0]?.calls).toBe(3)
  // A real list never yields to a prompt while it has work left; once done, the next prompt is a fresh plan.
  expect(apply(q, 300, { kind: 'prompt', name: 'go on', turnId: 't2' })).toBe(q)
  const done = apply(q, 400, { kind: 'finish' })
  const next = apply(done, 500, { kind: 'prompt', name: 'rename the barn', turnId: 't3' })
  expect(next.steps.map(s => s.name)).toEqual(['rename the barn'])
  expect(next.seats).toEqual(['p:t3', null, null, null, null, null])
  // Each later prompt gets its own step, though the one before never finished.
  const again = apply(next, 600, { kind: 'prompt', name: 'quick question', turnId: 't4' })
  expect(again.steps.map(s => s.id)).toEqual(['p:t4'])
  expect(apply(again, 700, { kind: 'prompt', name: 'quick question', turnId: 't4' })).toBe(again)
})

test('a list from another source replaces the plan, carrying progress by name', async () => {
  let p = apply(emptyPlan(), 0, list(['Read', 'completed'], ['Draw', 'in_progress']))
  p = calls(p, 2, 10)
  const q = apply(p, 20, { kind: 'replace', source: 'todo', items: items(['Draw', 'in_progress'], ['Ship', 'pending']) })
  expect(q.source).toBe('todo')
  expect(q.rev).toBe(p.rev + 1)
  expect(q.steps.map(s => [s.name, s.calls])).toEqual([['Draw', 2], ['Ship', 0]])
  // An empty list from another source is nothing to follow.
  expect(apply(q, 30, { kind: 'replace', source: 'plan', items: [] })).toBe(q)
})

test('the current step is the one in progress started last; calls and helpers go to it, else the next, else the last', async () => {
  const p = apply(emptyPlan(), 0, list(['A', 'completed'], ['B', 'in_progress'], ['C', 'pending']))
  expect(currentStep(p)?.name).toBe('B')
  expect(workStep(p)?.name).toBe('B')
  const q = apply(p, 10, { kind: 'move', done: [2] })
  expect(currentStep(q)).toBeUndefined()
  expect(workStep(q)?.name).toBe('C')
  expect(workStep(apply(q, 20, { kind: 'finish' }))?.name).toBe('C')
  expect(workStep(emptyPlan())).toBeUndefined()
})

test('a call past full growth keeps counting to 999, then changes nothing; one with nothing in progress counts nowhere', async () => {
  const p = apply(emptyPlan(), 0, list(['A', 'in_progress']))
  const q = calls(p, 9)
  expect(q.steps[0]?.calls).toBe(9)
  const full = { ...q, steps: q.steps.map(s => ({ ...s, calls: 999 })) }
  expect(countCall(full, 'n:0:A', 5)).toBe(full)
  const done = apply(p, 0, { kind: 'finish' })
  expect(countCall(done, 'n:0:A', 5)).toBe(done)
})

test('a plan of eight shows six plots, keeping the step in progress in view', async () => {
  const p = apply(emptyPlan(), 0, list(['1', 'completed'], ['2', 'completed'], ['3', 'completed'], ['4', 'completed'], ['5', 'completed'], ['6', 'in_progress'], ['7', 'pending'], ['8', 'pending']))
  expect(p.seats).toEqual(['n:0:3', 'n:0:4', 'n:0:5', 'n:0:6', 'n:0:7', 'n:0:8'])
  expect(seatSteps(p)).toBe(p)
})

test('steps keep their seats as the plan moves; a new step takes the seat of the step finished first', async () => {
  const names = Array.from({ length: 6 }, (_, i) => `s${i}`)
  let p = apply(emptyPlan(), 0, list(...names.map((n, i): [string, StepStatus] => [n, i === 0 ? 'in_progress' : 'pending'])))
  const seats0 = p.seats
  for (let i = 1; i < 6; i++) p = apply(p, i * 100, { kind: 'move', advance: true })
  expect(p.seats).toEqual(seats0)
  // Two more steps: they take the seats of s0 and s1, the first two finished.
  p = apply(p, 1000, list(...names.map((n): [string, StepStatus] => [n, n === 's5' ? 'in_progress' : 'completed']), ['s6', 'pending'], ['s7', 'pending']))
  expect(p.seats).toEqual(['n:0:s6', 'n:0:s7', 'n:0:s2', 'n:0:s3', 'n:0:s4', 'n:0:s5'])
})

test('with up to 24 steps the step in progress is always seated, evicting the last pending one', async () => {
  for (const n of [8, 12, 24, 30]) {
    const all = Array.from({ length: n }, (_, i): [string, StepStatus] => [`s${i}`, 'pending'])
    let p = apply(emptyPlan(), 0, list(...all))
    expect(p.steps.length).toBe(Math.min(n, 24))
    expect(p.seats).toEqual(['n:0:s0', 'n:0:s1', 'n:0:s2', 'n:0:s3', 'n:0:s4', 'n:0:s5'])
    const last = Math.min(n, 24)
    p = apply(p, 10, { kind: 'move', start: last })
    expect(p.seats).toEqual(['n:0:s0', 'n:0:s1', 'n:0:s2', 'n:0:s3', 'n:0:s4', `n:0:s${last - 1}`])
    for (let k = 0; k < last; k++) {
      p = apply(p, 20 + k, { kind: 'move', start: k + 1 })
      expect(p.seats.includes(currentStep(p)?.id ?? '')).toBe(true)
      expect(new Set(p.seats.filter(Boolean)).size).toBe(p.seats.filter(Boolean).length)
    }
  }
})

test('a plan of one step is named after its prompt, never the app\'s reminders', async () => {
  expect(taskName('<system-reminder>The user said</system-reminder>Lets test crab farm see', 1)).toBe('Lets test crab farm see')
  expect(taskName('', 4)).toBe('task 4')
  expect(taskName('one two three four five six seven eight nine', 1)).toBe('one two three four five six seven eight')
})
