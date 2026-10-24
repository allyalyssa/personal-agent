const BASE = 'https://data.sf.gov/resource'

export const DATASETS = {
  addresses: { id: '3mea-di5p', name: 'San Francisco Addresses - Enterprise Addressing System' },
  assessor: { id: 'wv5m-vpq2', name: 'Assessor Historical Secured Property Tax Rolls' },
  street_sweeping: { id: 'yhqp-riqs', name: 'Street Sweeping Schedule' },
  temporary_no_parking: { id: 'sftu-nd43', name: 'Parking Signs / Street Space Permits' },
  cases_311: { id: 'vw6y-z8j6', name: '311 Cases' },
  citations: { id: 'ab4h-6ztd', name: 'SFMTA - Parking Citations & Fines' }
}

async function soda(dataset: keyof typeof DATASETS, params: Record<string, string>) {
  const url = new URL(`${BASE}/${DATASETS[dataset].id}.json`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const headers: Record<string, string> = {}
  if (process.env.DATASF_APP_TOKEN) headers['X-App-Token'] = process.env.DATASF_APP_TOKEN
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`DataSF ${DATASETS[dataset].id} ${res.status}: ${await res.text()}`)
  return { rows: await res.json() as any[], url: url.toString() }
}

const SUFFIXES: Record<string, string> = { STREET: 'ST', AVENUE: 'AVE', BOULEVARD: 'BLVD', DRIVE: 'DR', PLACE: 'PL', COURT: 'CT', TERRACE: 'TER', WAY: 'WAY', LANE: 'LN', ROAD: 'RD', ALLEY: 'ALY' }

