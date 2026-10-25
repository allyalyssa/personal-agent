import { readFileSync } from 'node:fs'
import { rule } from './rules.ts'
import { today } from './clock.ts'
import { tasteSampler, rng, ratingCount } from './taste.ts'
import type { Busy } from './calendar.ts'

export type Food = { id: string, name: string, serving: string, search: string, match: string[], exclude: string[], roles: string[], diet: string[], allergens: string[], cook_minutes: number, n: Record<string, number> }

export const FOODS = JSON.parse(readFileSync('nutrition/foods.json', 'utf8')) as { source: string, source_url: string, units: Record<string, string>, foods: Food[] }

export type Ingredient = { line: string, qty: number | null, unit: string | null, item: string, size?: string }
export type Recipe = { id: number, name: string, dish: string, url: string, meal: string, category: string, cuisines: string[], main: string, tags: string[], minutes: number | null, servings: number, rating: number, reviews: number, score: number, per_serving: Record<string, number>, ingredients: Ingredient[] }

export const RECIPES = JSON.parse(readFileSync('nutrition/recipes.json', 'utf8')) as { source: string, source_url: string, license: string, recipes: Recipe[] }

const round = (n: number, step = 1) => Number((Math.round(n / step) * step).toFixed(2))

const list = (v: any): string[] => (Array.isArray(v) ? v : String(v ?? '').split(/[;,]| and | y | e /)).map(s => String(s).trim().toLowerCase()).filter(s => s && !/^(none|no|ninguna|nenhuma|n\/a)$/.test(s))

