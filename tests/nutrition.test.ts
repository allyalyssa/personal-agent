import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.HANDLED_DB = ':memory:'
delete process.env.ANTHROPIC_API_KEY
const { loadRules } = await import('../server/rules.ts')
const { loadPlaybooks } = await import('../server/playbooks.ts')
const { nutritionTargets, mealPlan, parseHeight, parseWeight, parseTimes, allowedFoods, allowedRecipes, amount, FOODS } = await import('../server/nutrition.ts')
const { routeByTriggers } = await import('../server/agent.ts')
const { createCase, updateCase, setFields, plan, setProfile, prefillFromProfile } = await import('../server/engine.ts')
const { readFileSync } = await import('node:fs')

loadRules()
loadPlaybooks()

test('units parse from how people say them', () => {
  assert.equal(parseHeight(`5'6"`)!.cm, 167.6)
  assert.equal(parseHeight('168 cm')!.cm, 168)
  assert.equal(parseHeight('1.68 m')!.cm, 168)
  assert.equal(parseWeight('150 lb', false)!.kg, 68)
  assert.equal(parseWeight('68 kg', true)!.kg, 68)
  assert.deepEqual(parseTimes('8am, 1pm, 7:30pm'), ['08:00', '13:00', '19:30'])
})

test('Mifflin-St Jeor targets for a woman who lifts and is anemic', () => {
  const t: any = nutritionTargets({ age: 29, sex: 'female', height: '165 cm', weight: '62 kg', exercise: 'pesas 3 veces por semana', goal: 'bajar grasa', conditions: 'anemia', language: 'es' })
  assert.equal(t.bmr, 1350)
  assert.equal(t.tdee, 2090)
  assert.equal(t.calories, 1590)
  assert.deepEqual(t.protein, { min: 87, max: 124, target: 118 })
  assert.equal(t.needs.iron, 18)
  assert.ok(t.priority.includes('iron'))
  assert.ok(t.conditions.some((c: any) => c.condition === 'anemia' && c.source_url.includes('ods.od.nih.gov')))
  assert.match(t.explanation[0], /Quemas unas 2[.,]?090 calorías/)
})

test('lean mass uses Katch-McArdle and the calorie floor holds', () => {
  const lean: any = nutritionTargets({ age: 30, sex: 'male', height: '180 cm', weight: '80 kg', body_fat_pct: 12, activity: 'active', goal: 'maintain' })
  assert.equal(lean.formula, 'Katch-McArdle, from your lean mass')
  assert.equal(lean.bmr, 1890)
  const small: any = nutritionTargets({ age: 60, sex: 'female', height: '150 cm', weight: '45 kg', activity: 'sedentary', goal: 'lose' })
  assert.equal(small.calories, 1200)
  assert.equal(small.calorie_floor_applied, true)
})

test('conditions change the plan or step back', () => {
  const kidney: any = nutritionTargets({ age: 50, sex: 'male', height: '175 cm', weight: '80 kg', conditions: 'chronic kidney disease' })
  assert.equal(kidney.protein, null)
  assert.equal(kidney.needs.potassium, null)
  const ed: any = nutritionTargets({ age: 22, sex: 'female', height: '160 cm', weight: '50 kg', conditions: 'history of anorexia', goal: 'lose' })
  assert.equal(ed.calories, null)
  assert.ok(!ed.explanation.join(' ').match(/\d,\d{3} calories/))
  const pregnant: any = nutritionTargets({ age: 31, sex: 'female', height: '163 cm', weight: '64 kg', conditions: 'pregnant', trimester: 3, goal: 'lose' })
  assert.equal(pregnant.inputs.goal, 'maintain')
  assert.equal(pregnant.needs.iron, 27)
  const asian: any = nutritionTargets({ age: 40, sex: 'male', height: '170 cm', weight: '70 kg', ethnicity: 'Filipino' })
  assert.equal(asian.bmi, 24.2)
  assert.equal(asian.bmi_category, 'overweight')
})

