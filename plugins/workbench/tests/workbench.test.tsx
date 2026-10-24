import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { bashWrites, classify, isTestCommand } from '../hooks/mode'
import { looksSecret, parseNote, redact, search } from '../hooks/brain'
import { assess, callKey } from '../hooks/budget'

const ROOT = '/home/test/repos/second-brain'
const TOOL_DASH_NAME = 'mcp__workbench__dashboard_update'

const SEED: Record<string, string> = {
  'profile/coding-style.md': `---
title: Coding style
type: preference
status: active
summary: No comment banners, no unrequested validation.
---
# Coding style
`,
  'decisions/2026-09-02-welch-t-test.md': `---
title: Welch t-test for ERP comparison
type: decision
project: eeg-study
tags: [eeg, statistics]
status: active
updated: 2026-09-02
summary: Unequal variances, so Welch over Student's t for the ERP amplitude comparison.
---
# Welch t-test

Links [[projects/eeg-study]].
`,
  'projects/eeg-study.md': `---
title: EEG study
type: project
project: eeg-study
status: active
summary: Visual working memory EEG project.
---
# EEG study
`,
}

type World = {
  files: Map<string, string>
  argv: string[][]
  running: { id: string; type: string; status: string }[]
  contexts: (readonly string[] | undefined)[]
  prompts: string[]
  usage: { usd: number; percent: number; windows: { kind: string; percentUsed: number }[] }
  compacted: number
  clock: { advance: (ms: number) => Promise<void> }
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

function world(on: On): World {
  const files = new Map(Object.entries(SEED).map(([k, v]) => [`${ROOT}/${k}`, v]))
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 19, 12) })
  const w: World = { files, argv: [], running: [], contexts: [], prompts: [], usage: { usd: 1.5, percent: 12, windows: [] }, compacted: 0, clock }
  mock.store(on)
  mock.env(on, { USERPROFILE: '/home/test', OS: 'Windows_NT' })
  on('ui.status', () => ({ value: undefined }))
  on('prompt.submit', (_, e) => {
    w.prompts.push(e.text)
    w.contexts.push(e.context)
    return { text: e.text }
  })

  on('fs.list', (_, e) => {
    const dir = norm(String((e as { path?: string }).path ?? '')).replace(/\/$/, '')
    const names = new Map<string, 'file' | 'dir'>()
    for (const path of files.keys()) {
      if (!path.startsWith(`${dir}/`)) continue
      const [head, ...rest] = path.slice(dir.length + 1).split('/')
      if (head) names.set(head, rest.length ? 'dir' : 'file')
    }
    return { value: [...names].map(([name, kind]) => ({ name, kind, size: 1, mtimeMs: 1, isLink: false })) }
  })
  on('fs.read', (_, e) => {
    const text = files.get(norm(String((e as { path: string }).path)))
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.write', (_, e) => {
    const { path, text } = e as { path: string; text: string }
    files.set(norm(path), text)
    return { value: undefined }
  })
  on('fs.exists', (_, e) => {
    const path = norm(String((e as { path: string }).path))
    return { value: files.has(path) || [...files.keys()].some(k => k.startsWith(`${path}/`)) }
  })
  on('process.run', (_, e) => {
    const argv = (e as { argv: string[] }).argv
    w.argv.push(argv)
    const target = argv.at(-1)?.match(/'(.+)'$/)?.[1]?.replace(/''/g, "'")
    if (target) files.delete(norm(target))
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.register', (_, e) => ({ value: { command: (e as { name: string }).name } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__workbench__${(e as { name: string }).name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.root', () => ({ value: '/home/test/repos/eeg-study' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000, percent: w.usage.percent }, rateLimits: w.usage.windows, cost: { usd: w.usage.usd } },
  }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.version', () => ({ value: { version: '2.1.304', base: '2.1.304', builtAt: '2026-10-01' } }))
  on('session.surfaces', () => ({ value: ['terminal' as const] }))
  on('session.compact', () => {
    w.compacted += 1
    return { skip: 'test' }
  })
  on('turn.complete', (_, e) => ({ text: e.answer, reason: 'answer' as const }))
  on('ui.toast', () => ({ value: undefined }))
  on('classic.Stop', () => ({}))
  on('agent.list', () => ({ value: w.running.map(a => ({ ...a, description: 'task', status: a.status as 'running' })) }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  return w
}

const PANE = {
  plugin: 'workbench',
  component: 'Pane',
  requestId: 'workbench',
  props: { title: 'Workbench', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

type Kit = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0]

const submit = ($: Kit, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
const run = ($: Kit, command: string, args: string) =>
  $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })

const finishTurn = ($: Kit) => $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })

