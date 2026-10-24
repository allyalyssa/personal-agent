import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, RenderChildren } from 'claude-code'

import type { Dash, Mode, Prefs } from '../types'
import {
  TYPE_DIRS,
  backlinks,
  frontmatter,
  indexMarkdown,
  looksSecret,
  parseFrontmatter,
  parseNote,
  redact,
  scanBrain,
  search,
  slugify,
  terms,
  type Note,
} from './brain'
import { bashWrites, classify, isCodeFile, isTestCommand, modeFromFile, testSummary } from './mode'
import { assess, callKey, underPressure, type BudgetConfig, type Snapshot } from './budget'
import { hasProgress, ledgerMarkdown, resumeSummary, type LedgerEntry } from './ledger'

const PANE = 'workbench'
const TOOL_DASH = 'mcp__workbench__dashboard_update'
const TOOL_SEARCH = 'mcp__workbench__brain_search'
const TOOL_RECORD = 'mcp__workbench__brain_record'
const MODES: Mode[] = ['coding', 'debugging', 'research', 'writing', 'planning', 'general']

const EMPTY: Dash = {
  mode: 'general',
  pinnedMode: null,
  objective: '',
  status: '',
  files: [],
  tests: [],
  tasks: [],
  sources: [],
  findings: [],
  conflicts: [],
  questions: [],
  decisions: [],
  blockers: [],
  next: [],
  draft: null,
  errors: [],
  memories: [],
  agents: [],
  usage: {},
  budget: { taskStartUsd: 0, windows: [], warned: [], agentCalls: 0, toolCalls: 0, searches: 0, byModel: {}, loops: [], downgrades: 0 },
  reviews: 0,
}

const PANELS: Record<Mode, string[]> = {
  coding: ['objective', 'agents', 'files', 'tests', 'tasks', 'blockers', 'memory', 'errors', 'budget'],
  debugging: ['objective', 'agents', 'tests', 'files', 'blockers', 'tasks', 'memory', 'errors', 'budget'],
  research: ['objective', 'questions', 'sources', 'findings', 'agents', 'memory', 'errors', 'budget'],
  writing: ['objective', 'draft', 'tasks', 'memory', 'budget'],
  planning: ['objective', 'decisions', 'tasks', 'blockers', 'agents', 'memory', 'budget'],
  general: ['objective', 'decisions', 'tasks', 'blockers', 'agents', 'memory', 'budget'],
}
const AGENT_MODELS: Record<string, string> = {
  'workbench:critic': 'opus',
  'workbench:architect': 'opus',
  'workbench:researcher': 'sonnet',
  'workbench:engineer': 'sonnet',
  'workbench:qa-security': 'sonnet',
  'workbench:writer': 'sonnet',
  'workbench:efficiency': 'haiku',
}

const dash = atom({ plugin: 'workbench', key: 'dash' } as const, EMPTY)
const prefs = atom({ plugin: 'workbench', key: 'prefs' } as const, { view: 'compact', hidden: [] } as Prefs)

const short = (s: string, n: number) => {
  const clean = redact(s)
  return clean.length > n ? `${clean.slice(0, n - 1)}…` : clean
}
const base = (p: string) => p.split(/[\\/]/).filter(Boolean).slice(-2).join('/')
const strings = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : [])

let options: PluginOptions = {}
let maxParallel = 3
let maxReviews = 2
let maxMemories = 3
let maxSearches = 12
let compactAt = 80
let budgetCfg: BudgetConfig = { taskUsd: 5, sessionUsd: 20, reservePercent: 15, warnPercent: 80 }


let root = ''
let project = 'global'
let notes: Note[] = []
let agentTimer: { cancel: () => void } | undefined
let policySent = false
let policyComposed = false
const claims = new Map<string, string>()
const callCounts = new Map<string, number>()
let ledgerResumeSent = false
let requestStartedAt = 0
let skipReview = false
let reviewNudged = false
let reviewMinFiles = 3
let stopHookRan = false
let startupErrors: string[] = []
const noteError = (step: string) => (err: unknown) => {
  startupErrors.push(`${step}: ${err instanceof Error ? err.message : String(err)}`)
}
let compactTimer: { cancel: () => void } | undefined

async function today($: EngineInterface) {
  return new Date(await $.clock.now()).toISOString().slice(0, 10)
}

async function resolveRoot($: EngineInterface) {
  const configured = String(options.brainPath ?? '').trim()
  if (configured) return configured.replace(/[\\/]+$/, '')
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  return `${home}/repos/second-brain`
}

async function reindex($: EngineInterface, writeIndex: boolean) {
  notes = await scanBrain($, root)
  if (writeIndex && (await $.fs.exists(root))) {
    await $.fs.write(`${root}/index.md`, indexMarkdown(notes, await today($)))
  }
}

async function change($: EngineInterface, fn: (d: Dash) => Dash) {
  await update($, dash, d => fn(d ?? EMPTY))
  const d = await read($, dash)
  const running = d.agents.filter(a => a.status === 'running').length
  const latest = new Map(d.tests.map(t => [t.command, t.ok]))
  const passing = [...latest.values()].filter(Boolean).length
  const parts = [`wb ${d.mode}`]
  if (running) parts.push(`${running} agent${running === 1 ? '' : 's'}`)
  if (latest.size) parts.push(`checks ${passing}/${latest.size}`)
  $.ui.status(parts.join(' · '))
}

async function refreshAgents($: EngineInterface) {
  const list = await $.agent.list()
  await change($, d => ({
    ...d,
    agents: list.slice(-12).map(a => ({ id: a.id, type: a.type, description: a.description, status: a.status })),
  }))
  const running = list.some(a => a.status === 'running')
  if (running && !agentTimer) agentTimer = $.clock.every(4000, () => void refreshAgents($).catch(() => undefined))
  if (!running && agentTimer) {
    agentTimer.cancel()
    agentTimer = undefined
  }
}

async function savePrefs($: EngineInterface, fn: (p: Prefs) => Prefs) {
  await update($, prefs, p => fn(p ?? { view: 'compact', hidden: [] }))
  await $.store.set('prefs', await read($, prefs))
}

async function snapshot($: EngineInterface): Promise<Snapshot> {
  const usage = await $.session.usage()
  return {
    usd: usage.cost?.usd,
    contextPercent: usage.context.percent,
    windows: usage.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt })),
  }
}

async function budgetCheck($: EngineInterface) {
  const snap = await snapshot($)
  const d = await read($, dash)
  const notices = assess(budgetCfg, snap, d.budget.taskStartUsd)
  const fresh = notices.filter(n => !d.budget.warned.includes(n.level))
  await change($, x => ({
    ...x,
    usage: { usd: snap.usd, contextPercent: snap.contextPercent },
    budget: { ...x.budget, windows: snap.windows, warned: [...new Set([...x.budget.warned, ...fresh.map(n => n.level)])] },
  }))
  for (const n of fresh) $.ui.toast(n.message.replace(/^workbench (budget|usage)?:?\s*/, ''), { timeoutMs: 8000 })
  return {
    snap,
    fresh: fresh.map(n => n.message),
    stopsDelegation: notices.find(n => n.stopsDelegation),
    stopsResearch: notices.find(n => n.stopsResearch),
  }
}

function ledgerPath() {
  return `${root}/_ledgers/${project}.md`
}

