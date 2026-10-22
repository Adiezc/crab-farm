export type Farm = {
  /** The main loop is mid-turn. */
  isWorking: boolean
  /** The current main-loop turn, and the text it started with: a new task is named after it. */
  turnId: string
  turnText: string
  /** The current task's tool calls when this turn began: a turn that adds to them brings in a crop. */
  toolsAtTurnStart: number
  /** Tasks started this session, including any rolled off the kept list; the newest task's number. */
  taskCount: number
  /** Crops harvested across sessions (finished turns and subagents), mirrored from $.store. */
  harvest: number
}

/** One task of this session: its own Claude on its own plot. */
export type Task = {
  id: string
  name: string
  startedAt: number
  /** The turn the task began in. */
  turnId: string
  /** Main-loop tool calls made for this task: its crops grow with them. */
  tools: number
  /** working: mid-turn; waiting: its turn ended, waiting for the user; done: a later task took over. */
  status: 'working' | 'waiting' | 'done'
}

export type Critter = {
  id: string
  agentId?: string
  /** The task that was current when the subagent was spawned: it helps on that plot. */
  taskId: string
  label: string
  model: string
  status: 'running' | 'done' | 'failed'
}

/** A Claude as drawn: one task, or a sleeping placeholder before the first one. */
export type Farmer = {
  id: string
  name: string
  status: 'working' | 'waiting' | 'done' | 'asleep'
  tools: number
  startedAt: number
  /** Its running subagents: the little helpers on its plot. */
  helpers: { label: string; model: string }[]
  /** The newest task, named in yellow. */
  isCurrent?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'crab-farm': { farm: Farm; tasks: Task[]; critters: Critter[] }
  }
}