async function start($: Kit) {
  await $.session.start({ cwd: '/home/test/repos/eeg-study', surface: 'terminal', isInteractive: true })
}

describe('pure helpers', () => {
  test('classifies task modes', async () => {
    expect(classify('fix the failing pytest traceback in loader.py')).toBe('debugging')
    expect(classify('implement a parser function in utils.ts')).toBe('coding')
    expect(classify('find sources and papers on time perception evidence')).toBe('research')
    expect(classify('rewrite this email to Dr. Eagleman so it sounds less stiff')).toBe('writing')
    expect(classify('make a plan and timeline for the ISEF milestones')).toBe('planning')
    expect(classify('what is 2+2')).toBe('general')
  })

  test('finds files written by shell commands', async () => {
    expect(bashWrites("cat > stats/inferential.py <<'EOF'\nx\nEOF")).toEqual(['stats/inferential.py'])
    expect(bashWrites('cat >> a.py <<EOF && sed -i "s/a/b/" b.py && git mv c.py d/c.py')).toEqual(['a.py', 'b.py', 'd/c.py'])
    expect(bashWrites('python -m pytest -q 2>&1 | tail -5')).toEqual([])
    expect(bashWrites('ls > /dev/null; echo hi | tee -a log.txt')).toEqual(['log.txt'])
  })

  test('recognizes test commands and secrets', async () => {
    expect(isTestCommand('python -m pytest -q')).toBe(true)
    expect(isTestCommand('npm run test')).toBe(true)
    expect(isTestCommand('ls -la')).toBe(false)
    expect(looksSecret('api_key = sk-abcdefghijklmnopqrstuvwxyz123')).toBe(true)
    expect(looksSecret('we chose Welch because variances differ')).toBe(false)
  })

  test('search ranks the matching decision first and skips superseded notes', async () => {
    const notes = Object.entries(SEED).map(([p, t]) => parseNote(p, t))
    const hits = search(notes, 'which statistics test for the ERP comparison', { project: 'eeg-study' })
    expect(hits[0]?.note.path).toBe('decisions/2026-09-02-welch-t-test.md')
    const old = parseNote('decisions/old.md', '---\ntitle: ERP statistics\nstatus: superseded\n---\n')
    expect(search([old], 'ERP statistics').length).toBe(0)
  })
})