async function writeLedger($: EngineInterface) {
  if (options.ledger === false || !root) return
  const d = await read($, dash)
  if (!hasProgress(d)) return
  const key = `ledger-history:${project}`
  const history = ((await $.store.get(key)) as LedgerEntry[] | undefined) ?? []
  const stamp = new Date(await $.clock.now()).toISOString().replace('T', ' ').slice(0, 16)
  const prior = history.filter(h => h.objective !== d.objective).slice(-10)
  await $.store.set(key, [...prior, { date: stamp.slice(0, 10), objective: d.objective, status: d.status }].slice(-11))
  await $.fs.write(ledgerPath(), redact(ledgerMarkdown(project, d, stamp, prior)))
}

async function maybeCompact($: EngineInterface) {
  if (compactAt <= 0 || compactTimer) return
  const usage = await $.session.usage()
  if ((usage.context.percent ?? 0) < compactAt) return
  compactTimer = $.clock.after(1500, () => {
    compactTimer = undefined
    void $.session
      .compact({ instructions: 'Keep the current objective, decisions and their reasons, files changed, check results, open tasks and next steps. Drop exploratory output.' })
      .then(() => $.ui.toast(`Compacted the conversation at ${usage.context.percent}% context (workbench compactAtPercent).`))
      .catch(() => undefined)
  })
}

function reviewReason(d: Dash) {
  if (options.requireReview === false || skipReview || reviewNudged || d.reviews > 0) return undefined
  const edited = [...new Set(d.files.filter(f => f.kind === 'edit' && f.at >= requestStartedAt && isCodeFile(f.path)).map(f => f.path))]
  if (edited.length < reviewMinFiles) return undefined
  return `workbench: this request changed ${edited.length} code files (${edited.map(base).join(', ')}) and no independent review has run. Before finishing, brief workbench:qa-security with the goal and the changed files, address what it finds, then give your final answer. If the change is genuinely trivial, say why in one line and finish instead.`
}

function policy() {
  const standing = notes
    .filter(n => n.type === 'preference' && n.status === 'active')
    .map(n => `- ${n.title}: ${n.summary || short(n.text.replace(/\s+/g, ' '), 200)}`)
    .join('\n')
  const cap = budgetCfg.sessionUsd > 0 ? `$${budgetCfg.sessionUsd}` : 'no cap'
  const task = budgetCfg.taskUsd > 0 ? `$${budgetCfg.taskUsd} per request (the last ${budgetCfg.reservePercent}% reserved for verifying and answering)` : 'no per-request budget'
  return [
    '# Workbench team (workbench plugin)',
    'You orchestrate. Pick the lightest strategy that does the job well:',
    '- A factual question, quick edit or short answer: do it directly. No subagents, no dashboard updates.',
    '- Coding: for non-trivial design choices consult workbench:architect first; implement yourself or with workbench:engineer. Before reporting done, have workbench:qa-security review any change that alters existing behavior or a signature, spans several files, or touches security, data or dependencies (skip it only for trivial or purely additive edits, or when the person asks for speed).',
    '- Debugging: reproduce first. For a stubborn bug, brief workbench:critic for an independent diagnosis without telling it your theory, then compare.',
    '- Research: workbench:researcher gathers primary sources; workbench:critic tests the conclusions.',
    '- Writing the person will send or publish: use the natural-writing skill; workbench:writer for longer pieces. Keep their meaning, facts and voice. Never invent facts, quotes, sources or experiences. Do not restyle technical output unasked.',
    '- Planning: workbench:architect for structure, workbench:critic for blind spots.',
    '- workbench:efficiency only when a workflow is long or expensive enough to be worth trimming.',
    'Coordination: subagents report back to you and you relay what matters. Leave the Agent call\'s `name` unset unless agents genuinely need to message each other: unnamed subagents can\'t be messaged, which keeps independent reviews independent (and, if the person has enabled agent teams, a named spawn becomes a costlier teammate). When independent judgment matters, brief agents separately (in parallel only if the work is truly independent) and do not show one agent another\'s conclusions first. Send a concrete conflict back to the agent that can settle it, with the evidence. You write the one final answer. Never hand the same file to two agents at once.',
    'Models: each agent has a default (opus: critic, architect; sonnet: researcher, engineer, qa-security, writer; haiku: efficiency). Override with the Agent call\'s `model` only when the sub-task clearly calls for it: haiku for mechanical work (reformatting, renaming, extracting, simple lookups), opus for subtle bugs, architecture and high-stakes reasoning. Don\'t upgrade by default. You cannot change your own model; if the person is on an expensive model doing routine work, you may suggest /model once.',
    'Delegation briefs: pass the essential context and verified findings so agents don\'t redo research; ask for short reports. Reuse earlier findings (second brain, this conversation) before searching again.',
    `Limits the plugin enforces: ${maxParallel} subagents at a time; ${maxReviews} critic/QA reviews per request; ${maxSearches} web searches/fetches per request; budget ${task}; new subagents stop at ${cap} session cost. When it warns about budget or account usage, follow the warning. When usage is tight, prefer cheaper models and fewer agents; the plugin may downgrade opus subagents to sonnet. If an Agent call fails because a model is unavailable, retry once with model "sonnet"; if that fails too, do the work yourself and say so.`,
    `Dashboard: in multi-step work call ${TOOL_DASH} when the objective, status, findings, decisions, blockers or draft state change. Skip it for one-shot answers.`,
    `Second brain: Markdown notes at ${root}. Notes may arrive attached to a prompt; use them only if relevant, cite their paths, and let current instructions override them. Search with ${TOOL_SEARCH}. After a meaningful task, record durable decisions, verified outcomes, lessons and open questions with ${TOOL_RECORD} (load it with ToolSearch): one note per subject, update rather than duplicate, use supersedes when a decision is replaced. Never record secrets, credentials, or sensitive personal details, and skip trivia.`,
    'Report a test or check as passing only when it ran and passed. Say when you are unsure.',
    standing ? `Standing preferences from the second brain:\n${standing.slice(0, 1500)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function inside(rel: string) {
  const clean = rel.replace(/\\/g, '/').replace(/^\/+/, '')
  return clean.split('/').includes('..') ? undefined : clean
}

function findNote(ref: string) {
  const key = ref.toLowerCase().replace(/\.md$/, '').replace(/^\[\[|\]\]$/g, '')
  return notes.find(
    n =>
      n.path.toLowerCase().replace(/\.md$/, '') === key ||
      n.title.toLowerCase() === key ||
      n.path.split('/').pop()?.toLowerCase().replace(/\.md$/, '') === key,
  )
}

function describeNote(n: Note) {
  return `${root}/${n.path} — ${n.title}${n.summary ? `: ${n.summary}` : ''}${n.status === 'active' ? '' : ` [${n.status}]`}`
}

async function record($: EngineInterface, input: Record<string, unknown>) {
  const type = String(input.type ?? '')
  const title = String(input.title ?? '').trim()
  const summary = String(input.summary ?? '').trim()
  const body = String(input.body ?? '').trim()
  const dir = TYPE_DIRS[type]
  if (!dir || !title) return `Not recorded: type must be one of ${Object.keys(TYPE_DIRS).join(', ')} and title is required.`
  if (looksSecret(`${title}\n${summary}\n${body}`)) {
    return 'Not recorded: the text looks like it contains a credential or secret. Remove it and try again.'
  }
  const date = await today($)
  const slug = slugify(title)
  const dated = type === 'decision' || type === 'session'
  const existing =
    notes.find(n => n.type === type && n.title.toLowerCase() === title.toLowerCase()) ??
    notes.find(n => n.path === `${dir}/${slug}.md` || (dated && n.path.startsWith(`${dir}/`) && n.path.endsWith(`-${slug}.md`)))
  const tags = strings(input.tags).map(t => t.replace(/^#/, ''))
  const links = strings(input.links).map(l => l.replace(/^\[\[|\]\]$/g, ''))
  const notProject = String(input.project ?? '').trim() || project
  let path: string
  let verb: string

  if (existing) {
    path = existing.path
    const text = await $.fs.read(`${root}/${path}`)
    const { meta, body: oldBody } = parseFrontmatter(text)
    const merged = {
      ...meta,
      tags: [...new Set([...strings(meta.tags), ...tags])],
      links: [...new Set([...strings(meta.links), ...links.map(l => `"[[${l}]]"`)])],
      summary: summary || String(meta.summary ?? ''),
      updated: date,
    }
    const addition = body && !oldBody.includes(body) ? `\n\n## Update ${date}\n\n${body}\n` : ''
    await $.fs.write(`${root}/${path}`, frontmatter(merged as Record<string, string | string[]>) + oldBody.trimEnd() + addition + '\n')
    verb = addition ? 'Updated' : 'Touched (body already present)'
  } else {
    path = `${dir}/${dated ? `${date}-` : ''}${slug}.md`
    const related = links.length ? `\n\nRelated: ${links.map(l => `[[${l}]]`).join(' · ')}\n` : '\n'
    const fields = {
      title,
      type,
      project: notProject,
      tags,
      status: 'active',
      created: date,
      updated: date,
      summary,
      links: links.map(l => `"[[${l}]]"`),
      supersedes: input.supersedes ? `"[[${String(input.supersedes).replace(/\.md$/, '')}]]"` : undefined,
    }
    await $.fs.write(`${root}/${path}`, `${frontmatter(fields)}# ${title}\n\n${body}${related}`)
    verb = 'Created'
  }

  if (input.supersedes) {
    const old = findNote(String(input.supersedes))
    if (old && old.path !== path) {
      const text = await $.fs.read(`${root}/${old.path}`)
      const { meta, body: oldBody } = parseFrontmatter(text)
      const fields = { ...meta, status: 'superseded', superseded_by: `"[[${path.replace(/\.md$/, '')}]]"`, updated: date }
      await $.fs.write(`${root}/${old.path}`, frontmatter(fields as Record<string, string | string[]>) + oldBody)
    }
  }
  await reindex($, true)
  return `${verb} ${root}/${path}`
}

