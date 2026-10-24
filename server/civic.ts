import { db, json } from './db.ts'
import { allRules } from './rules.ts'
import { today } from './clock.ts'

// What Handled can tell the City, with no names, addresses or case details:
// which obligations people hit, and which steps still need a human because there is no online path.
export function civicReport() {
  const byPlaybook = db.prepare(`select playbook, count(*) n, sum(money_at_stake) at_stake, sum(money_recovered) recovered from cases where playbook is not null group by playbook order by n desc`).all()
  const manual = (db.prepare(`select tool, payload from actions where tool in ('prepare_form', 'open_url_prefilled') and status != 'rejected'`).all() as any[]).map(a => {
    const p = json(a.payload, {} as any)
    const url = p.official_url ?? p.url
    return url ? new URL(url).host : null
  }).filter(Boolean) as string[]
  const manualByHost = Object.entries(manual.reduce((m, h) => ({ ...m, [h]: (m[h] ?? 0) + 1 }), {} as Record<string, number>)).sort((a, b) => b[1] - a[1]).map(([host, count]) => ({ host, count }))
  const deadlines = db.prepare(`select rule_id, count(*) n from deadlines where rule_id is not null group by rule_id order by n desc`).all() as any[]
  const rules = Object.fromEntries(allRules().map(r => [r.id, r]))
  const reports311 = db.prepare(`select count(*) n from actions a join cases c on c.id = a.case_id where c.playbook = 'report_311' and a.status = 'done'`).get() as any
  const closed311 = db.prepare(`select count(*) n from cases where playbook = 'report_311' and status = 'resolved'`).get() as any
  return {
    generated: today(),
    note: 'Aggregate counts only. No names, addresses, amounts per person, or case text.',
    obligations: byPlaybook,
    steps_with_no_online_path: manualByHost,
    deadlines_tracked: deadlines.map(d => ({ rule: rules[d.rule_id]?.title ?? d.rule_id, count: d.n, rule_status: rules[d.rule_id]?.status })),
    reports_311: { prepared: reports311.n, closed_by_city: closed311.n }
  }
}
