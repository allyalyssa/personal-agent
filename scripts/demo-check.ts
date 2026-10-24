// Runs the stage flows end to end against live City data, in keyword mode, on a throwaway database.
// Use it before the demo: npm run demo-check
process.env.HANDLED_DB = ':memory:'
delete process.env.ANTHROPIC_API_KEY
const { readFileSync } = await import('node:fs')
const { loadRules } = await import('../server/rules.ts')
const { loadPlaybooks } = await import('../server/playbooks.ts')
const { createCase, setProfile, getCase, caseView } = await import('../server/engine.ts')
const { intake, reply } = await import('../server/agent.ts')

loadRules()
loadPlaybooks()
setProfile(JSON.parse(readFileSync('profiles/valentina.json', 'utf8')))

async function flow(name: string, text: string, answers: Record<string, any>, check: (v: any) => string) {
  const id = createCase(name)
  await intake(id, { text, source: 'demo check' })
  if (getCase(id).questions?.length) await reply(id, { answers })
  const v = caseView(id)
  const missing = v.questions?.map((q: any) => q.field) ?? []
  const line = missing.length ? `still asking for ${missing.join(', ')}` : check(v)
  console.log(`${v.playbook ?? 'no playbook'} | ${name}: ${line}`)
}

await flow('deposit interest', 'Mi depósito de garantía nunca me dio interés', {}, v =>
  `$${v.computed.interest.total_owed} owed, at least $${v.computed.interest.net_minimum} after fees; building built ${v.fields.building?.year_built}; ${v.actions.length} actions`)

await flow('parking ticket', 'Me pusieron una multa de estacionamiento por street cleaning', { citation_number: '2007036990' }, v =>
  `${v.fields.citation?.violation} $${v.fields.citation?.fine} at ${v.fields.citation?.location}; ${v.computed.check?.explanation} Deadline ${v.deadlines[0]?.due_at}`)

await flow('parked here', 'Estacioné en 1000 Guerrero St, lado oeste', { parked_address: '1000 Guerrero St', side: 'West' }, v =>
  `next sweep ${v.computed.next?.date} ${v.computed.next?.starts}-${v.computed.next?.ends}; reminder jobs ${v.jobs.length}`)

await flow('break-in call', 'Me rompieron el vidrio del auto anoche en Valencia y 20', { incident_date: '2026-10-23', incident_location: 'Valencia St and 20th St', damage: 'rear passenger window', max_price: '400' }, v =>
  `call to ${v.actions.find((a: any) => a.tool === 'place_call')?.payload.to}; ${v.actions.length} actions`)

await flow('311', 'Hay un poste de luz roto frente a 1000 Guerrero St', { problem: 'broken streetlight', location: '1000 Guerrero St', keyword: 'streetlight' }, v =>
  `${v.actions.length} actions; ${v.deadlines.length} deadlines`)

await flow('eat well', '¿Cuántas calorías necesito y qué debo comer?', {}, v => {
  const t = v.computed.targets
  const p = v.computed.plan
  const n = v.fields.nearby
  return `${t?.headline}; protein ${t?.protein?.target} g; iron ${t?.needs?.iron} mg; ${n?.stores?.length ?? 0} stores within ${n?.walk_minutes} min, ${n?.deal_count ?? 0} deals; plan: ${p?.meals?.map((m: any) => `${m.meal} ${m.items.map((i: any) => `${i.servings}x ${i.id}`).join('+')}`).join(' | ')}; on sale: ${p?.shopping?.filter((s: any) => s.deal).map((s: any) => `${s.id} ${s.deal.store} $${s.deal.price}`).join(', ')}; ${v.actions.length} actions; error: ${n?.error ?? 'none'}`
})

await flow('arrival','Hola, acabo de llegar a San Francisco', { staying_for: 'moving', work_authorized: 'yes', visa_waiver: 'no', arrival_date: '2026-10-20', moved_in_date: '2026-10-21' }, v =>
  v.deadlines.map((d: any) => `${d.due_at} ${d.title}`).join('; '))
