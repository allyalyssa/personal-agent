import { queryDatasf } from '../server/datasf.ts'

const address = process.argv[2] ?? '1000 Guerrero St'
const date = process.argv[3] ?? new Date().toISOString().slice(0, 10)
for (const dataset of ['assessor', 'street_sweeping', 'temporary_no_parking'] as const) {
  const r = await queryDatasf({ dataset, address, date })
  console.log(dataset, JSON.stringify(r, null, 2))
}
