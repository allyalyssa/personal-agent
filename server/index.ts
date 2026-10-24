import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { extname } from 'node:path'
import { db } from './db.ts'
import { loadRules, allRules } from './rules.ts'
import { loadPlaybooks, allPlaybooks, playbook, PACKS } from './playbooks.ts'
import { createCase, caseView, listCases, resolveCase, getProfile, setProfile, getCase } from './engine.ts'
import { intake, reply } from './agent.ts'
import { executeAction, rejectAction, completeAction } from './actions.ts'
import { civicReport } from './civic.ts'
import { runDueJobs, startScheduler } from './scheduler.ts'
import { advance, resetClock, now, offsetMs, today } from './clock.ts'
import { watchCall } from './calls.ts'
import { calendarFeed } from './ics.ts'

loadRules()
loadPlaybooks()
if (!Object.keys(getProfile()).length) setProfile(JSON.parse(readFileSync(existsSync('profile.json') ? 'profile.json' : 'profiles/jordan.json', 'utf8')))

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }

async function body(req: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}

function send(res: ServerResponse, status: number, data: any, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(type === 'application/json' ? JSON.stringify(data) : data)
}

function startIntake(text: string | undefined, files: string[] | undefined, source: string, title = 'Reading what you sent...') {
  const id = createCase(title)
  intake(id, { text, files, source }).catch(e => console.error('intake', e))
  return id
}

function state() {
  const recent = db.prepare(`select e.*, c.title as case_title from events e join cases c on c.id = e.case_id where e.kind in ('notify', 'escalate', 'call_result') order by e.id desc limit 20`).all()
  return {
    profile: getProfile(),
    ...listCases(),
    notifications: recent,
    clock: { now: now().toISOString(), today: today(), offset_days: Math.round(offsetMs() / 86400000) },
    integrations: {
      claude: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
      email: Boolean(process.env.RESEND_API_KEY),
      sms: Boolean(process.env.TWILIO_ACCOUNT_SID),
      free_mode: !process.env.RESEND_API_KEY || !process.env.TWILIO_ACCOUNT_SID || !process.env.VAPI_API_KEY,
      calls: Boolean(process.env.VAPI_API_KEY && process.env.VAPI_PHONE_NUMBER_ID)
    }
  }
}

