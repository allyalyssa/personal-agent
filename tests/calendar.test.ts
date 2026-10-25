import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.HANDLED_DB = ':memory:'
delete process.env.ANTHROPIC_API_KEY
const { loadRules } = await import('../server/rules.ts')
const { busyOn } = await import('../server/calendar.ts')
const { nutritionTargets, mealPlan, RECIPES } = await import('../server/nutrition.ts')

loadRules()

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VTIMEZONE
TZID:America/Los_Angeles
BEGIN:DAYLIGHT
TZOFFSETFROM:-0800
TZOFFSETTO:-0700
TZNAME:PDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0700
TZOFFSETTO:-0800
TZNAME:PST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:class
SUMMARY:Stats class
DTSTART;TZID=America/Los_Angeles:20261005T120000
DTEND;TZID=America/Los_Angeles:20261005T130000
RRULE:FREQ=WEEKLY;BYDAY=MO
END:VEVENT
BEGIN:VEVENT
UID:standup
SUMMARY:Standup
DTSTART;TZID=America/Los_Angeles:20261005T080000
DTEND;TZID=America/Los_Angeles:20261005T081500
RRULE:FREQ=WEEKLY;BYDAY=MO
END:VEVENT
BEGIN:VEVENT
UID:standup
RECURRENCE-ID;TZID=America/Los_Angeles:20261026T080000
SUMMARY:Standup
DTSTART;TZID=America/Los_Angeles:20261026T100000
DTEND;TZID=America/Los_Angeles:20261026T101500
END:VEVENT
BEGIN:VEVENT
UID:holiday
SUMMARY:Holiday
DTSTART;VALUE=DATE:20261026
DTEND;VALUE=DATE:20261027
END:VEVENT
BEGIN:VEVENT
UID:free
SUMMARY:Maybe coffee
TRANSP:TRANSPARENT
DTSTART:20261026T170000Z
DTEND:20261026T180000Z
END:VEVENT
BEGIN:VEVENT
UID:cancelled
SUMMARY:Cancelled thing
STATUS:CANCELLED
DTSTART:20261026T200000Z
DTEND:20261026T210000Z
END:VEVENT
END:VCALENDAR`

test('reads repeating events, moved occurrences and time zones; all-day, free and cancelled events do not block', () => {
  assert.deepEqual(busyOn(ICS, '2026-10-26'), [
    { start: 600, end: 615, title: 'Standup' },
    { start: 720, end: 780, title: 'Stats class' }
  ])
  assert.deepEqual(busyOn(ICS, '2026-10-27'), [])
})

const targets = nutritionTargets({ age: 29, sex: 'female', height: '165 cm', weight: '62 kg', exercise: 'lift 3x a week', goal: 'maintain' })
const plan = (busy: any[]) => mealPlan({ targets, nearby: {}, meal_times: '8am, 12:30pm, 7pm', max_cook_minutes: 60, busy, shop_minutes: 15 }) as any
const lunch = (p: any) => p.meals.find((m: any) => m.meal === 'lunch')

test('a meal moves to the closest time where the store trip, cooking and eating all fit', () => {
  const free = lunch(plan([]))
  const l = lunch(plan([{ start: 690, end: 780, title: 'Stats class' }]))
  const [h, m] = l.time.split(':').map(Number)
  const at = h * 60 + m
  assert.equal(l.usual_time, '12:30')
  assert.deepEqual(l.moved_because, ['Stats class'])
  assert.ok(at - l.trip_minutes - l.recipe.minutes >= 780 || at + 30 <= 690, `${l.time} ${l.recipe.minutes} min`)
  assert.ok(Math.abs(at - 750) <= 120)
  assert.equal(l.leave, at - l.trip_minutes - l.recipe.minutes)
  assert.equal(free.time, '12:30')
  assert.equal(free.moved_because, null)
})

test('when only a short gap is free, a quicker recipe fills it', () => {
  const base = RECIPES.recipes.find((r: any) => r.meal === 'main' && r.per_serving.kcal > 500 && r.per_serving.kcal < 700 && r.per_serving.sodium_mg < 500)!
  const slow = { ...base, id: 1, minutes: 45, score: 5 }
  const quick = { ...base, id: 2, minutes: 10, score: 4.5 }
  const p: any = mealPlan({ targets, nearby: {}, meal_times: '8am, 12:30pm, 7pm', max_cook_minutes: 60, shop_minutes: 15, recipes: [slow, quick], busy: [{ start: 600, end: 720, title: 'Lectures' }, { start: 780, end: 900, title: 'Lab' }] })
  const l = lunch(p)
  assert.equal(lunch(mealPlan({ targets, nearby: {}, meal_times: '8am, 12:30pm, 7pm', max_cook_minutes: 60, shop_minutes: 15, recipes: [slow, quick] })).recipe.id, slow.id)
  assert.equal(l.recipe.id, quick.id)
  assert.deepEqual(l.quicker_because, ['Lectures'])
  assert.equal(l.time, '12:30')
  assert.equal(l.leave, 750 - 15 - 10)
})

test('each meal also gets a nearby restaurant, timed for the walk there and back around the calendar', () => {
  const restaurants = [
    { name: 'Thai Place', kind: 'restaurant', cuisine: 'thai', website: 'https://thai.example', lat: 37.75, lon: -122.42, walk_minutes: 6 },
    { name: 'Corner Cafe', kind: 'cafe', cuisine: 'coffee_shop;breakfast', website: null, lat: 37.75, lon: -122.42, walk_minutes: 3 },
    { name: 'Boba Stop', kind: 'fast_food', cuisine: 'bubble_tea', website: null, lat: 37.75, lon: -122.42, walk_minutes: 2 },
    { name: 'Taqueria', kind: 'restaurant', cuisine: 'mexican', website: null, lat: 37.75, lon: -122.42, walk_minutes: 9 }
  ]
  const p: any = mealPlan({ targets, nearby: { restaurants }, meal_times: '8am, 12:30pm, 7pm', max_cook_minutes: 60, max_walk_minutes: 15, busy: [{ start: 1110, end: 1170, title: 'Study group' }] })
  const out = Object.fromEntries(p.meals.map((m: any) => [m.meal, m.eat_out]))
  assert.equal(out.breakfast.name, 'Corner Cafe')
  assert.ok(['Thai Place', 'Taqueria'].includes(out.lunch.name) && ['Thai Place', 'Taqueria'].includes(out.dinner.name) && out.lunch.name !== out.dinner.name)
  assert.equal(out.snack, null)
  assert.ok(Object.values(out).every((o: any) => !o || o.name !== 'Boba Stop'))
  const d = out.dinner
  const [h, mm] = d.time.split(':').map(Number)
  const at = h * 60 + mm
  assert.equal(d.leave, at - d.walk_minutes)
  assert.equal(d.back, at + 45 + d.walk_minutes)
  assert.ok(d.leave >= 1170 || d.back <= 1110, JSON.stringify(d))
  assert.deepEqual(d.moved_because, ['Study group'])
  assert.ok(d.typical?.kcal > 0)
})

test('with no room at all, lunch keeps its time and says why', () => {
  const l = lunch(plan([{ start: 540, end: 960, title: 'Exam day' }]))
  assert.equal(l.time, '12:30')
  assert.deepEqual(l.no_time_because, ['Exam day'])
})
