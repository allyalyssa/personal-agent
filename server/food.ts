import { lookupAddress } from './datasf.ts'
import { allowedFoods } from './nutrition.ts'
import { db } from './db.ts'

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter']
const FLIPP = 'https://backflipp.wishabi.com/flipp/items/search'
const METERS_PER_MINUTE = 80
const PLACES_TTL_DAYS = 7
const GENERIC = new Set(['foods', 'fresh', 'grocery', 'valencia', 'mission', 'super', 'save'])

function meters(a: { lat: number, lon: number }, b: { lat: number, lon: number }) {
  const rad = Math.PI / 180
  const x = (b.lon - a.lon) * rad * Math.cos((a.lat + b.lat) / 2 * rad)
  const y = (b.lat - a.lat) * rad
  return Math.sqrt(x * x + y * y) * 6371000
}

const norm = (s: string) => s.toLowerCase().replace(/['’]s\b/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\b(supermarkets?|markets?|stores?|inc|co|the)\b/g, ' ').replace(/\s+/g, ' ').trim()

async function overpass(server: string, q: string) {
  const res = await fetch(server, { method: 'POST', body: `data=${encodeURIComponent(q)}`, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Handled (hackathon demo)' }, signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`OpenStreetMap ${res.status}`)
  const body = await res.json() as any
  // Overpass reports its own timeouts as a 200 with a remark and no elements; treat that as a failure, not "no stores".
  if (body.remark || !body.elements?.length) throw new Error(`OpenStreetMap returned nothing${body.remark ? `: ${body.remark}` : ''}`)
  return body.elements as any[]
}

// Grocery stores and farmers markets around a point, from OpenStreetMap. The first server to answer wins.
// Stores rarely change, so results are kept for a week to spare the free map servers.
export async function storesAround(lat: number, lon: number, radius: number) {
  const key = `places:${lat.toFixed(4)},${lon.toFixed(4)},${radius}`
  const cached = db.prepare('select value from settings where key = ?').get(key) as { value: string } | undefined
  if (cached) {
    const c = JSON.parse(cached.value)
    if (Date.parse(c.at) > Date.now() - PLACES_TTL_DAYS * 86400000) return c.places as any[]
  }
  const q = `[out:json][timeout:25];(node["shop"~"^(supermarket|greengrocer|convenience|butcher|health_food|deli)$"](around:${radius},${lat},${lon});way["shop"~"^(supermarket|greengrocer)$"](around:${radius},${lat},${lon});node["amenity"="marketplace"](around:${Math.max(radius, 2000)},${lat},${lon}););out center 80;`
  const elements = await Promise.any(OVERPASS.map(s => overpass(s, q)))
  const places = elements.filter(e => e.tags?.name).map(e => {
    const p = { lat: e.lat ?? e.center.lat, lon: e.lon ?? e.center.lon }
    const d = meters({ lat, lon }, p)
    return { name: e.tags.name, brand: e.tags.brand ?? null, kind: e.tags.shop ?? e.tags.amenity, meters: Math.round(d), walk_minutes: Math.max(1, Math.round(d / METERS_PER_MINUTE)), ...p }
  }).sort((a, b) => a.meters - b.meters)
  db.prepare('insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value').run(key, JSON.stringify({ at: new Date().toISOString(), places }))
  return places
}

async function flyerItems(zip: string, term: string) {
  const url = `${FLIPP}?locale=en-us&postal_code=${encodeURIComponent(zip)}&q=${encodeURIComponent(term)}`
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) return []
  const body = await res.json() as any
  return (body.items ?? []) as any[]
}

// This week's flyer deals for the foods this person can eat, matched to stores within walking distance.
export async function foodNearby(args: { address: string, walk_minutes?: any, diet?: any, allergies?: any, conditions?: any, dislikes?: any, max_cook_minutes?: any, delivery?: any }) {
  const addr = await lookupAddress(args.address)
  if (!addr.match) return { found: false, address: args.address, note: 'Address not found in the City address registry.', sources: [addr.query_url] }
  const lat = Number(addr.match.latitude)
  const lon = Number(addr.match.longitude)
  const zip = addr.match.zip_code
  const walk = Number(args.walk_minutes) || 15
  const radius = Math.min(3000, walk * METERS_PER_MINUTE)
  let mapError: string | null = null
  const placesPending = storesAround(lat, lon, radius).catch(e => {
    mapError = `OpenStreetMap unavailable: ${e.errors?.[0]?.message ?? e.message}`
    return [] as any[]
  })
  const foods = allowedFoods(args)
  const flyers: any[][] = []
  for (let i = 0; i < foods.length; i += 12) flyers.push(...await Promise.all(foods.slice(i, i + 12).map(f => flyerItems(zip, f.search).catch(() => []))))
  const places = await placesPending
  const stores = places.filter(p => p.kind !== 'marketplace' && p.walk_minutes <= walk)
  const markets = places.filter(p => p.kind === 'marketplace')
  // Without the map we can't tell walking distance, so keep every deal in the ZIP code rather than none.
  const keepFar = mapError != null || args.delivery === true || /^(y|yes|sí|si|sim|true)/i.test(String(args.delivery ?? ''))
  // Flyers are real-world data, so they are checked against the real date even when the demo clock is fast-forwarded.
  const nowIso = new Date().toISOString()
  const deals: Record<string, any[]> = {}
  foods.forEach((f, j) => {
    const found = flyers[j]
      .filter(it => typeof it.current_price === 'number' && it.current_price > 0)
      .filter(it => /food|beverage/i.test(it._L1 ?? 'food'))
      .filter(it => (!it.valid_to || it.valid_to > nowIso) && (!it.valid_from || it.valid_from <= nowIso))
      .filter(it => {
        const name = String(it.name ?? '').toLowerCase()
        return f.match.some(m => name.includes(m)) && !f.exclude.some(x => name.includes(x))
      })
      .map(it => {
        const key = norm(it.merchant_name ?? '')
        const first = key.split(' ')[0]
        // Match the chain by its brand or the start of the store name, so "Valencia Whole Foods" is not Whole Foods.
        const store = key ? stores.find(s => [s.brand, s.name].filter(Boolean).map(norm).some(n => n === key || n.startsWith(`${key} `) || key.startsWith(`${n} `) || (first.length > 4 && !GENERIC.has(first) && n.split(' ')[0] === first))) : undefined
        return {
          item: it.name,
          price: it.current_price,
          price_text: [it.pre_price_text, `$${it.current_price}`, it.post_price_text].filter(Boolean).join(' '),
          was: it.original_price ?? null,
          merchant: it.merchant_name,
          store: store ? store.name : null,
          walk_minutes: store ? store.walk_minutes : null,
          valid_to: it.valid_to ?? null,
          image: it.clean_image_url ?? null
        }
      })
      .filter(d => d.store || keepFar)
      .sort((a, b) => (a.walk_minutes == null ? 1 : 0) - (b.walk_minutes == null ? 1 : 0) || a.price - b.price)
      .slice(0, 3)
    if (found.length) deals[f.id] = found
  })
  return {
    found: true,
    address: addr.match.address,
    neighborhood: addr.match.nhood,
    zip,
    walk_minutes: walk,
    radius_m: radius,
    stores: stores.slice(0, 12).map(s => ({ name: s.name, kind: s.kind, walk_minutes: s.walk_minutes })),
    markets: markets.slice(0, 5).map(m => ({ name: m.name, walk_minutes: m.walk_minutes })),
    deals,
    deal_count: Object.values(deals).reduce((n, d) => n + d.length, 0),
    checked_at: nowIso,
    map_error: mapError,
    note: 'Walk times are straight-line estimates at about 80 m a minute. Deals are from this week\'s store flyers (Flipp) for your ZIP code.',
    sources: [addr.query_url, 'https://www.openstreetmap.org/', `https://flipp.com/en-us/search?postal_code=${zip}`]
  }
}