async function deleteNote($: EngineInterface, rel: string) {
  const note = findNote(rel)
  if (!note) return `No note matches "${rel}".`
  const stamp = (await today($)) + '-' + String(await $.clock.now()).slice(-6)
  const full = `${root}/${note.path}`
  await $.fs.write(`${root}/_trash/${stamp}/${note.path}`, await $.fs.read(full))
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const argv = isWindows
    ? ['powershell', '-NoProfile', '-NonInteractive', '-Command', `Remove-Item -LiteralPath '${full.replace(/'/g, "''")}'`]
    : ['rm', '--', full]
  const ran = await $.process.run(argv)
  if (ran.exitCode !== 0) return `Copied to _trash but could not remove the original: ${short(ran.stderr.trim(), 200)}`
  await reindex($, true)
  return `Deleted ${note.path}. A copy is in ${root}/_trash/${stamp}/.`
}

async function brainCommand($: EngineInterface, args: string) {
  const [sub = '', ...rest] = args.trim().split(/\s+/)
  const arg = rest.join(' ')
  const stamp = `${await today($)}-${String(await $.clock.now()).slice(-6)}`
  switch (sub) {
    case 'search': {
      const hits = search(notes, arg, { project, limit: 12, includeInactive: true })
      return hits.length ? hits.map(h => `${h.score}  ${describeNote(h.note)}`).join('\n') : `Nothing matches "${arg}".`
    }
    case 'show': {
      const note = findNote(arg)
      if (!note) return `No note matches "${arg}".`
      const text = await $.fs.read(`${root}/${note.path}`)
      const back = backlinks(notes, note).map(n => `- ${n.path}`).join('\n') || '- none'
      return `${root}/${note.path}\n\n${text}\n\nBacklinks:\n${back}`
    }
    case 'recent':
      return [...notes].sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 12).map(describeNote).join('\n') || 'No notes yet.'
    case 'rebuild':
      await reindex($, true)
      return `Re-scanned ${notes.length} notes and rewrote ${root}/index.md.`
    case 'export': {
      const parts: string[] = []
      for (const n of notes) parts.push(`\n\n<!-- ${n.path} -->\n\n${await $.fs.read(`${root}/${n.path}`)}`)
      await $.fs.write(`${root}/_exports/brain-${stamp}.md`, `# Second brain export ${stamp}${parts.join('')}`)
      await $.fs.write(
        `${root}/_exports/brain-${stamp}.json`,
        JSON.stringify(notes.map(({ text, ...meta }) => meta), null, 2),
      )
      return `Exported ${notes.length} notes to ${root}/_exports/brain-${stamp}.md and .json.`
    }
    case 'backup': {
      const files = [...notes.map(n => n.path), 'index.md', 'README.md']
      let count = 0
      for (const rel of files) {
        if (!(await $.fs.exists(`${root}/${rel}`))) continue
        await $.fs.write(`${root}/_backups/${stamp}/${rel}`, await $.fs.read(`${root}/${rel}`))
        count += 1
      }
      return `Backed up ${count} files to ${root}/_backups/${stamp}/.`
    }
    case 'delete': {
      const rel = inside(arg)
      return rel ? deleteNote($, rel) : 'Give a note path inside the second brain, e.g. /brain delete lessons/foo.md'
    }
    case 'edit': {
      const note = findNote(arg)
      if (!note) return `No note matches "${arg}".`
      await $.prompt.fill({ text: `Edit the second-brain note ${root}/${note.path}: `, mode: 'replace' })
      return `Put an edit request for ${note.path} in the prompt box.`
    }
    case 'path':
      return root
    default: {
      const byType = new Map<string, number>()
      for (const n of notes) byType.set(n.type, (byType.get(n.type) ?? 0) + 1)
      const counts = [...byType].map(([t, c]) => `${t} ${c}`).join(', ') || 'empty'
      return [
        `Second brain: ${root}`,
        `${notes.length} notes (${counts}). Project here: ${project}.`,
        '',
        '/brain search <words>   find notes',
        '/brain show <path|title> read a note with its backlinks',
        '/brain recent           latest updates',
        '/brain edit <path>      ask Claude to edit a note',
        '/brain delete <path>    delete (a copy goes to _trash)',
        '/brain export | backup  write _exports/ or _backups/',
        '/brain rebuild          re-scan and rewrite index.md',
      ].join('\n')
    }
  }
}

