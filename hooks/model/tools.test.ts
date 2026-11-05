import { expect, test } from 'claude-code/testing'
import { classify, coreCommand, hueOf } from './tools'

// Tool, its input, and the farm job it becomes.
const PAIRS: [string, Record<string, unknown>, string][] = [
  ['Read', { file_path: '/a/b/register.tsx' }, 'inspect'],
  ['NotebookRead', { notebook_path: 'x.ipynb' }, 'inspect'],
  ['LSP', { filePath: 'a.ts' }, 'inspect'],
  ['Grep', { pattern: 'TODO' }, 'scout'],
  ['Glob', { pattern: '**/*.ts' }, 'scout'],
  ['ToolSearch', { query: 'select:Read' }, 'scout'],
  ['Edit', { file_path: 'a.ts' }, 'till'],
  ['MultiEdit', { file_path: 'a.ts', edits: [{}, {}] }, 'till'],
  ['NotebookEdit', { notebook_path: 'n.ipynb', cell_type: 'code' }, 'till'],
  ['NotebookEdit', { notebook_path: 'n.ipynb', cell_type: 'markdown' }, 'pots'],
  ['Write', { file_path: 'new.ts' }, 'sow'],
  ['WebFetch', { url: 'https://example.com/docs' }, 'post'],
  ['WebSearch', { query: 'crab farming' }, 'lookout'],
  ['Agent', { description: 'look around' }, 'hire'],
  ['Task', { description: 'look around' }, 'hire'],
  ['TodoWrite', { todos: [] }, 'stake'],
  ['TaskCreate', { subject: 'x' }, 'stake'],
  ['TaskUpdate', { taskId: '1' }, 'stake'],
  ['TaskList', {}, 'stake'],
  ['mcp__ccd_turn__update_plan', { items: [] }, 'stake'],
  ['mcp__ccd_turn__wrap_up', {}, 'stake'],
  ['Skill', { skill: 'run' }, 'almanac'],
  ['PushNotification', {}, 'bell'],
  ['SendUserMessage', {}, 'bell'],
  ['ScheduleWakeup', {}, 'alarm'],
  ['CronCreate', {}, 'alarm'],
  ['CronDelete', {}, 'alarm'],
  ['CronList', {}, 'alarm'],
  ['Monitor', { description: 'watch logs' }, 'watch'],
  ['EnterPlanMode', {}, 'blueprint'],
  ['ExitPlanMode', {}, 'blueprint'],
  ['EnterWorktree', {}, 'backfield'],
  ['ExitWorktree', {}, 'backfield'],
  ['TaskGet', {}, 'tinker'],
  ['TaskStop', {}, 'tinker'],
  ['mcp__ccd_session__mark_chapter', {}, 'tinker'],
  ['mcp__Claude_Browser__navigate', { url: 'http://localhost:3000' }, 'post'],
  ['mcp__claude-in-chrome__computer', {}, 'post'],
  ['mcp__github__get_issue', {}, 'trade'],
  ['mcp__slack__send_message', {}, 'trade'],
  ['SomethingNew', {}, 'tinker'],
]

// Bash commands and the job each one becomes.
const COMMANDS: [string, string][] = [
  ['ls -la', 'scout'],
  ['find . -name "*.ts"', 'scout'],
  ['rg TODO hooks', 'scout'],
  ['grep -n foo bar.ts', 'scout'],
  ['tree -L 2', 'scout'],
  ['cat README.md', 'inspect'],
  ['head -50 hooks/register.tsx', 'inspect'],
  ['tail -f log.txt', 'inspect'],
  ['wc -l *.ts', 'inspect'],
  ['git status --short', 'inspect'],
  ['git log --oneline -5', 'inspect'],
  ['git diff main', 'inspect'],
  ['git -C /repo show HEAD', 'inspect'],
  ['git blame a.ts', 'inspect'],
  ['npm test', 'sprinkle'],
  ['npm run test', 'sprinkle'],
  ['pnpm test -- --watch=false', 'sprinkle'],
  ['yarn test', 'sprinkle'],
  ['bun test', 'sprinkle'],
  ['pytest -q', 'sprinkle'],
  ['python -m pytest tests', 'sprinkle'],
  ['uv run pytest', 'sprinkle'],
  ['npx vitest run', 'sprinkle'],
  ['jest --ci', 'sprinkle'],
  ['go test ./...', 'sprinkle'],
  ['cargo test', 'sprinkle'],
  ['claude plugin test .', 'sprinkle'],
  ['make test', 'sprinkle'],
  ['cd app && npm test 2>&1 | tail', 'sprinkle'],
  ['npm run build', 'mill'],
  ['make', 'mill'],
  ['tsc -p .', 'mill'],
  ['npx tsc --noEmit', 'mill'],
  ['vite build', 'mill'],
  ['cargo build --release', 'mill'],
  ['go build ./cmd/x', 'mill'],
  ['npm install', 'deliver'],
  ['npm i lodash', 'deliver'],
  ['npm ci', 'deliver'],
  ['pnpm add zod', 'deliver'],
  ['yarn add react', 'deliver'],
  ['pip install requests', 'deliver'],
  ['uv add httpx', 'deliver'],
  ['brew install jq', 'deliver'],
  ['git commit -m "x"', 'pack'],
  ['git push origin main', 'ship'],
  ['gh pr create --fill', 'ship'],
  ['gh pr merge 12', 'ship'],
  ['curl -s https://example.com', 'post'],
  ['wget https://example.com/a.tgz', 'post'],
  ['echo hello', 'water'],
  ['node scripts/build_art.js', 'water'],
  ['test -f package.json && echo yes', 'water'],
  ['sudo rm -rf build', 'water'],
  ['FOO=1 BAR="a b" npm test', 'sprinkle'],
  ['time cargo test', 'sprinkle'],
]

