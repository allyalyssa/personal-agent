import { rule } from './rules.ts'
import { addMonths, addDays, today, daysBetween, now } from './clock.ts'
import { nutritionTargets, mealPlan } from './nutrition.ts'

type Rate = { start: string, end: string, rate: number, status: string }

function rateOn(rates: Rate[], date: string) {
  return rates.find(r => r.start <= date && date <= r.end)
}

const money = (n: number) => Math.round(n * 100) / 100
const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function depositInterest(args: { deposit_amount: number, move_in_date: string, interest_paid_through?: string, as_of?: string, year_built?: number, units?: number }) {
  const r = rule('sf_deposit_interest')
  const asOf = args.as_of ?? today()
  const years = []
  let start = args.move_in_date
  let due = addMonths(start, 12)
  while (due <= asOf) {
    const rate = rateOn(r.params.rates, due)
    const alreadyPaid = args.interest_paid_through ? due <= args.interest_paid_through : false
    years.push({
      period: `${start} to ${due}`,
      due_date: due,
      rate_percent: rate?.rate ?? null,
      rate_status: rate ? rate.status : 'no verified rate on file',
      interest: rate ? money(args.deposit_amount * rate.rate / 100) : null,
      math: rate ? `${due}: ${usd(args.deposit_amount)} x ${rate.rate}% = ${usd(money(args.deposit_amount * rate.rate / 100))}` : `${due}: rate not verified for this period; ask the Rent Board`,
      already_paid: alreadyPaid
    })
    start = due
    due = addMonths(start, 12)
  }
  const nextRate = rateOn(r.params.rates, due)
  const owed = years.filter(y => !y.already_paid && y.interest !== null)
  const unknown = years.filter(y => !y.already_paid && y.interest === null)
  const total = money(owed.reduce((s, y) => s + (y.interest as number), 0))
  // Rent-controlled units: the landlord may keep half the yearly Rent Board fee out of each year's interest.
  const covered = args.year_built ? args.year_built < 1979 && (args.units ?? 2) >= 2 : null
  const share = r.params.fee_share_per_year.at(-1).amount
  const deduction = covered ? money(share * owed.length) : 0
  return {
    years,
    total_owed: total,
    rent_controlled_likely: covered,
    fee_deduction_max: deduction,
    net_minimum: money(Math.max(0, total - deduction)),
    fee_note: covered ? `Built ${args.year_built}, so the landlord may deduct up to ${usd(share)} a year (half the Rent Board fee): up to ${usd(deduction)}.` : covered === false ? 'Not likely under the Rent Ordinance, so no Rent Board fee deduction.' : 'Building year unknown; the landlord may deduct half the Rent Board fee if the unit is rent controlled.',
    years_owed: owed.length,
    years_needing_confirmation: unknown.map(y => y.period),
    next_payment: { due_date: due, rate_percent: nextRate?.rate ?? null, interest: nextRate ? money(args.deposit_amount * nextRate.rate / 100) : null },
    method: r.params.rate_applied,
    method_status: r.params.rate_applied_status,
    source_url: r.source_url,
    last_verified: r.last_verified
  }
}