test('review fixes: trimester is not kidney disease, nut allergy blocks almonds, eating disorder hides numbers', () => {
  const preg: any = nutritionTargets({ age: 31, sex: 'female', height: '163 cm', weight: '64 kg', conditions: 'pregnant, second trimester' })
  assert.ok(preg.protein && preg.needs.potassium, 'pregnancy kept protein and potassium targets')
  assert.ok(!preg.inputs.conditions.includes('kidney'))
  for (const a of ['nut allergy', 'cashews', 'walnuts']) assert.ok(!allowedFoods({ allergies: a }).some(f => f.id === 'almonds'), a)
  assert.ok(allowedFoods({ allergies: 'peanuts' }).some(f => f.id === 'almonds'))
  assert.ok(!allowedFoods({ conditions: 'pregnant' }).some(f => f.id === 'tuna'))
  const ed: any = nutritionTargets({ age: 22, sex: 'female', height: '160 cm', weight: '50 kg', conditions: 'anorexia', goal: 'lose' })
  assert.equal(ed.bmi, null)
  assert.equal(ed.tdee, null)
  assert.equal(ed.inputs.weight_kg, null)
  assert.ok(!ed.explanation.join(' ').match(/IMC|BMI|lose fat/))
  const p: any = mealPlan({ targets: ed, nearby: {} })
  assert.ok(!p.coverage.some((x: any) => x.key === 'kcal'))
})

test('review fixes: adults only, sane units, valid meal times, no deficit when underweight', () => {
  assert.equal((nutritionTargets({ age: 12, sex: 'female', height: '150 cm', weight: '40 kg' }) as any).ready, false)
  assert.equal((nutritionTargets({ age: 30, sex: 'male', height: '5', weight: '5' }) as any).ready, false)
  const thin: any = nutritionTargets({ age: 25, sex: 'female', height: '170 cm', weight: '50 kg', goal: 'lose' })
  assert.equal(thin.inputs.goal, 'maintain')
  assert.deepEqual(parseTimes('25:99, 7am'), ['07:00'])
})

test('allergies, diet and celiac remove foods', () => {
  const ids = allowedFoods({ allergies: 'peanuts, shellfish', diet: 'vegan', conditions: 'celiac' }).map(f => f.id)
  assert.ok(!ids.includes('peanut_butter'))
  assert.ok(!ids.includes('eggs'))
  assert.ok(!ids.includes('oats'))
  assert.ok(ids.includes('lentils'))
})

test('without a fitting recipe, the plate plan pairs iron with vitamin C and prefers nearby deals', () => {
  const t: any = nutritionTargets({ age: 29, sex: 'female', height: '165 cm', weight: '62 kg', exercise: 'lift 3x a week', goal: 'lose', conditions: 'anemia' })
  const nearby = { deals: { black_beans: [{ item: 'Black Beans 15 oz', price: 0.99, store: 'Safeway', walk_minutes: 6, valid_to: '2026-10-28T06:59:59+00:00' }] }, stores: [], markets: [] }
  const p: any = mealPlan({ targets: t, nearby, likes: 'eggs', meal_times: '8am, 1pm, 8pm', recipes: [] })
  const all = p.meals.flatMap((m: any) => m.items.map((i: any) => i.id))
  assert.ok(all.includes('black_beans'))
  assert.ok(all.includes('eggs'))
  assert.ok(p.pairs.length > 0, JSON.stringify(p.meals))
  const kcal = p.coverage.find((c: any) => c.key === 'kcal')
  assert.ok(Math.abs(kcal.have - t.calories) / t.calories < 0.15, `${kcal.have} vs ${t.calories}`)
  assert.equal(p.first_expiry.date, '2026-10-28')
  assert.match(p.shopping_text, /Safeway \$0\.99 \(6 min walk\)/)
})