describe('memory', () => {
  test('attaches relevant notes to a substantive prompt, none to a short one', async ($, on) => {
    const w = world(on)
    await start($)
    await submit($, 'Which statistics test did we pick for the ERP comparison again?')
    await submit($, 'ok thanks')
    expect(w.contexts[0]?.join('\n')).toContain('decisions/2026-09-02-welch-t-test.md')
    expect(w.contexts[1]).toBeUndefined()
  })

  test('sends the team policy once, with the first prompt, when the system prompt hook is bypassed', async ($, on) => {
    const w = world(on)
    await start($)
    await submit($, 'hello there, can you help me plan my week')
    await submit($, 'and also plan the week after that one please')
    expect(w.contexts[0]?.some(c => c.includes('# Workbench team'))).toBe(true)
    expect(w.contexts[1]?.some(c => c.includes('# Workbench team')) ?? false).toBe(false)
  })

  test('brain_record creates, then updates instead of duplicating, supersedes, and refuses secrets', async ($, on) => {
    const w = world(on)
    await start($)
    const first = await $.tool.call({
      tool: 'mcp__workbench__brain_record',
      type: 'decision',
      title: 'Use permutation test for ERP comparison',
      summary: 'Permutation test replaces Welch',
      body: 'Small samples; permutation test avoids the normality assumption.',
      supersedes: 'decisions/2026-09-02-welch-t-test.md',
    } as never)
    expect(String(first.result)).toContain('Created')
    const path = `${ROOT}/decisions/2026-10-19-use-permutation-test-for-erp-comparison.md`
    expect(w.files.get(path)).toContain('status: active')
    expect(w.files.get(`${ROOT}/decisions/2026-09-02-welch-t-test.md`)).toContain('status: superseded')
    expect(w.files.get(`${ROOT}/index.md`)).toContain('(superseded)')

    const again = await $.tool.call({
      tool: 'mcp__workbench__brain_record',
      type: 'decision',
      title: 'Use permutation test for ERP comparison',
      summary: 'Permutation test replaces Welch',
      body: '10,000 permutations is enough here.',
    } as never)
    expect(String(again.result)).toContain('Updated')
    expect([...w.files.keys()].filter(k => k.includes('permutation')).length).toBe(1)
    expect(w.files.get(path)).toContain('## Update 2026-10-19')

    const secret = await $.tool.call({
      tool: 'mcp__workbench__brain_record',
      type: 'lesson',
      title: 'API setup',
      summary: 'key',
      body: 'api_key = sk-abcdefghijklmnopqrstuvwxyz0123456789',
    } as never)
    expect(String(secret.result)).toContain('Not recorded')
  })

  test('brain_search finds notes and reads one with backlinks', async ($, on) => {
    world(on)
    await start($)
    const found = await $.tool.call({ tool: 'mcp__workbench__brain_search', query: 'ERP statistics' } as never)
    expect(String(found.result)).toContain('welch-t-test')
    const shown = await $.tool.call({ tool: 'mcp__workbench__brain_search', path: 'projects/eeg-study' } as never)
    expect(String(shown.result)).toContain('decisions/2026-09-02-welch-t-test.md')
  })

  test('/brain delete keeps a trash copy and removes the note', async ($, on) => {
    const w = world(on)
    await start($)
    const out = await run($, 'brain', 'delete projects/eeg-study.md')
    expect(out.text).toContain('Deleted projects/eeg-study.md')
    expect(w.files.has(`${ROOT}/projects/eeg-study.md`)).toBe(false)
    expect([...w.files.keys()].some(k => k.includes('/_trash/') && k.endsWith('projects/eeg-study.md'))).toBe(true)
    expect(w.argv[0]?.[0]).toBe('powershell')
  })
})

describe('policy', () => {
  test('adds the team policy and standing preferences to the system prompt', async ($, on) => {
    world(on)
    on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'engine', scope: 'shared' as const }] }))
    await start($)
    const composed = await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] })
    const policy = composed.sections.find(s => s.id === 'workbench:policy')
    expect(policy?.scope).toBe('session')
    expect(policy?.text).toContain('workbench:critic')
    expect(policy?.text).toContain('Coding style')
  })
})

describe('limits and coordination', () => {
  test('refuses a new agent past the parallel limit', async ($, on) => {
    const w = world(on)
    on('tool.call', () => ({ result: {} }))
    await start($)
    w.running = [1, 2, 3].map(n => ({ id: `a${n}`, type: 'workbench:engineer', status: 'running' }))
    const ran = await $.tool.call({ tool: 'Agent', description: 'x', prompt: 'y', subagent_type: 'workbench:engineer' })
    expect(ran.deny).toContain('limit 3')
  })

  test('caps review rounds per request', { options: { maxReviewRounds: 2 } }, async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: {} }))
    await start($)
    await submit($, 'review the new parser implementation for bugs please')
    const call = () => $.tool.call({ tool: 'Agent', description: 'review', prompt: 'p', subagent_type: 'workbench:critic' })
    expect((await call()).deny).toBeUndefined()
    expect((await call()).deny).toBeUndefined()
    expect((await call()).deny).toContain('review rounds')
  })

  test('a subagent cannot edit a file another running subagent is editing', async ($, on) => {
    const w = world(on)
    on('tool.call', () => ({ result: {} }))
    await start($)
    w.running = [{ id: 'A', type: 'workbench:engineer', status: 'running' }, { id: 'B', type: 'workbench:engineer', status: 'running' }]
    const edit = (agentId: string) =>
      $.tool.call({ tool: 'Edit', file_path: 'src/app.ts', old_string: 'a', new_string: 'b', agentId } as never)
    expect((await edit('A')).deny).toBeUndefined()
    expect((await edit('B')).deny).toContain('another subagent')
  })
})

