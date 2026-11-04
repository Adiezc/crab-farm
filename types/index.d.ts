// The farm's state contract: self-contained, as the engine reads it. hooks/contracts.ts re-exports the words below.

/** Wall-clock milliseconds since the epoch. */
export type Ms = number
/** Farm time: wall time less the time spent paused while Claude asks you something. */
export type Ft = number
/** A point in world pixels (the world is 180 × 250). For an actor, where its feet are. */
export type Pt = { x: number; y: number }
export type Model = 'haiku' | 'sonnet' | 'opus' | 'fable'

export type LandmarkId =
  | 'home' | 'row' | 'fence' | 'barnDoor' | 'barnIn' | 'eave' | 'yard' | 'pond' | 'compost' | 'lookout' | 'stump'
  | 'shade' | 'gate' | 'coop' | 'barrel' | 'mailbox' | 'bench' | 'well' | 'jetty' | 'windmill' | 'orchard'
  | 'paddock' | 'market' | 'greenhouse' | 'cart' | 'telescope' | 'hayloft' | 'gazebo' | 'sign'

export type JobKind =
  | 'inspect' | 'scout' | 'till' | 'sow' | 'pots' | 'water' | 'sprinkle' | 'mill' | 'deliver' | 'pack' | 'ship'
  | 'post' | 'lookout' | 'hire' | 'trade' | 'stake' | 'almanac' | 'bell' | 'alarm' | 'watch' | 'blueprint'
  | 'backfield' | 'tinker'
  | 'harvest' | 'haul' | 'compost' | 'arrive' | 'leave' | 'basket' | 'muster'

/** The ladder's builds, in order. Only the first SHIPPED_BUILDS (hooks/contracts.ts) have art in this version. */
export type UnlockId =
  | 'scarecrow' | 'coop' | 'barrel' | 'mailbox' | 'bench' | 'cat' | 'flowers' | 'hive' | 'well' | 'jetty'
  | 'windmill' | 'orchard' | 'cow' | 'market' | 'ducks' | 'greenhouse' | 'sheep' | 'lamps' | 'vane'
  | 'pumpkins' | 'cart' | 'telescope' | 'hayloft' | 'green'

// ---- the one plan model: the desktop app's task list, TodoWrite, the Task tools, or the prompt ----

export type StepStatus = 'pending' | 'in_progress' | 'completed'
export type PlanSource = 'plan' | 'todo' | 'tasks' | 'prompt'

/** One step of the plan: its own crab on its own plot. */
export type Step = {
  /** 'n:<k>:<name>' from a list (k: earlier steps of that name), 'k:<taskId>' from the Task tools, 'p:<turnId>' from a prompt. */
  id: string
  /** The list's content, the task's subject, or the prompt's first words. */
  name: string
  /** The present-tense form (activeForm), for the hover card. */
  doing?: string
  status: StepStatus
  /** Main-loop calls made while it was in progress, capped at 999; crops grow with min(calls, 8). */
  calls: number
  startedAt?: Ms
  lastAt?: Ms
  doneAt?: Ms
  /** Its harvest coins are counted: a list sent again never pays twice. */
  paid?: true
  /** Deleted or dropped from the list: its crab composts the plot, then walks into the barn. */
  goneAt?: Ms
}

/** The plan as the farm follows it. At most 24 steps; six seats, each a step id or empty. */
export type Plan = { source: PlanSource; rev: number; steps: Step[]; seats: (string | null)[] }

// ---- jobs and the ones who do them ----

/** One errand of a crab, made from one tool call or several of the same kind merged. */
export type Job = {
  /** Per-session sequence: stable CSS ids. */
  n: number
  kind: JobKind
  /** Queued at, farm time, on a beat. */
  t0: Ft
  /** Resolved when queued, so a later build never moves a route already planned. */
  to: Pt
  /** For the hover card: "AT THE WELL". */
  land: LandmarkId
  /** Its act holds until the tool returns. */
  isOpen: boolean
  /** When the tool returned; absent on an open job still running. */
  until?: Ft
  /** Calls merged into it, at least 1. */
  count: number
  /** The last tool merged in: 'Bash', 'Edit', 'mcp__github__get_issue'. */
  tool: string
  /** At most 32 characters: 'npm test', 'register.tsx'. */
  note?: string
  /** False when the tool failed: a puddle and a shrug. */
  ok?: boolean
  /** An MCP server's neighbour colour, a hash of its name mod 360. */
  hue?: number
}

