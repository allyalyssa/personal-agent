import { readdirSync, readFileSync } from 'node:fs'

export type Rule = {
  id: string
  title: string
  jurisdiction: string
  rule: string
  params: Record<string, any>
  source_url: string
  verify_phrase: string
  status: 'verified' | 'unverified'
  last_verified: string | null
  confirm_with: string
  notes?: string
}

const rules = new Map<string, Rule>()

export function loadRules() {
  rules.clear()
  for (const f of readdirSync('rules').filter(f => f.endsWith('.json'))) {
    const r = JSON.parse(readFileSync(`rules/${f}`, 'utf8')) as Rule
    rules.set(r.id, r)
  }
  return rules
}

export function rule(id: string) {
  const r = rules.get(id)
  if (!r) throw new Error(`Unknown rule ${id}`)
  return r
}

export function allRules() {
  return [...rules.values()]
}