test('every tool family becomes its farm job', async () => {
  expect(PAIRS.length + COMMANDS.length).toBeGreaterThan(60)
  for (const [tool, args, kind] of PAIRS) expect(`${tool} ${classify(tool, args).kind}`).toBe(`${tool} ${kind}`)
})

test('every Bash command becomes its job, after the wrappers in front are stripped', async () => {
  for (const [command, kind] of COMMANDS) expect(`${command} → ${classify('Bash', { command }).kind}`).toBe(`${command} → ${kind}`)
  expect(coreCommand('cd "/a b" && FOO=1 sudo npx jest')).toBe('jest')
  expect(coreCommand('cd /x; git status')).toBe('git status')
})

test('long-running work holds the act until the tool returns; quick looks never do', async () => {
  const open = (tool: string, args: Record<string, unknown> = {}) => classify(tool, args).isOpen
  expect(open('Bash', { command: 'npm test' })).toBe(true)
  expect(open('Bash', { command: 'echo x' })).toBe(true)
  expect(open('Bash', { command: 'npm run build' })).toBe(true)
  expect(open('WebFetch', { url: 'https://a.b' })).toBe(true)
  expect(open('WebSearch')).toBe(true)
  expect(open('Monitor')).toBe(true)
  expect(open('Read')).toBe(false)
  expect(open('Edit')).toBe(false)
  expect(open('Bash', { command: 'ls' })).toBe(false)
  expect(open('Bash', { command: 'git commit -m x' })).toBe(false)
})

test('the bubble names the work, and the note is short', async () => {
  expect(classify('Bash', { command: 'npm test' }).icon).toBe('terminal')
  expect(classify('Read', { file_path: '/a/b/register.tsx' })).toEqual({ kind: 'inspect', isOpen: false, note: 'register.tsx', icon: 'scroll' })
  expect(classify('Edit', { file_path: 'x/a.ts' }).icon).toBe('quill')
  expect(classify('WebFetch', { url: 'https://docs.example.com/a?b=1' }).note).toBe('docs.example.com')
  expect(classify('Agent', {}).icon).toBe('roster')
  expect(classify('Skill', { skill: 'run' }).icon).toBe('book')
  const note = classify('Bash', { command: `echo ${'x'.repeat(80)}` }).note ?? ''
  expect(note.length).toBe(32)
  expect(note.endsWith('…')).toBe(true)
  expect(classify('TaskList', {}).note).toBeUndefined()
})

test('an MCP server keeps its neighbour colour, and only its changes hold the act', async () => {
  const a = classify('mcp__github__get_issue', {})
  const b = classify('mcp__github__create_issue', {})
  expect(a.hue).toBe(hueOf('github'))
  expect(b.hue).toBe(a.hue)
  expect(classify('mcp__slack__read_channel', {}).hue).not.toBe(a.hue)
  expect((a.hue ?? -1) >= 0 && (a.hue ?? 360) < 360).toBe(true)
  expect(a.isOpen).toBe(false)
  expect(b.isOpen).toBe(true)
  // The tool's own read-only flag wins over its name.
  expect(classify('mcp__github__create_issue', {}, true).isOpen).toBe(false)
  expect(classify('mcp__github__get_issue', {}, false).isOpen).toBe(true)
  expect(classify('mcp__ccd_session__mark_chapter', {}).hue).toBeUndefined()
})

test('an unknown tool that only reads is inspecting; any other unknown tool tinkers in the barn', async () => {
  expect(classify('Mystery', {}, true).kind).toBe('inspect')
  expect(classify('Mystery', {}, true).isOpen).toBe(false)
  expect(classify('Mystery', {}).kind).toBe('tinker')
  expect(classify('Mystery', {}).isOpen).toBe(true)
  expect(classify('Mystery', {}, false).kind).toBe('tinker')
  // The exact name comes before the read-only flag.
  expect(classify('Edit', { file_path: 'a' }, true).kind).toBe('till')
})

test('odd input is an unknown tool, never a throw: no input, no name, or a name every object has', async () => {
  const none = undefined as unknown as Record<string, unknown>
  expect(classify('Read', none)).toMatchObject({ kind: 'inspect', isOpen: false })
  expect(classify('Bash', none)).toMatchObject({ kind: 'water', isOpen: true })
  expect(classify(undefined as unknown as string, {})).toMatchObject({ kind: 'tinker', isOpen: true })
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) expect(classify(name, {})).toMatchObject({ kind: 'tinker', isOpen: true })
})
