import { readdirSync, readFileSync } from 'node:fs'
import YAML from 'yaml'

export type Field = {
  type: 'string' | 'number' | 'date' | 'boolean' | 'email' | 'phone' | 'list'
  label: string
  get: string
  optional?: boolean
  profile?: string
  default?: any
}

export type ActionSpec = {
  id: string
  tool: 'send_email' | 'send_sms' | 'place_call' | 'create_calendar_event' | 'prepare_form' | 'open_url_prefilled' | 'schedule_followup'
  title: string
  needs_approval: boolean
  due?: string
  when?: string
  unless?: string
  waits_on_other_party?: boolean
  payload: Record<string, any>
  outcome?: Record<string, any>
}

export type DeadlineSpec = {
  title: string
  due: string
  rule?: string
  note?: string
  when?: string
  unless?: string
  remind_days_before?: number[]
}

export type FollowupSpec = {
  after_action: string
  wait: string
  check: string
  resolved_when: string
  escalate?: Omit<ActionSpec, 'id'> & { id?: string }
}

export type Playbook = {
  id: string
  pack: string
  title: string
  pitch: string
  depth: 'deep' | 'standard'
  triggers: { documents: string[], phrases: string[] }
  required_fields: Record<string, Field>
  rules: string[]
  compute?: Record<string, { fn: string, args: Record<string, string> }>
  money_at_stake?: string
  guidance?: string
  datasf?: string[]
  actions: ActionSpec[]
  deadlines?: DeadlineSpec[]
  followups?: FollowupSpec[]
  sample: string
}

const playbooks = new Map<string, Playbook>()

export function loadPlaybooks() {
  playbooks.clear()
  for (const f of readdirSync('playbooks').filter(f => f.endsWith('.yaml'))) {
    const p = YAML.parse(readFileSync(`playbooks/${f}`, 'utf8')) as Playbook
    playbooks.set(p.id, p)
  }
  return playbooks
}

export function playbook(id: string) {
  const p = playbooks.get(id)
  if (!p) throw new Error(`Unknown playbook ${id}`)
  return p
}

export function allPlaybooks() {
  return [...playbooks.values()]
}

export const PACKS: Record<string, string> = {
  renter: 'Renters',
  car: 'Car owners',
  work: 'Tech and work',
  everyday: 'Everyday life',
  care: 'Caring for someone',
  business: 'Small business',
  newcomer: 'Newcomers',
  good: 'The good stuff'
}
