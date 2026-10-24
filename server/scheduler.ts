import { db, json } from './db.ts'
import { now } from './clock.ts'
import { getCase, updateCase, logEvent, insertAction, context } from './engine.ts'
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