describe('dashboard', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`adapts panels to coding, research and writing on ${surface}`, async ($, on) => {
      world(on)
      on('tool.call', (_, e) => (e.tool === 'Bash' ? { result: {}, isError: true, text: '1 failed, 3 passed' } : { result: {} }))
      await start($)

      await submit($, 'implement the epoch loader function in loader.py and add unit tests')
      await $.tool.call({ tool: 'Edit', file_path: 'src/loader.py', old_string: 'a', new_string: 'b' })
      await $.tool.call({ tool: 'Bash', command: 'python -m pytest -q' })
      let ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ type: 'Text', text: /Files/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /FAIL python -m pytest/ })).toBeDefined()
      await ui.unmount()

      await submit($, 'research papers and sources on evidence for VR time perception studies')
      await $.tool.call({ tool: 'WebSearch', query: 'VR time perception study' } as never)
      await $.tool.call({
        tool: 'mcp__workbench__dashboard_update',
        findings: [{ text: 'Time feels faster in VR', confidence: 'likely' }],
        conflicts: ['Two studies disagree on effect size'],
      } as never)
      ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ type: 'Text', text: /Sources/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Time feels faster in VR \[likely\]/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Conflicting evidence/ })).toBeDefined()
      await ui.unmount()

      await submit($, 'rewrite this email to my mentor so the tone is warmer')
      await $.tool.call({ tool: 'mcp__workbench__dashboard_update', draft: { status: 'second draft', audience: 'mentor', tone: 'warm' } } as never)
      ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ type: 'Text', text: /Audience: mentor/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Files/ })).toBeUndefined()

      await ui.press({ key: 'view' })
      expect(await ui.find({ key: 'p-draft' })).toBeDefined()
      await ui.press({ key: 'p-draft' })
      expect(await ui.find({ type: 'Text', text: /Audience: mentor/ })).toBeUndefined()
      await ui.unmount()
    })
  }

  test('/dash text works where panes cannot be drawn', async ($, on) => {
    world(on)
    await start($)
    await submit($, 'make a plan and timeline for the science fair milestones')
    const out = await run($, 'dash', 'text')
    expect(out.text).toContain('[planning]')
  })
})