export function rentIncreaseCheck(args: { current_rent: number, new_rent: number, effective_date: string, year_built?: number, unit_type?: string, last_increase_date?: string }) {
  const allowable = rule('sf_allowable_increase')
  const coverage = rule('sf_rent_control_coverage')
  const increasePct = money((args.new_rent - args.current_rent) / args.current_rent * 100)
  const rate = rateOn(allowable.params.rates, args.effective_date)
  const builtBefore = Number(coverage.params.built_before.slice(0, 4))
  const singleUnit = /single|condo/i.test(args.unit_type ?? '')
  const likelyCovered = args.year_built ? args.year_built < builtBefore && !singleUnit : null

  const banked = []
  if (args.last_increase_date) {
    for (const r of allowable.params.rates as Rate[]) {
      if (r.start > args.last_increase_date && r.end < args.effective_date) banked.push(r)
    }
  }
  const bankedPct = money(banked.reduce((s, r) => s + r.rate, 0))
  const maxPct = rate ? money(rate.rate + bankedPct) : null
  const allowedRent = maxPct !== null ? money(args.current_rent * (1 + maxPct / 100)) : null
  return {
    increase_percent: increasePct,
    increase_dollars: money(args.new_rent - args.current_rent),
    allowable_percent: rate?.rate ?? null,
    allowable_status: rate?.status ?? 'no rate on file for that date',
    banked_years: banked.map(r => `${r.start} to ${r.end}: ${r.rate}% (${r.status})`),
    banked_percent: bankedPct,
    banked_note: bankedPct > 0 ? `, plus ${bankedPct}% banked from years without an increase` : '',
    max_percent_with_banking: maxPct,
    max_allowed_rent: allowedRent,
    overcharge_per_month: allowedRent !== null && likelyCovered ? Math.max(0, money(args.new_rent - allowedRent)) : null,
    rent_control_likely: likelyCovered,
    coverage_basis: args.year_built ? `Built ${args.year_built}; increase limits generally cover buildings before 1979${singleUnit ? ', but single-family homes and condos are generally exempt' : ''}` : 'Year built unknown',
    math: rate ? `${usd(args.current_rent)} x (1 + ${maxPct}%) = ${usd(allowedRent!)} allowed, vs ${usd(args.new_rent)} asked (${increasePct}%)` : null,
    sources: [allowable.source_url, coverage.source_url]
  }
}