test('each meal gets a recipe sized to its share of the day', () => {
  const t: any = nutritionTargets({ age: 29, sex: 'female', height: '165 cm', weight: '62 kg', exercise: 'lift 3x a week', goal: 'lose', conditions: 'anemia' })
  const p: any = mealPlan({ targets: t, nearby: {}, meal_times: '8am, 1pm, 7pm', max_cook_minutes: 45 })
  const ids = p.meals.map((m: any) => m.recipe?.id)
  assert.ok(ids.every(Boolean), JSON.stringify(p.meals.map((m: any) => [m.meal, m.recipe?.name])))
  assert.equal(new Set(ids).size, ids.length)
  for (const m of p.meals) assert.ok(Math.abs(m.recipe.kcal - m.kcal_target) <= m.kcal_target * 0.25, `${m.meal} ${m.recipe.kcal} vs ${m.kcal_target}`)
  assert.deepEqual(p.meals.map((m: any) => m.kcal_target), [400, 560, 480, 160])
  assert.ok(p.meals.every((m: any) => m.recipe.minutes <= 45 && m.recipe.url.startsWith('https://www.food.com/recipe/')))
  assert.deepEqual(p.coverage.map((c: any) => c.key), ['kcal', 'protein', 'fiber'])
})

test('a deal on a recipe ingredient shows on the shopping list and on that meal', () => {
  const t: any = nutritionTargets({ age: 35, sex: 'male', height: '178 cm', weight: '80 kg', goal: 'maintain' })
  const args = { targets: t, meal_times: '8am, 1pm, 7pm', max_cook_minutes: 45 }
  const base: any = mealPlan({ ...args, nearby: {} })
  const meal = base.meals.find((m: any) => m.recipe.ingredients.some((i: any) => FOODS.foods.some(f => f.match.some(w => i.item.toLowerCase().includes(w)) && !f.exclude.some(w => i.item.toLowerCase().includes(w)))))
  const text = meal.recipe.ingredients.map((i: any) => i.item.toLowerCase()).join(' | ')
  const food = FOODS.foods.find(f => f.match.some(w => text.includes(w)) && !f.exclude.some(w => text.includes(w)))!
  const nearby = { deals: { [food.id]: [{ item: food.name, price: 1.5, price_text: '$1.50 lb', store: 'Safeway', walk_minutes: 4, valid_to: '2026-10-28T06:59:59+00:00' }] }, stores: [], markets: [] }
  const p: any = mealPlan({ ...args, nearby })
  const line = p.shopping.find((s: any) => s.id === food.id)
  assert.equal(line.deal.store, 'Safeway')
  assert.ok(p.on_sale_count >= 1)
  assert.ok(p.shopping_text.includes('Safeway $1.50 lb (4 min walk)'))
  assert.ok(p.meals.some((m: any) => m.deals.some((d: any) => d.food === food.name && d.store === 'Safeway' && d.walk_minutes === 4 && d.price_text === '$1.50 lb')))
  assert.ok(p.shopping.some((s: any) => !s.deal), 'ingredients without a food still listed')
  assert.ok(!p.shopping.some((s: any) => /^(salt|water|pepper)$/.test(s.name)))
  assert.ok(p.shopping.length <= 25)
})

test('an anemic profile with recipes gets one iron side with vitamin C and a pairs line', () => {
  const t: any = nutritionTargets({ age: 29, sex: 'female', height: '165 cm', weight: '62 kg', exercise: 'lift 3x a week', goal: 'lose', conditions: 'anemia' })
  const p: any = mealPlan({ targets: t, nearby: {}, meal_times: '8am, 1pm, 8pm', max_cook_minutes: 45 })
  const sides = p.meals.flatMap((m: any) => m.items)
  assert.equal(sides.length, 2)
  assert.ok(p.meals.every((m: any) => m.recipe))
  assert.equal(p.pairs.length, 1)
  assert.match(p.pairs[0], /^lunch: .+ with .+, so the vitamin C helps you absorb the iron$/)
  const kcal = p.coverage.find((c: any) => c.key === 'kcal')
  assert.ok(Math.abs(kcal.have - t.calories) / t.calories < 0.15, `${kcal.have} vs ${t.calories}`)
  const plain: any = mealPlan({ targets: nutritionTargets({ age: 35, sex: 'male', height: '178 cm', weight: '80 kg' }), nearby: {}, meal_times: '8am, 1pm, 8pm', max_cook_minutes: 45 })
  assert.deepEqual(plain.pairs, [])
})