async function dashCommand($: EngineInterface, args: string) {
  const [sub = 'show', name = ''] = args.trim().split(/\s+/)
  const d = await read($, dash)
  switch (sub) {
    case 'show':
    case '': {
      const { isPlaced } = await $.ui.open({ id: PANE, title: 'Workbench' })
      return isPlaced ? 'Dashboard open.' : `Dashboard can't be drawn here; showing it as text.\n\n${textDash(d)}`
    }
    case 'close':
      await $.ui.close({ id: PANE })
      return 'Dashboard closed. /dash brings it back.'
    case 'compact':
    case 'detailed':
      await savePrefs($, p => ({ ...p, view: sub }))
      return `Dashboard view: ${sub}.`
    case 'hide':
    case 'unhide':
      if (!name) return `Panels: ${[...new Set(Object.values(PANELS).flat())].join(', ')}`
      await savePrefs($, p => ({
        ...p,
        hidden: sub === 'hide' ? [...new Set([...p.hidden, name])] : p.hidden.filter(h => h !== name),
      }))
      return `${name} ${sub === 'hide' ? 'hidden' : 'shown'}.`
    case 'mode': {
      if (name === 'auto') {
        await change($, x => ({ ...x, pinnedMode: null }))
        return 'Dashboard mode follows the task again.'
      }
      if (!MODES.includes(name as Mode)) return `Modes: auto, ${MODES.join(', ')}`
      await change($, x => ({ ...x, mode: name as Mode, pinnedMode: name as Mode }))
      return `Dashboard pinned to ${name}.`
    }
    case 'text':
      return textDash(d)
    case 'reset':
      await change($, () => ({ ...EMPTY, usage: d.usage }))
      return 'Dashboard cleared.'
    default:
      return [
        '/dash              open the pane',
        '/dash close        close it',
        '/dash compact | detailed',
        '/dash hide <panel> | unhide <panel>',
        '/dash mode <coding|debugging|research|writing|planning|general|auto>',
        '/dash text         print it (for surfaces without panes)',
        '/dash reset        clear this session\'s dashboard',
      ].join('\n')
  }
}

function textDash(d: Dash) {
  const lines = [`[${d.mode}] ${d.objective || 'no objective yet'}${d.status ? ` — ${d.status}` : ''}`]
  const add = (label: string, items: string[]) => items.length && lines.push(`${label}: ${items.join('; ')}`)
  add('Agents', d.agents.map(a => `${a.type} ${a.status}`))
  add('Edited', [...new Set(d.files.filter(f => f.kind === 'edit').map(f => base(f.path)))])
  add('Checks', d.tests.slice(-4).map(t => `${t.ok ? 'ok' : 'FAIL'} ${short(t.command, 40)}`))
  add('Tasks', d.tasks.map(t => `${t.status === 'completed' ? '[x]' : '[ ]'} ${t.subject}`))
  add('Findings', d.findings.map(f => `${f.text} (${f.confidence})`))
  add('Decisions', d.decisions)
  add('Blockers', d.blockers)
  add('Next', d.next)
  add('Notes used', d.memories)
  return lines.join('\n')
}

function agentsReport(d: Dash) {
  const rows = Object.entries(AGENT_MODELS).map(([name, model]) => `  ${name.padEnd(22)} default model ${model}`)
  const usedModels = Object.entries(d.budget.byModel).map(([m, n]) => `${m} ${n}`).join(', ') || 'none'
  const live = d.agents.map(a => `  ${a.status.padEnd(9)} ${a.type}: ${a.description}`)
  return [
    'Agents (definitions in plugins/workbench/agents/*.md):',
    ...rows,
    '',
    `This session: ${d.budget.agentCalls} subagent calls (${usedModels}); ${d.budget.downgrades} downgraded under usage pressure.`,
    ...(live.length ? ['', 'Recent and running:', ...live] : []),
  ].join('\n')
}

async function budgetReport($: EngineInterface) {
  const { snap } = await budgetCheck($)
  const d = await read($, dash)
  const model = await $.session.model()
  const task = snap.usd !== undefined ? snap.usd - d.budget.taskStartUsd : undefined
  const lines = [
    `Main model: ${model}${/opus|fable|mythos/i.test(model) ? ' (for routine work, /model sonnet uses less of your limits)' : ''}`,
    `This request: ${task !== undefined ? `$${task.toFixed(2)}` : 'n/a'} of ${budgetCfg.taskUsd > 0 ? `$${budgetCfg.taskUsd}` : 'no budget'}; reserve ${budgetCfg.reservePercent}%`,
    `Session: ${snap.usd !== undefined ? `$${snap.usd.toFixed(2)}` : 'n/a'} of ${budgetCfg.sessionUsd > 0 ? `$${budgetCfg.sessionUsd}` : 'no budget'}; warnings from ${budgetCfg.warnPercent}%`,
    `Context window: ${snap.contextPercent ?? '?'}%${compactAt > 0 ? `; the plugin compacts at ${compactAt}%` : ''}`,
    ...(snap.windows.length
      ? snap.windows.map(w => `Account ${w.kind}: ${w.percentUsed}% used${w.resetsAt ? `, resets ${w.resetsAt}` : ''}`)
      : ['Account usage windows: not reported by this session (shown only on subscription plans after the first reply)']),
    `Tool calls ${d.budget.toolCalls}; subagent calls ${d.budget.agentCalls}; web lookups this request ${d.budget.searches}/${maxSearches}`,
    d.budget.loops.length ? `Repeated calls refused: ${d.budget.loops.join(', ')}` : '',
    'Costs are what Claude Code reports for this session (list-price estimates on a subscription); nothing here sees usage from other devices or chats except the account windows.',
  ]
  return lines.filter(Boolean).join('\n')
}

async function doctorReport($: EngineInterface) {
  const version = await $.session.version()
  const exists = await $.fs.exists(root)
  const panes = await $.ui.panes()
  const policyState = options.teamPolicy === false ? 'off' : policyComposed ? 'in the system prompt' : policySent ? 'sent as context with the first prompt' : 'on; goes out with the first prompt'
  const [major = 0, minor = 0, patch = 0] = (version.base ?? version.version).split(/[.-]/).map(Number)
  const tooOld = major * 1e6 + minor * 1e3 + patch < 2 * 1e6 + 1 * 1e3 + 287
  return [
    startupErrors.length ? `STARTUP ERRORS:\n${startupErrors.map(x => `  ${x}`).join('\n')}` : 'Startup: all steps succeeded',
    `Claude Code ${version.version}${tooOld ? ' (too old: mods need 2.1.287+)' : ''}; surfaces: ${(await $.session.surfaces()).join(', ') || 'none'}`,
    `Main model: ${await $.session.model()}`,
    `Second brain: ${root} ${exists ? `(${notes.length} notes)` : '(missing: create the folder or set brainPath)'}`,
    `Index: ${(await $.fs.exists(`${root}/index.md`)) ? 'present' : 'missing (run /brain rebuild)'}; ledger: ${(await $.fs.exists(ledgerPath())) ? ledgerPath() : 'none yet for this project'}`,
    `Project: ${project}`,
    `Dashboard: ${panes.some(p => p.id === PANE) ? 'open' : 'closed'} (view ${(await read($, prefs)).view})`,
    `Team policy: ${policyState}`,
    `Limits: ${maxParallel} parallel agents, ${maxReviews} reviews and ${maxSearches} web lookups per request`,
    `Budgets: $${budgetCfg.taskUsd} per request, $${budgetCfg.sessionUsd} per session, reserve ${budgetCfg.reservePercent}%, warn at ${budgetCfg.warnPercent}%`,
    'Agents: workbench:critic, researcher, architect, engineer, qa-security, efficiency, writer',
    'Skills: workbench:team-routing, workbench:natural-writing, workbench:second-brain, workbench:personal-profile',
  ].join('\n')
}

