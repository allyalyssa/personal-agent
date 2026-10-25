import { db } from './db.ts'
import { now, today } from './clock.ts'
import { busyToday } from './calendar.ts'
import { tasteTable } from './taste.ts'
import { playbook } from './playbooks.ts'
import { getProfile, setProfile, getCase, createCase, updateCase, setFields, prefillFromProfile, runLookups, plan, get } from './engine.ts'

const LOOK = { name: 'Pip', color: '#2bb673', hat: 'sprout', image: null }
const MEAL: Record<string, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' }
const SHOP_MINUTES = 15
const CALENDAR_MINUTES = 10

export function pipLook() {
  const row = db.prepare(`select value from settings where key = 'pip'`).get() as { value: string } | undefined
  return { ...LOOK, ...(row ? JSON.parse(row.value) : {}) }
}

export function setPipLook(look: Record<string, any>) {
  const next = { ...pipLook(), ...look }
  db.prepare(`insert into settings (key, value) values ('pip', ?) on conflict(key) do update set value = excluded.value`).run(JSON.stringify(next))
  return next
}

function foodCaseId() {
  const row = db.prepare(`select id from cases where playbook = 'eat_well' and status = 'open' order by updated_at desc limit 1`).get() as { id: string } | undefined
  return row?.id ?? null
}

export function details() {
  const p = getProfile()
  return { address: p.address ?? '', phone: p.phone ?? '', language: p.language ?? 'en', body: p.body ?? {}, food: { shop_minutes: SHOP_MINUTES, area: p.address ?? '', ...p.food } }
}

// Saving details rewrites the food case's fields from the profile, so a changed answer replaces the old one.
export async function saveDetails(b: { address?: string, phone?: string, language?: string, body?: Record<string, any>, food?: Record<string, any> }) {
  const p = getProfile()
  const next = {
    ...p,
    ...Object.fromEntries((['address', 'phone', 'language'] as const).filter(k => b[k] != null).map(k => [k, b[k]])),
    body: { ...p.body, ...b.body },
    food: { ...p.food, ...b.food }
  }
  setProfile(next)
  let id = foodCaseId()
  if (!id) {
    id = createCase('Eat well near you')
    updateCase(id, { playbook: 'eat_well', pack: 'food' })
  }
  const fields: Record<string, any> = {}
  for (const [k, f] of Object.entries(playbook('eat_well').required_fields)) {
    if (!f.profile) continue
    const v = get(next, f.profile)
    fields[k] = v === '' ? null : v ?? null
  }
  setFields(id, { ...fields, nearby: null })
  prefillFromProfile(id)
  await runLookups(id)
  await readCalendar(id, true)
  return plan(id)
}

// Re-reads the calendar when it is older than CALENDAR_MINUTES or from another day; returns whether it read.
async function readCalendar(id: string, force = false) {
  const url = getProfile().food?.calendar_url
  const c = getCase(id)
  if (!url) {
    if (c.fields.busy?.length || c.fields.calendar_error) setFields(id, { busy: [], calendar_error: null })
    return !!c.fields.busy?.length
  }
  const checked = Date.parse(c.fields.busy_checked_at ?? '')
  if (!force && c.fields.busy_date === today() && checked > now().getTime() - CALENDAR_MINUTES * 60000) return false
  const stamp = { busy_date: today(), busy_checked_at: now().toISOString() }
  try {
    setFields(id, { ...stamp, busy: await busyToday(url, today()), calendar_error: null })
  } catch (e: any) {
    setFields(id, { ...stamp, calendar_error: `Could not read your calendar: ${e.message}` })
  }
  return true
}

const minutesPT = (d: Date) => {
  const [h, m] = d.toLocaleTimeString('en-GB', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hour12: false }).split(':').map(Number)
  return (h % 24) * 60 + m
}

const clock = (min: number) => {
  const m = ((min % 1440) + 1440) % 1440
  const h = Math.floor(m / 60)
  return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}

// One reminder per timed meal, at its leave-by time: meal time - (walk there + shopping + walk back + cooking).
export async function nudges(force = false) {
  const at = minutesPT(now())
  const id = foodCaseId()
  if (!id) return { now: at, nudges: [] }
  const stale = (p: any) => p?.ready && (p.date !== today() || p.meals.some((m: any) => m.time && !('eat_out' in m)) || !('shop_at' in p))
  if (getCase(id).fields.nearby && !getCase(id).fields.nearby.restaurants) setFields(id, { nearby: null })
  const lookedUp = !getCase(id).fields.nearby && (await runLookups(id), true)
  if ((await readCalendar(id, force)) || lookedUp || stale(getCase(id).computed?.plan)) plan(id)
  const c = getCase(id)
  const mealPlan = c.computed?.plan
  if (!mealPlan?.ready) return { now: at, nudges: [], calendar_error: c.fields.calendar_error ?? null }
  const store = mealPlan.shop_at
  const shop = Number(getProfile().food?.shop_minutes) || SHOP_MINUTES
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const list = mealPlan.meals.filter((m: any) => m.time && m.leave != null).map((m: any) => {
    const meal = toMin(m.time)
    const cook = meal - m.leave - m.trip_minutes
    const out = m.eat_out
    const headline = !m.no_time_because
      ? `${MEAL[m.meal]} at ${clock(meal)}. Leave for ${store?.name ?? 'the store'} by ${clock(m.leave)}.`
      : out?.leave != null
        ? `${MEAL[m.meal]}: no time to shop and cook around ${m.no_time_because.join(', ')}. Eat out at ${out.name} instead: leave by ${clock(out.leave)}.`
        : `${MEAL[m.meal]} at ${clock(meal)}: no time to shop and cook around ${m.no_time_because.join(', ')}. Grab something quick today.`
    return {
      id: `${mealPlan.date}:${m.meal}:${m.time}`,
      meal: m.meal,
      at: meal,
      leave: m.leave,
      text: headline,
      when: {
        time: clock(meal),
        usual: clock(toMin(m.usual_time)),
        leave: clock(m.leave),
        walk: store?.walk_minutes ?? null,
        shop,
        cook,
        moved_because: m.moved_because,
        quicker_because: m.quicker_because,
        no_time_because: m.no_time_because
      },
      recipe: m.recipe ? { name: m.recipe.name, url: m.recipe.url, minutes: m.recipe.minutes, servings: m.recipe.servings, kcal: m.recipe.kcal, ingredients: m.recipe.ingredients } : null,
      plate: m.recipe ? null : m.items.map((i: any) => `${i.servings} x ${i.name} (${i.serving})`),
      store,
      kcal_target: m.kcal_target,
      eat_out: out ? { ...out, time_text: out.time ? clock(toMin(out.time)) : null, leave_text: out.leave != null ? clock(out.leave) : null, back_text: out.back != null ? clock(out.back) : null } : null
    }
  })
  const allergies = String(getProfile().food?.allergies ?? '').trim()
  return { now: at, case_id: id, allergies: /^(none|no|)$/i.test(allergies) ? null : allergies, nudges: list, calendar_error: c.fields.calendar_error ?? null }
}

export function meals() {
  const id = foodCaseId()
  const c = id ? getCase(id) : null
  const learned = tasteTable().map(t => ({ kind: t.kind, key: t.key, score: Math.round(t.alpha / (t.alpha + t.beta) * 100), ratings: Math.round((t.alpha + t.beta - 2) * 10) / 10 }))
  return { case_id: id, targets: c?.computed?.targets ?? null, plan: c?.computed?.plan ?? null, calendar_error: c?.fields.calendar_error ?? null, learned }
}