export function tollTextCheck(args: { message_text: string, links?: string[] }) {
  const r = rule('fastrak_billing')
  const official: string[] = r.params.official_domains
  const urls = args.links?.length ? args.links : (args.message_text.match(/https?:\/\/[^\s]+|\b[\w-]+(\.[\w-]+)+\/[^\s]*/g) ?? [])
  const hosts = urls.map(u => {
    const host = u.replace(/^https?:\/\//, '').split(/[/?#]/)[0].toLowerCase()
    return { url: u, host, official: official.some(d => host === d || host.endsWith(`.${d}`)) }
  })
  const pressure = /(final notice|suspend|penalt|avoid|today|immediately|within 24|late fee|legal action|DMV)/i.test(args.message_text)
  let verdict = 'unsure'
  if (hosts.some(h => !h.official)) verdict = 'likely scam'
  else if (hosts.length && hosts.every(h => h.official)) verdict = 'likely real'
  return {
    verdict,
    likely_real: verdict === 'likely real',
    links: hosts,
    pressure_language: pressure,
    official_domains: official,
    advice: verdict === 'likely scam' ? 'Do not tap the link. Check your account by typing bayareafastrak.org yourself.' : 'Check the balance by typing bayareafastrak.org yourself instead of using the link.',
    source_url: r.source_url,
    rule_status: r.status
  }
}

export function daysUntil(args: { date: string }) {
  return { days: daysBetween(today(), args.date) }
}

export function addDaysFn(args: { date: string, days: number }) {
  if (!args.date || !args.days) return { date: null }
  return { date: addDays(args.date, Number(args.days)), days: Number(args.days) }
}

export function visaGrace(args: { termination_date: string, i94_end_date?: string }) {
  const r = rule('h1b_grace_period')
  const sixty = addDays(args.termination_date, r.params.max_days)
  const end = args.i94_end_date && args.i94_end_date < sixty ? args.i94_end_date : sixty
  return {
    end_date: end,
    basis: end === sixty ? `${r.params.max_days} days after employment ended` : 'your I-94 end date, which comes first',
    rule_status: r.status,
    confirm_with: r.confirm_with
  }
}

// Sum and compare line items: used for medical bills against the insurer statement.
export function compareBill(args: { bill_lines: { description: string, code?: string, date?: string, amount: number }[], eob_patient_responsibility?: number, amount_billed: number }) {
  const seen = new Map<string, number>()
  const duplicates = []
  for (const l of args.bill_lines ?? []) {
    const key = `${l.code ?? l.description}|${l.date ?? ''}|${l.amount}`
    seen.set(key, (seen.get(key) ?? 0) + 1)
    if (seen.get(key) === 2) duplicates.push(l)
  }
  const lineTotal = money((args.bill_lines ?? []).reduce((s, l) => s + l.amount, 0))
  const overEob = args.eob_patient_responsibility !== undefined ? money(args.amount_billed - args.eob_patient_responsibility) : null
  const duplicateTotal = money(duplicates.reduce((s, l) => s + l.amount, 0))
  return {
    amount_billed: args.amount_billed,
    eob_patient_responsibility: args.eob_patient_responsibility ?? null,
    billed_over_eob: overEob,
    duplicate_lines: duplicates,
    duplicate_total: duplicateTotal,
    line_total: lineTotal,
    lines_match_total: Math.abs(lineTotal - args.amount_billed) < 0.01,
    disputed_amount: Math.max(overEob ?? 0, duplicateTotal),
    math: overEob !== null ? `Billed $${args.amount_billed.toFixed(2)} - insurer says you owe $${args.eob_patient_responsibility!.toFixed(2)} = $${overEob.toFixed(2)} over` : null
  }
}

export function recurringCharges(args: { charges: { merchant: string, amount: number, date: string }[] }) {
  const byMerchant = new Map<string, { merchant: string, amount: number, date: string }[]>()
  for (const c of args.charges ?? []) {
    const key = c.merchant.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 12)
    byMerchant.set(key, [...(byMerchant.get(key) ?? []), c])
  }
  const recurring = [...byMerchant.values()].filter(list => list.length >= 2 || /subscr|monthly|premium|plus|\+/i.test(list[0].merchant)).map(list => {
    const amounts = list.map(l => l.amount)
    return { merchant: list[0].merchant, times: list.length, typical_amount: amounts[amounts.length - 1], yearly_cost: money(amounts[amounts.length - 1] * 12), last_date: list.map(l => l.date).sort().at(-1) }
  })
  const names = recurring.map(r => r.merchant.toUpperCase())
  const possibleDuplicates = recurring.filter(r => names.filter(n => n.split(' ')[0] === r.merchant.toUpperCase().split(' ')[0]).length > 1)
  return { recurring, possible_duplicates: possibleDuplicates, monthly_total: money(recurring.reduce((s, r) => s + r.typical_amount, 0)), yearly_total: money(recurring.reduce((s, r) => s + r.yearly_cost, 0)) }
}

export function vestSchedule(args: { grant_date: string, total_shares: number, cliff_months?: number, vest_months?: number, frequency_months?: number, vesting_start?: string }) {
  const start = args.vesting_start ?? args.grant_date
  const cliff = args.cliff_months ?? 12
  const months = args.vest_months ?? 48
  const every = args.frequency_months ?? 1
  const perMonth = args.total_shares / months
  const events = []
  let vested = 0
  for (let m = cliff; m <= months; m += every) {
    const shares = m === cliff ? Math.floor(perMonth * cliff) : Math.floor(perMonth * m) - vested
    vested += shares
    events.push({ date: addMonths(start, m), shares, cumulative: vested })
  }
  return { events, first_vest: events[0], next_vest: events.find(e => e.date >= today()) ?? null, total: vested }
}

type Sweep = { side: string, when: string, weekday: string, weeks: number[], from_hour: number, to_hour: number, holidays: boolean }
const DAYS = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa']

// City data times are local wall-clock strings like 2026-10-18T07:17:00.000.
function local(s: string) {
  const [d, t = '00:00'] = s.split('T')
  const [y, m, day] = d.split('-').map(Number)
  const [h, min] = t.split(':').map(Number)
  const weekday = new Date(Date.UTC(y, m - 1, day)).getUTCDay()
  return { date: d, day, weekday, hour: h + min / 60, week: Math.ceil(day / 7) }
}

