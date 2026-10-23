export type Farm = {
  /** The main loop is mid-turn. */
  isWorking: boolean
  /** The text the current turn started with: a plan of one step is named after it. */
  turnText: string
  /** The main loop has called a tool this turn: the turn brings in a crop. */
  turnHadTools: boolean
  /** Tasks started this session (the task list's first_task and new_task). */
  taskCount: number
  /** Crops harvested across sessions (working turns and finished subagents), mirrored from $.store. */
  harvest: number
  /** A tool call of the main loop is waiting on a permission prompt or a question put to the person. */
  isAsking?: boolean
  /** The last turn was stopped or failed: the step in progress wilts until work resumes. */
  isStopped?: boolean
}

/** One step of the plan: its own Claude on its own plot. */
export type Step = {
  name: string
  status: 'pending' | 'in_progress' | 'completed'
  /** Main-loop tool calls made while this step was in progress: its crops grow with them. */
  tools: number
  /** When the step was first put in progress (ms since the epoch): its crops also grow with time. */
  startedAt?: number
  /** When the step was finished: the most recent one celebrates. */
  doneAt?: number
}

/** The task list as the farm follows it; a new list replaces it and gets a new `seq`. */
export type Plan = {
  seq: number
  steps: Step[]
}

export type Critter = {
  id: string
  agentId?: string
  /** The plan and step in progress when the subagent was spawned (`<seq>:<index>`): it helps on that plot. */
  step: string
  label: string
  model: string
  status: 'running' | 'done' | 'failed'
}

/** A Claude as drawn: one step of the plan, or a sleeping placeholder before the first prompt. */
export type Farmer = {
  id: string
  name: string
  /**
   * working: its step is in progress mid-turn (thinking until its first tool call); asking: a call of the step waits on
   * the person; waiting: in progress, the turn over; stopped: in progress, the turn stopped or failed; done; pending:
   * not started; asleep: no plan yet.
   */
  status: 'working' | 'asking' | 'waiting' | 'stopped' | 'done' | 'pending' | 'asleep'
  tools: number
  /** Minutes the step has been in progress. */
  minutes?: number
  /** The most recently finished step: its Claude celebrates. */
  isFresh?: boolean
  /** Its running subagents: the mini Claudes on its plot. */
  helpers: { label: string; model: string }[]
  /** The step in progress, its sign in gold. */
  isCurrent?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'crab-farm': { farm: Farm; plan: Plan; critters: Critter[] }
  }
}
