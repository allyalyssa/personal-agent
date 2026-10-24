import type { Window } from '../types'

export type BudgetConfig = {
  taskUsd: number
  sessionUsd: number
  reservePercent: number
  warnPercent: number
}

export type Snapshot = { usd?: number; contextPercent?: number; windows: Window[] }

export type Notice = { level: string; message: string; stopsDelegation: boolean; stopsResearch: boolean }

const money = (n: number) => `$${n.toFixed(2)}`

export function assess(cfg: BudgetConfig, snap: Snapshot, taskStartUsd: number): Notice[] {
  const out: Notice[] = []
  const usd = snap.usd

  if (usd !== undefined && cfg.taskUsd > 0) {
    const spent = usd - taskStartUsd
    const reserveAt = cfg.taskUsd * (1 - cfg.reservePercent / 100)
    if (spent >= cfg.taskUsd) {
      out.push({
        level: 'task-over',
        message: `workbench budget: this request has used ${money(spent)} of its ${money(cfg.taskUsd)} budget. No new subagents or web research for it. Finish with what you have: verify, update the dashboard's next steps so the ledger can resume, and tell the person what remains.`,
        stopsDelegation: true,
        stopsResearch: true,
      })
    } else if (spent >= reserveAt) {
      out.push({
        level: 'task-reserve',
        message: `workbench budget: this request has used ${money(spent)} of ${money(cfg.taskUsd)}; the last ${cfg.reservePercent}% is reserved for verification and the answer. Stop exploring and delegating, check your result, and wrap up.`,
        stopsDelegation: true,
        stopsResearch: false,
      })
    }
  }

  if (usd !== undefined && cfg.sessionUsd > 0) {
    if (usd >= cfg.sessionUsd) {
      out.push({
        level: 'session-over',
        message: `workbench budget: the session has cost ${money(usd)}, past its ${money(cfg.sessionUsd)} budget. No new subagents. Ask the person before spending more.`,
        stopsDelegation: true,
        stopsResearch: false,
      })
    } else if (usd >= (cfg.sessionUsd * cfg.warnPercent) / 100) {
      out.push({
        level: 'session-warn',
        message: `workbench budget: the session has cost ${money(usd)} of its ${money(cfg.sessionUsd)} budget. Prefer direct work over delegation and cheaper models for routine sub-tasks.`,
        stopsDelegation: false,
        stopsResearch: false,
      })
    }
  }

  for (const w of snap.windows) {
    const resets = w.resetsAt ? ` (resets ${w.resetsAt})` : ''
    if (w.percentUsed >= 95) {
      out.push({
        level: `window-critical:${w.kind}`,
        message: `workbench usage: the account's ${w.kind.replace('_', '-')} usage window is at ${w.percentUsed}%${resets}. Checkpoint now: record progress and next steps with ${'mcp__workbench__dashboard_update'}, give the person a short status, and avoid new subagents.`,
        stopsDelegation: true,
        stopsResearch: true,
      })
    } else if (w.percentUsed >= cfg.warnPercent) {
      out.push({
        level: `window-warn:${w.kind}`,
        message: `workbench usage: the account's ${w.kind.replace('_', '-')} usage window is at ${w.percentUsed}%${resets}. Use fewer and cheaper subagents (sonnet or haiku), avoid repeated research, and keep answers tight.`,
        stopsDelegation: false,
        stopsResearch: false,
      })
    }
  }

  if (snap.contextPercent !== undefined && snap.contextPercent >= 85) {
    out.push({
      level: 'context-high',
      message: `workbench: the context window is ${snap.contextPercent}% full. Avoid re-reading large files; summarize instead of quoting.`,
      stopsDelegation: false,
      stopsResearch: false,
    })
  }
  return out
}

export function underPressure(cfg: BudgetConfig, snap: Snapshot): boolean {
  return snap.windows.some(w => w.percentUsed >= cfg.warnPercent)
}

const IGNORED = new Set(['tool', 'tool_use_id', 'agentId', 'requestMeta', 'consent'])

export function callKey(input: Record<string, unknown>): string {
  const keys = Object.keys(input).filter(k => !IGNORED.has(k)).sort()
  return `${String(input.tool)}:${JSON.stringify(keys.map(k => [k, input[k]]))}`
}
