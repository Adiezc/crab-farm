// What a tool call becomes on the farm: the kind of job, whether its act holds until the tool returns, and its bubble.
// Pure. The order is the spec's: the exact tool name, then the mcp__ prefix, then the Bash command, then read-only.
import type { IconId, JobKind, ToolClass } from '../contracts'
import { hash32 } from './rng'

const NOTE_MAX = 32

/** The bubble each kind shows over the crab. */
const ICON: Record<JobKind, IconId> = {
  inspect: 'scroll', scout: 'magnifier', till: 'quill', sow: 'quill', pots: 'quill', water: 'terminal', sprinkle: 'terminal',
  mill: 'terminal', deliver: 'terminal', pack: 'terminal', ship: 'terminal', post: 'globe', lookout: 'globe', hire: 'roster',
  trade: 'plug', stake: 'plan', almanac: 'book', bell: 'heart', alarm: 'gear', watch: 'dots', blueprint: 'plan',
  backfield: 'dots', tinker: 'gear', harvest: 'dots', haul: 'dots', compost: 'dots', arrive: 'dots', leave: 'dots',
  basket: 'dots', muster: 'dots',
}

const clip = (s: string): string | undefined => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t ? (t.length > NOTE_MAX ? `${t.slice(0, NOTE_MAX - 1)}…` : t) : undefined
}
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const base = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? ''
const host = (url: string): string => url.replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0] ?? ''

const job = (kind: JobKind, isOpen: boolean, note?: string, icon: IconId = ICON[kind]): ToolClass =>
  note === undefined ? { kind, isOpen, icon } : { kind, isOpen, note, icon }

/** The neighbour colour of an MCP server: the same server is always the same hue. */
export const hueOf = (server: string): number => hash32('mcp', server) % 360

// Tools matched by their exact name, with the note each one shows.
const BY_NAME: Record<string, (a: Record<string, unknown>) => ToolClass> = {
  Read: a => job('inspect', false, clip(base(str(a.file_path)))),
  NotebookRead: a => job('inspect', false, clip(base(str(a.notebook_path)))),
  LSP: a => job('inspect', false, clip(base(str(a.filePath ?? a.file_path)))),
  Grep: a => job('scout', false, clip(str(a.pattern))),
  Glob: a => job('scout', false, clip(str(a.pattern))),
  ToolSearch: a => job('scout', false, clip(str(a.query))),
  Edit: a => job('till', false, clip(base(str(a.file_path)))),
  MultiEdit: a => job('till', false, clip(base(str(a.file_path)))),
  NotebookEdit: a => job(a.cell_type === 'markdown' || a.edit_mode === 'delete' ? 'pots' : 'till', false, clip(base(str(a.notebook_path)))),
  Write: a => job('sow', false, clip(base(str(a.file_path)))),
  WebFetch: a => job('post', true, clip(host(str(a.url)))),
  WebSearch: a => job('lookout', true, clip(str(a.query))),
  Agent: a => job('hire', false, clip(str(a.description))),
  Task: a => job('hire', false, clip(str(a.description))),
  TodoWrite: () => job('stake', false),
  TaskCreate: a => job('stake', false, clip(str(a.subject))),
  TaskUpdate: a => job('stake', false, clip(str(a.subject))),
  TaskList: () => job('stake', false),
  Skill: a => job('almanac', false, clip(str(a.skill))),
  PushNotification: () => job('bell', false),
  SendUserMessage: () => job('bell', false),
  ScheduleWakeup: () => job('alarm', false),
  CronCreate: () => job('alarm', false),
  CronDelete: () => job('alarm', false),
  CronList: () => job('alarm', false),
  Monitor: a => job('watch', true, clip(str(a.description))),
  EnterPlanMode: () => job('blueprint', false),
  ExitPlanMode: () => job('blueprint', false),
  EnterWorktree: () => job('backfield', false),
  ExitWorktree: () => job('backfield', false),
}

