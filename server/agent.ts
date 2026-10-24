import type Anthropic from '@anthropic-ai/sdk'
import { client, MODEL, EFFORT, FALLBACK, structured, imageBlock } from './llm.ts'
import { allPlaybooks, playbook } from './playbooks.ts'
import { rule } from './rules.ts'
import { computeFns } from './compute.ts'
import { queryDatasf } from './datasf.ts'
import { today } from './clock.ts'
import { redact, redactDeep } from './redact.ts'
import { getCase, updateCase, logEvent, setFields, prefillFromProfile, missingFields, plan, getProfile, insertAction, context, caseView } from './engine.ts'
import { db } from './db.ts'

type Tool = Anthropic.Beta.BetaTool

const tools: Tool[] = [
  {
    name: 'route_playbook',
    description: 'Pick the playbook that matches what the user captured. Returns the playbook definition: fields it needs, rules it relies on, compute steps, and the actions it will propose. Call this first. If nothing fits, use playbook_id "none".',
    input_schema: {
      type: 'object',
      properties: {
        playbook_id: { type: 'string' },
        case_title: { type: 'string', description: 'Short title for the case list, e.g. "Deposit interest from Lombard Properties"' },
        reason: { type: 'string' }
      },
      required: ['playbook_id', 'case_title', 'reason']
    }
  },
  {
    name: 'set_fields',
    description: 'Save field values for this case (extracted from the document, said by the user, or looked up). Dates as YYYY-MM-DD, money as numbers. Never include full SSNs, card numbers, ID numbers or account numbers; last 4 digits at most. Returns which required fields are still missing.',
    input_schema: {
      type: 'object',
      properties: { fields: { type: 'object', additionalProperties: true } },
      required: ['fields']
    }
  },
  {
    name: 'lookup_rule',
    description: 'Read a rule file: plain-English rule, parameters, official source URL, whether it was verified, and who to confirm with.',
    input_schema: { type: 'object', properties: { rule_id: { type: 'string' } }, required: ['rule_id'] }
  },
  {
    name: 'query_datasf',
    description: 'Query live San Francisco open data for an address. assessor: year built, units, use (for rent control). street_sweeping: sweeping schedule for that block. temporary_no_parking: posted no-parking permits active on a date.',
    input_schema: {
      type: 'object',
      properties: {
        dataset: { type: 'string', enum: ['assessor', 'street_sweeping', 'temporary_no_parking'] },
        address: { type: 'string', description: 'Street address in San Francisco, e.g. "1000 Guerrero St"' },
        date: { type: 'string', description: 'YYYY-MM-DD, for temporary_no_parking' }
      },
      required: ['dataset', 'address']
    }
  },
  {
    name: 'compute',
    description: `Run a deterministic calculation. Never do this math yourself. Functions: ${Object.keys(computeFns).join(', ')}. Arguments: deposit_interest {deposit_amount, move_in_date, interest_paid_through?}; rent_increase_check {current_rent, new_rent, effective_date, year_built?, unit_type?, last_increase_date?}; toll_text_check {message_text, links?}; days_until {date}.`,
    input_schema: {
      type: 'object',
      properties: { fn: { type: 'string', enum: Object.keys(computeFns) }, args: { type: 'object', additionalProperties: true } },
      required: ['fn', 'args']
    }
  },
  {
    name: 'ask_user',
    description: 'Ask the user only for required fields you could not extract or look up. One short question per field. After calling this, stop and wait.',
    input_schema: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          items: { type: 'object', properties: { field: { type: 'string' }, question: { type: 'string' } }, required: ['field', 'question'] }
        }
      },
      required: ['questions']
    }
  },
  {
    name: 'plan_actions',
    description: 'Once required fields are set, run the playbook engine. It computes deadlines from the rules, creates the case timeline, and proposes the actions (each waits for the user to approve). Returns the actions and deadlines. You may call it again after new facts.',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'revise_action',
    description: 'Improve the draft of a proposed action before the user sees it, e.g. tailor an email body or call script to details in the document. Only changes the fields you pass. Keep every number and date exactly as the engine computed it.',
    input_schema: {
      type: 'object',
      properties: { action_id: { type: 'number' }, changes: { type: 'object', additionalProperties: true } },
      required: ['action_id', 'changes']
    }
  },
  {
    name: 'propose_action',
    description: 'Propose an extra action the playbook does not cover. It goes to the user for approval like every other action. Tools: send_email {to, subject, body}, send_sms {to, body}, place_call {to, contact_name, goal, opener, facts[], must_not[], ask[]}, create_calendar_event {title, date, note}, prepare_form {form_name, official_url, fields{}, instructions}, open_url_prefilled {url, params{}}, schedule_followup {wait, check}.',
    input_schema: {
      type: 'object',
      properties: {
        tool: { type: 'string', enum: ['send_email', 'send_sms', 'place_call', 'create_calendar_event', 'prepare_form', 'open_url_prefilled', 'schedule_followup'] },
        title: { type: 'string' },
        payload: { type: 'object', additionalProperties: true },
        due: { type: 'string', description: 'YYYY-MM-DD or a formula like "today + 3 days"' }
      },
      required: ['tool', 'title', 'payload']
    }
  }
]