/** A seated step's crab. Its timeline is derived from the anchor and the jobs, never stored. */
export type Crab = {
  /** The step it works, or 'resident' for the farmhand when there is no plan. */
  stepId: string
  /** 0 to 5. */
  plot: number
  /** Where the timeline starts; moved forward as jobs finish and when a new job cuts in. */
  anchor: { ft: Ft; pt: Pt }
  /** At most 3. */
  jobs: Job[]
  /** Idle routines count from here. */
  restSince: Ft
  /** Leaving the farm (its step was dropped): it walks into the barn and is removed once there. */
  leavingAt?: Ft
}

/** A subagent: a mini on its step's plot, coloured by model. */
export type Helper = {
  id: string
  agentId?: string
  stepId: string
  plot: number
  /** 0 to 2 across the top of the plot; beyond three show as +N. */
  slot: number
  label: string
  model: Model
  since: Ft
  endedAt?: Ft
  outcome?: 'done' | 'failed'
  /** 1 to 3, from the Agent result's tool counts. */
  crates: number
}

/** A short effect at a point: coins floating up, a sparkle, a puddle, confetti for a build. */
export type Fx = {
  n: number
  kind: 'coins' | 'sparkle' | 'puddle' | 'confetti' | 'compost' | 'golden'
  at: Pt
  t0: Ft
  value?: number
  unlock?: UnlockId
}

/** Lifetime or per-session counts. */
export type Totals = {
  coins: number
  harvests: number
  calls: number
  crates: number
  helpers: number
  golden: number
  /** Lane segment id → walks along it, for worn paths. */
  trips: Record<string, number>
}

/** This session's earnings, kept with the day they count toward. */
export type Earn = Totals & {
  /** Local date, YYYY-MM-DD. */
  day: string
  callsToday: number
  harvestsToday: number
  /** Coins the board shows: it moves only when a crate or basket lands or a build appears. */
  shown: number
}

/** Everything that changes as Claude works, for this session. One atom: a write redraws. */
export type Live = {
  rev: number
  turn: { isWorking: boolean; id?: string; text: string; startedAt?: Ms; hadTools: boolean; outcome?: 'answer' | 'aborted' | 'error' | 'refusal' }
  asking?: { since: Ms; tool: string }
  /** Farm time is wall time less pausedMs; while asking it stands still at pauseFrom. */
  clock: { pausedMs: number; pauseFrom?: Ms }
  plan: Plan
  /** One per seated step, plus any still walking off. */
  crabs: Crab[]
  /** At most 24. */
  helpers: Helper[]
  /** At most 8, pruned 30 s after they start. */
  fx: Fx[]
  /** Tasks started this session (first_task and new_task), the board's TASKS. */
  tasks: number
  /** Next Job.n and Fx.n. */
  seq: number
  earn: Earn
}

// ---- progression ----

/** The farm across sessions, as last read from the store. */
export type Bank = {
  v: 2
  seed: number
  bornAt: Ms
  /** The folded base plus every other session's ledger, as of the last sync. */
  others: Totals
  /** Builds [0, owned) are standing. */
  owned: number
  builtAt: Partial<Record<UnlockId, Ms>>
  /** Days farmed, a lifetime count, never a streak. */
  days: number
  basketDay?: string
  snowmanYear?: number
  syncedAt: Ms
}

// ---- 1.2's values, read once to carry a session's farm across a reload, never written by 2.0 ----

export type Farm12 = {
  isWorking: boolean
  turnText: string
  turnHadTools: boolean
  taskCount: number
  harvest: number
  isAsking?: boolean
  isStopped?: boolean
}
export type Step12 = {
  name: string
  status: 'pending' | 'in_progress' | 'completed'
  tools: number
  startedAt?: number
  doneAt?: number
}
export type Plan12 = { seq: number; steps: Step12[]; isAuto?: boolean }
export type Critter12 = {
  id: string
  agentId?: string
  step: string
  label: string
  model: string
  status: 'running' | 'done' | 'failed'
}
/** 1.2's Claude as drawn, kept while its renderer is. */
export type Farmer = {
  id: string
  name: string
  status: 'working' | 'asking' | 'waiting' | 'stopped' | 'done' | 'pending' | 'asleep'
  tools: number
  minutes?: number
  isFresh?: boolean
  helpers: { label: string; model: string }[]
  isCurrent?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'crab-farm': {
      live: Shaped<Live>
      bank: Shaped<Bank>
      farm: Farm12
      plan: Plan12
      critters: Critter12[]
    }
  }
}