// Bash commands, first word (or two) after the wrappers. Tests come before builds, builds before installs.
// `test -f x` is the shell's own test, not a test run.
const TESTS = /^(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|go\s+test\b|cargo\s+test\b|claude\s+plugin\s+test\b|make\s+(?:test|check)\b|(?:pytest|jest|vitest|mocha|rspec)\b|test\b(?!\s+-)|python3?\s+-m\s+pytest\b)/
const BUILDS = /^(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b|vite\s+build\b|cargo\s+build\b|go\s+build\b|(?:build|make|tsc|webpack|esbuild|gradle|gradlew|\.\/gradlew|mvn)\b)/
const INSTALLS = /^(?:npm\s+(?:i|install|ci)\b|pnpm\s+(?:add|i|install)\b|yarn\s+add\b|pip3?\s+install\b|uv\s+(?:add|pip\s+install)\b|brew\s+install\b|cargo\s+add\b|go\s+get\b|bun\s+(?:add|install)\b)/
const GIT = /^git\s+(?:-C\s+\S+\s+|--no-pager\s+|-c\s+\S+\s+)*(\S+)/
const INSPECT = new Set(['cat', 'head', 'tail', 'less', 'more', 'wc', 'stat', 'file', 'du', 'bat'])
const SCOUT = new Set(['rg', 'grep', 'egrep', 'find', 'fd', 'ag', 'ls', 'tree'])
const GIT_LOOK = new Set(['status', 'log', 'diff', 'show', 'blame'])

/** The command a Bash call runs, without `cd … &&`, `VAR=x`, `sudo`, `time`, `npx`, `bunx` or `uv run` in front. */
export const coreCommand = (command: string): string => {
  let c = command.trim()
  for (let i = 0; i < 12; i++) {
    const next = c
      .replace(/^cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/, '')
      .replace(/^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+/, '')
      .replace(/^(?:sudo|time|npx|bunx|exec|command|nice|env|uv\s+run|poetry\s+run)\s+/, '')
      .replace(/^\(\s*/, '')
    if (next === c) break
    c = next
  }
  return c
}

const bash = (command: string): ToolClass => {
  const c = coreCommand(command)
  const note = clip(c)
  if (TESTS.test(c)) return job('sprinkle', true, note)
  if (BUILDS.test(c)) return job('mill', true, note)
  if (INSTALLS.test(c)) return job('deliver', true, note)
  const git = GIT.exec(c)?.[1]
  if (git === 'commit') return job('pack', false, note)
  if (git === 'push' || /^gh\s+pr\s+(?:create|merge)\b/.test(c)) return job('ship', false, note)
  if (git !== undefined && GIT_LOOK.has(git)) return job('inspect', false, note, 'terminal')
  const first = c.split(/\s+/)[0] ?? ''
  if (first === 'curl' || first === 'wget') return job('post', true, note, 'terminal')
  if (INSPECT.has(first)) return job('inspect', false, note, 'terminal')
  if (SCOUT.has(first)) return job('scout', false, note, 'terminal')
  return job('water', true, note)
}

// MCP tools that only look: by the tool's own read-only flag, else by the name's verb.
const LOOKS = /^(?:get|list|search|read|query|fetch|find|describe|view|show|lookup|count|check|whoami|download)/i

// Tools that are a glance, not an errand: they tinker briefly and never hold.
const QUIET = new Set(['TaskGet', 'TaskStop', 'KillShell', 'BashOutput', 'TaskOutput'])

const mcp = (tool: string, args: Record<string, unknown>, isReadOnly?: boolean): ToolClass => {
  const [, server = '', name = ''] = /^mcp__(.+?)__(.+)$/.exec(tool) ?? []
  if (server.includes('ccd_turn')) return job('stake', false)
  if (server === 'Claude_Browser' || server === 'claude-in-chrome') return job('post', true, clip(str(args.url) ? host(str(args.url)) : name))
  if (server.startsWith('ccd_')) return (isReadOnly ?? LOOKS.test(name)) ? job('tinker', false, clip(name), 'dots') : job('tinker', true, clip(name))
  const looks = isReadOnly ?? LOOKS.test(name)
  return { ...job('trade', !looks, clip(name)), hue: hueOf(server) }
}

export function classify(tool: string, args: Record<string, unknown>, isReadOnly?: boolean): ToolClass {
  const named = BY_NAME[tool]
  if (named) return named(args)
  if (tool.startsWith('mcp__')) return mcp(tool, args, isReadOnly)
  if (tool === 'Bash') return bash(str(args.command))
  if (QUIET.has(tool)) return job('tinker', false, undefined, 'dots')
  // An unknown tool that only looks is reading; anything else is tinkering in the barn until it returns.
  return isReadOnly === true ? job('inspect', false, undefined, 'dots') : job('tinker', true, undefined, 'gear')
}