// "5'6", "5 ft 6 in", "168 cm", "1.68 m" or a bare number of centimeters.
export function parseHeight(v: any) {
  const s = String(v ?? '').toLowerCase().trim()
  const ft = s.match(/(\d+)\s*(?:'|ft|feet|foot|pies)\s*(\d+(?:\.\d+)?)?/)
  if (ft) return { cm: round((Number(ft[1]) * 12 + Number(ft[2] ?? 0)) * 2.54, 0.1), imperial: true }
  const m = s.match(/^(\d(?:\.\d+)?)\s*m$/)
  if (m) return { cm: Number(m[1]) * 100, imperial: false }
  const n = parseFloat(s)
  return Number.isFinite(n) ? { cm: n, imperial: false } : null
}

export function parseWeight(v: any, imperialHint: boolean) {
  const s = String(v ?? '').toLowerCase().trim()
  const n = parseFloat(s)
  if (!Number.isFinite(n)) return null
  if (/lb|pound|libra/.test(s)) return { kg: round(n * 0.4536, 0.1), assumed: false }
  if (/kg|kilo/.test(s)) return { kg: n, assumed: false }
  return { kg: imperialHint ? round(n * 0.4536, 0.1) : n, assumed: true }
}

function parseSex(v: any) {
  const s = String(v ?? '').toLowerCase()
  if (/^(f|female|woman|women|mujer|femenin|mulher|feminin)/.test(s)) return 'female'
  if (/^(m|male|man|men|hombre|masculin|homem|varón)/.test(s)) return 'male'
  return 'other'
}

function parseActivity(v: any, exercise: string) {
  const s = `${v ?? ''} ${exercise}`.toLowerCase()
  if (/\bvery\b|athlete|twice a day|muy activ|muito ativ/.test(s)) return 'very_active'
  const days = s.match(/(\d)\s*(?:x|times|days|veces|días|dias|vezes)/)
  if (days) return Number(days[1]) >= 6 ? 'active' : Number(days[1]) >= 3 ? 'moderate' : 'light'
  if (/sedentar|desk job|^\s*none\s*$|no exercise|\bnada\b|\bninguno\b/.test(s)) return 'sedentary'
  if (/light|ligera|leve|walk|camin/.test(s)) return 'light'
  if (/active|activ|ativ/.test(s)) return 'active'
  return 'moderate'
}

function parseGoal(v: any) {
  const s = String(v ?? '').toLowerCase()
  if (/lose|loss|cut|bajar|perder|adelgaz|emagrec/.test(s)) return 'lose'
  if (/gain|bulk|build|muscle|ganar|ganhar|músculo|musculo/.test(s)) return 'gain'
  return 'maintain'
}

const CONDITION_WORDS: Record<string, RegExp> = {
  anemia: /anemi|anémi|iron defic|hierro bajo|ferro baixo/,
  diabetes: /diabet|prediabet|insulin resist/,
  hypertension: /hypertens|blood pressure|presión alta|presion alta|pressão alta|hipertens/,
  cholesterol: /cholest|colesterol|ldl/,
  celiac: /celiac|coeliac|celíac|celiaq/,
  kidney: /kidney|\brenal\b|\bckd\b|riñón|riñon|rinon|\brim\b|doença renal/,
  pregnancy: /pregnan|embaraz|grávida|gravida|gestante/,
  breastfeeding: /breastfeed|nursing|lactanc|amamant/,
  lactose: /lactose|lactosa/,
  osteoporosis: /osteopor|osteopen|bone densit/,
  ibs: /\bibs\b|irritable bowel|colon irritable/,
  eating_disorder: /eating disorder|anorex|bulimi|binge|trastorno aliment|transtorno aliment/
}

export function parseConditions(v: any) {
  const text = list(v).join(' ')
  return Object.keys(CONDITION_WORDS).filter(k => CONDITION_WORDS[k].test(text))
}

const ASIAN = /asian|chinese|filipin|vietnam|korean|japanese|indian|south asian|pakistan|bangladesh|thai|indonesia|malays|taiwan|hmong|cambod|laotian|nepal|asiát|asiat/
const LACTOSE_GROUPS = /black|african|asian|chinese|filipin|vietnam|korean|japanese|indian|latin|hispan|mexican|native|indigenous|american indian|latino|latina/

function bmiCategory(bmi: number, asian: boolean) {
  const c = rule('nutrition_energy').params
  const over = asian ? c.bmi_cutoffs_asian.over : c.bmi_cutoffs.over
  const obese = asian ? c.bmi_cutoffs_asian.obese : c.bmi_cutoffs.obese
  if (bmi < c.bmi_cutoffs.under) return 'underweight'
  if (bmi < over) return 'healthy range'
  if (bmi < obese) return 'overweight'
  return 'obesity range'
}

const NUTRIENTS: Record<string, { name: string, unit: string, foods: string, how: string }> = {
  iron: { name: 'Iron', unit: 'mg', foods: 'lentils, beans, spinach, beef, sardines, tofu', how: 'Eat iron foods with vitamin C (peppers, oranges, strawberries). Keep coffee and tea an hour away from those meals; calcium at the same meal also blocks some iron.' },
  calcium: { name: 'Calcium', unit: 'mg', foods: 'yogurt, milk, calcium-set tofu, sardines, fortified soy milk', how: 'Your body absorbs about 500 mg at a time best, so spread it over meals. Vitamin D helps you absorb it. Most of the calcium in spinach is not absorbed.' },
  vitamin_d: { name: 'Vitamin D', unit: 'mcg', foods: 'salmon, sardines, eggs, fortified milk or soy milk', how: 'Few foods have much. Eat it with a meal that has some fat. Ask your doctor whether to test your level or take a supplement.' },
  b12: { name: 'Vitamin B12', unit: 'mcg', foods: 'fish, meat, eggs, dairy, fortified soy milk', how: 'Only animal foods and fortified foods have it. If you eat no animal foods, use fortified foods or a supplement every day.' },
  folate: { name: 'Folate', unit: 'mcg', foods: 'lentils, beans, spinach, broccoli, avocado', how: 'Beans and dark greens are the best sources.' },
  fiber: { name: 'Fiber', unit: 'g', foods: 'beans, lentils, oats, vegetables, fruit', how: 'Add it slowly over a couple of weeks and drink water with it.' },
  potassium: { name: 'Potassium', unit: 'mg', foods: 'potatoes, beans, lentils, spinach, bananas', how: 'Get it from food, not pills.' },
  magnesium: { name: 'Magnesium', unit: 'mg', foods: 'beans, almonds, spinach, brown rice, oats', how: 'Whole grains, nuts and beans cover most of it.' },
  vitamin_c: { name: 'Vitamin C', unit: 'mg', foods: 'peppers, oranges, strawberries, broccoli', how: 'Raw or lightly cooked keeps more of it. It also helps you absorb iron.' },
  protein: { name: 'Protein', unit: 'g', foods: 'chicken, fish, eggs, yogurt, tofu, lentils', how: 'Spread it out: about 20 to 40 g at each meal helps your muscles use it.' }
}

const NUTRIENT_TEXT: Record<string, Record<string, [string, string]>> = {
  es: {
    iron: ['Hierro', 'Come el hierro con vitamina C (morrón, naranja, frutillas). Deja el café y el té una hora lejos de esas comidas; el calcio en la misma comida también bloquea parte del hierro.'],
    vitamin_c: ['Vitamina C', 'Cruda o poco cocida conserva más. También te ayuda a absorber el hierro.'],
    calcium: ['Calcio', 'El cuerpo absorbe mejor unos 500 mg por vez, así que repártelo en las comidas. La vitamina D ayuda; el calcio de la espinaca casi no se absorbe.'],
    vitamin_d: ['Vitamina D', 'Pocos alimentos la tienen: salmón, sardinas, huevos, leche fortificada. Pregúntale a tu médico si conviene medirla o suplementar.'],
    b12: ['Vitamina B12', 'Solo está en alimentos animales y fortificados. Si no comes nada animal, usa fortificados o un suplemento todos los días.'],
    folate: ['Folato', 'Porotos, lentejas y hojas verdes son la mejor fuente.'],
    fiber: ['Fibra', 'Súbela de a poco durante un par de semanas y toma agua.'],
    potassium: ['Potasio', 'Mejor de la comida que de pastillas: papas, porotos, lentejas, bananas.'],
    magnesium: ['Magnesio', 'Granos integrales, frutos secos y porotos cubren casi todo.']
  },
  pt: {
    iron: ['Ferro', 'Coma o ferro com vitamina C (pimentão, laranja, morango). Deixe café e chá uma hora longe dessas refeições; cálcio na mesma refeição também bloqueia parte do ferro.'],
    vitamin_c: ['Vitamina C', 'Crua ou pouco cozida conserva mais. Também ajuda a absorver o ferro.'],
    calcium: ['Cálcio', 'O corpo absorve melhor uns 500 mg por vez, então divida nas refeições. A vitamina D ajuda; o cálcio do espinafre quase não é absorvido.'],
    vitamin_d: ['Vitamina D', 'Poucos alimentos têm: salmão, sardinha, ovos, leite fortificado. Pergunte ao seu médico sobre exame ou suplemento.'],
    b12: ['Vitamina B12', 'Só existe em alimentos animais e fortificados. Se você não come nada animal, use fortificados ou suplemento todo dia.'],
    folate: ['Folato', 'Feijão, lentilha e folhas verdes são as melhores fontes.'],
    fiber: ['Fibra', 'Aumente aos poucos por duas semanas e beba água.'],
    potassium: ['Potássio', 'Melhor da comida do que de comprimidos: batata, feijão, lentilha, banana.'],
    magnesium: ['Magnésio', 'Grãos integrais, castanhas e feijão cobrem quase tudo.']
  }
}

const T: Record<string, Record<string, (a: any) => string>> = {
  en: {
    burn: a => `You burn about ${a.tdee.toLocaleString('en-US')} calories a day (${a.formula}, ${a.activity}).`,
    lose: a => `To lose about 1 lb a week, eat about ${a.cal.toLocaleString('en-US')} a day.`,
    gain: a => `To gain muscle slowly, eat about ${a.cal.toLocaleString('en-US')} a day.`,
    maintain: a => `To stay where you are, eat about ${a.cal.toLocaleString('en-US')} a day.`,
    floor: a => `That is the lowest Handled plans without a clinician (${a.cal.toLocaleString('en-US')}).`,
    nocal: () => 'No calorie counting: the plan is built as balanced plates.',
    protein: a => `Protein: about ${a.g} g a day (${a.min} to ${a.max} g), split across meals, to ${a.why}.`,
    priority: a => `${a.name}: ${a.amount} ${a.unit} a day. ${a.how}`,
    bmi: a => `BMI ${a.bmi} (${a.cat}${a.asian ? ', using the lower cutoffs for Asian adults' : ''}). BMI does not see muscle, so treat it as a rough guide.`,
    plan: a => a.walk ? `The plan uses foods on sale within about ${a.walk} minutes' walk of ${a.area}.` : 'The plan uses common foods; add your area to see local deals.'
  },
  es: {
    burn: a => `Quemas unas ${a.tdee.toLocaleString('es-US')} calorías al día (${a.formula}, ${a.activity}).`,
    lose: a => `Para bajar cerca de medio kilo por semana, come unas ${a.cal.toLocaleString('es-US')} al día.`,
    gain: a => `Para ganar músculo de a poco, come unas ${a.cal.toLocaleString('es-US')} al día.`,
    maintain: a => `Para mantenerte, come unas ${a.cal.toLocaleString('es-US')} al día.`,
    floor: a => `Es lo mínimo que Handled planifica sin un profesional (${a.cal.toLocaleString('es-US')}).`,
    nocal: () => 'Sin contar calorías: el plan son platos balanceados.',
    protein: a => `Proteína: unos ${a.g} g al día (${a.min} a ${a.max} g), repartidos en las comidas, para ${a.why_es}.`,
    priority: a => `${a.name}: ${a.amount} ${a.unit} al día. ${a.how}`,
    bmi: a => `IMC ${a.bmi}. El IMC no distingue músculo; tómalo como guía aproximada.`,
    plan: a => a.walk ? `El plan usa comida en oferta a unos ${a.walk} minutos a pie de ${a.area}.` : 'El plan usa comida común; agrega tu zona para ver ofertas.'
  },
  pt: {
    burn: a => `Você gasta cerca de ${a.tdee.toLocaleString('pt-BR')} calorias por dia (${a.formula}, ${a.activity}).`,
    lose: a => `Para perder cerca de meio quilo por semana, coma umas ${a.cal.toLocaleString('pt-BR')} por dia.`,
    gain: a => `Para ganhar músculo aos poucos, coma umas ${a.cal.toLocaleString('pt-BR')} por dia.`,
    maintain: a => `Para manter o peso, coma umas ${a.cal.toLocaleString('pt-BR')} por dia.`,
    floor: a => `É o mínimo que o Handled planeja sem um profissional (${a.cal.toLocaleString('pt-BR')}).`,
    nocal: () => 'Sem contar calorias: o plano são pratos equilibrados.',
    protein: a => `Proteína: cerca de ${a.g} g por dia (${a.min} a ${a.max} g), divididos nas refeições, para ${a.why_pt}.`,
    priority: a => `${a.name}: ${a.amount} ${a.unit} por dia. ${a.how}`,
    bmi: a => `IMC ${a.bmi}. O IMC não enxerga músculo; use como guia aproximado.`,
    plan: a => a.walk ? `O plano usa comida em promoção a uns ${a.walk} minutos a pé de ${a.area}.` : 'O plano usa comida comum; adicione sua região para ver promoções.'
  }
}

export function nutritionTargets(args: { age: any, sex: any, height: any, weight: any, body_fat_pct?: any, muscle_mass?: any, activity?: any, exercise?: any, goal?: any, conditions?: any, diet?: any, ethnicity?: any, trimester?: any, language?: string, area?: string, walk_minutes?: any }) {
  const energy = rule('nutrition_energy').params
  const dri = rule('nutrition_dri').params
  const cond = rule('nutrition_conditions').params
  const age = Number(args.age)
  const sex = parseSex(args.sex)
  const height = parseHeight(args.height)
  const weight = height ? parseWeight(args.weight, height.imperial) : null
  if (!age || !height || !weight) return { ready: false, missing: [!age && 'age', !height && 'height', !weight && 'weight'].filter(Boolean) }
  // These equations and intakes are for adults; outside these ranges the input is probably a typo.
  if (age < 18 || age > 100) return { ready: false, missing: [], reason: 'Handled plans for adults 18 and older. For a child or teen, ask their pediatrician.' }
  if (height.cm < 90 || height.cm > 250 || weight.kg < 25 || weight.kg > 300) return { ready: false, missing: ['height', 'weight'], reason: 'That height or weight looks off. Check the units (lb or kg, ft or cm).' }

  const exercise = String(args.exercise ?? '')
  const activity = parseActivity(args.activity, exercise)
  const conditions = parseConditions(args.conditions)
  const noCalories = conditions.includes('eating_disorder')
  const goal = noCalories ? 'maintain' : parseGoal(args.goal)
  const diet = list(args.diet).join(' ')
  const plantOnly = /vegan|vegetar|plant/.test(diet)
  const asian = ASIAN.test(String(args.ethnicity ?? '').toLowerCase())
  const pregnant = conditions.includes('pregnancy')
  const nursing = conditions.includes('breastfeeding')
  const assumptions: string[] = []
  if (weight.assumed) assumptions.push(`Weight read as ${weight.kg} kg.`)

  const kg = weight.kg
  const cm = height.cm
  const bmi = round(kg / (cm / 100) ** 2, 0.1)
  const bodyFat = parseFloat(String(args.body_fat_pct ?? ''))
  let bmr: number
  let formula: string
  if (Number.isFinite(bodyFat) && bodyFat > 3 && bodyFat < 70) {
    bmr = 370 + 21.6 * kg * (1 - bodyFat / 100)
    formula = 'Katch-McArdle, from your lean mass'
  } else {
    const male = 10 * kg + 6.25 * cm - 5 * age + 5
    const female = 10 * kg + 6.25 * cm - 5 * age - 161
    bmr = sex === 'male' ? male : sex === 'female' ? female : (male + female) / 2
    formula = 'Mifflin-St Jeor'
    if (sex === 'other') assumptions.push('Used the average of the male and female equations; tell Handled if one fits you better.')
  }
  const factor = energy.activity_factors[activity]
  const tdee = round(bmr * factor, 10)
  const floor = energy.floor[sex]
  let calories = tdee
  let effectiveGoal = goal
  if ((pregnant || nursing) && goal === 'lose') {
    effectiveGoal = 'maintain'
    assumptions.push('No weight-loss target while pregnant or breastfeeding.')
  }
  if (goal === 'lose' && bmi < energy.bmi_cutoffs.under) {
    effectiveGoal = 'maintain'
    assumptions.push('Your BMI is already under 18.5, so Handled plans to maintain, not lose. Talk to your doctor about your goal.')
  }
  if (effectiveGoal === 'lose') calories = tdee - energy.deficit_per_day
  if (effectiveGoal === 'gain') calories = tdee + energy.surplus_per_day
  if (pregnant) calories += energy.pregnancy_extra[String(args.trimester ?? 2)] ?? energy.pregnancy_extra['2']
  if (nursing) calories += energy.breastfeeding_extra
  const atFloor = calories < floor
  if (atFloor) calories = floor
  calories = round(calories, 10)

  const exercises = activity !== 'sedentary' || exercise.length > 0
  const strength = /lift|weight|gym|strength|crossfit|pesas|gimnasio|muscula|calistenia|resistance/i.test(exercise)
  const endurance = /run|cycl|bike|swim|soccer|futbol|fútbol|marathon|correr|nadar|row|hike|basket|tennis|climb/i.test(exercise)
  const proteinKg = bmi >= 30 ? round(25 * (cm / 100) ** 2, 0.1) : kg
  if (bmi >= 30) assumptions.push(`Protein is based on ${proteinKg} kg (the weight at a BMI of 25), the usual practice at higher weights.`)
  let pMin = dri.protein_g_per_kg.rda
  let pMax = 1.0
  if (exercises && (strength || endurance || activity === 'active' || activity === 'very_active' || goal !== 'maintain')) {
    pMin = dri.protein_g_per_kg.exercise_min
    pMax = dri.protein_g_per_kg.exercise_max
  }
  if (pregnant) pMin = Math.max(pMin, dri.protein_g_per_kg.pregnancy)
  const kidney = conditions.includes('kidney')
  const protein = kidney ? null : {
    min: round(proteinKg * pMin),
    max: round(proteinKg * pMax),
    target: round(proteinKg * Math.min(pMax, strength || goal !== 'maintain' ? (pMin + pMax) / 2 + 0.2 : (pMin + pMax) / 2))
  }
  let fatPct = endurance ? 25 : 30
  if (conditions.includes('cholesterol')) fatPct = 25
  const fat_g = round(calories * fatPct / 100 / 9)
  let carbs_g = round((calories - (protein?.target ?? proteinKg * 0.8) * 4 - fat_g * 9) / 4)
  if (conditions.includes('diabetes')) carbs_g = Math.min(carbs_g, round(calories * cond.diabetes.carbs_percent_max / 100 / 4))

  const female = sex === 'female' || (sex === 'other' && pregnant)
  const iron = (pregnant ? dri.iron_mg.pregnant : sex === 'male' ? dri.iron_mg.male : age <= 50 ? dri.iron_mg.female_19_50 : dri.iron_mg.female_51_plus) * (plantOnly ? dri.iron_mg.vegetarian_multiplier : 1)
  let calcium = (female && age > 50) || (sex === 'male' && age > 70) ? 1200 : dri.calcium_mg.default
  if (conditions.includes('osteoporosis')) calcium = cond.osteoporosis.calcium_mg
  const needs: Record<string, number | null> = {
    protein: protein?.target ?? null,
    fiber: round(calories / 1000 * dri.fiber_g_per_1000_kcal),
    iron: round(iron, 0.1),
    calcium,
    vitamin_d: age > 70 ? dri.vitamin_d_mcg.age_71_plus : dri.vitamin_d_mcg.default,
    b12: pregnant ? dri.b12_mcg.pregnant : nursing ? dri.b12_mcg.breastfeeding : dri.b12_mcg.default,
    folate: pregnant ? dri.folate_mcg.pregnant : nursing ? dri.folate_mcg.breastfeeding : dri.folate_mcg.default,
    magnesium: pregnant ? dri.magnesium_mg.pregnant : sex === 'male' ? (age <= 30 ? dri.magnesium_mg.male_19_30 : dri.magnesium_mg.male_31_plus) : (age <= 30 ? dri.magnesium_mg.female_19_30 : dri.magnesium_mg.female_31_plus),
    potassium: kidney ? null : pregnant ? dri.potassium_mg.pregnant : sex === 'male' ? dri.potassium_mg.male : dri.potassium_mg.female,
    vitamin_c: pregnant ? dri.vitamin_c_mg.pregnant : nursing ? dri.vitamin_c_mg.breastfeeding : sex === 'male' ? dri.vitamin_c_mg.male : dri.vitamin_c_mg.female
  }

  const priority = new Set<string>()
  for (const c of conditions) for (const p of cond[c]?.priority ?? []) priority.add(p)
  if (plantOnly) {
    priority.add('b12')
    priority.add('iron')
  }
  if (female && age <= 50 && !priority.has('iron')) priority.add('iron')
  if (calcium >= 1200) priority.add('calcium')
  if (kidney) priority.delete('potassium')

  const lang = args.language && T[args.language] ? args.language : 'en'
  const say = T[lang]
  const losing = effectiveGoal === 'lose'
  const why = losing ? 'keep your muscle while you lose fat' : strength ? 'build and repair muscle' : endurance ? 'recover from training' : 'keep your muscles strong'
  const why_es = losing ? 'cuidar tu músculo mientras bajas grasa' : strength ? 'construir y reparar músculo' : endurance ? 'recuperarte del entrenamiento' : 'mantener tus músculos fuertes'
  const why_pt = losing ? 'manter o músculo enquanto perde gordura' : strength ? 'construir e reparar músculo' : endurance ? 'se recuperar do treino' : 'manter os músculos fortes'
  const activityLabel = activity.replace('_', ' ')
  const explanation: string[] = []
  if (noCalories) explanation.push(say.nocal({}))
  else {
    explanation.push(say.burn({ tdee, formula, activity: activityLabel }))
    explanation.push(atFloor ? say.floor({ cal: calories }) : say[effectiveGoal]({ cal: calories }))
  }
  if (protein) explanation.push(say.protein({ g: protein.target, min: protein.min, max: protein.max, why, why_es, why_pt }))
  for (const p of [...priority].slice(0, 2)) {
    if (needs[p] == null) continue
    const [name, how] = NUTRIENT_TEXT[lang]?.[p] ?? [NUTRIENTS[p].name, NUTRIENTS[p].how]
    explanation.push(say.priority({ name, amount: needs[p], unit: NUTRIENTS[p].unit, how }))
  }
  if (!pregnant && !noCalories) explanation.push(say.bmi({ bmi, cat: bmiCategory(bmi, asian), asian }))
  explanation.push(say.plan({ walk: Number(args.walk_minutes) || null, area: args.area }))

  const notes = conditions.map(c => ({ condition: c, label: cond[c].label, note: cond[c].note, source_url: cond[c].source_url, confirm_with: cond[c].confirm_with }))
  if (args.ethnicity && LACTOSE_GROUPS.test(String(args.ethnicity).toLowerCase()) && !conditions.includes('lactose')) {
    notes.push({ condition: 'lactose_info', label: 'If dairy bothers you', note: 'Lactose intolerance is more common in many groups. Say so and Handled swaps in fortified soy milk and tofu for calcium.', source_url: cond.lactose.source_url, confirm_with: cond.lactose.confirm_with })
  }

  return {
    ready: true,
    headline: noCalories ? 'Balanced plates, no counting' : `About ${calories.toLocaleString('en-US')} calories a day`,
    inputs: { age, sex, height_cm: round(cm, 0.1), weight_kg: noCalories ? null : kg, body_fat_pct: Number.isFinite(bodyFat) && !noCalories ? bodyFat : null, muscle_mass: noCalories ? null : args.muscle_mass ?? null, activity, exercise, goal: effectiveGoal, conditions, diet, ethnicity_used_for: asian ? 'BMI cutoffs' : args.ethnicity ? 'not used for targets' : null },
    bmi: noCalories ? null : bmi,
    bmi_category: pregnant || noCalories ? null : bmiCategory(bmi, asian),
    bmr: noCalories ? null : round(bmr, 10),
    formula,
    activity_factor: factor,
    tdee: noCalories ? null : tdee,
    plan_calories: noCalories ? tdee : null,
    calories: noCalories ? null : calories,
    calorie_floor_applied: atFloor,
    sodium_limit_mg: conditions.includes('hypertension') ? cond.hypertension.sodium_limit_mg : dri.sodium_limit_mg,
    sat_fat_limit_g: conditions.includes('cholesterol') && !noCalories ? round(calories * cond.cholesterol.sat_fat_percent_max / 100 / 9) : null,
    carbs_limited: conditions.includes('diabetes') && !noCalories,
    protein,
    carbs_g: noCalories ? null : carbs_g,
    fat_g: noCalories ? null : fat_g,
    water_l: sex === 'male' ? dri.water_l_total.male : dri.water_l_total.female,
    needs,
    priority: [...priority],
    nutrients: Object.entries(needs).filter(([, v]) => v != null).map(([k, v]) => ({ key: k, name: NUTRIENTS[k].name, amount: v, unit: NUTRIENTS[k].unit, foods: NUTRIENTS[k].foods, how: NUTRIENTS[k].how, priority: priority.has(k) })),
    conditions: notes,
    assumptions,
    explanation,
    no_calorie_target: noCalories,
    sources: [rule('nutrition_energy').source_url, rule('nutrition_dri').source_url, FOODS.source_url]
  }
}

// Plain facts from a voice note when there is no Claude key: "I'm 29, female, 5'5" and 140 lb, I lift 3 times a week..."
export function bodyFacts(text: string) {
  const t = text.replace(/[’‘]/g, "'").replace(/[“”]/g, '"')
  const lower = t.toLowerCase()
  const out: Record<string, any> = {}
  const age = lower.match(/\b(?:i'?m|i am|tengo|tenho|age|edad|idade)\s*(\d{2})\b/) ?? lower.match(/\b(\d{2})\s*(?:years? old|yo\b|años|anos)/)
  if (age) out.age = Number(age[1])
  if (/\b(female|woman|mujer|mulher)\b/.test(lower)) out.sex = 'female'
  else if (/\b(male|man|hombre|homem)\b/.test(lower)) out.sex = 'male'
  const ft = t.match(/\b(\d)\s*(?:'|ft|feet|foot|pies)\s*(\d{1,2})?\s*(?:"|in\b|inches|pulgadas)?/)
  const cm = lower.match(/\b(1\d{2})\s*cm\b/) ?? lower.match(/\b(1[.,]\d{2})\s*m\b/)
  if (ft) out.height = `${ft[1]}'${ft[2] ?? 0}"`
  else if (cm) out.height = cm[1].includes('.') || cm[1].includes(',') ? `${Math.round(Number(cm[1].replace(',', '.')) * 100)} cm` : `${cm[1]} cm`
  const w = lower.match(/\b(\d{2,3}(?:\.\d)?)\s*(lbs?|pounds|libras|kg|kilos?)\b/)
  if (w) out.weight = `${w[1]} ${/kg|kilo/.test(w[2]) ? 'kg' : 'lb'}`
  const bf = lower.match(/\b(\d{1,2}(?:\.\d)?)\s*%\s*(?:body fat|bf|grasa|gordura)/)
  if (bf) out.body_fat_pct = Number(bf[1])
  const ex = lower.match(/\b((?:lift|run|swim|bike|cycle|climb|play|train|go to the gym|do yoga|do crossfit|hago|corro|levanto|entreno|juego|nado|treino|malho|corro)[^.,;]*)/)
  if (ex) out.exercise = ex[1].trim()
  if (/\b(sedentary|desk job|sedentari[oa])\b/.test(lower)) out.activity = 'sedentary'
  if (/\b(lose|bajar|perder|adelgazar|emagrecer)\b/.test(lower)) out.goal = 'lose fat'
  else if (/\b(gain|build|bulk|ganar|ganhar)\b/.test(lower)) out.goal = 'build muscle'
  else if (/\b(maintain|mantener|manter)\b/.test(lower)) out.goal = 'maintain'
  const conditions = parseConditions(lower)
  if (conditions.length) out.conditions = conditions.join(', ')
  const tri = lower.match(/\b(first|second|third|1st|2nd|3rd|primer|segundo|tercer)\s*(?:trimester|trimestre)/)
  if (tri) out.trimester = /first|1st|primer/.test(tri[1]) ? 1 : /second|2nd|segundo/.test(tri[1]) ? 2 : 3
  if (/\b(no allergies|no food allergies|sin alergias|sem alergias|no allergy)\b/.test(lower)) out.allergies = 'none'
  else {
    const al = lower.match(/\b(?:allergic to|allergy to|alérgic[oa] a|alergia a)\s+([^.;]+)/)
    if (al) out.allergies = al[1].trim()
  }
  const diet = lower.match(/\b(vegan[oa]?|vegetarian[oa]?|pescatarian|halal|kosher|gluten[- ]free|sin gluten|sem glúten)\b/)
  if (diet) out.diet = diet[1]
  const area = t.match(/\b(?:near|at|on|by|cerca de|en|perto de|na|no)\s+(\d{1,5}\s+[A-Za-z0-9 .]+?\s(?:St|Street|Ave|Avenue|Blvd|Boulevard|Way|Rd|Road|Dr|Drive|Pl|Place|Ter|Terrace)\b\.?)/i)
  if (area) out.food_area = area[1].replace(/\.$/, '')
  const walk = lower.match(/\bwalk(?:ing)?\s+(?:more than |over |for |más de |mais de )?(\d{1,2})\s*(?:min|minutes)/) ?? lower.match(/\b(\d{1,2})\s*(?:min|minute|minutes)(?:'s)?\s+(?:walk|a pie|caminando|a pé)/) ?? lower.match(/\bcaminar\s+(?:más de )?(\d{1,2})/)
  if (walk) out.max_walk_minutes = Number(walk[1])
  const cook = lower.match(/\bcook(?:ing)?\s+(?:more than |over |for |longer than )?(\d{1,3})/) ?? lower.match(/\bcocinar\s+(?:más de )?(\d{1,3})/) ?? lower.match(/\bcozinhar\s+(?:mais de )?(\d{1,3})/)
  if (cook) out.max_cook_minutes = Number(cook[1])
  if (/\b(no delivery|sin entrega|sem entrega)\b/.test(lower)) out.delivery = false
  else if (/\b(delivery|delivered|a domicilio|entrega)\b/.test(lower)) out.delivery = true
  if (/\b(tight|on a budget|cheap|can't afford|cannot afford|barato|presupuesto|no me alcanza|sin dinero|apertad|grana curta)\b/.test(lower)) out.food_budget_tight = true
  const meals = lower.match(/\beat (?:at|around)\s+([\d:apm ,.and]+)/)
  if (meals) out.meal_times = meals[1].replace(/\band\b/g, ',')
  return out
}

// Meal times like "8am, 12:30, 7pm" become 08:00, 12:30, 19:00.
export function parseTimes(v: any) {
  const out = list(v).map(s => {
    const m = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/)
    if (!m) return null
    let h = Number(m[1])
    if (m[3]?.startsWith('p') && h < 12) h += 12
    if (m[3]?.startsWith('a') && h === 12) h = 0
    if (h > 23 || Number(m[2] ?? 0) > 59) return null
    return `${String(h).padStart(2, '0')}:${m[2] ?? '00'}`
  }).filter(Boolean) as string[]
  return out.length ? out.sort() : ['08:00', '12:30', '19:00']
}

function mealName(time: string) {
  const h = Number(time.slice(0, 2))
  if (h < 11) return 'breakfast'
  if (h < 15) return 'lunch'
  if (h < 17) return 'snack'
  return 'dinner'
}

const SLOTS: Record<string, string[]> = {
  breakfast: ['breakfast_protein', 'breakfast_carb', 'fruit', 'drink'],
  lunch: ['protein', 'carb', 'veg'],
  dinner: ['protein', 'carb', 'veg'],
  snack: ['snack']
}

type Limits = { diet?: any, allergies?: any, conditions?: any, dislikes?: any, max_cook_minutes?: any }

function limits(args: Limits) {
  const diet = list(args.diet).join(' ')
  const allergies = list(args.allergies).join(' ')
  const conditions = parseConditions(args.conditions)
  const dislikes = list(args.dislikes)
  const blocked = new Set<string>()
  if (/peanut|maní|mani|amendoim/.test(allergies)) blocked.add('peanut')
  if (/(?<!pea)nut|almond|cashew|walnut|pecan|pistachio|hazelnut|nueces|nuez|almendra|castanha|nozes/.test(allergies)) blocked.add('tree_nut')
  if (/egg|huevo|ovo/.test(allergies)) blocked.add('egg')
  if (/dairy|milk|lact|lácteo|lacteo|leche|leite/.test(allergies + diet)) blocked.add('dairy')
  if (/soy|soja/.test(allergies)) blocked.add('soy')
  if (/(?<!shell)fish|pescado|peixe/.test(allergies)) blocked.add('fish')
  if (/shellfish|shrimp|prawn|crab|lobster|marisco|camar[oã]o/.test(allergies)) blocked.add('shellfish')
  if (/gluten|wheat|trigo|celiac/.test(allergies + diet)) blocked.add('gluten')
  for (const c of conditions) for (const e of rule('nutrition_conditions').params[c]?.exclude ?? []) blocked.add(e)
  // FDA fish advice for pregnancy: keep to 2 or 3 servings a week, so daily plans use salmon and sardines, not tuna.
  if (conditions.includes('pregnancy')) dislikes.push('tuna')
  return { diet, blocked, dislikes, maxCook: Number(args.max_cook_minutes) || 30 }
}

const SEAFOOD = /fish|salmon|tuna|\bcod\b|tilapia|halibut|anchov|sardine|trout|shrimp|prawn|crab|lobster|\bscallops?\b|clam|mussel|oyster/
const MEAT = /beef|steak|pork|bacon|\bham\b|sausage|chicken|turkey|lamb|veal|duck|prosciutto|pancetta|pepperoni|salami|chorizo|kielbasa|hot dog|meatball|gelatin|\blard\b/
const PORK = /pork|bacon|\bham\b|\blard\b|prosciutto|pancetta|pepperoni|salami|chorizo|kielbasa/
const ALCOHOL = /wine|\bbeer\b|\brum\b|bourbon|brandy|sherry|liqueur|vodka|whiske?y|tequila/
const LINE_BLOCKS: Record<string, RegExp> = {
  peanut: /peanut/,
  tree_nut: /almond|cashew|walnut|pecan|pistachio|hazelnut|macadamia|pine nut|brazil nut|\bnuts\b/,
  egg: /\beggs?\b|egg (?:white|yolk)|mayonnaise|\bmayo\b/,
  dairy: /(?<!peanut |almond |coconut |soy |oat |apple |nut )(?:butter|milk)\b|buttermilk|cheese|(?<!coconut )cream(?! of tartar)|yogh?urt|ghee|whey|parmesan|mozzarella|cheddar|ricotta/,
  soy: /\bsoy|tofu|edamame|tempeh|miso|tamari/,
  fish: /(?<!shell)fish|salmon|tuna|\bcod\b|tilapia|halibut|anchov|sardine|trout|worcestershire/,
  shellfish: /shrimp|prawn|crab|lobster|\bscallops?\b|clam|mussel|oyster/,
  gluten: /flour|bread|pasta|noodle|wheat|barley|\brye\b|couscous|cracker|tortilla|soy sauce|\bbeer\b|biscuit|bisquick|crumb|spaghetti|macaroni|penne|fettuccine|linguine|lasagna|rotini|ziti|orzo|pie crust|crouton|seitan/
}
const GLUTEN_FREE = /gluten.free|rice noodle|rice flour|almond flour|coconut flour|corn tortilla|cornmeal|corn flour|cornstarch|tamari/g

export function allowedRecipes(args: Limits, recipes = RECIPES.recipes) {
  const { diet, blocked, dislikes, maxCook } = limits(args)
  const rules = [...blocked].filter(t => LINE_BLOCKS[t]).map(t => LINE_BLOCKS[t])
  if (/vegan|plant/.test(diet)) rules.push(MEAT, SEAFOOD, LINE_BLOCKS.dairy, LINE_BLOCKS.egg, /honey/)
  else if (/vegetar/.test(diet)) rules.push(MEAT, SEAFOOD)
  else if (/pescatar/.test(diet)) rules.push(MEAT)
  if (/halal/.test(diet)) rules.push(PORK, ALCOHOL, /gelatin/)
  if (/kosher/.test(diet)) rules.push(PORK, LINE_BLOCKS.shellfish)
  return recipes.filter(r => {
    if (r.minutes == null || r.minutes > maxCook) return false
    const name = r.name.toLowerCase()
    const lines = r.ingredients.map(i => i.line.toLowerCase())
    if (lines.some(l => rules.some(rx => rx.test(rx === LINE_BLOCKS.gluten ? l.replace(GLUTEN_FREE, '') : l)))) return false
    return !dislikes.some(d => name.includes(d) || lines.some(l => l.includes(d)))
  })
}

const FRACTIONS: [number, string][] = [[0, ''], [1 / 8, '1/8'], [1 / 4, '1/4'], [1 / 3, '1/3'], [1 / 2, '1/2'], [2 / 3, '2/3'], [3 / 4, '3/4'], [1, '']]
const SMALLER: Record<string, [string, number, number]> = { cup: ['tbsp', 16, 0.25], tbsp: ['tsp', 3, 1], lb: ['oz', 16, 0.5] }

// "0.167 lb" for one serving reads as "2 2/3 oz".
export function amount(i: Ingredient, servings: number) {
  if (i.qty == null) return ''
  let qty = i.qty * servings
  let unit = i.unit
  while (unit && SMALLER[unit] && qty < SMALLER[unit][2]) [unit, qty] = [SMALLER[unit][0], qty * SMALLER[unit][1]]
  let whole = Math.floor(qty)
  const [frac, text] = FRACTIONS.reduce((a, b) => Math.abs(qty - whole - b[0]) < Math.abs(qty - whole - a[0]) ? b : a)
  if (frac === 1) whole += 1
  const n = [whole || '', text].filter(Boolean).join(' ') || '1/8'
  return [n, unit].filter(Boolean).join(' ')
}

export function allowedFoods(args: Limits) {
  const { diet, blocked, dislikes, maxCook } = limits(args)
  return FOODS.foods.filter(f => {
    if (f.allergens.some(a => blocked.has(a))) return false
    if (/vegan|plant/.test(diet) && !f.diet.includes('vegan')) return false
    if (/vegetar/.test(diet) && !f.diet.includes('vegan') && !f.diet.includes('vegetarian')) return false
    if (/pescatar/.test(diet) && !f.diet.length) return false
    if (dislikes.some(d => f.id === d || f.name.toLowerCase().includes(d) || d.includes(f.search))) return false
    if (f.cook_minutes > maxCook) return false
    return true
  })
}

const IRON_SIDES = ['lentils', 'black_beans', 'spinach', 'sardines', 'tofu', 'ground_beef']
const MAX_SHOPPING = 25
const PANTRY = /\b(salt|water|oil|spray|vinegar|sugar|spices?|seasoning|flakes|cumin|paprika|cayenne|oregano|thyme|cinnamon|extract|powder)\b|(?<!bell |green |red |yellow )\bpepper/

function foodFor(text: string) {
  if (PANTRY.test(text)) return undefined
  return FOODS.foods.find(f => f.match.some(m => text.includes(m)) && !f.exclude.some(x => text.includes(x)))
}

const MEAL_SHARE:Record<string, number> = { breakfast: 0.25, lunch: 0.35, dinner: 0.30, snack: 0.10 }
const RECIPE_MEAL: Record<string, string> = { breakfast: 'breakfast', lunch: 'main', dinner: 'main', snack: 'snack' }

type Budget = { kcal: number, protein: number | null, fiber: number | null, sodium: number, carbs: number | null, satFat: number | null }

// Calories within 25%; sodium, and carbs or saturated fat when a condition limits them, at or under the meal's share.
function pickRecipe(pool: Recipe[], meal: string, b: Budget, taken: Set<number>, mains: Set<string>, taste: (r: Recipe) => number, maxMinutes = Infinity) {
  let best: { recipe: Recipe, servings: number } | null = null
  let bestScore = -1
  for (const r of pool) {
    if (r.meal !== RECIPE_MEAL[meal] || taken.has(r.id) || !(r.per_serving.kcal > 0) || (r.minutes ?? 0) > maxMinutes) continue
    const n = r.per_serving
    const servings = Math.min(2, Math.max(0.5, round(b.kcal / n.kcal, 0.5)))
    if (Math.abs(servings * n.kcal - b.kcal) > b.kcal * 0.25) continue
    if (servings * n.sodium_mg > b.sodium || (b.carbs != null && servings * n.carbs_g > b.carbs) || (b.satFat != null && servings * n.sat_fat_g > b.satFat)) continue
    const fit = (have: number, want: number | null) => want ? 0.5 + 0.5 * Math.min(1, have / want) : 1
    const s = taste(r) * (r.score / 5) * fit(servings * n.protein_g, b.protein) * fit(servings * n.fiber_g, b.fiber) * (mains.has(r.main) ? 0.1 : 1)
    if (s > bestScore) [best, bestScore] = [{ recipe: r, servings }, s]
  }
  return best
}

const EAT_MINUTES = 30
const MAX_SHIFT = 120

const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const overlapping = (busy: Busy[], from: number, to: number) => busy.filter(b => b.start < to && b.end > from)

// Meal times to try, closest to the usual one first, in 5-minute steps up to MAX_SHIFT either way.
function nearby(usual: number) {
  const out = [usual]
  for (let k = 5; k <= MAX_SHIFT; k += 5) out.push(usual - k, usual + k)
  return out.filter(t => t >= 0 && t + EAT_MINUTES <= 1440)
}

// Store trip, cooking and eating all have to be free, and after the previous meal.
function schedule(usual: number, prep: number, busy: Busy[], after: number) {
  return nearby(usual).find(t => t - prep >= after && !overlapping(busy, t - prep, t + EAT_MINUTES).length) ?? null
}

// For each candidate time with a free meal, how many minutes are free before it for the trip and cooking.
function room(usual: number, busy: Busy[], after: number) {
  return nearby(usual).filter(t => !overlapping(busy, t, t + EAT_MINUTES).length).map(t => ({ t, free: t - Math.max(after, ...busy.filter(b => b.start < t).map(b => b.end)) }))
}

const EAT_OUT_MINUTES = 45
const OSM_CUISINE: Record<string, string> = {
  thai: 'thai', chinese: 'chinese', dim_sum: 'chinese', cantonese: 'chinese', szechuan: 'chinese', sichuan: 'chinese', noodle: 'chinese',
  japanese: 'japanese', sushi: 'japanese', ramen: 'japanese', udon: 'japanese', korean: 'korean', vietnamese: 'vietnamese', pho: 'vietnamese',
  indian: 'indian', nepalese: 'indian', pakistani: 'indian', mexican: 'mexican', burrito: 'mexican', taco: 'mexican', tacos: 'mexican', 'tex-mex': 'mexican',
  italian: 'italian', pizza: 'italian', pasta: 'italian', greek: 'greek', mediterranean: 'greek', middle_eastern: 'middle_eastern', lebanese: 'middle_eastern',
  turkish: 'middle_eastern', falafel: 'middle_eastern', kebab: 'middle_eastern', persian: 'middle_eastern', french: 'french', cajun: 'cajun', creole: 'cajun',
  ethiopian: 'african', african: 'african', moroccan: 'african', caribbean: 'caribbean', jamaican: 'caribbean', cuban: 'caribbean', spanish: 'spanish', tapas: 'spanish',
  german: 'german', filipino: 'filipino', hawaiian: 'hawaiian', poke: 'hawaiian', peruvian: 'latin_american', salvadoran: 'latin_american',
  latin_american: 'latin_american', brazilian: 'latin_american', colombian: 'latin_american', american: 'american', burger: 'american', sandwich: 'american',
  barbecue: 'american', bbq: 'american', chicken: 'american', wings: 'american', diner: 'american', breakfast: 'american', brunch: 'american', hot_dog: 'american',
  steak_house: 'american', seafood: 'american', salad: 'american', bagel: 'american'
}
const NOT_A_MEAL_PLACE = /^(coffee_shop|bubble_tea|ice_cream|juice|donut|dessert|frozen_yogurt|tea|cake|cupcake)$/
const BREAKFAST_PLACE = /breakfast|brunch|bagel|bakery|diner|coffee_shop/

const placeCuisines = (p: { cuisine: string }) => [...new Set(p.cuisine.toLowerCase().split(';').map(c => OSM_CUISINE[c.trim()]).filter(Boolean))]

// The most-reviewed main of each cuisine, with the median home serving's calories, as a rough guide for eating out.
const TYPICAL: Record<string, { name: string, url: string, kcal: number }> = Object.fromEntries([...new Set(Object.values(OSM_CUISINE))].flatMap(c => {
  const mains = RECIPES.recipes.filter(r => r.meal === 'main' && r.cuisines.includes(c))
  if (!mains.length) return []
  const kcal = mains.map(r => r.per_serving.kcal).sort((a, b) => a - b)[Math.floor(mains.length / 2)]
  const top = mains.reduce((a, b) => b.reviews > a.reviews ? b : a)
  return [[c, { name: top.name, url: top.url, kcal: round(kcal, 10) }]]
}))

function pickPlace(places: any[], meal: string, taste: (r: any) => number, used: Set<string>, maxWalk: number) {
  let best: any = null
  let bestScore = -1
  for (const p of places) {
    const kinds = p.cuisine.toLowerCase().split(';').map((c: string) => c.trim())
    const breakfast = p.kind === 'cafe' || kinds.some((c: string) => BREAKFAST_PLACE.test(c))
    if (used.has(p.name) || kinds.every((c: string) => NOT_A_MEAL_PLACE.test(c)) || (meal === 'breakfast' ? !breakfast : p.kind === 'cafe')) continue
    const cuisines = p.cuisines.length ? p.cuisines : ['american']
    const s = taste({ id: 0, cuisines, main: null }) * (0.5 + 0.5 * (1 - p.walk_minutes / (maxWalk + 1)))
    if (s > bestScore) [best, bestScore] = [{ ...p, cuisines }, s]
  }
  return best
}

export function mealPlan(args: { targets: any, nearby?: any, diet?: any, allergies?: any, conditions?: any, likes?: any, dislikes?: any, max_cook_minutes?: any, meal_times?: any, delivery?: any, recipes?: Recipe[], busy?: Busy[], shop_minutes?: any }) {
  const tg = args.targets
  if (!tg?.ready) return { ready: false }
  const foods = allowedFoods(args)
  const likes = list(args.likes)
  const deals = args.nearby?.deals ?? {}
  const times = parseTimes(args.meal_times)
  const meals = times.map(t => ({ time: t, meal: mealName(t) }))
  if (!meals.some(m => m.meal === 'snack')) meals.push({ time: '', meal: 'snack' })
  const used = new Set<string>()

  const score = (f: Food, role: string, withIron = false) => {
    let s = 0
    if (likes.some(l => f.id === l || f.name.toLowerCase().includes(l) || l.includes(f.search))) s += 6
    if (deals[f.id]?.length) s += 3
    for (const p of tg.priority) {
      const need = tg.needs[p]
      if (need) s += Math.min(4, (f.n[p] ?? 0) / need * 12)
    }
    if (role === 'veg' && withIron) s += f.n.vitamin_c / 30
    // Protein slots favor foods with more protein per calorie, so the day can reach a high protein target.
    if ((role === 'protein' || role === 'breakfast_protein') && tg.protein) s += f.n.protein / f.n.kcal * 25
    if (used.has(f.id)) s -= 8
    return s
  }

  const day = meals.map(m => {
    const items: { food: Food, role: string }[] = []
    for (const role of SLOTS[m.meal]) {
      const ironMeal = tg.priority.includes('iron') && items.some(i => i.food.n.iron >= 3)
      const options = foods.filter(f => f.roles.includes(role))
      if (!options.length) continue
      const pick = options.slice().sort((a, b) => score(b, role, ironMeal) - score(a, role, ironMeal) || a.id.localeCompare(b.id))[0]
      used.add(pick.id)
      items.push({ food: pick, role })
    }
    return { ...m, items: items.map(i => ({ id: i.food.id, name: i.food.name, role: i.role, servings: 1, serving: i.food.serving })) }
  })

  const byId = Object.fromEntries(FOODS.foods.map(f => [f.id, f]))
  const total = (key: string) => day.reduce((s, m) => s + m.items.reduce((t, i) => t + (byId[i.id].n[key] ?? 0) * i.servings, 0), 0)
  const target = tg.calories ?? tg.plan_calories
  if (!tg.no_calorie_target) {
    const scale = target / total('kcal')
    for (const m of day) for (const i of m.items) {
      if (['protein', 'carb', 'breakfast_carb', 'breakfast_protein', 'snack'].includes(i.role)) i.servings = Math.min(3, Math.max(0.5, round(scale, 0.5)))
    }
    for (let n = 0; n < 6 && total('kcal') < target * 0.93; n++) {
      for (const m of day) for (const i of m.items) if (['carb', 'breakfast_carb'].includes(i.role) && i.servings < 3) i.servings += 0.5
    }
    for (let n = 0; n < 6 && total('kcal') > target * 1.07; n++) {
      for (const m of day) for (const i of m.items) if (['carb', 'breakfast_carb', 'snack'].includes(i.role) && i.servings > 0.5) i.servings -= 0.5
    }
    // Trade starch for protein until the day reaches about 90% of the protein target, keeping calories level.
    for (let n = 0; n < 8 && tg.protein && total('protein') < tg.protein.target * 0.9; n++) {
      const lean = day.flatMap(m => m.items).filter(i => (i.role === 'protein' || i.role === 'breakfast_protein') && i.servings < 3).sort((a, b) => byId[b.id].n.protein / byId[b.id].n.kcal - byId[a.id].n.protein / byId[a.id].n.kcal)[0]
      if (!lean) break
      lean.servings += 0.5
      const starch = day.flatMap(m => m.items).filter(i => (i.role === 'carb' || i.role === 'breakfast_carb') && i.servings > 0.5).sort((a, b) => b.servings - a.servings)[0]
      if (starch && total('kcal') > target * 1.05) starch.servings -= 0.5
    }
  }

  const shareTotal = meals.reduce((s, m) => s + MEAL_SHARE[m.meal], 0)
  const pool = allowedRecipes(args, args.recipes)
  const seed = `${today()}:${ratingCount()}`
  const taken = new Set<number>()
  const mains = new Set<string>()
  const stores = args.nearby?.stores ?? []
  const shop = stores.find((x: any) => x.kind === 'supermarket') ?? stores[0] ?? null
  const shopAt = shop ? { name: shop.name, walk_minutes: shop.walk_minutes, map_url: shop.lat != null ? `https://www.google.com/maps/search/?api=1&query=${shop.lat}%2C${shop.lon}` : null } : null
  const trip = (shop?.walk_minutes ?? 0) * 2 + (Number(args.shop_minutes) || 15)
  const dealFor = (item: string) => {
    const t = item.toLowerCase()
    for (const f of FOODS.foods) {
      const d = deals[f.id]?.[0]
      if (d && f.match.some(m => new RegExp(`\\b${m}`).test(t)) && !f.exclude.some(x => t.includes(x))) return { item: d.item, price_text: d.price_text, store: d.store ?? d.merchant, walk_minutes: d.walk_minutes, valid_to: d.valid_to }
    }
    return null
  }
  const busy: Busy[] = Array.isArray(args.busy) ? args.busy : []
  let after = 0
  const usedPlaces = new Set<string>()
  const places = (args.nearby?.restaurants ?? []).map((p: any) => ({ ...p, cuisines: placeCuisines(p) }))
  const sideItems: typeof day[number]['items'] = []
  if (tg.priority.includes('iron') && pool.length) {
    const ironFood = foods.filter(f => IRON_SIDES.includes(f.id)).sort((a, b) => score(b, 'side') - score(a, 'side') || a.id.localeCompare(b.id))[0]
    const cFood = foods.filter(f => f.n.vitamin_c >= 50 && (f.roles.includes('veg') || f.roles.includes('fruit'))).sort((a, b) => score(b, 'side') - score(a, 'side') || b.n.vitamin_c - a.n.vitamin_c)[0]
    if (ironFood && cFood) {
      const ironServings = Math.max(0.5, Math.min(1, round(120 / ironFood.n.kcal, 0.5)))
      sideItems.push({ id: ironFood.id, name: ironFood.name, role: 'iron_side', servings: ironServings, serving: ironFood.serving })
      sideItems.push({ id: cFood.id, name: cFood.name, role: 'vitamin_c_side', servings: 1, serving: cFood.serving })
    }
  }
  const sideKcal = sideItems.reduce((s, i) => s + byId[i.id].n.kcal * i.servings, 0)
  const sideSodium = sideItems.reduce((s, i) => s + (byId[i.id].n.sodium ?? 0) * i.servings, 0)
  const hostIndex = Math.max(0, meals.findIndex(m => m.meal === 'lunch'))

  const picked = day.map((m, n) => {
    const before = after
    const share = MEAL_SHARE[m.meal] / shareTotal
    const kcal = target * share
    const budget: Budget = {
      kcal: kcal - (n === hostIndex && !tg.no_calorie_target ? sideKcal : 0),
      protein: tg.protein ? tg.protein.target * share : null,
      fiber: tg.needs.fiber ? tg.needs.fiber * share : null,
      sodium: tg.sodium_limit_mg * share - (n === hostIndex ? sideSodium : 0),
      carbs: tg.carbs_limited ? tg.carbs_g * share : null,
      satFat: tg.sat_fat_limit_g != null ? tg.sat_fat_limit_g * share : null
    }
    const taste = tasteSampler(rng(`${seed}:${m.meal}:${m.time}`))
    let pick = pickRecipe(pool, m.meal, budget, taken, mains, taste)
    const cook = () => pick ? pick.recipe.minutes ?? 0 : Math.max(0, ...m.items.map(i => byId[i.id].cook_minutes ?? 0))
    const usual = m.time ? toMinutes(m.time) : null
    let at = usual
    let moved: string[] | null = null
    let quicker: string[] | null = null
    let noTime: string[] | null = null
    if (usual != null && busy.length) {
      const conflicts = overlapping(busy, usual - trip - cook(), usual + EAT_MINUTES).map(b => b.title)
      at = schedule(usual, trip + cook(), busy, after)
      if (at == null && pick) {
        for (const r of room(usual, busy, after)) {
          const quick = r.free - trip >= 5 ? pickRecipe(pool, m.meal, budget, taken, mains, taste, r.free - trip) : null
          if (quick) {
            [pick, at, quicker] = [quick, r.t, conflicts]
            break
          }
        }
      }
      if (at == null) [at, noTime] = [usual, conflicts]
      else if (at !== usual) moved = conflicts
    }
    if (at != null) after = at + EAT_MINUTES
    const place = m.meal !== 'snack' && usual != null ? pickPlace(places, m.meal, taste, usedPlaces, Number(args.max_walk_minutes) || 15) : null
    let eatOut = null
    if (place) {
      usedPlaces.add(place.name)
      const walk = place.walk_minutes
      const t = nearby(usual!).find(t => t - walk >= before && !overlapping(busy, t - walk, t + EAT_OUT_MINUTES + walk).length) ?? null
      const conflicts = overlapping(busy, usual! - walk, usual! + EAT_OUT_MINUTES + walk).map(b => b.title)
      eatOut = {
        name: place.name, kind: place.kind, cuisine: place.cuisine.split(';')[0].replaceAll('_', ' '), cuisines: place.cuisines,
        walk_minutes: walk, website: place.website, map_url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}%20${place.lat}%2C${place.lon}`,
        time: t != null ? toTime(t) : null, leave: t != null ? t - walk : null, back: t != null ? t + EAT_OUT_MINUTES + walk : null,
        moved_because: t != null && t !== usual && conflicts.length ? conflicts : null, no_time_because: t == null ? conflicts : null,
        typical: TYPICAL[place.cuisines[0]] ?? null
      }
    }
    const timing = { time: at != null ? toTime(at) : m.time, usual_time: m.time, leave: at != null ? at - trip - cook() : null, trip_minutes: trip, moved_because: moved, quicker_because: quicker, no_time_because: noTime, eat_out: eatOut }
    const kcal_target = tg.no_calorie_target ? null : round(kcal, 10)
    if (!pick) return { ...m, ...timing, kcal_target, recipe: null }
    const r = pick.recipe
    const servings = pick.servings
    taken.add(r.id)
    mains.add(r.main)
    return {
      ...m,
      ...timing,
      kcal_target,
      items: [] as typeof sideItems,
      recipe: {
        id: r.id, name: r.name, url: r.url, cuisines: r.cuisines, main: r.main, minutes: r.minutes, rating: r.rating, reviews: r.reviews,
        servings,
        kcal: tg.no_calorie_target ? null : round(servings * r.per_serving.kcal),
        protein_g: round(servings * r.per_serving.protein_g),
        fiber_g: round(servings * r.per_serving.fiber_g),
        sodium_mg: round(servings * r.per_serving.sodium_mg, 10),
        carbs_g: round(servings * r.per_serving.carbs_g),
        sat_fat_g: round(servings * r.per_serving.sat_fat_g, 0.5),
        ingredients: r.ingredients.map(i => ({ amount: amount(i, servings), item: i.item, deal: i.qty == null ? null : dealFor(i.item) }))
      }
    }
  })
  if (picked[hostIndex].recipe) picked[hostIndex].items = sideItems

  const foodIds = (m: typeof picked[number]) => [...new Set<string>([...m.items.map(i => i.id), ...(m.recipe?.ingredients ?? []).map(i => foodFor(i.item.toLowerCase())?.id).filter(Boolean) as string[]])]
  const planned = picked.map(m => ({
    ...m,
    deals: foodIds(m).filter(id => deals[id]?.length).map(id => {
      const d = deals[id][0]
      return { food: byId[id].name, price_text: d.price_text, store: d.store ?? d.merchant, walk_minutes: d.walk_minutes }
    })
  }))
  const recipes = planned.flatMap(m => m.recipe ? [m.recipe] : [])
  const plateTotal = (key: string) => planned.reduce((s, m) => s + m.items.reduce((t, i) => t + (byId[i.id].n[key] ?? 0) * i.servings, 0), 0)
  const recipeTotal: Record<string, (r: any) => number> = { kcal: r => r.kcal ?? 0, protein: r => r.protein_g, fiber: r => r.fiber_g, sodium: r => r.sodium_mg }

  const keys = recipes.length ? ['kcal', 'protein', 'fiber'] : ['kcal', 'protein', 'fiber', 'iron', 'calcium', 'vitamin_c', 'potassium', 'magnesium', 'folate', 'b12', 'vitamin_d']
  const coverage = keys.filter(k => k !== 'kcal' || !tg.no_calorie_target).map(k => {
    const need = k === 'kcal' ? (tg.calories ?? null) : tg.needs[k]
    const have = round(plateTotal(k) + recipes.reduce((s, r) => s + recipeTotal[k](r), 0), k === 'b12' || k === 'vitamin_d' || k === 'iron' ? 0.1 : 1)
    return { key: k, name: k === 'kcal' ? 'Calories' : NUTRIENTS[k].name, have, need, unit: k === 'kcal' ? 'kcal' : NUTRIENTS[k].unit, percent: need ? Math.round(have / need * 100) : null }
  })
  const sodium = round(plateTotal('sodium') + recipes.reduce((t, r) => t + r.sodium_mg, 0), 10)
  coverage.push({ key: 'sodium', name: 'Sodium (stay under)', have: sodium, need: tg.sodium_limit_mg, unit: 'mg', percent: Math.round(sodium / tg.sodium_limit_mg * 100) })
  const gaps = coverage.filter(c => c.key !== 'kcal' && c.key !== 'sodium' && c.percent != null && c.percent < 80).map(c => ({
    ...c,
    tip: c.key === 'vitamin_d' || c.key === 'b12' ? `${NUTRIENTS[c.key].how}` : `Add more ${NUTRIENTS[c.key].foods}.`
  }))

  const pairs: string[] = []
  for (const m of planned) {
    const iron = m.items.find(i => byId[i.id].n.iron >= 2.5)
    const c = m.items.find(i => byId[i.id].n.vitamin_c >= 50)
    if (iron && c) pairs.push(`${m.meal}: ${byId[iron.id].name.toLowerCase()} with ${byId[c.id].name.toLowerCase()}, so the vitamin C helps you absorb the iron`)
  }

  const toBuy = new Map<string, { name: string, search: string }>()
  for (const id of new Set(planned.flatMap(m => m.items.map(i => i.id)))) toBuy.set(id, { name: byId[id].name, search: byId[id].search })
  for (const r of recipes) for (const i of r.ingredients) {
    const text = i.item.toLowerCase()
    if (PANTRY.test(text)) continue
    const food = foodFor(text)
    const name = text.split(/,| or /)[0].trim()
    const key = food?.id ?? name
    if (name && !toBuy.has(key)) toBuy.set(key, { name: food?.name ?? name, search: food?.search ?? name })
  }
  const delivery = args.delivery === true || /^(y|yes|sí|si|sim|true)/i.test(String(args.delivery ?? ''))
  const shopping = [...toBuy].map(([id, b]) => {
    const best = (deals[id] ?? [])[0] ?? null
    return {
      id,
      name: b.name,
      deal: best ? { item: best.item, price: best.price, price_text: best.price_text, store: best.store ?? best.merchant, walk_minutes: best.walk_minutes, valid_to: best.valid_to, image: best.image } : null,
      order_url: delivery ? `https://www.instacart.com/store/s?k=${encodeURIComponent(b.search)}` : null
    }
  }).sort((a, b) => Number(!!b.deal) - Number(!!a.deal)).slice(0, MAX_SHOPPING)
  const onSale = shopping.filter(s => s.deal)
  const expiring = onSale.filter(s => s.deal!.valid_to).sort((a, b) => a.deal!.valid_to.localeCompare(b.deal!.valid_to))[0] ?? null
  const shoppingText = [
    ...recipes.map(r => `${r.name}: ${r.ingredients.map(i => [i.amount, i.item].filter(Boolean).join(' ')).join(', ')}`),
    ...shopping.map(s => s.deal ? `${s.name}: ${s.deal.store} ${s.deal.price_text ?? `$${s.deal.price}`}${s.deal.walk_minutes != null ? ` (${s.deal.walk_minutes} min walk)` : ''}` : s.name)
  ].join('; ')

  return {
    ready: true,
    date: today(),
    meal_times: times,
    meal_times_text: times.join('; '),
    shop_at: shopAt,
    meals: planned,
    coverage,
    gaps,
    pairs,
    shopping,
    on_sale_count: onSale.length,
    shopping_text: shoppingText,
    first_expiry: expiring ? { item: expiring.name, store: expiring.deal!.store, date: expiring.deal!.valid_to.slice(0, 10) } : null,
    stores: (args.nearby?.stores ?? []).slice(0, 5),
    markets: (args.nearby?.markets ?? []).slice(0, 3),
    note: recipes.length
      ? 'Recipes are the best-rated Food.com version of each dish, sized to your meal. Iron, calcium and other nutrients are not tracked for recipes yet; deals come from store flyers and can sell out.'
      : 'Nutrients are USDA FoodData Central averages per serving; deals come from store flyers and can sell out.'
  }
}