// "1000 Guerrero St, San Francisco" -> number 1000, street GUERRERO
export function parseAddress(address: string) {
  const first = address.split(',')[0].trim().toUpperCase().replace(/\./g, '')
  const m = first.match(/^(\d+)[A-Z]?\s+(.+)$/)
  if (!m) throw new Error(`Could not read a street number in "${address}"`)
  const words = m[2].split(/\s+/)
  const unitAt = words.findIndex(w => /^(APT|UNIT|#)/.test(w))
  if (unitAt >= 0) words.splice(unitAt)
  const last = words.at(-1)!
  let type: string | null = null
  if (SUFFIXES[last] || Object.values(SUFFIXES).includes(last)) type = SUFFIXES[words.pop()!] ?? last
  // EAS pads numbered streets: "6th Ave" is stored as 06TH.
  const street = words.join(' ').replace(/^(\d)(ST|ND|RD|TH)$/, '0$1$2')
  return { number: m[1], street, type }
}

export async function lookupAddress(address: string, anyType = false): Promise<{ match: any, candidates: number, query_url: string }> {
  const parsed = parseAddress(address)
  const { number, street } = parsed
  const type = anyType ? null : parsed.type
  const { rows, url } = await soda('addresses', {
    $where: `address_number=${Number(number)} and upper(street_name)='${street.replace(/'/g, "''")}'${type ? ` and upper(street_type)='${type}'` : ''}`,
    $select: 'address,cnn,parcel_number,nhood,zip_code,latitude,longitude',
    $limit: '5'
  })
  if (!rows.length && type) return lookupAddress(address, true)
  return { match: rows[0] ?? null, candidates: rows.length, query_url: url }
}

export async function assessorByAddress(address: string) {
  const addr = await lookupAddress(address)
  if (!addr.match) return { found: false, address, note: 'Address not found in the City address registry (EAS).', sources: [addr.query_url] }
  const { rows, url } = await soda('assessor', {
    $where: `parcel_number='${addr.match.parcel_number}'`,
    $order: 'closed_roll_year DESC',
    $limit: '1',
    $select: 'closed_roll_year,property_location,parcel_number,year_property_built,number_of_units,use_definition,property_class_code_definition,number_of_stories'
  })
  const r = rows[0]
  return {
    found: Boolean(r),
    address: addr.match.address,
    neighborhood: addr.match.nhood,
    parcel_number: addr.match.parcel_number,
    year_built: r ? Number(r.year_property_built) : null,
    units: r ? Number(r.number_of_units) : null,
    use: r?.use_definition ?? null,
    property_class: r?.property_class_code_definition ?? null,
    roll_year: r?.closed_roll_year ?? null,
    dataset: DATASETS.assessor,
    sources: [addr.query_url, url]
  }
}

export async function sweepingByAddress(address: string) {
  const addr = await lookupAddress(address)
  if (!addr.match) return { found: false, address, sources: [addr.query_url] }
  const select = 'corridor,limits,blockside,cnnrightleft,fullname,weekday,fromhour,tohour,holidays,week1,week2,week3,week4,week5'
  const first = await soda('street_sweeping', { $where: `cnn='${addr.match.cnn}'`, $select: select })
  // Each side of a block can be its own segment, so fetch the whole block by street and limits.
  const block = first.rows[0]
    ? await soda('street_sweeping', { $where: `corridor='${first.rows[0].corridor.replace(/'/g, "''")}' and upper(limits) like '${first.rows[0].limits.toUpperCase().split('-').map((p: string) => p.trim()).join('%').replace(/'/g, "''")}'`, $select: select })
    : first
  const rows = block.rows
  return {
    found: rows.length > 0,
    address: addr.match.address,
    block: rows[0] ? `${rows[0].corridor}, ${rows[0].limits.replace(/\s+/g, ' ')}` : null,
    schedules: rows.map(r => ({
      side: r.blockside,
      when: `${r.fullname}, ${r.fromhour}:00-${r.tohour}:00`,
      weekday: r.weekday,
      weeks: [1, 2, 3, 4, 5].filter(n => r[`week${n}`] === '1'),
      from_hour: Number(r.fromhour),
      to_hour: Number(r.tohour),
      holidays: r.holidays === '1'
    })),
    dataset: DATASETS.street_sweeping,
    sources: [addr.query_url, block.url]
  }
}

// Parking citations are public on DataSF by citation number.
export async function citationLookup(number: string) {
  const { rows, url } = await soda('citations', {
    $where: `citation_number='${String(number).replace(/\D/g, '')}'`,
    $select: 'citation_number,citation_issued_datetime,violation,violation_desc,citation_location,fine_amount'
  })
  const r = rows[0]
  return {
    found: Boolean(r),
    number,
    issued_at: r?.citation_issued_datetime ?? null,
    violation: r?.violation_desc ?? null,
    code: r?.violation ?? null,
    location: r?.citation_location ?? null,
    fine: r ? Number(r.fine_amount) : null,
    dataset: DATASETS.citations,
    sources: [url],
    note: r ? null : 'Not in City data yet; new citations can take a few days to appear.'
  }
}

function mdy(s: string) {
  const [m, d, y] = s.split('/')
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

export async function noParkingByAddress(address: string, date: string) {
  const addr = await lookupAddress(address)
  if (!addr.match) return { found: false, address, sources: [addr.query_url] }
  const { rows, url } = await soda('temporary_no_parking', {
    $where: `cnn='${addr.match.cnn}'`,
    $select: 'category,signtype,companyname,permitnumber,startdate,enddate,starttime,endtime,notes,sideofstreet,address,datetimeposted',
    $order: 'datetimeentered DESC',
    $limit: '50'
  })
  const active = rows.filter(r => r.startdate && r.enddate && mdy(r.startdate) <= date && date <= mdy(r.enddate))
  return {
    found: active.length > 0,
    address: addr.match.address,
    date,
    active_permits: active.map(r => ({ who: r.companyname, category: r.category, permit: r.permitnumber, dates: `${r.startdate} to ${r.enddate}`, hours: `${r.starttime}-${r.endtime}`, notes: r.notes, side: r.sideofstreet, posted: r.datetimeposted ?? null })),
    permits_on_block: rows.length,
    dataset: DATASETS.temporary_no_parking,
    sources: [addr.query_url, url]
  }
}

// What neighbors already reported to 311 near this address, and how fast the City closed it.
export async function nearby311(address: string, keyword?: string, days = 60, meters = 150) {
  const addr = await lookupAddress(address)
  if (!addr.match) return { found: false, address, sources: [addr.query_url] }
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 19)
  const kw = keyword ? ` and (upper(service_name) like '%${keyword.toUpperCase().replace(/'/g, "''")}%' or upper(service_subtype) like '%${keyword.toUpperCase().replace(/'/g, "''")}%' or upper(service_details) like '%${keyword.toUpperCase().replace(/'/g, "''")}%')` : ''
  const { rows, url } = await soda('cases_311', {
    $where: `requested_datetime > '${since}' and within_circle(point, ${Number(addr.match.latitude)}, ${Number(addr.match.longitude)}, ${meters})${kw}`,
    $select: 'service_request_id,service_name,service_subtype,status_description,requested_datetime,closed_date,address,agency_responsible',
    $order: 'requested_datetime DESC',
    $limit: '50'
  })
  const closed = rows.filter(r => r.closed_date)
  const hours = closed.map(r => (Date.parse(r.closed_date) - Date.parse(r.requested_datetime)) / 3600000).filter(h => h >= 0).sort((x, y) => x - y)
  const open = rows.filter(r => !r.closed_date && r.status_description !== 'Closed')
  return {
    found: rows.length > 0,
    address: addr.match.address,
    neighborhood: addr.match.nhood,
    within_meters: meters,
    days,
    reports: rows.length,
    open_reports: open.length,
    median_hours_to_close: hours.length ? Math.round(hours[Math.floor(hours.length / 2)]) : null,
    agencies: [...new Set(rows.map(r => r.agency_responsible).filter(Boolean))],
    recent: rows.slice(0, 5).map(r => ({ id: r.service_request_id, what: `${r.service_name}${r.service_subtype ? ` / ${r.service_subtype}` : ''}`, status: r.status_description, requested: r.requested_datetime?.slice(0, 10), closed: r.closed_date?.slice(0, 10) ?? null, address: r.address })),
    dataset: DATASETS.cases_311,
    sources: [addr.query_url, url]
  }
}

export async function status311(requestId: string) {
  const { rows, url } = await soda('cases_311', { $where: `service_request_id='${requestId.replace(/'/g, "''")}'`, $select: 'service_request_id,status_description,status_notes,closed_date,updated_datetime' })
  return { found: rows.length > 0, ...(rows[0] ?? {}), source: url }
}

export async function queryDatasf(args: { dataset: 'assessor' | 'street_sweeping' | 'temporary_no_parking' | 'nearby_311' | 'citation' | 'food_nearby', address?: string, date?: string, keyword?: string, number?: string, [k: string]: any }) {
  if (args.dataset === 'food_nearby') return (await import('./food.ts')).foodNearby(args as any)
  if (args.dataset === 'citation') return citationLookup(args.number!)
  if (args.dataset === 'assessor') return assessorByAddress(args.address!)
  if (args.dataset === 'street_sweeping') return sweepingByAddress(args.address!)
  if (args.dataset === 'nearby_311') return nearby311(args.address!, args.keyword)
  return noParkingByAddress(args.address!, args.date ?? new Date().toISOString().slice(0, 10))
}