function catalog() {
  return allPlaybooks().map(p => `- ${p.id} (${p.pack}): ${p.title}. Documents: ${p.triggers.documents.join(', ')}. Phrases: ${p.triggers.phrases.join(', ')}.`).join('\n')
}

function systemPrompt() {
  return `You are Handled, a personal agent for San Francisco residents that takes care of the obligations nobody explains: deadlines, money people are owed, forms, calls, and follow-ups.

The user captures something (a photo of a notice, bill, or letter; a forwarded email; a voice note). You:
1. Route it to one playbook with route_playbook.
2. Fill the playbook's required fields with set_fields: from the document first, then the user's profile (already prefilled), then live data via query_datasf. Ask the user with ask_user only for required fields still missing, then stop.
3. Run plan_actions. The engine computes deadlines and drafts actions from the playbook; you may tailor drafts with revise_action.
4. Finish with a short message: what you found, then the next actions in one or two sentences each, ordered by deadline, each citing its rule or data source.

Hard rules:
- Never invent numbers, rates, or deadlines. Use compute and the rule files. If a rule is marked unverified, say "unverified" and name who to confirm with.
- Legal, tax, immigration, and medical points are information with sources, not advice. Name who to confirm with.
- Nothing is sent, filed, or called without the user's approval. The engine handles that; never claim something was sent.
- Never store or repeat full SSNs, card numbers, government ID numbers, or full account numbers. Last 4 digits at most.
- Government and legal forms are prepared, never submitted. The user presses the final button.
- Keep messages short and plain. The user is on a phone.

Playbooks:
${catalog()}`
}

