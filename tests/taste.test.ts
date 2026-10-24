import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.HANDLED_DB = ':memory:'
const { rate, tasteTable, tasteSampler, rng, betaSample } = await import('../server/taste.ts')

test('stars move each cuisine and main ingredient partway', () => {
  rate(null, { id: 1, cuisines: ['korean'], main: 'beef' }, 4)
  const t = tasteTable().map(x => ({ ...x }))
  assert.deepEqual(t.find(x => x.kind === 'cuisine' && x.key === 'korean'), { kind: 'cuisine', key: 'korean', alpha: 1.75, beta: 1.25 })
  assert.deepEqual(t.find(x => x.kind === 'main' && x.key === 'beef'), { kind: 'main', key: 'beef', alpha: 1.75, beta: 1.25 })
})

test('beta samples average alpha / (alpha + beta)', () => {
  const r = rng('beta')
  let sum = 0
  for (let i = 0; i < 4000; i++) sum += betaSample(6, 2, r)
  assert.ok(Math.abs(sum / 4000 - 0.75) < 0.02, String(sum / 4000))
})

test('a Thai lover gets more Thai, less of what they rated low, and still tries new cuisines', () => {
  for (let i = 0; i < 6; i++) {
    rate(null, { id: 100 + i, cuisines: ['thai'], main: 'chicken' }, 5)
    rate(null, { id: 200 + i, cuisines: ['american'], main: 'chicken' }, 1)
  }
  const options = ['thai', 'american', 'italian', 'mexican'].map((c, i) => ({ id: i, cuisines: [c], main: 'chicken' }))
  const wins: Record<string, number> = { thai: 0, american: 0, italian: 0, mexican: 0 }
  for (let day = 0; day < 400; day++) {
    const taste = tasteSampler(rng(`day ${day}`))
    wins[options.reduce((a, b) => taste(b) > taste(a) ? b : a).cuisines[0]]++
  }
  assert.ok(wins.thai > wins.italian && wins.thai > wins.mexican, JSON.stringify(wins))
  assert.ok(wins.american < wins.italian && wins.american < wins.mexican, JSON.stringify(wins))
  assert.ok(wins.italian + wins.mexican > 40, JSON.stringify(wins))
})