async function backupSettings($: EngineInterface) {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  const settings = `${home}/.claude/settings.json`
  if (!(await $.fs.exists(settings))) return 'No ~/.claude/settings.json to back up.'
  const stamp = new Date(await $.clock.now()).toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const target = `${home}/.claude/backups/settings.json.${stamp}.bak`
  await $.fs.write(target, await $.fs.read(settings))
  return `Settings backed up to ${target}`
}

async function systemCommand($: EngineInterface, args: string) {
  const [sub = 'help', ...rest] = args.trim().split(/\s+/)
  const arg = rest.join(' ')
  const d = await read($, dash)
  switch (sub) {
    case 'status':
      return `${textDash(d)}\n\n${await budgetReport($)}`
    case 'dashboard':
    case 'dash':
      return dashCommand($, arg)
    case 'agents':
      return agentsReport(d)
    case 'memory':
    case 'brain':
      return brainCommand($, arg)
    case 'budget':
    case 'usage':
      return budgetReport($)
    case 'resume': {
      const text = await $.fs.read(ledgerPath()).catch(() => '')
      if (!text) return `No ledger for ${project} yet.`
      await $.prompt.fill({ text: `Resume the unfinished work recorded in ${ledgerPath()}: `, mode: 'replace' })
      return `Ledger for ${project}:\n\n${text}\n\nA resume request is in the prompt box.`
    }
    case 'checkpoint':
      await writeLedger($)
      return (await $.fs.exists(ledgerPath())) ? `Ledger written: ${ledgerPath()}` : 'Nothing to checkpoint yet (no objective with tasks, edits or next steps).'
    case 'doctor':
      return doctorReport($)
    case 'config':
      return [
        'Options (change them in /plugin, workbench, Configure, or in ~/.claude/settings.json under pluginConfigs["workbench@claude-workbench"].options):',
        ...Object.entries(options).map(([k, v]) => `  ${k} = ${JSON.stringify(v)}`),
      ].join('\n')
    case 'backup':
      return `${await backupSettings($)}\n${await brainCommand($, 'backup')}`
    default:
      return [
        '/system status          dashboard summary and budget',
        '/system dashboard ...   same as /dash',
        '/system agents          agent team, default models, this session\'s delegation',
        '/system memory ...      same as /brain (search, show, recent, edit, delete, export, backup)',
        '/system budget          spend, context and account usage windows',
        '/system resume          load the last ledger for this project',
        '/system checkpoint      write the ledger now',
        '/system doctor          check that everything loaded',
        '/system config          current options',
        '/system backup          back up settings.json and the second brain',
      ].join('\n')
  }
}