test('recipes respect diet, allergies and celiac line by line', () => {
  const lines = (args: any) => allowedRecipes(args).flatMap((r: any) => r.ingredients.map((i: any) => i.line.toLowerCase()))
  assert.ok(!lines({ diet: 'vegetarian', max_cook_minutes: 600 }).some((l: string) => /chicken|beef|pork|bacon|shrimp|salmon/.test(l)))
  assert.ok(!lines({ allergies: 'peanuts', max_cook_minutes: 600 }).some((l: string) => l.includes('peanut')))
  const celiac = lines({ conditions: 'celiac', max_cook_minutes: 600 })
  assert.ok(!celiac.some((l: string) => /\bflour\b/.test(l) && !/rice flour|almond flour|coconut flour|corn flour|gluten.free/.test(l)))
  assert.ok(allowedRecipes({ allergies: 'shellfish', max_cook_minutes: 600 }).some((r: any) => r.main === 'seafood' && /salmon/i.test(r.name)))
  assert.ok(allowedRecipes({ max_cook_minutes: 20 }).every((r: any) => r.minutes <= 20))
})

test('amounts for one serving read like a cook would say them', () => {
  assert.equal(amount({ line: '', qty: 0.167, unit: 'lb', item: 'sausage' }, 1), '2 2/3 oz')
  assert.equal(amount({ line: '', qty: 0.05, unit: 'cup', item: 'water' }, 1), '2 1/3 tsp')
  assert.equal(amount({ line: '', qty: 0.75, unit: null, item: 'eggs' }, 2), '1 1/2')
  assert.equal(amount({ line: '', qty: 0.333, unit: 'tbsp', item: 'oil' }, 1), '1 tsp')
  assert.equal(amount({ line: '', qty: null, unit: null, item: 'salt' }, 1), '')
})

test('keyword mode reads body facts from a voice note', async () => {
  const { bodyFacts } = await import('../server/nutrition.ts')
  const f = bodyFacts(`How many calories should I eat? I'm 29, female, 5'5" and 140 lb. I lift weights 3 times a week and want to lose a little fat. I'm anemic. No allergies. I shop near 1000 Guerrero St, I don't want to walk more than 15 minutes or cook more than 30.`)
  assert.deepEqual(f, { age: 29, sex: 'female', height: `5'5"`, weight: '140 lb', exercise: 'lift weights 3 times a week and want to lose a little fat', goal: 'lose fat', conditions: 'anemia', allergies: 'none', food_area: '1000 Guerrero St', max_walk_minutes: 15, max_cook_minutes: 30 })
  const es = bodyFacts('Tengo 34 años, hombre, 178 cm y 80 kg. Corro 4 veces por semana y quiero ganar músculo. Soy alérgico al maní.')
  assert.equal(es.age, 34)
  assert.equal(es.sex, 'male')
  assert.equal(es.height, '178 cm')
  assert.equal(es.weight, '80 kg')
  assert.equal(es.goal, 'build muscle')
})

test('routes nutrition questions in three languages', () => {
  assert.equal(routeByTriggers('how many calories should I eat a day')?.id, 'eat_well')
  assert.equal(routeByTriggers('¿cuántas calorías necesito y qué debo comer?')?.id, 'eat_well')
  assert.equal(routeByTriggers('o que devo comer para ganhar músculo')?.id, 'eat_well')
})

test('playbook plans from the profile without a lookup', () => {
  setProfile(JSON.parse(readFileSync('profiles/valentina.json', 'utf8')))
  const id = createCase('food')
  updateCase(id, { playbook: 'eat_well', pack: 'food' })
  prefillFromProfile(id)
  setFields(id, { nearby: { found: true, deals: {}, stores: [], markets: [], checked_at: new Date().toISOString() } })
  const v: any = plan(id)
  assert.equal(v.computed.targets.calories, 1590)
  assert.ok(v.actions.some((a: any) => a.step === 'meal_calendar' && a.payload.times === '08:00; 13:00; 20:00'))
  assert.ok(v.actions.some((a: any) => a.step === 'text_list' && a.payload.to === '+15555550110'))
  assert.ok(!v.actions.some((a: any) => a.step === 'calfresh'))
})
