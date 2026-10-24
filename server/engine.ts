import { randomUUID } from 'node:crypto'
import { db, json } from './db.ts'
import { now, today, evalFormula, addDays, at9 } from './clock.ts'
import { playbook, type ActionSpec } from './playbooks.ts'
import { rule, allRules } from './rules.ts'
import { computeFns } from './compute.ts'
import { redactDeep } from './redact.ts'
import { queryDatasf } from './datasf.ts'

export type Case = {
  id: string
  playbook: string | null
  pack: string | null
  title: string
  status: 'open' | 'waiting_on_other_party' | 'escalated' | 'resolved'
  fields: Record<string, any>
  computed: Record<string, any>
  summary: string | null
  questions: { field: string, question: string }[] | null
  money_at_stake: number
  money_recovered: number
  messages: any[]
  busy: number
  created_at: string
  updated_at: string
}

export function getProfile() {
  const row = db.prepare('select data from profile where id = 1').get() as { data: string } | undefined
  return json(row?.data, {} as Record<string, any>)
}

export function setProfile(data: Record<string, any>) {
  db.prepare('insert into profile (id, data) values (1, ?) on conflict(id) do update set data = excluded.data').run(JSON.stringify(data))
}

export function getCase(id: string): Case {
  const row = db.prepare('select * from cases where id = ?').get(id) as any
  if (!row) throw new Error(`No case ${id}`)
  return {
    ...row,
    fields: json(row.fields, {}),
    computed: json(row.computed, {}),
    questions: json(row.questions, null),
    messages: json(row.messages, [])
  }
}

export function createCase(title: string) {
  const id = randomUUID().slice(0, 8)
  const at = now().toISOString()
  db.prepare('insert into cases (id, title, created_at, updated_at) values (?, ?, ?, ?)').run(id, title, at, at)
  return id
}

const columns = ['playbook', 'pack', 'title', 'status', 'fields', 'computed', 'summary', 'questions', 'money_at_stake', 'money_recovered', 'messages', 'busy']

export function updateCase(id: string, patch: Partial<Case>) {
  const keys = Object.keys(patch).filter(k => columns.includes(k))
  const values = keys.map(k => {
    const v = (patch as any)[k]
    return v !== null && typeof v === 'object' ? JSON.stringify(v) : v
  })
  db.prepare(`update cases set ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = ? where id = ?`).run(...values, now().toISOString(), id)
}

export function logEvent(caseId: string, kind: string, title: string, detail?: any) {
  db.prepare('insert into events (case_id, at, kind, title, detail) values (?, ?, ?, ?, ?)').run(caseId, now().toISOString(), kind, title, detail === undefined ? null : JSON.stringify(detail))
}

// 'a|b' means a, or b when a is empty.
export function get(ctx: any, path: string): any {
  if (path.includes('|')) return path.split('|').map(p => get(ctx, p.trim())).find(v => v != null && v !== '')
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx)
}