const routes: [string, RegExp, (m: RegExpMatchArray, req: IncomingMessage, res: ServerResponse) => Promise<void>][] = [
  ['GET', /^\/api\/state$/, async (_, __, res) => send(res, 200, state())],
  ['POST', /^\/api\/intake$/, async (_, req, res) => {
    const b = await body(req)
    send(res, 200, { case_id: startIntake(b.text, b.files, b.source ?? 'text') })
  }],
  // Forwarded email or meeting-notes webhook (for example a notetaker automation): any JSON with text in it.
  ['POST', /^\/api\/inbound$/, async (_, req, res) => {
    const b = await body(req)
    const text = [b.subject, b.from ? `From: ${b.from}` : null, b.text ?? b.body ?? b.notes ?? b.summary ?? JSON.stringify(b)].filter(Boolean).join('\n\n')
    send(res, 200, { case_id: startIntake(text, undefined, 'forwarded email or webhook') })
  }],
  ['GET', /^\/api\/cases\/(\w+)$/, async (m, __, res) => send(res, 200, caseView(m[1]))],
  ['POST', /^\/api\/cases\/(\w+)\/reply$/, async (m, req, res) => {
    const b = await body(req)
    reply(m[1], b).catch(e => console.error('reply', e))
    send(res, 200, { ok: true })
  }],
  ['POST', /^\/api\/cases\/(\w+)\/resolve$/, async (m, req, res) => {
    const b = await body(req)
    resolveCase(m[1], Number(b.recovered ?? 0))
    send(res, 200, caseView(m[1]))
  }],
  ['POST', /^\/api\/actions\/(\d+)\/approve$/, async (m, req, res) => {
    const b = await body(req)
    send(res, 200, await executeAction(Number(m[1]), b.payload))
  }],
  ['POST', /^\/api\/actions\/(\d+)\/reject$/, async (m, __, res) => {
    rejectAction(Number(m[1]))
    send(res, 200, { ok: true })
  }],
  ['POST', /^\/api\/clock\/advance$/, async (_, req, res) => {
    const b = await body(req)
    advance(Number(b.days))
    const fired = await runDueJobs()
    send(res, 200, { fired, ...state().clock })
  }],
  ['POST', /^\/api\/clock\/reset$/, async (_, __, res) => {
    resetClock()
    send(res, 200, state().clock)
  }],
  ['GET', /^\/api\/playbooks$/, async (_, __, res) => send(res, 200, {
    packs: PACKS,
    playbooks: allPlaybooks().map(p => ({ id: p.id, pack: p.pack, title: p.title, pitch: p.pitch, depth: p.depth, sample: p.sample, rules: p.rules, actions: p.actions.map(a => a.tool) }))
  })],
  ['POST', /^\/api\/playbooks\/(\w+)\/try$/, async (m, __, res) => {
    const p = playbook(m[1])
    send(res, 200, { case_id: startIntake(p.sample, undefined, `sample for ${p.id}`) })
  }],
  // "Tell Handled about you": one voice note becomes a profile and a set of cases.
  ['POST', /^\/api\/onboard$/, async (_, req, res) => {
    const b = await body(req)
    const id = createCase('Getting to know you')
    intake(id, { text: b.text, source: 'onboarding. The user is introducing themself. Save every durable fact with remember (language too, as an ISO code under the key language). Then open_case for each obligation that applies to them now, up to 6, passing what you know. Route this case with playbook_id "none" and finish with a short list of what you opened and why' }).catch(e => console.error('onboard', e))
    send(res, 200, { case_id: id })
  }],
  ['POST', /^\/api\/actions\/(\d+)\/complete$/, async (m, req, res) => {
    const b = await body(req)
    await completeAction(Number(m[1]), b.notes)
    send(res, 200, { ok: true })
  }],
  ['GET', /^\/api\/personas$/, async (_, __, res) => send(res, 200, readdirSync('profiles').filter(f => f.endsWith('.json')).map(f => ({ id: f.replace('.json', ''), ...JSON.parse(readFileSync(`profiles/${f}`, 'utf8')) })).map(p => ({ id: p.id, name: p.name, persona: p.persona, language: p.language })))],
  ['POST', /^\/api\/personas\/(\w+)$/, async (m, req, res) => {
    const b = await body(req)
    if (b.fresh) {
      db.exec('delete from cases; delete from events; delete from actions; delete from deadlines; delete from jobs;')
      resetClock()
    }
    setProfile(JSON.parse(readFileSync(`profiles/${m[1]}.json`, 'utf8')))
    send(res, 200, getProfile())
  }],
  ['GET', /^\/api\/civic$/, async (_, __, res) => send(res, 200, civicReport())],
  ['GET', /^\/api\/rules$/, async (_, __, res) => send(res, 200, allRules())],
  ['GET', /^\/api\/profile$/, async (_, __, res) => send(res, 200, getProfile())],
  ['POST', /^\/api\/profile$/, async (_, req, res) => {
    setProfile(await body(req))
    send(res, 200, getProfile())
  }],
  ['GET', /^\/calendar\.ics$/, async (_, __, res) => send(res, 200, calendarFeed(), 'text/calendar; charset=utf-8')],
  ['GET', /^\/api\/cases\/(\w+)\/calendar\.ics$/, async (m, __, res) => send(res, 200, calendarFeed(m[1]), 'text/calendar; charset=utf-8')]
]

const server = createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://x')
  for (const [method, re, handler] of routes) {
    const m = url.pathname.match(re)
    if (m && req.method === method) {
      try {
        await handler(m, req, res)
      } catch (e: any) {
        console.error(e)
        send(res, 500, { error: e.message })
      }
      return
    }
  }
  const path = url.pathname === '/' || !extname(url.pathname) ? '/index.html' : url.pathname
  const file = `public${path}`
  if (!existsSync(file) || path.includes('..')) return send(res, 404, { error: 'not found' })
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
})

// Calls still running when the server restarted pick up where they left off.
for (const a of db.prepare(`select * from actions where tool = 'place_call' and status = 'in_progress'`).all() as any[]) {
  const callId = JSON.parse(a.result ?? '{}').call_id
  if (callId) watchCall(a.case_id, a.id, callId)
}
db.prepare(`update cases set busy = 0`).run()

startScheduler()
const port = Number(process.env.PORT ?? 3000)
server.listen(port, () => console.log(`Handled on http://localhost:${port}`))
