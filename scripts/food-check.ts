// Live check of the food lookup: npm run food-check -- "1000 Guerrero St"
process.env.HANDLED_DB = ':memory:'
const { loadRules } = await import('../server/rules.ts')
const { foodNearby } = await import('../server/food.ts')

loadRules()
const address = process.argv[2] ?? '1000 Guerrero St'
const r: any = await foodNearby({ address, walk_minutes: 15 })
console.log(r.map_error ?? 'map ok', r.address, r.zip, `${r.stores?.length} stores, ${r.markets?.length} markets, ${r.deal_count} deals`)
console.log(r.stores?.slice(0, 8).map((s: any) => `${s.name} (${s.kind}, ${s.walk_minutes} min)`).join('; '))
for (const [food, deals] of Object.entries(r.deals ?? {})) console.log(food, (deals as any[]).map(d => `${d.store ?? d.merchant} ${d.walk_minutes ?? '?'}min${d.price_text} ${d.item}`).join(' | '))
