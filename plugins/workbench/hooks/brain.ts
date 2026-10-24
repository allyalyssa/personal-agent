import type { EngineInterface } from 'claude-code'

export type Note = {
  path: string
  title: string
  type: string
  project: string
  tags: string[]
  status: string
  summary: string
  created: string
  updated: string
  links: string[]
  text: string
}

export type Hit = { note: Note; score: number }

export const TYPE_DIRS: Record<string, string> = {
  project: 'projects',
  decision: 'decisions',
  lesson: 'lessons',
  workflow: 'workflows',
  research: 'research',
  question: 'questions',
  session: 'sessions',
  preference: 'profile',
  concept: 'concepts',
}

const STOP = new Set(
  'the and for with that this from have what when where which will would could should about into your their there them they then than just like make made also some more most very want need does doing done been being were please help can how why who you are not but all any use using get our out its it\'s'.split(
    ' ',
  ),
)

export function terms(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9][a-z0-9_.-]{2,}/g) ?? []
  return [...new Set(words.filter(w => !STOP.has(w)))]
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'note'
  )
}

function parseList(raw: string): string[] {
  const inner = raw.trim().replace(/^\[|\]$/g, '')
  if (inner === '') return []
  return inner
    .split(',')
    .map(s => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)
}

export function parseFrontmatter(text: string): { meta: Record<string, string | string[]>; body: string } {
  const meta: Record<string, string | string[]> = {}
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return { meta, body: text }
  let listKey = ''
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const item = line.match(/^\s+-\s+(.*)$/)
    if (item && listKey) {
      const prev = meta[listKey]
      meta[listKey] = [...(Array.isArray(prev) ? prev : []), (item[1] ?? '').trim()]
      continue
    }
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (!kv) continue
    const key = kv[1] ?? ''
    const value = (kv[2] ?? '').trim()
    if (value === '') {
      listKey = key
      meta[key] = []
    } else if (value.startsWith('[')) {
      listKey = ''
      meta[key] = parseList(value)
    } else {
      listKey = ''
      meta[key] = value.replace(/^["']|["']$/g, '')
    }
  }
  return { meta, body: text.slice(match[0].length) }
}

const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(', ') : v ?? '')
const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? parseList(v) : [])

export function parseNote(path: string, text: string): Note {
  const { meta, body } = parseFrontmatter(text)
  const heading = body.match(/^#\s+(.+)$/m)?.[1]
  const name = path.split('/').pop()?.replace(/\.md$/, '') ?? path
  const wikilinks = [...body.matchAll(/\[\[([^\]|#]+)/g)].map(m => (m[1] ?? '').trim())
  return {
    path,
    title: str(meta.title) || heading || name,
    type: str(meta.type) || 'note',
    project: str(meta.project) || 'global',
    tags: list(meta.tags),
    status: str(meta.status) || 'active',
    summary: str(meta.summary),
    created: str(meta.created),
    updated: str(meta.updated),
    links: [...new Set([...list(meta.links).map(l => l.replace(/^\[\[|\]\]$/g, '')), ...wikilinks])],
    text: body.slice(0, 4000).toLowerCase(),
  }
}

export async function scanBrain($: EngineInterface, root: string): Promise<Note[]> {
  const notes: Note[] = []
  const walk = async (rel: string, depth: number) => {
    const entries = await $.fs.list(rel ? `${root}/${rel}` : root).catch(() => [])
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
      const child = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.kind === 'dir' && depth < 4) await walk(child, depth + 1)
      else if (entry.kind === 'file' && entry.name.endsWith('.md') && rel !== '') {
        const text = await $.fs.read(`${root}/${child}`).catch(() => '')
        notes.push(parseNote(child, text))
      }
    }
  }
  await walk('', 0)
  return notes
}

export function search(
  notes: Note[],
  query: string,
  opts: { project?: string; type?: string; limit?: number; includeInactive?: boolean } = {},
): Hit[] {
  const words = terms(query)
  const hits: Hit[] = []
  for (const note of notes) {
    if (opts.type && note.type !== opts.type) continue
    if (!opts.includeInactive && (note.status === 'superseded' || note.status === 'archived')) continue
    const title = note.title.toLowerCase()
    const summary = note.summary.toLowerCase()
    const tags = note.tags.join(' ').toLowerCase()
    let score = 0
    for (const w of words) {
      if (title.includes(w)) score += 3
      if (tags.includes(w)) score += 3
      if (summary.includes(w)) score += 2
      if (note.text.includes(w)) score += 1
    }
    if (score === 0) continue
    if (opts.project && note.project === opts.project) score += 2
    hits.push({ note, score })
  }
  hits.sort((a, b) => b.score - a.score || b.note.updated.localeCompare(a.note.updated))
  return hits.slice(0, opts.limit ?? 8)
}

export function backlinks(notes: Note[], target: Note): Note[] {
  const name = target.path.split('/').pop()?.replace(/\.md$/, '') ?? ''
  const keys = new Set([name, target.title, target.path.replace(/\.md$/, '')].map(k => k.toLowerCase()))
  return notes.filter(n => n !== target && n.links.some(l => keys.has(l.toLowerCase())))
}

const SECRET = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /sk-ant-[A-Za-z0-9_-]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(password|passwd|api[_-]?key|secret|token)\s*[:=]\s*\S{6,}/i,
]

export function looksSecret(text: string): boolean {
  return SECRET.some(re => re.test(text))
}

export function redact(text: string): string {
  return SECRET.reduce((out, re) => out.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`), '[redacted]'), text)
}

export function frontmatter(fields: Record<string, string | string[] | undefined>): string {
  const lines = ['---']
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) continue
    lines.push(Array.isArray(value) ? `${key}: [${value.join(', ')}]` : `${key}: ${value.replace(/\n/g, ' ')}`)
  }
  lines.push('---', '')
  return lines.join('\n')
}

export function indexMarkdown(notes: Note[], today: string): string {
  const groups = new Map<string, Note[]>()
  for (const note of notes) groups.set(note.type, [...(groups.get(note.type) ?? []), note])
  const out = [
    '# Second brain index',
    '',
    `Rebuilt by the workbench plugin on ${today}. Edit notes, not this file.`,
    '',
  ]
  for (const type of [...groups.keys()].sort()) {
    out.push(`## ${type}`, '')
    const sorted = (groups.get(type) ?? []).sort((a, b) => b.updated.localeCompare(a.updated))
    for (const n of sorted) {
      const flag = n.status === 'active' ? '' : ` (${n.status})`
      const summary = n.summary ? ` — ${n.summary}` : ''
      out.push(`- [[${n.path.replace(/\.md$/, '')}|${n.title}]]${flag}${summary}`)
    }
    out.push('')
  }
  return out.join('\n')
}
