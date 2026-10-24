import type { Dash } from '../types'

export type LedgerEntry = { date: string; objective: string; status: string }

export function hasProgress(d: Dash): boolean {
  return d.objective !== '' && (d.files.some(f => f.kind === 'edit') || d.tasks.length > 0 || d.next.length > 0 || d.decisions.length > 0)
}

export function ledgerMarkdown(project: string, d: Dash, stamp: string, history: LedgerEntry[]): string {
  const edited = [...new Set(d.files.filter(f => f.kind === 'edit').map(f => f.path))]
  const latestChecks = [...new Map(d.tests.map(t => [t.command, t])).values()]
  const open = d.tasks.filter(t => t.status !== 'completed')
  const lines = [
    `# Ledger: ${project}`,
    '',
    `Updated ${stamp} by the workbench plugin. It is rewritten at the end of each turn; resume from it with /system resume.`,
    '',
    '## Objective',
    '',
    d.objective || '(none)',
    '',
    `Mode: ${d.mode}${d.status ? `. Status: ${d.status}` : ''}`,
    '',
    '## Tasks',
    '',
    ...(d.tasks.length ? d.tasks.map(t => `- [${t.status === 'completed' ? 'x' : ' '}] ${t.subject}${t.status === 'in_progress' ? ' (in progress)' : ''}`) : ['(no task list)']),
    '',
    '## Next steps',
    '',
    ...(d.next.length ? d.next.map(n => `- ${n}`) : open.length ? open.map(t => `- ${t.subject}`) : ['(none recorded)']),
    '',
  ]
  if (d.blockers.length) lines.push('## Blockers', '', ...d.blockers.map(b => `- ${b}`), '')
  if (d.decisions.length) lines.push('## Decisions', '', ...d.decisions.map(x => `- ${x}`), '')
  if (edited.length) lines.push('## Files modified', '', ...edited.map(p => `- ${p}`), '')
  if (latestChecks.length) lines.push('## Checks', '', ...latestChecks.map(t => `- ${t.ok ? 'pass' : 'FAIL'}: \`${t.command}\`${t.summary ? ` (${t.summary})` : ''}`), '')
  const b = d.budget
  lines.push(
    '## Usage',
    '',
    `- Session cost: ${d.usage.usd !== undefined ? `$${d.usage.usd.toFixed(2)}` : 'n/a'}; context ${d.usage.contextPercent ?? '?'}%`,
    `- Subagent calls: ${b.agentCalls}${Object.keys(b.byModel).length ? ` (${Object.entries(b.byModel).map(([m, n]) => `${m} ${n}`).join(', ')})` : ''}; tool calls ${b.toolCalls}`,
    ...b.windows.map(w => `- Account ${w.kind}: ${w.percentUsed}%`),
    '',
  )
  if (history.length) lines.push('## Earlier objectives', '', ...history.map(h => `- ${h.date}: ${h.objective}${h.status ? ` (${h.status})` : ''}`), '')
  return lines.join('\n')
}

export function resumeSummary(text: string): string | undefined {
  const section = (name: string) => text.match(new RegExp(`## ${name}\\n\\n([\\s\\S]*?)(?:\\n## |$)`))?.[1]?.trim()
  const objective = section('Objective')
  const next = section('Next steps')
  const tasks = section('Tasks')
  const openTasks = tasks?.split('\n').filter(l => l.startsWith('- [ ]')).join('\n')
  if (!objective || objective === '(none)') return undefined
  if ((!next || next === '(none recorded)') && !openTasks) return undefined
  return [`Objective: ${objective.split('\n')[0]}`, openTasks ? `Open tasks:\n${openTasks}` : '', next && next !== '(none recorded)' ? `Next steps:\n${next}` : '']
    .filter(Boolean)
    .join('\n')
}