function sweepsAt(s: Sweep, t: ReturnType<typeof local>) {
  // A row with no week flags is treated as every week, so a gap in City data never produces a protest.
  const everyWeek = !s.weeks?.length
  return DAYS.indexOf(s.weekday.slice(0, 2).toLowerCase()) === t.weekday && (everyWeek || s.weeks.includes(t.week)) && t.hour >= s.from_hour && t.hour < s.to_hour
}

// Was this block actually scheduled for sweeping when the ticket was written?
export function sweepingCheck(args: { schedules: Sweep[], issued_at: string, side?: string }) {
  const t = local(args.issued_at)
  const schedules = (args.schedules ?? []).filter(s => !args.side || s.side.toLowerCase() === args.side.toLowerCase())
  const matching = schedules.filter(s => sweepsAt(s, t))
  const label = `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][t.weekday]} (week ${t.week} of the month) at ${args.issued_at.slice(11, 16)}`
  return {
    issued: label,
    schedules_on_block: schedules.map(s => `${s.side}: ${s.when}`),
    scheduled: matching.length > 0,
    contest_grounds: schedules.length > 0 && matching.length === 0,
    explanation: !schedules.length
      ? 'No sweeping schedule found for this block in City data; check the posted signs.'
      : matching.length
        ? `City data shows sweeping here then (${matching.map(s => s.when).join('; ')}), so the ticket matches the schedule.`
        : `City data shows no sweeping on this block at ${label}. Scheduled: ${schedules.map(s => `${s.side} ${s.when}`).join('; ')}.`,
    note: 'Holiday schedules and posted temporary signs are not checked; photos of the signs help a protest.'
  }
}

export function nextSweeping(args: { schedules: Sweep[], from?: string, side?: string }) {
  const start = args.from ?? `${today()}T${now().toLocaleTimeString('en-GB', { timeZone: 'America/Los_Angeles', hourCycle: 'h23' }).slice(0, 5)}`
  const schedules = (args.schedules ?? []).filter(s => !args.side || s.side.toLowerCase() === args.side.toLowerCase())
  for (let i = 0; i < 40; i++) {
    const date = addDays(start.slice(0, 10), i)
    for (const s of schedules.slice().sort((a, b) => a.from_hour - b.from_hour)) {
      const t = local(`${date}T${String(s.from_hour).padStart(2, '0')}:00`)
      if (!sweepsAt(s, t)) continue
      if (i === 0 && local(start).hour >= s.to_hour) continue
      return { date, starts: `${String(s.from_hour).padStart(2, '0')}:00`, ends: `${String(s.to_hour).padStart(2, '0')}:00`, side: s.side, when: s.when, move_by: `${date}T${String(s.from_hour).padStart(2, '0')}:00` }
    }
  }
  return { date: null, note: 'No sweeping in the next 40 days for this block in City data.' }
}

export function nextAnnual(args: { month_day: string }) {
  const year = Number(today().slice(0, 4))
  const thisYear = `${year}-${args.month_day}`
  return { date: thisYear >= today() ? thisYear : `${year + 1}-${args.month_day}` }
}

export const computeFns: Record<string, (args: any) => any> = {
  deposit_interest: depositInterest,
  rent_increase_check: rentIncreaseCheck,
  toll_text_check: tollTextCheck,
  days_until: daysUntil,
  add_days: addDaysFn,
  visa_grace: visaGrace,
  compare_bill: compareBill,
  recurring_charges: recurringCharges,
  vest_schedule: vestSchedule,
  sweeping_check: sweepingCheck,
  next_sweeping: nextSweeping,
  next_annual: nextAnnual,
  nutrition_targets: nutritionTargets,
  meal_plan: mealPlan
}
