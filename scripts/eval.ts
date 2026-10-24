// npm run eval: scores routing in keyword mode (free) and, with ANTHROPIC_API_KEY set, with Claude too.
// Also checks the sweeping rule against real street-cleaning tickets the City wrote this week.
// Results go to data/eval.json, which the app shows in Settings.
process.env.HANDLED_DB = ':memory:'
const { readFileSync, writeFileSync, mkdirSync } = await import('node:fs')
const { loadRules } = await import('../server/rules.ts')
const { loadPlaybooks } = await import('../server/playbooks.ts')
const { routeByTriggers, intake } = await import('../server/agent.ts')
const { createCase, getCase, setProfile } = await import('../server/engine.ts')
const { sweepingByAddress } = await import('../server/datasf.ts')
const { sweepingCheck } = await import('../server/compute.ts')
const { hasClaude } = await import('../server/llm.ts')

loadRules()
loadPlaybooks()
setProfile(JSON.parse(readFileSync('profiles/valentina.json', 'utf8')))
const cases = JSON.parse(readFileSync('eval/cases.json', 'utf8')) as { lang: string, text: string, playbook: string }[]

function score(results: { lang: string, ok: boolean }[]) {
  const by: Record<string, { ok: number, n: number }> = {}
  for (const r of results) {
    by[r.lang] ??= { ok: 0, n: 0 }
    by[r.lang].n++
    if (r.ok) by[r.lang].ok++
  }
  return { total: `${results.filter(r => r.ok).length}/${results.length}`, by_language: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, `${v.ok}/${v.n}`])) }
}

const keyword = cases.map(c => ({ ...c, got: routeByTriggers(c.text)?.id ?? null })).map(c => ({ ...c, ok: c.got === c.playbook }))

let claude = null
if (hasClaude()) {
  const results = []
  for (const c of cases) {
    const id = createCase('eval')
    await intake(id, { text: c.text, source: 'eval' })
    const got = getCase(id).playbook
    results.push({ ...c, got, ok: got === c.playbook })
  }
  claude = { ...score(results), misses: results.filter(r => !r.ok).map(r => `${r.text} -> ${r.got}`) }
}

const url = new URL('https://data.sf.gov/resource/ab4h-6ztd.json')
url.searchParams.set('$where', `violation_desc='STR CLEAN' and citation_issued_datetime > '${new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10)}'`)
url.searchParams.set('$select', 'citation_number,citation_issued_datetime,citation_location')
url.searchParams.set('$order', 'citation_issued_datetime DESC')
url.searchParams.set('$limit', '60')
const tickets = await (await fetch(url)).json()
let checked = 0
let agree = 0
for (const t of tickets) {
  if (!t.citation_issued_datetime) continue
  const s = await sweepingByAddress(t.citation_location)
  if (!s.found) continue
  checked++
  if (sweepingCheck({ schedules: s.schedules, issued_at: t.citation_issued_datetime }).scheduled) agree++
  if (checked >= 25) break
}

const report = {
  run_at: new Date().toISOString(),
  routing_keyword_mode: { ...score(keyword), misses: keyword.filter(r => !r.ok).map(r => `${r.text} -> ${r.got}`) },
  routing_claude: claude ?? 'not run (no ANTHROPIC_API_KEY)',
  sweeping_rule_vs_city_tickets: { tickets_checked: checked, schedule_matches: agree, meaning: 'Share of real street-cleaning tickets this week that the sweeping check says were written during a scheduled window. High agreement means Handled will not push protests the City would reject.' }
}
mkdirSync('data', { recursive: true })
writeFileSync('data/eval.json', JSON.stringify(report, null, 2))
writeFileSync('eval/latest.json', `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
