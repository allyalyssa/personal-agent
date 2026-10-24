export type Mode = 'coding' | 'debugging' | 'research' | 'writing' | 'planning' | 'general'

export type FileTouch = { path: string; kind: 'read' | 'edit'; at: number }
export type TestRun = { command: string; ok: boolean; summary: string; at: number }
export type TaskItem = { id: string; subject: string; status: string }
export type Source = { label: string; kind: 'web' | 'search'; at: number }
export type Finding = { text: string; confidence: string; source?: string }
export type Draft = {
  status: string
  audience: string
  tone: string
  revisions: number
  issues: string[]
}
export type AgentRow = { id: string; type: string; description: string; status: string }
export type Usage = { usd?: number; contextPercent?: number }
export type Window = { kind: string; percentUsed: number; resetsAt?: string }
export type Budget = {
  taskStartUsd: number
  windows: Window[]
  warned: string[]
  agentCalls: number
  toolCalls: number
  searches: number
  byModel: Record<string, number>
  loops: string[]
  downgrades: number
}

export type Dash = {
  mode: Mode
  pinnedMode: Mode | null
  objective: string
  status: string
  files: FileTouch[]
  tests: TestRun[]
  tasks: TaskItem[]
  sources: Source[]
  findings: Finding[]
  conflicts: string[]
  questions: string[]
  decisions: string[]
  blockers: string[]
  next: string[]
  draft: Draft | null
  errors: string[]
  memories: string[]
  agents: AgentRow[]
  usage: Usage
  budget: Budget
  reviews: number
}

export type View = 'compact' | 'detailed'
export type Prefs = { view: View; hidden: string[] }

declare module 'claude-code' {
  interface PluginState {
    workbench: { dash: Dash; prefs: Prefs }
  }
}
