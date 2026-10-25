// Prints Valentina's targets and meal plan without network calls: node scripts/plan-check.ts
process.env.HANDLED_DB = ':memory:'
const { readFileSync } = await import('node:fs')
const { loadRules } = await import('../server/rules.ts')
const { loadPlaybooks } = await import('../server/playbooks.ts')
const { createCase, updateCase, setFields, plan, setProfile, prefillFromProfile } = await import('../server/engine.ts')

loadRules()
loadPlaybooks()
setProfile(JSON.parse(readFileSync('profiles/valentina.json', 'utf8')))
const id = createCase('food')
updateCase(id, { playbook: 'eat_well', pack: 'food' })
prefillFromProfile(id)
setFields(id, { nearby: { found: true, deals: {}, stores: [], markets: [], checked_at: new Date().toISOString() } })
const v: any = plan(id)
const p = v.computed.plan
console.log(v.computed.targets.headline, `protein ${v.computed.targets.protein?.target} g`)
for (const m of p.meals) console.log(m.meal, m.time, m.kcal_target ?? '', '|', m.recipe ? `${m.recipe.name} (${m.recipe.kcal} kcal, ${m.recipe.protein_g} g protein, ${m.recipe.minutes} min)` : 'no recipe', '|', m.items.map((i: any) => `${i.servings}x ${i.id}`).join(' + '))
console.log('coverage', p.coverage.map((x: any) => `${x.key} ${x.percent}%`).join(' '))