describe('budget and usage', () => {
  test('assess reserves the end of a task budget and stops at the limit', async () => {
    const cfg = { taskUsd: 2, sessionUsd: 10, reservePercent: 25, warnPercent: 80 }
    expect(assess(cfg, { usd: 1.0, windows: [] }, 0).map(n => n.level)).toEqual([])
    expect(assess(cfg, { usd: 1.6, windows: [] }, 0).map(n => n.level)).toEqual(['task-reserve'])
    expect(assess(cfg, { usd: 2.1, windows: [] }, 0)[0]?.stopsResearch).toBe(true)
    expect(assess(cfg, { usd: 8.5, windows: [] }, 8).map(n => n.level)).toEqual(['session-warn'])
    const windows = assess(cfg, { usd: 0, windows: [{ kind: 'five_hour', percentUsed: 96 }] }, 0)
    expect(windows[0]?.level).toBe('window-critical:five_hour')
    expect(windows[0]?.stopsDelegation).toBe(true)
  })

  test('callKey ignores ids so identical calls match', async () => {
    expect(callKey({ tool: 'Read', file_path: 'a', tool_use_id: '1' })).toBe(callKey({ tool: 'Read', file_path: 'a', tool_use_id: '2' }))
    expect(callKey({ tool: 'Read', file_path: 'a' })).not.toBe(callKey({ tool: 'Read', file_path: 'b' }))
  })

  test('warns the model once at the reserve, then refuses research and delegation past the task budget', async ($, on) => {
    const w = world(on)
    on('tool.call', () => ({ result: {} }))
    await start($)
    await submit($, 'research the literature on tactile temporal order judgment thresholds')
    w.usage.usd = 1.5 + 4.4
    const first = await $.tool.call({ tool: 'Read', file_path: 'notes.md' })
    expect(first.context?.join(' ')).toContain('reserved for verification')
    const second = await $.tool.call({ tool: 'Read', file_path: 'other.md' })
    expect(second.context ?? []).toEqual([])
    expect((await $.tool.call({ tool: 'Agent', description: 'x', prompt: 'y', subagent_type: 'workbench:researcher' })).deny).toContain('reserved')
    w.usage.usd = 1.5 + 5.2
    expect((await $.tool.call({ tool: 'WebSearch', query: 'temporal order judgment' } as never)).deny).toContain('budget')
  })

  test('downgrades opus subagents to sonnet when the account window is past the warning level', async ($, on) => {
    const w = world(on)
    const models: (string | undefined)[] = []
    on('tool.call', (_, e) => {
      if (e.tool === 'Agent') models.push(e.model)
      return { result: {} }
    })
    await start($)
    w.usage.windows = [{ kind: 'five_hour', percentUsed: 85 }]
    const ran = await $.tool.call({ tool: 'Agent', description: 'design', prompt: 'p', subagent_type: 'workbench:architect' })
    expect(models).toEqual(['sonnet'])
    expect(ran.context?.join(' ')).toContain('sonnet instead of opus')
  })

  test('refuses the fifth identical call and caps web lookups per request', async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: {} }))
    await start($)
    await submit($, 'look into why the loader keeps failing on large files')
    for (let i = 0; i < 4; i++) expect((await $.tool.call({ tool: 'Read', file_path: 'big.csv' })).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Read', file_path: 'big.csv' })).deny).toContain('exact Read call')
    for (let i = 0; i < 12; i++) await $.tool.call({ tool: 'WebSearch', query: `q${i}` } as never)
    expect((await $.tool.call({ tool: 'WebSearch', query: 'q-final' } as never)).deny).toContain('limit 12')
  })

  test('compacts after a turn once the context passes the threshold', async ($, on) => {
    const w = world(on)
    await start($)
    await finishTurn($)
    await w.clock.advance(2000)
    expect(w.compacted).toBe(0)
    w.usage.percent = 83
    await finishTurn($)
    await w.clock.advance(2000)
    expect(w.compacted).toBe(1)
  })
})

describe('ledger', () => {
  test('writes a ledger at the end of a turn and offers it to the next session', async ($, on) => {
    const w = world(on)
    on('tool.call', () => ({ result: {} }))
    await start($)
    await submit($, 'implement the epoch rejection step in the EEG preprocessing pipeline')
    await $.tool.call({ tool: 'Edit', file_path: 'src/preprocess.py', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: TOOL_DASH_NAME, next: ['add tests for the threshold'], status: 'rejection step written' } as never)
    await finishTurn($)
    const ledger = w.files.get(`${ROOT}/_ledgers/eeg-study.md`) ?? ''
    expect(ledger).toContain('src/preprocess.py')
    expect(ledger).toContain('- add tests for the threshold')

    await start($)
    w.contexts.length = 0
    await submit($, 'what should I work on next in this project today')
    expect(w.contexts[0]?.join('\n')).toContain('Unfinished work from an earlier session')
  })
})

describe('system command and safety', () => {
  test('/system budget, agents and doctor report real figures', async ($, on) => {
    const w = world(on)
    await start($)
    w.usage.windows = [{ kind: 'seven_day', percentUsed: 41 }]
    const budget = await run($, 'system', 'budget')
    expect(budget.text).toContain('Account seven_day: 41% used')
    expect(budget.text).toContain('/model sonnet')
    expect((await run($, 'system', 'agents')).text).toContain('workbench:efficiency')
    expect((await run($, 'system', 'doctor')).text).toContain('3 notes')
  })

  test('secrets typed into a prompt never reach the dashboard', async ($, on) => {
    world(on)
    await start($)
    await submit($, 'my key is sk-ant-abcdefghijklmnopqrstuvwx please wire it into config')
    const out = await run($, 'dash', 'text')
    expect(out.text).not.toContain('sk-ant-abcdef')
    expect(out.text).toContain('[redacted]')
    expect(redact('token: abcdef123456')).toContain('[redacted]')
  })
})