export const register: Register = (on, opts) => {
  options = opts
  maxParallel = Number(opts.maxParallelAgents ?? 3)
  maxReviews = Number(opts.maxReviewRounds ?? 2)
  maxMemories = Number(opts.maxMemoriesPerPrompt ?? 3)
  maxSearches = Number(opts.maxSearchesPerRequest ?? 12)
  reviewMinFiles = Number(opts.reviewMinFiles ?? 3)
  compactAt = Number(opts.compactAtPercent ?? 80)
  budgetCfg = {
    taskUsd: Number(opts.taskBudgetUsd ?? 5),
    sessionUsd: Number(opts.sessionBudgetUsd ?? 20),
    reservePercent: Number(opts.reservePercent ?? 15),
    warnPercent: Number(opts.usageWarnPercent ?? 80),
  }

  on('session.start', async ($, e, next) => {
    policySent = false
    policyComposed = false
    ledgerResumeSent = false
    startupErrors = []

    await $.command.register({ name: 'system', description: 'Workbench: status, dashboard, agents, memory, budget, resume, doctor, config, backup' }).catch(noteError('register /system'))
    await $.command.register({ name: 'dash', description: 'Workbench dashboard: show, close, compact, detailed, hide/unhide <panel>, mode <m>' }).catch(noteError('register /dash'))
    await $.command.register({ name: 'brain', description: 'Second brain: search, show, recent, edit, delete, export, backup, rebuild' }).catch(noteError('register /brain'))

    await (async () => {
      root = await resolveRoot($)
      const projectRoot = await $.session.root().catch(() => e.cwd)
      project = slugify(projectRoot.split(/[\\/]/).filter(Boolean).pop() ?? 'global')
      await reindex($, false)
    })().catch(noteError('second brain'))

    await (async () => {
      const stored = (await $.store.get('prefs')) as Prefs | undefined
      if (stored) await update($, prefs, () => stored)
      await update($, dash, d => d ?? EMPTY)
    })().catch(noteError('dashboard state'))

    await $.tool.register({
      name: 'dashboard_update',
      description:
        'Update the workbench dashboard the person watches. Use in multi-step work when the objective, status, findings, decisions, blockers, next steps or draft state change. Each field you pass replaces what the dashboard shows for it.',
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          objective: { type: 'string' },
          status: { type: 'string', description: 'One line: where the work stands' },
          next: { type: 'array', items: { type: 'string' } },
          blockers: { type: 'array', items: { type: 'string' } },
          decisions: { type: 'array', items: { type: 'string' } },
          questions: { type: 'array', items: { type: 'string' }, description: 'Research questions or open questions' },
          findings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                confidence: { type: 'string', enum: ['verified', 'likely', 'uncertain', 'disputed'] },
                source: { type: 'string' },
              },
              required: ['text', 'confidence'],
            },
          },
          conflicts: { type: 'array', items: { type: 'string' } },
          draft: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              audience: { type: 'string' },
              tone: { type: 'string' },
              issues: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    }).catch(noteError('register tool dashboard_update'))
    await $.tool.register({
      name: 'brain_search',
      description:
        "Search the person's local second brain (Markdown notes on decisions, projects, lessons, research, workflows, open questions). Pass `query`, or `path` to read one note in full with its backlinks.",
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          path: { type: 'string', description: 'A note path or title to read in full' },
          type: { type: 'string', enum: Object.keys(TYPE_DIRS) },
          project: { type: 'string' },
          limit: { type: 'number' },
        },
      },
    }).catch(noteError('register tool brain_search'))
    await $.tool.register({
      name: 'brain_record',
      description:
        "Record or update a durable note in the person's second brain: a decision and its rationale, a verified task outcome, a lesson or fix, a workflow, research findings with sources, an open question, a project summary, or a stated preference. Updates the existing note on the same subject instead of duplicating it. Refuses text that looks like a secret. Never store credentials or sensitive personal details.",
      isDeferred: true,
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: Object.keys(TYPE_DIRS) },
          title: { type: 'string' },
          summary: { type: 'string', description: 'One line, used in search results and the index' },
          body: { type: 'string', description: 'Markdown. Link related notes with [[note-name]].' },
          project: { type: 'string', description: 'Project slug; defaults to the current project' },
          tags: { type: 'array', items: { type: 'string' } },
          links: { type: 'array', items: { type: 'string' }, description: 'Names or paths of related notes' },
          supersedes: { type: 'string', description: 'Path or title of a note this one replaces' },
        },
        required: ['type', 'title', 'summary', 'body'],
      },
    }).catch(noteError('register tool brain_record'))

    if (startupErrors.length) $.ui.log(`workbench: some startup steps failed (run /system doctor): ${startupErrors.join('; ')}`)

    if (options.autoOpenDashboard !== false && e.isInteractive) {
      void $.ui.open({ id: PANE, title: 'Workbench' }).catch(noteError('open dashboard'))
    }
    return next(e)
  })

  on('command.run', { command: 'dash' }, async ($, e) => ({ text: await dashCommand($, e.args) }))
  on('command.run', { command: 'brain' }, async ($, e) => ({ text: await brainCommand($, e.args) }))
  on('command.run', { command: 'system' }, async ($, e) => ({ text: await systemCommand($, e.args) }))

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (options.teamPolicy === false || policySent || e.traits.includes('bare') || e.traits.includes('teammate')) return composed
    policyComposed = true
    return { sections: [...composed.sections, { id: 'workbench:policy', text: policy(), scope: 'session' }] }
  })

  on('session.compact', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined) policySent = false
    return ran
  })

  on('session.end', async ($, e, next) => {
    await writeLedger($).catch(() => undefined)
    if (e.reason === 'clear') {
      policySent = false
      ledgerResumeSent = false
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta || (e.origin.kind === 'plugin' && e.origin.name === 'workbench')) return next(e)
    const fromPerson = ['composer', 'bridge', 'sdk', 'slack-ping', 'unclassified'].includes(e.origin.kind) && e.turnId === undefined
    const isNewTask = fromPerson && terms(e.text).length >= 3
    const extra: string[] = []
    if (options.teamPolicy !== false && !policySent && !policyComposed) {
      extra.push(policy())
      policySent = true
    }
    let context: string | undefined
    let used: string[] = []
    if (options.injectMemories !== false && notes.length && isNewTask) {
      const hits = search(notes, e.text, { project, limit: maxMemories }).filter(h => h.score >= 4)
      if (hits.length) {
        used = hits.map(h => h.note.path)
        context = [
          'Second-brain notes that may be relevant (workbench plugin). Use only if they help; cite the path if you rely on one; current instructions win.',
          ...hits.map(h => `- ${describeNote(h.note)}`),
        ].join('\n')
      }
    }
    if (!ledgerResumeSent && options.ledger !== false) {
      ledgerResumeSent = true
      const text = await $.fs.read(ledgerPath()).catch(() => '')
      const summary = text ? resumeSummary(text) : undefined
      if (summary) {
        extra.push(`Unfinished work from an earlier session in this project (workbench ledger at ${ledgerPath()}). Mention it only if it bears on the request; the person can say "resume" or run /system resume.\n${summary}`)
      }
    }
    if (isNewTask) {
      const usd = (await $.session.usage()).cost?.usd ?? 0
      callCounts.clear()
      requestStartedAt = await $.clock.now()
      skipReview = /\b(no review|skip (the )?review|without (a )?review|quick(ly)?|just do it|fast)\b/i.test(e.text)
      reviewNudged = false
      await change($, d => ({
        ...d,
        mode: d.pinnedMode ?? classify(e.text),
        objective: short(e.text.split(/\r?\n/)[0] ?? '', 140),
        status: '',
        reviews: 0,
        memories: used,
        budget: { ...d.budget, taskStartUsd: usd, warned: d.budget.warned.filter(w => w.startsWith('session') || w.startsWith('window')), searches: 0, loops: [] },
      }))
    }
    if (context) extra.push(context)
    return extra.length ? next({ ...e, context: [...(e.context ?? []), ...extra] }) : next(e)
  })

  on('tool.call', { tool: TOOL_DASH }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    await change($, d => {
      const out = { ...d }
      if (typeof input.objective === 'string') out.objective = input.objective
      if (typeof input.status === 'string') out.status = input.status
      for (const key of ['next', 'blockers', 'decisions', 'questions', 'conflicts'] as const) {
        if (Array.isArray(input[key])) out[key] = strings(input[key]).slice(0, 20)
      }
      if (Array.isArray(input.findings)) {
        out.findings = (input.findings as Record<string, unknown>[]).slice(0, 20).map(f => ({
          text: String(f.text ?? ''),
          confidence: String(f.confidence ?? 'uncertain'),
          source: f.source ? String(f.source) : undefined,
        }))
      }
      if (input.draft && typeof input.draft === 'object') {
        const draft = input.draft as Record<string, unknown>
        const prev = d.draft ?? { status: '', audience: '', tone: '', revisions: 0, issues: [] }
        out.draft = {
          status: String(draft.status ?? prev.status),
          audience: String(draft.audience ?? prev.audience),
          tone: String(draft.tone ?? prev.tone),
          issues: Array.isArray(draft.issues) ? strings(draft.issues) : prev.issues,
          revisions: prev.revisions + (draft.status && draft.status !== prev.status ? 1 : 0),
        }
      }
      return out
    })
    return { result: 'Dashboard updated.' }
  })

  on('tool.call', { tool: TOOL_SEARCH }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    if (input.path) {
      const note = findNote(String(input.path))
      if (!note) return { result: `No note matches "${String(input.path)}".` }
      const text = await $.fs.read(`${root}/${note.path}`)
      const back = backlinks(notes, note).map(n => `- ${n.path}`).join('\n') || '- none'
      return { result: `${root}/${note.path}\n\n${text}\n\nBacklinks:\n${back}` }
    }
    const hits = search(notes, String(input.query ?? ''), {
      project: input.project ? String(input.project) : project,
      type: input.type ? String(input.type) : undefined,
      limit: Number(input.limit ?? 8),
      includeInactive: true,
    })
    return {
      result: hits.length
        ? hits.map(h => `- ${describeNote(h.note)}${h.note.tags.length ? ` #${h.note.tags.join(' #')}` : ''}`).join('\n')
        : `No notes match. The second brain at ${root} has ${notes.length} notes.`,
    }
  })

  on('tool.call', { tool: TOOL_RECORD }, async ($, e) => ({
    result: await record($, e as unknown as Record<string, unknown>),
  }))

  on('tool.call', async ($, e, next) => {
    const isMain = e.agentId === undefined
    const advice: string[] = []
    const key = callKey(e as unknown as Record<string, unknown>)
    const repeats = (callCounts.get(key) ?? 0) + 1
    callCounts.set(key, repeats)
    if (repeats >= 5 && e.tool !== 'TaskUpdate' && e.tool !== TOOL_DASH) {
      await change($, x => ({ ...x, budget: { ...x.budget, loops: [...new Set([...x.budget.loops, short(String(e.tool), 40)])] } }))
      return { deny: `workbench: this exact ${e.tool} call has run ${repeats - 1} times in this request. It is not going to give a different result; change approach or report what is blocking you.` }
    }
    if (repeats === 3) advice.push(`workbench: this is the third identical ${e.tool} call in this request. If it isn't making progress, try something different.`)

    const check = await budgetCheck($)
    advice.push(...check.fresh)
    await change($, x => ({ ...x, budget: { ...x.budget, toolCalls: x.budget.toolCalls + 1 } }))

    if ((e.tool === 'WebSearch' || e.tool === 'WebFetch') && isMain) {
      const d = await read($, dash)
      if (check.stopsResearch) return { deny: check.stopsResearch.message }
      if (d.budget.searches >= maxSearches) {
        return { deny: `workbench: ${d.budget.searches} web searches and fetches already ran for this request (limit ${maxSearches}). Synthesize what you have and name what is still unknown, or ask the person to allow more.` }
      }
      await change($, x => ({ ...x, budget: { ...x.budget, searches: x.budget.searches + 1 } }))
    }

    if (e.tool === 'Agent' && isMain) {
      const running = (await $.agent.list()).filter(a => a.status === 'running').length
      if (running >= maxParallel) {
        return { deny: `workbench: ${running} subagents are already running (limit ${maxParallel}). Wait for one to finish, or ask the person to raise maxParallelAgents.` }
      }
      if (check.stopsDelegation) return { deny: check.stopsDelegation.message }
      const isReview = /critic|qa-security/.test(e.subagent_type ?? '')
      if (isReview) {
        const d = await read($, dash)
        if (d.reviews >= maxReviews) {
          return { deny: `workbench: ${d.reviews} review rounds already ran for this request (limit ${maxReviews}). Synthesize with what you have, or ask the person for another round.` }
        }
        await change($, x => ({ ...x, reviews: x.reviews + 1 }))
      }
      let call = e
      const intended = e.model ?? AGENT_MODELS[e.subagent_type ?? ''] ?? 'inherit'
      let model = intended
      if (options.downgradeUnderPressure !== false && intended === 'opus' && underPressure(budgetCfg, check.snap)) {
        call = { ...e, model: 'sonnet' }
        model = 'sonnet'
        advice.push('workbench: account usage is high, so this subagent ran on sonnet instead of opus.')
        await change($, x => ({ ...x, budget: { ...x.budget, downgrades: x.budget.downgrades + 1 } }))
      }
      await change($, x => ({
        ...x,
        budget: { ...x.budget, agentCalls: x.budget.agentCalls + 1, byModel: { ...x.budget.byModel, [model]: (x.budget.byModel[model] ?? 0) + 1 } },
      }))
      if (!agentTimer) agentTimer = $.clock.every(4000, () => void refreshAgents($).catch(() => undefined))
      const ran = await next(call)
      await refreshAgents($)
      if (ran.isError && /model/i.test(ran.text ?? '') && /(not (available|found|allowed|supported)|unavailable|invalid|access|permission)/i.test(ran.text ?? '')) {
        advice.push(`workbench: the ${model} model looks unavailable to this account. Retry once with model "sonnet"; if that fails too, do the work directly.`)
      }
      return ran.deny === undefined && advice.length ? { ...ran, context: [...(ran.context ?? []), ...advice] } : ran
    }

    if ((e.tool === 'Edit' || e.tool === 'Write' || e.tool === 'NotebookEdit') && e.agentId !== undefined) {
      const path = e.tool === 'NotebookEdit' ? e.notebook_path : e.file_path
      const holder = claims.get(path)
      if (holder && holder !== e.agentId) {
        const stillRunning = (await $.agent.list()).some(a => a.id === holder && a.status === 'running')
        if (stillRunning) return { deny: `workbench: another subagent (${holder}) is editing ${path}. Leave it to that agent or report back to the orchestrator.` }
      }
      claims.set(path, e.agentId)
    }

    const ran = await next(e)
    const now = await $.clock.now()
    const failed = ran.deny === undefined && ran.isError === true

    switch (e.tool) {
      case 'Read':
        await change($, d => ({ ...d, files: [...d.files, { path: e.file_path, kind: 'read' as const, at: now }].slice(-60) }))
        break
      case 'Edit':
      case 'Write':
      case 'NotebookEdit': {
        const path = e.tool === 'NotebookEdit' ? e.notebook_path : e.file_path
        const guess = modeFromFile(path)
        await change($, d => ({
          ...d,
          mode: d.pinnedMode ?? (d.mode === 'general' && guess ? guess : d.mode),
          files: [...d.files, { path, kind: 'edit' as const, at: now }].slice(-60),
        }))
        break
      }
      case 'Bash': {
        const written = ran.deny === undefined ? bashWrites(e.command) : []
        if (written.length) {
          await change($, d => ({
            ...d,
            mode: d.pinnedMode ?? (d.mode === 'general' && written.some(isCodeFile) ? 'coding' : d.mode),
            files: [...d.files, ...written.map(path => ({ path, kind: 'edit' as const, at: now }))].slice(-60),
          }))
        }
        if (isTestCommand(e.command) && ran.deny === undefined) {
          const ok = !failed
          await change($, d => ({
            ...d,
            tests: [...d.tests, { command: short(e.command, 80), ok, summary: testSummary(ran.text ?? ''), at: now }].slice(-20),
          }))
        }
        break
      }
      case 'WebFetch':
        await change($, d => ({ ...d, sources: [...d.sources, { label: e.url, kind: 'web' as const, at: now }].slice(-30) }))
        break
      case 'WebSearch':
        await change($, d => ({ ...d, sources: [...d.sources, { label: e.query, kind: 'search' as const, at: now }].slice(-30) }))
        break
      case 'TaskCreate': {
        const id = ran.text?.match(/#(\d+)/)?.[1]
        if (id) await change($, d => ({ ...d, tasks: [...d.tasks, { id, subject: e.subject, status: 'pending' }].slice(-30) }))
        break
      }
      case 'TaskUpdate':
        await change($, d => ({
          ...d,
          tasks: d.tasks
            .map(t => (t.id === e.taskId ? { ...t, status: e.status ?? t.status, subject: e.subject ?? t.subject } : t))
            .filter(t => t.status !== 'deleted'),
        }))
        break
    }

    if (failed && e.tool !== 'Bash') {
      await change($, d => ({ ...d, errors: [...d.errors, `${e.tool}: ${short((ran.text ?? '').replace(/\s+/g, ' '), 120)}`].slice(-8) }))
    }
    return ran.deny === undefined && advice.length ? { ...ran, context: [...(ran.context ?? []), ...advice] } : ran
  })

  on('classic.Stop', async ($, e, next) => {
    stopHookRan = true
    const result = await next(e)
    if (result.block || e.stop_hook_active) return result
    const reason = reviewReason(await read($, dash))
    if (!reason) return result
    reviewNudged = true
    return { ...result, block: reason }
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && !stopHookRan) {
      const reason = reviewReason(await read($, dash))
      if (reason) {
        reviewNudged = true
        void $.prompt.submit({ text: reason }).catch(() => undefined)
      }
    }
    await budgetCheck($)
    await refreshAgents($)
    await writeLedger($)
    await maybeCompact($)
    claims.clear()
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const d = await read($, dash)
    const p = await read($, prefs)
    const detailed = p.view === 'detailed'
    const width = Math.max(24, e.props.bodyColumns ?? 48)
    const room = detailed ? 8 : 3
    const visible = PANELS[d.mode].filter(id => !p.hidden.includes(id))

    const heading = (label: string, extra = '') => (
      <Text bold>
        {label}
        {extra ? <Text dimColor> {extra}</Text> : ''}
      </Text>
    )
    const line = (text: string, color?: string) => (
      <Text color={color} wrap="truncate-end">
        {short(text, width)}
      </Text>
    )
    const none = (what: string) => <Text dimColor>{what}</Text>

    const panels: Record<string, () => RenderChildren> = {
      objective: () => (
        <Box flexDirection="column">
          {heading('Objective', d.mode + (d.pinnedMode ? ' (pinned)' : ''))}
          {d.objective ? <Text wrap="wrap">{short(d.objective, detailed ? 280 : width * 2)}</Text> : none('Waiting for a task.')}
          {d.status ? line(`Status: ${d.status}`, 'suggestion') : ''}
          {d.next.slice(0, room).map(n => line(`next  ${n}`))}
        </Box>
      ),
      agents: () => {
        const rows = detailed ? d.agents : d.agents.filter(a => a.status === 'running')
        return (
          <Box flexDirection="column">
            {heading('Agents', `${d.agents.filter(a => a.status === 'running').length} running`)}
            {rows.length === 0
              ? none('None active.')
              : rows.slice(-room).map(a => line(`${a.status === 'running' ? 'runs' : a.status} ${a.type.replace(/^workbench:/, '')}: ${a.description}`, a.status === 'running' ? 'claude' : undefined))}
          </Box>
        )
      },
      files: () => {
        const latest = new Map<string, 'read' | 'edit'>()
        for (const f of d.files) latest.set(f.path, latest.get(f.path) === 'edit' ? 'edit' : f.kind)
        const rows = [...latest].reverse()
        const edited = rows.filter(([, k]) => k === 'edit').length
        return (
          <Box flexDirection="column">
            {heading('Files', `${edited} edited, ${rows.length - edited} read`)}
            {rows.length === 0 ? none('No files touched.') : rows.slice(0, room).map(([path, kind]) => line(`${kind === 'edit' ? '✎' : '·'} ${base(path)}`, kind === 'edit' ? 'warning' : undefined))}
          </Box>
        )
      },
      tests: () => {
        const latest = new Map(d.tests.map(t => [t.command, t]))
        const failing = [...latest.values()].filter(t => !t.ok)
        return (
          <Box flexDirection="column">
            {heading('Checks', latest.size ? `${latest.size - failing.length}/${latest.size} passing` : '')}
            {latest.size === 0
              ? none('No tests or checks run yet.')
              : [...latest.values()].slice(-room).map(t => line(`${t.ok ? 'pass' : 'FAIL'} ${t.command}${t.summary ? ` (${t.summary})` : ''}`, t.ok ? 'success' : 'error'))}
          </Box>
        )
      },
      tasks: () => {
        const open = d.tasks.filter(t => t.status !== 'completed')
        return (
          <Box flexDirection="column">
            {heading('Tasks', d.tasks.length ? `${d.tasks.length - open.length}/${d.tasks.length} done` : '')}
            {d.tasks.length === 0
              ? none('No task list.')
              : (detailed ? d.tasks : open).slice(0, room + 2).map(t =>
                  line(`${t.status === 'completed' ? '[x]' : t.status === 'in_progress' ? '[>]' : '[ ]'} ${t.subject}`, t.status === 'in_progress' ? 'claude' : t.status === 'completed' ? 'subtle' : undefined),
                )}
          </Box>
        )
      },
      blockers: () =>
        d.blockers.length ? (
          <Box flexDirection="column">
            {heading('Blockers')}
            {d.blockers.slice(0, room).map(b => line(`! ${b}`, 'error'))}
          </Box>
        ) : (
          ''
        ),
      questions: () => (
        <Box flexDirection="column">
          {heading('Questions')}
          {d.questions.length === 0 ? none('None recorded.') : d.questions.slice(0, room).map(q => line(`? ${q}`))}
        </Box>
      ),
      sources: () => (
        <Box flexDirection="column">
          {heading('Sources', `${d.sources.length}`)}
          {d.sources.length === 0 ? none('None examined yet.') : d.sources.slice(-room).reverse().map(s => line(`${s.kind === 'web' ? 'page' : 'search'} ${s.label}`, 'subtle'))}
        </Box>
      ),
      findings: () => (
        <Box flexDirection="column">
          {heading('Findings')}
          {d.findings.length === 0
            ? none('None yet.')
            : d.findings.slice(0, room).map(f => line(`${f.confidence === 'verified' ? '✓' : f.confidence === 'disputed' ? '≠' : '~'} ${f.text} [${f.confidence}]`, f.confidence === 'verified' ? 'success' : f.confidence === 'disputed' ? 'error' : undefined))}
          {d.conflicts.length ? heading('Conflicting evidence') : ''}
          {d.conflicts.slice(0, room).map(c => line(`≠ ${c}`, 'warning'))}
        </Box>
      ),
      draft: () => (
        <Box flexDirection="column">
          {heading('Draft', d.draft ? `rev ${d.draft.revisions}` : '')}
          {d.draft ? (
            <Box flexDirection="column">
              {line(`Status: ${d.draft.status || '?'}`)}
              {line(`Audience: ${d.draft.audience || '?'} · Tone: ${d.draft.tone || '?'}`)}
              {d.draft.issues.slice(0, room).map(i => line(`- ${i}`, 'warning'))}
            </Box>
          ) : (
            none('No draft tracked.')
          )}
        </Box>
      ),
      decisions: () => (
        <Box flexDirection="column">
          {heading('Decisions')}
          {d.decisions.length === 0 ? none('None yet.') : d.decisions.slice(-room).map(x => line(`- ${x}`))}
        </Box>
      ),
      memory: () =>
        d.memories.length ? (
          <Box flexDirection="column">
            {heading('Notes used')}
            {d.memories.map(m => line(m, 'subtle'))}
          </Box>
        ) : (
          ''
        ),
      errors: () =>
        d.errors.length ? (
          <Box flexDirection="column">
            {heading('Errors')}
            {d.errors.slice(-(detailed ? 5 : 2)).map(x => line(x, 'error'))}
          </Box>
        ) : (
          ''
        ),
      budget: () => {
        const b = d.budget
        const parts = [
          d.usage.usd !== undefined ? `$${(d.usage.usd - b.taskStartUsd).toFixed(2)} this request · $${d.usage.usd.toFixed(2)} session` : '',
          d.usage.contextPercent !== undefined ? `context ${d.usage.contextPercent}%` : '',
          ...b.windows.map(w => `${w.kind.replace('_', ' ')} ${w.percentUsed}%`),
        ].filter(Boolean)
        const hot = b.windows.some(w => w.percentUsed >= budgetCfg.warnPercent) || b.warned.some(w => w.startsWith('task') || w.endsWith('over'))
        return parts.length || b.agentCalls ? (
          <Box flexDirection="column">
            <Text dimColor={!hot} color={hot ? 'warning' : undefined} wrap="wrap">
              {parts.join(' · ')}
            </Text>
            {detailed ? <Text dimColor>{`${b.toolCalls} tool calls · ${b.agentCalls} agents${Object.keys(b.byModel).length ? ` (${Object.entries(b.byModel).map(([m, n]) => `${m} ${n}`).join(', ')})` : ''} · ${b.searches}/${maxSearches} lookups`}</Text> : ''}
            {b.loops.length ? line(`loop stopped: ${b.loops.join(', ')}`, 'error') : ''}
          </Box>
        ) : (
          ''
        )
      },
    }

    const toggle = (id: string) =>
      savePrefs($, x => ({ ...x, hidden: x.hidden.includes(id) ? x.hidden.filter(h => h !== id) : [...x.hidden, id] }))

    return (
      <Box flexDirection="column" gap={1}>
        {visible.map(id => panels[id]?.() ?? '')}
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Button key="view" plain label={detailed ? 'compact' : 'detailed'} onPress={() => savePrefs($, x => ({ ...x, view: detailed ? 'compact' : 'detailed' }))} />
          <Button
            key="mode"
            plain
            label={`mode: ${d.pinnedMode ?? 'auto'}`}
            onPress={() =>
              change($, x => {
                const order: (Mode | null)[] = [null, ...MODES]
                const pinned = order[(order.indexOf(x.pinnedMode) + 1) % order.length] ?? null
                return { ...x, pinnedMode: pinned, mode: pinned ?? x.mode }
              })
            }
          />
          {detailed ? PANELS[d.mode].map(id => <Button key={`p-${id}`} plain dimColor={p.hidden.includes(id)} label={p.hidden.includes(id) ? `+${id}` : `-${id}`} onPress={() => toggle(id)} />) : ''}
        </Box>
      </Box>
    )
  })
}