async function runTool(caseId: string, name: string, input: any): Promise<{ result: any, stop?: boolean }> {
  if (name === 'route_playbook') {
    if (input.playbook_id === 'none') {
      updateCase(caseId, { title: input.case_title })
      logEvent(caseId, 'route', 'No playbook matched', { reason: input.reason })
      return { result: { ok: true, note: 'No playbook. Explain what you can and propose actions with propose_action if useful.' } }
    }
    const p = playbook(input.playbook_id)
    updateCase(caseId, { playbook: p.id, pack: p.pack, title: input.case_title })
    prefillFromProfile(caseId)
    logEvent(caseId, 'route', `Matched playbook: ${p.title}`, { reason: input.reason })
    const c = getCase(caseId)
    return {
      result: {
        playbook: {
          id: p.id,
          title: p.title,
          guidance: p.guidance,
          required_fields: p.required_fields,
          compute: p.compute,
          datasf: p.datasf,
          actions: p.actions.map(a => ({ id: a.id, tool: a.tool, title: a.title, when: a.when, unless: a.unless })),
          deadlines: p.deadlines?.map(d => ({ title: d.title, due: d.due, rule: d.rule, when: d.when }))
        },
        rules: p.rules.map(r => {
          const x = rule(r)
          return { id: x.id, rule: x.rule, status: x.status, source_url: x.source_url, confirm_with: x.confirm_with }
        }),
        prefilled_fields: c.fields,
        missing: missingFields(c)
      }
    }
  }
  if (name === 'set_fields') {
    const merged = setFields(caseId, input.fields)
    logEvent(caseId, 'fields', `Saved ${Object.keys(input.fields).join(', ')}`, redactDeep(input.fields))
    const c = getCase(caseId)
    return { result: { fields: merged, missing: c.playbook ? missingFields(c) : [] } }
  }
  if (name === 'lookup_rule') return { result: rule(input.rule_id) }
  if (name === 'query_datasf') {
    const result = await queryDatasf(input)
    logEvent(caseId, 'data', `Looked up DataSF ${input.dataset} for ${input.address}`, result)
    return { result }
  }
  if (name === 'compute') {
    const result = computeFns[input.fn](input.args)
    logEvent(caseId, 'compute', `Computed ${input.fn}`, { args: input.args, result })
    return { result }
  }
  if (name === 'ask_user') {
    updateCase(caseId, { questions: input.questions })
    logEvent(caseId, 'question', input.questions.map((q: any) => q.question).join(' '))
    return { result: { ok: true, note: 'Questions shown to the user. Stop now and wait for answers.' }, stop: true }
  }
  if (name === 'plan_actions') {
    const c = getCase(caseId)
    const missing = missingFields(c)
    if (missing.length) return { result: { error: 'Required fields missing', missing } }
    const view = plan(caseId)
    return {
      result: {
        computed: view.computed,
        money_at_stake: view.money_at_stake,
        deadlines: view.deadlines,
        actions: view.actions.filter((a: any) => a.status === 'proposed').map((a: any) => ({ id: a.id, tool: a.tool, title: a.title, due_at: a.due_at, payload: a.payload }))
      }
    }
  }
  if (name === 'revise_action') {
    const a = db.prepare('select * from actions where id = ? and case_id = ?').get(input.action_id, caseId) as any
    if (!a || a.status !== 'proposed') return { result: { error: 'No proposed action with that id' } }
    const payload = { ...JSON.parse(a.payload), ...redactDeep(input.changes) }
    db.prepare('update actions set payload = ? where id = ?').run(JSON.stringify(payload), input.action_id)
    return { result: { ok: true, payload } }
  }
  if (name === 'propose_action') {
    const id = insertAction(caseId, { tool: input.tool, title: input.title, payload: input.payload, due: input.due, needs_approval: true }, context(getCase(caseId)))
    db.prepare(`update actions set source = 'agent' where id = ?`).run(id)
    return { result: { ok: true, action_id: id } }
  }
  throw new Error(`Unknown tool ${name}`)
}

// Runs the tool loop until Claude finishes or asks the user something.
// The conversation is stored on the case, append-only, so a reply continues it.
export async function runAgent(caseId: string, userContent: Anthropic.Beta.BetaContentBlockParam[]) {
  updateCase(caseId, { busy: 1, questions: null })
  const c = getCase(caseId)
  const messages: Anthropic.Beta.BetaMessageParam[] = [...c.messages, { role: 'user', content: userContent }]
  try {
    for (let turn = 0; turn < 16; turn++) {
      const res = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        ...FALLBACK,
        output_config: { effort: EFFORT },
        system: [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }],
        tools,
        messages
      })
      messages.push({ role: 'assistant', content: res.content as any })
      updateCase(caseId, { messages })

      if (res.stop_reason === 'refusal') {
        logEvent(caseId, 'error', 'The model declined this request', { explanation: res.stop_details?.explanation })
        break
      }
      if (res.stop_reason === 'pause_turn') continue
      const uses = res.content.filter(b => b.type === 'tool_use') as Anthropic.Beta.BetaToolUseBlock[]
      if (!uses.length) {
        const text = res.content.filter(b => b.type === 'text').map(b => (b as any).text).join('\n').trim()
        if (text) {
          updateCase(caseId, { summary: redact(text) })
          logEvent(caseId, 'agent', redact(text))
        }
        break
      }

      let stop = false
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
      for (const u of uses) {
        try {
          const out = await runTool(caseId, u.name, u.input)
          stop ||= Boolean(out.stop)
          results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out.result) })
        } catch (e: any) {
          results.push({ type: 'tool_result', tool_use_id: u.id, content: e.message, is_error: true })
        }
      }
      messages.push({ role: 'user', content: results })
      updateCase(caseId, { messages })
      if (stop) {
        const r = await client.beta.messages.create({
          model: MODEL,
          max_tokens: 2000,
          ...FALLBACK,
          output_config: { effort: 'low' },
          system: [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }],
          tools,
          tool_choice: { type: 'none' },
          messages
        })
        messages.push({ role: 'assistant', content: r.content as any })
        updateCase(caseId, { messages })
        break
      }
    }
  } catch (e: any) {
    logEvent(caseId, 'error', `Agent error: ${e.message}`)
  } finally {
    updateCase(caseId, { busy: 0 })
  }
  return caseView(caseId)
}

const docSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['document_type', 'summary', 'sender', 'key_text', 'amounts', 'dates', 'references', 'links'],
  properties: {
    document_type: { type: 'string', description: 'e.g. lease, termination letter, medical bill, EOB, toll text, tow notice, jury summons, grant summary, bank statement' },
    summary: { type: 'string' },
    sender: { type: 'string' },
    key_text: { type: 'string', description: 'The important text, transcribed. Replace SSNs, card, ID and account numbers with their last 4 digits.' },
    amounts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['label', 'amount'], properties: { label: { type: 'string' }, amount: { type: 'number' } } } },
    dates: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['label', 'date'], properties: { label: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' } } } },
    references: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['label', 'last4'], properties: { label: { type: 'string' }, last4: { type: 'string' } } } },
    links: { type: 'array', items: { type: 'string' } }
  }
}

// Photos and PDFs are read once here and turned into redacted text.
// The image itself is never stored or kept in the case conversation.
export async function extractDocument(caseId: string, files: string[]) {
  const doc = await structured<any>(
    `You transcribe documents for a personal assistant. Today is ${today()}. Record only what is on the page. Never output a full SSN, card, government ID, or account number: last 4 digits only.`,
    [...files.map(imageBlock), { type: 'text', text: 'Extract this document.' }],
    docSchema
  )
  const clean = redactDeep(doc)
  logEvent(caseId, 'extract', `Read ${clean.document_type} from ${clean.sender || 'unknown sender'}`, clean)
  return clean
}

export async function intake(caseId: string, input: { text?: string, files?: string[], source: string }) {
  const parts: string[] = [`Today is ${today()}. Source: ${input.source}.`]
  const profile = getProfile()
  parts.push(`User profile: ${JSON.stringify(redactDeep(profile))}`)
  if (input.files?.length) {
    updateCase(caseId, { busy: 1 })
    try {
      const doc = await extractDocument(caseId, input.files)
      parts.push(`Document (already extracted and redacted):\n${JSON.stringify(doc, null, 2)}`)
    } catch (e: any) {
      logEvent(caseId, 'error', `Could not read the document: ${e.message}`)
      updateCase(caseId, { busy: 0 })
      return
    }
  }
  if (input.text) parts.push(`User said:\n${redact(input.text)}`)
  return runAgent(caseId, [{ type: 'text', text: parts.join('\n\n') }])
}

export async function reply(caseId: string, input: { text?: string, files?: string[] }) {
  const parts: string[] = [`Today is ${today()}.`]
  if (input.files?.length) {
    const doc = await extractDocument(caseId, input.files)
    parts.push(`New document (extracted and redacted):\n${JSON.stringify(doc, null, 2)}`)
  }
  if (input.text) parts.push(`User replied:\n${redact(input.text)}`)
  logEvent(caseId, 'user', input.text ? redact(input.text) : 'Added a document')
  return runAgent(caseId, [{ type: 'text', text: parts.join('\n\n') }])
}
