import { db } from './db.ts'
import { now } from './clock.ts'

db.exec(`
create table if not exists taste (kind text not null, key text not null, alpha real not null default 1, beta real not null default 1, primary key (kind, key));
create table if not exists ratings (id integer primary key autoincrement, case_id text, recipe_id integer not null, stars integer not null, at text not null);
`)

export type Rated = { id: number, cuisines: string[], main: string }

// Thompson sampling with fractional Bernoulli rewards: 5 stars is a full like, 1 a full dislike, 3 half of each.
export function rate(caseId: string | null, recipe: Rated, stars: number) {
  const s = Math.min(5, Math.max(1, Math.round(stars)))
  const up = db.prepare('insert into taste (kind, key, alpha, beta) values (?, ?, 1 + ?, 1 + ?) on conflict(kind, key) do update set alpha = alpha + excluded.alpha - 1, beta = beta + excluded.beta - 1')
  for (const [kind, key] of [...recipe.cuisines.map(c => ['cuisine', c]), ['main', recipe.main]]) up.run(kind, key, (s - 1) / 4, (5 - s) / 4)
  db.prepare('insert into ratings (case_id, recipe_id, stars, at) values (?, ?, ?, ?)').run(caseId, recipe.id, s, now().toISOString())
}

export function tasteTable() {
  return db.prepare('select kind, key, alpha, beta from taste order by kind, alpha / (alpha + beta) desc').all() as { kind: string, key: string, alpha: number, beta: number }[]
}

export function ratingCount() {
  return (db.prepare('select count(*) as n from ratings').get() as { n: number }).n
}

export function rng(seed: string) {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353), h = h << 13 | h >>> 19
  return () => {
    h = Math.imul(h ^ h >>> 16, 2246822507)
    h = Math.imul(h ^ h >>> 13, 3266489909)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
}

// Marsaglia-Tsang; shape is always >= 1 here because every count starts at 1 and only grows.
function gamma(shape: number, random: () => number) {
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (;;) {
    let x: number, v: number
    do {
      x = Math.sqrt(-2 * Math.log(random() || 1e-12)) * Math.cos(2 * Math.PI * random())
      v = 1 + c * x
    } while (v <= 0)
    v = v * v * v
    const u = random()
    if (Math.log(u || 1e-12) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v
  }
}

export function betaSample(alpha: number, beta: number, random: () => number) {
  const a = gamma(alpha, random)
  return a / (a + gamma(beta, random))
}

export function tasteSampler(random: () => number) {
  const counts = new Map(tasteTable().map(t => [`${t.kind}:${t.key}`, t]))
  const drawn = new Map<string, number>()
  const draw = (kind: string, key: string) => {
    const k = `${kind}:${key}`
    if (!drawn.has(k)) {
      const t = counts.get(k)
      drawn.set(k, betaSample(t?.alpha ?? 1, t?.beta ?? 1, random))
    }
    return drawn.get(k)!
  }
  return (r: Rated) => Math.max(...r.cuisines.map(c => draw('cuisine', c))) * draw('main', r.main)
}
