import { db, json } from './db.ts'
import { now } from './clock.ts'
import { getCase, updateCase, logEvent, insertAction, context, resolveCase } from './engine.ts'
import { status311 } from './datasf.ts'
import { playbook } from './playbooks.ts'
import { notifyUser } from './actions.ts'

// Fires every due job: deadline reminders and follow-up check-ins.
// A check-in on an unresolved case escalates it and proposes the playbook's escalation step.
export async function runDueJobs() {
  const due = db.prepare(`select * from jobs where status = 'pending' and run_at <= ? order by run_at`).all(now().toISOString()) as any[]
  for (const job of due) {
    db.prepare(`update jobs set status = 'done' where id = ?`).run(job.id)
    const c = getCase(job.case_id)
    if (c.status === 'resolved') continue
    const payload = json(job.payload, {} as any)

    if (job.kind === 'reminder') {
      const d = db.prepare('select * from deadlines where id = ?').get(payload.deadline_id) as any
      if (!d || d.done) continue
      const when = payload.days_before === 0 ? 'today' : `in ${payload.days_before} day${payload.days_before === 1 ? '' : 's'}`
      await notifyUser(c.id, `Reminder: ${d.title} is due ${when} (${d.due_at}).`)
      continue
    }

    if (job.kind === 'followup') {
      logEvent(c.id, 'checkin', `Check-in: ${payload.check}`, payload)
      if (!c.playbook) {
        await notifyUser(c.id, payload.check)
        continue
      }
      const spec = playbook(c.playbook).followups?.find(f => f.after_action === payload.step)
      const requestId = spec?.check_311 ? c.fields[spec.check_311] : null
      if (requestId) {
        const s = await status311(String(requestId))
        logEvent(c.id, 'data', `Checked 311 request ${requestId} in City data: ${s.found ? s.status_description : 'not found yet'}`, s)
        if (s.found && s.status_description === 'Closed') {
          resolveCase(c.id, 0)
          await notifyUser(c.id, `The City closed your 311 report ${requestId}${s.status_notes ? `: ${s.status_notes}` : ''}. Thanks for fixing your block.`)
          continue
        }
        db.prepare(`insert into jobs (case_id, kind, run_at, payload) values (?, 'followup', ?, ?)`).run(c.id, new Date(now().getTime() + 3 * 86400000).toISOString(), job.payload)
        await notifyUser(c.id, `311 request ${requestId} is still ${s.found ? s.status_description : 'not in City data yet'}. Handled checks again in 3 days.`)
        continue
      }
      updateCase(c.id, { status: 'escalated' })
      if (spec?.escalate) {
        const id = insertAction(c.id, { ...spec.escalate, id: spec.escalate.id ?? `${payload.step}_escalation` }, context(c))
        logEvent(c.id, 'escalate', `Escalated. Proposed next step: ${spec.escalate.title}`, { action_id: id })
      }
      await notifyUser(c.id, `No resolution yet on "${c.title}". ${spec?.escalate ? `Next step ready for your approval: ${spec.escalate.title}.` : payload.check}`)
    }
  }
  return due.length
}

export function startScheduler() {
  setInterval(() => {
    runDueJobs().catch(e => console.error('scheduler', e))
  }, 60000)
}