describe('review gate', () => {
  test('a background task notification is not treated as a new request', async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: {} }))
    await start($)
    await submit($, 'refactor the stats module into a package with tests')
    await $.tool.call({ tool: 'Agent', description: 'review', prompt: 'p', subagent_type: 'workbench:qa-security' })
    await $.prompt.submit({ text: 'Background agent finished its review of the stats package', wait: false, origin: { kind: 'task-notification' } } as never)
    for (const f of ['stats/a.py', 'stats/b.py', 'test_stats.py']) await $.tool.call({ tool: 'Write', file_path: f, content: 'x' })
    expect((await $.classic.Stop({ stop_hook_active: false } as never)).block).toBeUndefined()
    expect((await run($, 'dash', 'text')).text).toContain('refactor the stats module')
  })

  test('sends Claude back for a review once when a request changed several code files', async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: {} }))
    await start($)
    const stop = () => $.classic.Stop({ stop_hook_active: false } as never)
    await submit($, 'refactor the stats module into a package with tests')
    for (const f of ['stats/a.py', 'stats/b.py', 'test_stats.py']) await $.tool.call({ tool: 'Write', file_path: f, content: 'x' })
    expect((await stop()).block).toContain('qa-security')
    expect((await stop()).block).toBeUndefined()

    await submit($, 'quick fix: rename the helper in three files, no review needed')
    for (const f of ['a.py', 'b.py', 'c.py']) await $.tool.call({ tool: 'Edit', file_path: f, old_string: 'a', new_string: 'b' })
    expect((await stop()).block).toBeUndefined()
  })

  test('does not ask for a review after one already ran', async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: {} }))
    await start($)
    await submit($, 'refactor the stats module into a package with tests')
    for (const f of ['stats/a.py', 'stats/b.py', 'test_stats.py']) await $.tool.call({ tool: 'Write', file_path: f, content: 'x' })
    await $.tool.call({ tool: 'Agent', description: 'review', prompt: 'p', subagent_type: 'workbench:qa-security' })
    expect((await $.classic.Stop({ stop_hook_active: false } as never)).block).toBeUndefined()
  })
})

test('queues a review request after the turn when the Stop hook was skipped', async ($, on) => {
  const w = world(on)
  on('tool.call', () => ({ result: {} }))
  await start($)
  await submit($, 'refactor the stats module into a package with tests')
  for (const f of ['stats/a.py', 'stats/b.py', 'test_stats.py']) await $.tool.call({ tool: 'Write', file_path: f, content: 'x' })
  await finishTurn($)
  await w.clock.advance(10)
  expect(w.prompts.at(-1)).toContain('workbench:qa-security')
  await finishTurn($)
  expect(w.prompts.filter(p => p.includes('qa-security')).length).toBe(1)
})

test('commands still register when the notes folder and plugin store fail at startup', async ($, on) => {
  const registered: string[] = []
  mock.clock(on, { now: 0 })
  mock.env(on, { USERPROFILE: '/nowhere' })
  on('command.register', (_, e) => {
    registered.push((e as { name: string }).name)
    return { value: { command: (e as { name: string }).name } }
  })
  on('tool.register', () => {
    throw new Error('tool registry unavailable')
  })
  on('fs.list', () => {
    throw new Error('EPERM')
  })
  on('fs.exists', () => ({ value: false }))
  on('store.get', () => {
    throw new Error('store locked')
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('session.root', () => ({ value: '/nowhere/project' }))
  on('session.version', () => ({ value: { version: '2.1.304', base: '2.1.304', builtAt: '2026-10-01' } }))
  on('session.surfaces', () => ({ value: ['terminal' as const] }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/nowhere/project', surface: 'terminal', isInteractive: true })
  expect(registered).toEqual(['system', 'dash', 'brain'])
  const doctor = await $.command.run({ command: 'system', args: 'doctor', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(doctor.text).toContain('STARTUP ERRORS')
  expect(doctor.text).toContain('dashboard state:')
  expect(doctor.text).toContain('register tool brain_search:')
})