function fmtMoney(v: any) {
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(v: any) {
  return new Date(`${String(v).slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

// {{path}}, {{$ path}} for money, {{date path}}, {{lines list.field}} for one line per item.
export function render(template: string, ctx: any): string {
  return template.replace(/\{\{\s*(\$|date|lines)?\s*([\w.]+)\s*\}\}/g, (_, helper, path) => {
    if (helper === 'lines') {
      const [listPath, field] = [path.split('.').slice(0, -1).join('.'), path.split('.').at(-1)]
      const list = get(ctx, listPath) ?? []
      return list.map((item: any) => `- ${item[field]}`).join('\n')
    }
    const v = get(ctx, path)
    if (v === undefined || v === null) return `[${path}]`
    if (helper === '$') return fmtMoney(v)
    if (helper === 'date') return fmtDate(v)
    if (Array.isArray(v) && v.every(x => typeof x !== 'object')) return v.join('; ')
    return typeof v === 'object' ? JSON.stringify(v) : String(v)
  })
}

function renderDeep(value: any, ctx: any): any {
  if (typeof value === 'string') return render(value, ctx)
  if (Array.isArray(value)) return value.map(v => renderDeep(v, ctx))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renderDeep(v, ctx)]))
  return value
}

export function context(c: Case) {
  return { ...c.fields, ...c.computed, profile: getProfile(), today: today(), case: { id: c.id, title: c.title } }
}

function applies(spec: { when?: string, unless?: string }, ctx: any) {
  if (spec.when && !get(ctx, spec.when)) return false
  if (spec.unless && get(ctx, spec.unless)) return false
  return true
}

export function missingFields(c: Case) {
  const p = playbook(c.playbook!)
  return Object.entries(p.required_fields)
    .filter(([k, f]) => !f.optional && (c.fields[k] === undefined || c.fields[k] === null || c.fields[k] === ''))
    .map(([k, f]) => ({ field: k, label: f.label, get: f.get }))
}

function setPath(obj: any, path: string, value: any) {
  const keys = path.split('.')
  let o = obj
  for (const [i, k] of keys.slice(0, -1).entries()) {
    if (o[k] == null) o[k] = /^\d+$/.test(keys[i + 1]) ? [] : {}
    o = o[k]
  }
  o[keys.at(-1)!] = value
}

// Anything the user tells Handled about themself is kept, so no playbook asks twice.
// Facts with a profile path go to that path; everything else grows profile.memory, one key per fact.
export function remember(key: string, value: any, from: string) {
  const profile = getProfile()
  profile.memory ??= {}
  profile.memory[key] = { value: redactDeep(value), from, at: now().toISOString().slice(0, 10) }
  setProfile(profile)
}

export function setFields(caseId: string, fields: Record<string, any>) {
  const c = getCase(caseId)
  const clean = redactDeep(fields)
  const merged = { ...c.fields, ...clean }
  updateCase(caseId, { fields: merged })
  if (c.playbook) {
    const p = playbook(c.playbook)
    const profile = getProfile()
    let changed = false
    for (const [k, v] of Object.entries(clean)) {
      const f = p.required_fields[k]
      if (!f?.profile || v == null || v === '' || get(profile, f.profile) != null) continue
      setPath(profile, f.profile, v)
      changed = true
    }
    if (changed) setProfile(profile)
  }
  return merged
}

// Form answers arrive as text; turn them into the field's type.
export function coerceAnswers(playbookId: string | null, answers: Record<string, any>) {
  if (!playbookId) return answers
  const fields = playbook(playbookId).required_fields
  return Object.fromEntries(Object.entries(answers).map(([k, v]) => {
    const t = fields[k]?.type
    if (typeof v !== 'string') return [k, v]
    if (t === 'number') return [k, Number(v.replace(/[$,\s]/g, ''))]
    if (t === 'boolean') return [k, /^(y|yes|s[ií]|sim|true|1)/i.test(v.trim())]
    if (t === 'list') return [k, v.split(/,|\n/).map(s => s.trim()).filter(Boolean)]
    return [k, v.trim()]
  }))
}

export function prefillFromProfile(caseId: string) {
  const c = getCase(caseId)
  const p = playbook(c.playbook!)
  const profile = getProfile()
  const fields = { ...c.fields }
  for (const [k, f] of Object.entries(p.required_fields)) {
    if (fields[k] !== undefined) continue
    if (f.profile && get(profile, f.profile) != null) fields[k] = get(profile, f.profile)
    else if (profile.memory?.[k]?.value != null) fields[k] = profile.memory[k].value
    else if (f.default !== undefined) fields[k] = f.default
  }
  updateCase(caseId, { fields })
}

// Live City data the playbook declares (building records, sweeping schedule, the citation itself),
// fetched once per case and saved as fields so compute steps and drafts can use them.
export async function runLookups(caseId: string) {
  const c = getCase(caseId)
  const p = playbook(c.playbook!)
  for (const [name, spec] of Object.entries(p.lookups ?? {})) {
    const ctx = getCase(caseId).fields
    if (ctx[name] && !ctx[name].error) continue
    const args: Record<string, any> = { dataset: spec.dataset, keyword: spec.keyword }
    if (spec.address) args.address = get(ctx, spec.address)
    if (spec.number) args.number = get(ctx, spec.number)
    if (spec.date) args.date = get(ctx, spec.date)
    if ((spec.address && !args.address) || (spec.number && !args.number)) continue
    // A slow or failed City API should leave the case usable, not stall the whole intake.
    let result: any
    try {
      result = await queryDatasf(args as any)
    } catch (e: any) {
      result = { found: false, error: `City data unavailable: ${e.message}` }
    }
    setFields(caseId, { [name]: result })
    logEvent(caseId, 'data', `Looked up DataSF ${spec.dataset} (${args.address ?? args.number})`, result)
  }
}

export function runCompute(c: Case) {
  const p = playbook(c.playbook!)
  const computed: Record<string, any> = {}
  const rules = Object.fromEntries(allRules().map(r => [r.id, r]))
  for (const [name, spec] of Object.entries(p.compute ?? {})) {
    const args = Object.fromEntries(Object.entries(spec.args).map(([k, path]) => [k, typeof path === 'number' ? path : get({ ...c.fields, ...computed, rule: rules }, path)]))
    computed[name] = computeFns[spec.fn](args)
  }
  return computed
}

// Turns the playbook into concrete proposed actions and deadlines for this case.
// Re-running replaces anything not yet approved, so the agent can re-plan after new facts.
export function plan(caseId: string) {
  const c0 = getCase(caseId)
  const p = playbook(c0.playbook!)
  const computed = runCompute(c0)
  updateCase(caseId, { computed })
  const c = getCase(caseId)
  const ctx = context(c)
  const money = p.money_at_stake ? Number(get(ctx, p.money_at_stake) ?? 0) : 0
  updateCase(caseId, { money_at_stake: money })

  // Keep drafts the agent tailored, extra actions it proposed, and escalations; replace only untouched playbook drafts.
  db.prepare(`delete from actions where case_id = ? and status = 'proposed' and source = 'playbook' and coalesce(json_extract(payload, '$.revised'), 0) = 0`).run(caseId)
  db.prepare(`delete from deadlines where case_id = ? and kind = 'deadline' and done = 0`).run(caseId)
  db.prepare(`delete from jobs where case_id = ? and kind = 'reminder' and status = 'pending'`).run(caseId)

  const lookup = (path: string) => get(ctx, path)
  for (const d of p.deadlines ?? []) {
    if (!applies(d, ctx)) continue
    const due = evalFormula(d.due, lookup)
    if (!due) continue
    const r = d.rule ? rule(d.rule) : null
    const note = [d.note ? render(d.note, ctx) : null, r ? `${r.status === 'verified' ? 'Verified' : 'Unverified'}: ${r.source_url}. Confirm with ${r.confirm_with}.` : null].filter(Boolean).join(' ')
    const info = db.prepare('insert into deadlines (case_id, title, due_at, rule_id, note) values (?, ?, ?, ?, ?)').run(caseId, render(d.title, ctx), due, d.rule ?? null, note)
    for (const n of d.remind_days_before ?? []) {
      const at = addDays(due, -n)
      if (at >= today()) db.prepare(`insert into jobs (case_id, kind, run_at, payload) values (?, 'reminder', ?, ?)`).run(caseId, at9(at, d.remind_hour), JSON.stringify({ deadline_id: Number(info.lastInsertRowid), days_before: n }))
    }
  }

  const done = new Set((db.prepare(`select step from actions where case_id = ? and step is not null`).all(caseId) as any[]).map(a => a.step))
  for (const a of p.actions) {
    if (done.has(a.id) || !applies(a, ctx)) continue
    insertAction(caseId, a, ctx)
  }
  logEvent(caseId, 'plan', `Planned with playbook "${p.title}"`, { money_at_stake: money })
  return caseView(caseId)
}

export function insertAction(caseId: string, a: Omit<ActionSpec, 'id'> & { id?: string }, ctx: any) {
  const due = a.due ? evalFormula(a.due, path => get(ctx, path)) : null
  const payload = redactDeep(renderDeep(a.payload, ctx))
  if (a.outcome) payload.outcome = a.outcome
  if (a.waits_on_other_party) payload.waits_on_other_party = true
  const info = db.prepare('insert into actions (case_id, step, tool, title, payload, due_at, source, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(caseId, a.id ?? null, a.tool, render(a.title, ctx), JSON.stringify(payload), due, 'playbook', now().toISOString())
  return Number(info.lastInsertRowid)
}

export function scheduleFollowups(caseId: string, step: string) {
  const c = getCase(caseId)
  if (!c.playbook) return
  const p = playbook(c.playbook)
  const ctx = context(c)
  for (const f of p.followups ?? []) {
    if (f.after_action !== step) continue
    const runAt = evalFormula(`today + ${f.wait}`, () => null)!
    db.prepare(`insert into jobs (case_id, kind, run_at, payload) values (?, 'followup', ?, ?)`).run(caseId, at9(runAt), JSON.stringify({ step, check: render(f.check, ctx), resolved_when: f.resolved_when }))
    db.prepare(`insert into deadlines (case_id, title, due_at, kind, note) values (?, ?, ?, 'checkin', ?)`).run(caseId, `Check-in: ${render(f.check, ctx)}`, runAt, `Handled checks in automatically. Resolved when: ${f.resolved_when}`)
  }
}

export function caseView(id: string) {
  const c = getCase(id)
  const p = c.playbook ? playbook(c.playbook) : null
  return {
    ...c,
    messages: undefined,
    playbook_title: p?.title ?? null,
    rules: p ? p.rules.map(r => rule(r)) : [],
    actions: (db.prepare('select * from actions where case_id = ? order by id').all(id) as any[]).map(a => ({ ...a, payload: json(a.payload, {}), result: json(a.result, null) })),
    deadlines: db.prepare('select * from deadlines where case_id = ? order by due_at').all(id),
    events: (db.prepare('select * from events where case_id = ? order by id').all(id) as any[]).map(e => ({ ...e, detail: json(e.detail, null) })),
    jobs: db.prepare(`select * from jobs where case_id = ? and status = 'pending' order by run_at`).all(id),
    missing: p ? missingFields(c) : []
  }
}

export function listCases() {
  const cases = db.prepare('select id, playbook, pack, title, status, summary, money_at_stake, money_recovered, busy, updated_at from cases order by updated_at desc').all() as any[]
  const next = db.prepare(`select d.*, c.title as case_title from deadlines d join cases c on c.id = d.case_id where d.done = 0 and d.due_at >= ? and c.status != 'resolved' order by d.due_at limit 1`).get(today())
  const pending = db.prepare(`select case_id, count(*) n from actions where status = 'proposed' group by case_id`).all() as any[]
  const pendingBy = Object.fromEntries(pending.map(p => [p.case_id, p.n]))
  for (const c of cases) {
    c.pending_approvals = pendingBy[c.id] ?? 0
    c.next_deadline = db.prepare(`select title, due_at from deadlines where case_id = ? and done = 0 and due_at >= ? order by due_at limit 1`).get(c.id, today()) ?? null
  }
  const open = cases.filter(c => c.status !== 'resolved')
  return {
    cases,
    totals: {
      at_stake: open.reduce((s, c) => s + c.money_at_stake, 0),
      recovered: cases.reduce((s, c) => s + c.money_recovered, 0),
      open: open.length
    },
    next_deadline: next ?? null
  }
}

export function resolveCase(id: string, recovered: number) {
  const c = getCase(id)
  updateCase(id, { status: 'resolved', money_recovered: recovered, money_at_stake: 0 })
  db.prepare(`update jobs set status = 'cancelled' where case_id = ? and status = 'pending'`).run(id)
  db.prepare(`update deadlines set done = 1 where case_id = ?`).run(id)
  logEvent(id, 'resolved', recovered ? `Resolved. Recovered $${fmtMoney(recovered)}` : 'Resolved', { previous_status: c.status })
}
