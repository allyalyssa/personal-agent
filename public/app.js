const view = document.getElementById('view')
let state = null
let route = location.hash.slice(1) || '/'
let lastNotification = Number(sessionStorage.getItem('lastNotification') ?? 0)
let caseTimer = null
let editing = new Set()

const safeUrl = u => /^(https?:|mailto:|sms:|tel:)/i.test(String(u ?? '')) ? u : '#'
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const usd = n => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
const usd2 = n => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const STRINGS = {
  en: {
    open: 'Open', waiting_on_other_party: 'Waiting on them', escalated: 'Escalated', resolved: 'Resolved',
    send_email: 'Email', send_sms: 'Text message', place_call: 'Phone call', create_calendar_event: 'Calendar', prepare_form: 'Form, ready for you to submit', open_url_prefilled: 'Link', schedule_followup: 'Follow-up',
    next_deadline: 'Next deadline', nothing_due: 'Nothing due. Capture anything below.', at_stake: 'Money at stake', recovered: 'Recovered', cases: 'Cases',
    approve: 'Ready for your approval', deadlines: 'Deadlines and check-ins', done: 'Done and in progress', rules: 'Rules and sources', timeline: 'Timeline', add: 'Add to this case',
    needs: 'A few things Handled needs', send_answers: 'Send answers', photo: 'Photo', voice: 'Voice', type: 'Type', handle: 'Handle it', cancel: 'Cancel', send: 'Send',
    intro_title: 'Life in SF comes with rules nobody explains.', intro: 'Tell Handled who you are, in any language. It finds the deadlines, the paperwork and the money, and does the follow-up.', intro_btn: 'Tell Handled about you',
    for_you: 'What it says', i_did_it: 'I did it', what_they_said: 'What did they say? (price, date, reference number)', open_phone: 'Open on your phone', listening: 'Listening...'
  },
  es: {
    open: 'Abierto', waiting_on_other_party: 'Esperando respuesta', escalated: 'Escalado', resolved: 'Resuelto',
    send_email: 'Email', send_sms: 'Mensaje de texto', place_call: 'Llamada', create_calendar_event: 'Calendario', prepare_form: 'Formulario listo para que lo envíes', open_url_prefilled: 'Enlace', schedule_followup: 'Seguimiento',
    next_deadline: 'Próximo plazo', nothing_due: 'Nada pendiente. Captura lo que sea abajo.', at_stake: 'Dinero en juego', recovered: 'Recuperado', cases: 'Casos',
    approve: 'Listo para tu aprobación', deadlines: 'Plazos y seguimientos', done: 'Hecho y en curso', rules: 'Reglas y fuentes', timeline: 'Historial', add: 'Agregar a este caso',
    needs: 'Handled necesita algunos datos', send_answers: 'Enviar respuestas', photo: 'Foto', voice: 'Voz', type: 'Escribir', handle: 'Resuélvelo', cancel: 'Cancelar', send: 'Enviar',
    intro_title: 'Vivir en SF viene con reglas que nadie te explica.', intro: 'Cuéntale a Handled quién eres, en tu idioma. Encuentra los plazos, los trámites y el dinero, y hace el seguimiento.', intro_btn: 'Cuéntale a Handled sobre ti',
    for_you: 'Lo que dice', i_did_it: 'Listo, lo hice', what_they_said: '¿Qué te dijeron? (precio, fecha, número de referencia)', open_phone: 'Abrir en tu teléfono', listening: 'Escuchando...'
  },
  pt: {
    open: 'Aberto', waiting_on_other_party: 'Aguardando resposta', escalated: 'Escalado', resolved: 'Resolvido',
    send_email: 'Email', send_sms: 'Mensagem de texto', place_call: 'Ligação', create_calendar_event: 'Calendário', prepare_form: 'Formulário pronto para você enviar', open_url_prefilled: 'Link', schedule_followup: 'Acompanhamento',
    next_deadline: 'Próximo prazo', nothing_due: 'Nada pendente. Registre qualquer coisa abaixo.', at_stake: 'Dinheiro em jogo', recovered: 'Recuperado', cases: 'Casos',
    approve: 'Pronto para sua aprovação', deadlines: 'Prazos e acompanhamentos', done: 'Feito e em andamento', rules: 'Regras e fontes', timeline: 'Histórico', add: 'Adicionar a este caso',
    needs: 'O Handled precisa de alguns dados', send_answers: 'Enviar respostas', photo: 'Foto', voice: 'Voz', type: 'Escrever', handle: 'Resolver', cancel: 'Cancelar', send: 'Enviar',
    intro_title: 'Morar em SF vem com regras que ninguém explica.', intro: 'Conte ao Handled quem você é, no seu idioma. Ele encontra os prazos, a papelada e o dinheiro, e faz o acompanhamento.', intro_btn: 'Conte ao Handled sobre você',
    for_you: 'O que diz', i_did_it: 'Feito', what_they_said: 'O que disseram? (preço, data, número de referência)', open_phone: 'Abrir no seu telefone', listening: 'Ouvindo...'
  }
}
const SPEECH_LANG = { en: 'en-US', es: 'es-US', pt: 'pt-BR', zh: 'zh-CN', tl: 'fil-PH', vi: 'vi-VN', ru: 'ru-RU' }
const t = key => (STRINGS[state?.profile?.language] ?? STRINGS.en)[key] ?? STRINGS.en[key] ?? key
const STATUS = new Proxy({}, { get: (_, k) => t(k) })
const TOOL = new Proxy({}, { get: (_, k) => t(k) })
const PACK_LABEL = { renter: 'Renter', car: 'Car', work: 'Work', everyday: 'Everyday', care: 'Care', business: 'Business', newcomer: 'Newcomer', city: 'City', food: 'Food', good: 'Good stuff' }

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? res.statusText)
  return data
}

function toast(text) {
  const el = document.createElement('div')
  el.className = 'toast'
  el.textContent = text
  document.getElementById('toasts').append(el)
  setTimeout(() => el.remove(), 6000)
}

function parseDay(s) {
  return new Date(`${String(s).slice(0, 10)}T12:00:00`)
}

function daysFromToday(s) {
  return Math.round((parseDay(s) - parseDay(state?.clock.today ?? new Date().toISOString())) / 86400000)
}

function relDay(s) {
  const d = daysFromToday(s)
  if (d === 0) return 'today'
  if (d === 1) return 'tomorrow'
  if (d === -1) return 'yesterday'
  return d > 0 ? `in ${d} days` : `${-d} days ago`
}

function prettyDate(s) {
  return parseDay(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

function dateBox(s) {
  const d = parseDay(s)
  const n = daysFromToday(s)
  return `<div class="date-box ${n < 0 ? 'past' : n <= 3 ? 'soon' : ''}"><div class="m">${d.toLocaleDateString('en-US', { month: 'short' })}</div><div class="d">${d.getDate()}</div></div>`
}

function go(path) {
  location.hash = path
}

window.addEventListener('hashchange', () => {
  route = location.hash.slice(1) || '/'
  editing = new Set()
  render()
  view.focus()
})

document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go === 'home' ? '/' : `/${b.dataset.go}`)))

async function refreshState() {
  state = await api('/api/state')
  for (const n of [...state.notifications].reverse()) {
    if (n.id > lastNotification) {
      if (lastNotification) toast(n.title)
      lastNotification = n.id
    }
  }
  sessionStorage.setItem('lastNotification', String(lastNotification))
}

// A small customizable character in the corner that explains what is on screen in one line at a time.
const HELPER_DEFAULT = { name: 'Pip', color: '#2bb673', hat: 'sprout', image: null, hidden: false }
let helperTip = 0
let currentCase = null

function helperSettings() {
  try {
    return { ...HELPER_DEFAULT, ...JSON.parse(localStorage.getItem('handledHelper') ?? '{}') }
  } catch {
    return { ...HELPER_DEFAULT }
  }
}

function saveHelper(s) {
  try {
    localStorage.setItem('handledHelper', JSON.stringify(s))
  } catch {}
  drawHelper()
}

const HATS = {
  none: '',
  sprout: '<path d="M32 16 v-8" stroke="#2f7d32" stroke-width="3"/><path d="M32 9 q-9 -6 -13 2 q8 3 13 -2" fill="#4caf50"/><path d="M32 9 q9 -6 13 2 q-8 3 -13 -2" fill="#66bb6a"/>',
  chef: '<rect x="20" y="10" width="24" height="9" rx="2" fill="#fff" stroke="#ccc"/><circle cx="24" cy="9" r="6" fill="#fff" stroke="#ccc"/><circle cx="32" cy="6" r="7" fill="#fff" stroke="#ccc"/><circle cx="40" cy="9" r="6" fill="#fff" stroke="#ccc"/>',
  cap: '<path d="M12 22 q20 -18 40 0 z" fill="#1e5aa8"/><rect x="34" y="19" width="20" height="4" rx="2" fill="#1e5aa8"/>',
  bow: '<path d="M32 18 l-10 -6 v12 z M32 18 l10 -6 v12 z" fill="#e5484d"/><circle cx="32" cy="18" r="3" fill="#b91c1c"/>',
  glasses: '<circle cx="24" cy="34" r="7" fill="none" stroke="#123" stroke-width="2"/><circle cx="40" cy="34" r="7" fill="none" stroke="#123" stroke-width="2"/><path d="M31 34 h2" stroke="#123" stroke-width="2"/>'
}

function helperSvg(s) {
  return `<svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true">
    <ellipse cx="32" cy="40" rx="24" ry="21" fill="${esc(s.color)}"/>
    <ellipse cx="32" cy="48" rx="13" ry="8" fill="#fff" opacity=".25"/>
    <circle cx="24" cy="34" r="4.5" fill="#fff"/><circle cx="40" cy="34" r="4.5" fill="#fff"/>
    <circle cx="25" cy="35" r="2.2" fill="#123"/><circle cx="41" cy="35" r="2.2" fill="#123"/>
    <path d="M26 45 q6 5 12 0" stroke="#123" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    ${HATS[s.hat] ?? ''}
  </svg>`
}

function helperTips() {
  const s = helperSettings()
  const c = route.startsWith('/case/') ? currentCase : null
  if (c?.computed?.targets?.ready) return c.computed.targets.explanation
  if (c) {
    const next = c.actions?.find(a => a.status === 'proposed')
    return [c.summary, next ? `Next: ${next.title}. Nothing goes out until you tap Approve.` : null].filter(Boolean)
  }
  if (route === '/gallery') return ['Pick a playbook and tap "Try with a sample" to see it run on live City data.', 'Eat well near you plans meals from what is on sale within walking distance.']
  if (route === '/settings') return [`You can rename me, change my color and hat, or upload your own picture below.`]
  const d = state?.next_deadline
  return [`Hi, I'm ${s.name}. Snap a notice, or tell me what you want to eat this week.`, d ? `Next up: ${d.title}, ${relDay(d.due_at)}.` : 'Nothing due right now.']
}

function drawHelper(say = false) {
  let el = document.getElementById('helper')
  if (!el) {
    el = document.createElement('div')
    el.id = 'helper'
    el.className = 'helper'
    document.body.appendChild(el)
    el.addEventListener('click', () => {
      helperTip++
      drawHelper(true)
    })
  }
  const s = helperSettings()
  el.hidden = s.hidden
  const tips = helperTips()
  const tip = tips.length ? tips[helperTip % tips.length] : ''
  el.innerHTML = `
    ${say && tip ? `<div class="helper-bubble" role="status"><strong>${esc(s.name)}</strong> ${esc(tip)}</div>` : ''}
    <button class="helper-body" aria-label="${esc(s.name)}, tap for a tip">${s.image ? `<img src="${esc(s.image)}" alt="">` : helperSvg(s)}</button>`
}

async function render() {
  clearTimeout(caseTimer)
  helperTip = 0
  currentCase = null
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', (t.dataset.go === 'home' && (route === '/' || route.startsWith('/case'))) || route === `/${t.dataset.go}`))
  if (!state) await refreshState()
  translateChrome()
  drawHelper(!route.startsWith('/case/'))
  if (route.startsWith('/case/')) return renderCase(route.split('/')[2])
  if (route === '/gallery') return renderGallery()
  if (route === '/settings') return renderSettings()
  return renderHome()
}

function integrationWarning() {
  const i = state.integrations
  const notes = []
  if (!i.claude) notes.push('Keyword mode: no Anthropic key, so Handled matches playbooks by keywords and asks with a form.')
  if (i.free_mode) notes.push('Free mode: Handled drafts every email, text and call script; your phone sends the last tap.')
  if (!notes.length) return ''
  return `<div class="card small" style="background:var(--info-bg);margin-bottom:10px">${notes.map(esc).join('<br>')}</div>`
}

function translateChrome() {
  document.documentElement.lang = state?.profile?.language ?? 'en'
  const caps = document.querySelectorAll('.capture-bar .cap > span:last-child')
  caps[0].textContent = t('photo')
  caps[1].textContent = t('voice')
  caps[2].textContent = t('type')
  document.getElementById('sendText').textContent = t('handle')
  document.getElementById('closeComposer').textContent = t('cancel')
  document.getElementById('cancelVoice').textContent = t('cancel')
  document.getElementById('sendVoice').textContent = t('send')
  document.querySelector('[data-go="home"].tab').textContent = t('cases')
}

function renderHome() {
  const s = state
  const next = s.next_deadline
  const soon = next && daysFromToday(next.due_at) <= 3
  view.innerHTML = `
    ${integrationWarning()}
    ${next ? `
      <button class="banner ${soon ? 'soon' : ''}" data-case="${esc(next.case_id)}">
        <div class="label">${esc(t('next_deadline'))}, ${esc(relDay(next.due_at))}</div>
        <div class="what">${esc(next.title)}</div>
        <div class="small" style="opacity:.85">${esc(prettyDate(next.due_at))} &middot; ${esc(next.case_title)}</div>
      </button>` : `
      <div class="banner"><div class="label">${esc(t('next_deadline'))}</div><div class="what">${esc(t('nothing_due'))}</div></div>`}
    <div class="totals">
      <div class="card total"><div class="muted small">${esc(t('at_stake'))}</div><div class="n">${usd(s.totals.at_stake)}</div></div>
      <div class="card total money"><div class="muted small">${esc(t('recovered'))}</div><div class="n">${usd(s.totals.recovered)}</div></div>
    </div>
    <h2>${esc(t('cases'))} <span class="muted small">${s.totals.open}</span></h2>
    <div class="stack">
      ${s.cases.length ? s.cases.map(caseCard).join('') : `
        <div class="card empty">
          <div class="big">${esc(t('intro_title'))}</div>
          <p class="muted">${esc(t('intro'))}</p>
          <button class="primary" data-onboard>${esc(t('intro_btn'))}</button>
          <p><button class="link" data-go-gallery>${playbookCount ?? ''} playbooks</button></p>
        </div>`}
    </div>`
  view.querySelectorAll('[data-case]').forEach(el => el.addEventListener('click', () => go(`/case/${el.dataset.case}`)))
  view.querySelector('[data-go-gallery]')?.addEventListener('click', () => go('/gallery'))
  view.querySelector('[data-onboard]')?.addEventListener('click', () => startVoice('onboard'))
}

let playbookCount = null
api('/api/playbooks').then(r => {
  playbookCount = r.playbooks.length
})

function caseCard(c) {
  return `
    <button class="card case-card" data-case="${esc(c.id)}">
      <div class="spread">
        <div class="case-title">${esc(c.title)}</div>
        <span class="status ${esc(c.status)}">${esc(STATUS[c.status])}</span>
      </div>
      <div class="row small muted" style="margin-top:6px">
        ${c.pack ? `<span class="chip">${esc(PACK_LABEL[c.pack] ?? c.pack)}</span>` : ''}
        ${c.money_at_stake > 0 ? `<span class="chip money">${usd(c.money_at_stake)} at stake</span>` : ''}
        ${c.money_recovered > 0 ? `<span class="chip money">${usd(c.money_recovered)} recovered</span>` : ''}
        ${c.pending_approvals ? `<span class="chip alert">${c.pending_approvals} to approve</span>` : ''}
        ${c.busy ? `<span class="working"><span class="spinner"></span>working</span>` : ''}
      </div>
      ${c.next_deadline ? `<div class="small" style="margin-top:6px">Next: ${esc(c.next_deadline.title)} &middot; <strong>${esc(relDay(c.next_deadline.due_at))}</strong></div>` : ''}
    </button>`
}

function hasPlaceholder(v) {
  return /\[[a-z_.0-9]+\]/.test(JSON.stringify(v))
}

function markPlaceholders(text) {
  return esc(text).replace(/\[([a-z_.0-9]+)\]/g, '<span class="placeholder">needs $1</span>')
}

function actionBody(a, isEditing) {
  const p = a.payload
  if (a.tool === 'send_email') {
    if (isEditing) return `
      <div class="edit" data-edit="${a.id}">
        <div class="field-label">To</div><input name="to" value="${esc(p.to)}">
        <div class="field-label">Subject</div><input name="subject" value="${esc(p.subject)}">
        <div class="field-label">Body</div><textarea name="body">${esc(p.body)}</textarea>
      </div>`
    return `
      <dl class="kv"><dt>To</dt><dd>${markPlaceholders(p.to)}</dd>${p.cc ? `<dt>Cc</dt><dd>${markPlaceholders(p.cc)}</dd>` : ''}<dt>Subject</dt><dd>${markPlaceholders(p.subject)}</dd></dl>
      <div class="transcript-box" style="margin-top:8px">${markPlaceholders(p.body)}</div>`
  }
  if (a.tool === 'send_sms') {
    if (isEditing) return `<div class="edit" data-edit="${a.id}"><div class="field-label">To</div><input name="to" value="${esc(p.to)}"><div class="field-label">Message</div><textarea name="body" style="min-height:90px">${esc(p.body)}</textarea></div>`
    return `<dl class="kv"><dt>To</dt><dd>${markPlaceholders(p.to)}</dd></dl><div class="transcript-box" style="margin-top:8px">${markPlaceholders(p.body)}</div>`
  }
  if (a.tool === 'place_call') {
    const list = (title, items) => items?.length ? `<div class="field-label">${title}</div><ul class="small" style="margin:0;padding-left:18px">${items.map(i => `<li>${markPlaceholders(i)}</li>`).join('')}</ul>` : ''
    if (isEditing) return `<div class="edit" data-edit="${a.id}"><div class="field-label">Number</div><input name="to" value="${esc(p.to)}"><div class="field-label">Goal</div><textarea name="goal" style="min-height:90px">${esc(p.goal)}</textarea></div>`
    return `
      <dl class="kv"><dt>Calling</dt><dd>${markPlaceholders(p.contact_name)} &middot; ${markPlaceholders(p.to)}</dd></dl>
      <div class="field-label">It will open with</div>
      <div class="transcript-box">"Hi, this is an AI assistant calling on behalf of ${esc(state.profile.name)}. ${markPlaceholders(p.opener)}"</div>
      <div class="field-label">Goal</div><div class="small">${markPlaceholders(p.goal)}</div>
      ${list('Facts it may share', p.facts)}
      ${list('It will never agree to', p.must_not)}
      ${list('It will ask', p.ask)}`
  }
  if (a.tool === 'prepare_form') {
    const fields = Object.entries(p.fields ?? {})
    return `
      <div class="small"><strong>${markPlaceholders(p.form_name)}</strong></div>
      <dl class="kv" style="margin-top:8px">${fields.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${markPlaceholders(typeof v === 'object' ? JSON.stringify(v) : v)} <button class="copy" data-copy="${esc(typeof v === 'object' ? JSON.stringify(v) : v)}">copy</button></dd>`).join('')}</dl>
      ${p.instructions ? `<p class="small muted">${markPlaceholders(p.instructions)}</p>` : ''}
      ${p.official_url ? `<p class="small">Official site: <a href="${esc(safeUrl(p.official_url))}" target="_blank" rel="noopener">${esc(p.official_url)}</a></p>` : ''}`
  }
  if (a.tool === 'open_url_prefilled') return `<p class="small"><a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener">${esc(p.url)}</a>${p.search_for ? `<br>Search for: ${markPlaceholders(p.search_for)}` : ''}${p.bring ? `<br>Bring: ${esc(p.bring)}` : ''}</p>`
  if (a.tool === 'create_calendar_event') return `<p class="small">${markPlaceholders(p.title)} on ${esc(p.date ? prettyDate(p.date) : '')}</p>`
  if (a.tool === 'schedule_followup') return `<p class="small">In ${esc(p.wait)}: ${markPlaceholders(p.check)}</p>`
  return `<pre class="small">${esc(JSON.stringify(p, null, 2))}</pre>`
}

function callResult(a, events) {
  const r = a.result ?? {}
  if (a.status === 'in_progress') {
    const statuses = events.filter(e => e.kind === 'call' && e.detail?.call_id === r.call_id).map(e => e.title.replace('Call ', ''))
    return `<div class="card calling working" style="margin-top:8px"><span class="pulse"></span><div><strong>Call in progress</strong><div class="small">${esc(statuses.at(-1) ?? 'dialing')}</div></div></div>`
  }
  if (!r.outcome) return ''
  const o = r.outcome
  return `
    <div style="margin-top:10px">
      <div class="row"><span class="chip ${o.resolved ? 'verified' : 'unverified'}">${o.resolved ? 'Goal reached' : 'Not resolved'}</span>${r.duration_s ? `<span class="chip">${r.duration_s}s</span>` : ''}</div>
      <p><strong>${esc(o.summary)}</strong></p>
      <dl class="kv">
        ${o.appointment_date ? `<dt>Booked</dt><dd>${esc(prettyDate(o.appointment_date))} ${esc(o.appointment_time ?? '')}</dd>` : ''}
        ${o.price !== null && o.price !== undefined ? `<dt>Price</dt><dd>${usd2(o.price)}</dd>` : ''}
        <dt>Next</dt><dd>${esc(o.next_step)}</dd>
        ${(o.fields ?? []).map(f => `<dt>${esc(f.key)}</dt><dd>${esc(f.value)}</dd>`).join('')}
      </dl>
      ${r.recording_url ? `<p class="small"><a href="${esc(safeUrl(r.recording_url))}" target="_blank" rel="noopener">Recording</a></p>` : ''}
      <details><summary class="small">Transcript</summary><div class="transcript-box">${esc(r.transcript)}</div></details>
    </div>`
}

function actionCard(a, events) {
  const isEditing = editing.has(a.id)
  const blocked = hasPlaceholder(a.payload)
  const proposed = a.status === 'proposed'
  return `
    <div class="card action ${esc(a.status)}" id="action-${a.id}">
      <div class="spread">
        <div>
          <div class="tool">${esc(TOOL[a.tool] ?? a.tool)}${a.due_at ? ` &middot; ${esc(relDay(a.due_at))}` : ''}</div>
          <div class="case-title">${esc(a.title)}</div>
        </div>
        ${!proposed ? `<span class="chip ${a.status === 'done' ? 'verified' : a.status === 'failed' ? 'alert' : ''}">${esc(a.status.replace('_', ' '))}</span>` : ''}
      </div>
      ${a.payload.for_you ? `<div class="small" style="margin-top:8px;padding:8px 10px;border-radius:10px;background:var(--info-bg)"><strong>${esc(t('for_you'))}:</strong> ${esc(a.payload.for_you)}</div>` : ''}
      <div style="margin-top:8px">${actionBody(a, isEditing)}</div>
      ${a.status === 'failed' && a.result?.error ? `<p class="small" style="color:var(--danger)">${esc(a.result.error)}</p>` : ''}
      ${a.status === 'handoff' ? `
        <div class="stack" style="margin-top:10px">
          <a class="primary" style="display:block;text-align:center;text-decoration:none" href="${esc(safeUrl(a.result.url))}">${esc(t('open_phone'))}</a>
          ${a.tool === 'place_call' ? `<textarea data-notes="${a.id}" rows="3" placeholder="${esc(t('what_they_said'))}" style="width:100%;border:1px solid var(--line);border-radius:10px;background:var(--bg);padding:10px"></textarea>` : ''}
          <button class="ghost" data-complete="${a.id}">${esc(t('i_did_it'))}</button>
        </div>` : ''}
      ${a.tool === 'place_call' ? callResult(a, events) : ''}
      ${a.tool === 'open_url_prefilled' && a.status === 'done' ? `<p class="small"><a href="${esc(safeUrl(a.result.url))}" target="_blank" rel="noopener">Open</a></p>` : ''}
      ${proposed ? `
        ${blocked && !isEditing ? `<p class="small" style="color:var(--warn)">Fill in the highlighted parts before approving.</p>` : ''}
        <div class="row" style="margin-top:10px">
          <button class="primary" data-approve="${a.id}" ${blocked && !isEditing ? 'disabled' : ''}>${a.tool === 'place_call' ? 'Approve and call' : a.tool === 'send_email' || a.tool === 'send_sms' ? 'Approve and send' : 'Approve'}</button>
          ${['send_email', 'send_sms', 'place_call'].includes(a.tool) ? `<button class="ghost" data-edit-btn="${a.id}">${isEditing ? 'Cancel edit' : 'Edit'}</button>` : ''}
          <button class="ghost" data-reject="${a.id}">Skip</button>
        </div>` : ''}
    </div>`
}

function eventLine(e) {
  const d = new Date(e.at)
  const extra = e.kind === 'data' && e.detail?.sources ? ` <a class="small" href="${esc(safeUrl(e.detail.sources.at(-1)))}" target="_blank" rel="noopener">data</a>` : ''
  return `<li class="${esc(e.kind)}"><div class="small">${esc(e.title)}${extra}</div><div class="tiny muted">${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div></li>`
}

const MEAL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' }

function foodCard(c) {
  const tg = c.computed.targets
  const p = c.computed.plan
  const near = c.fields.nearby
  if (!tg.ready) return `<div class="card" style="margin-top:10px"><div class="small">${esc(tg.reason ?? `Handled needs your ${tg.missing.join(', ')} to work out your targets.`)}</div></div>`
  const macro = [tg.protein ? `Protein ${tg.protein.target} g` : null, tg.carbs_g ? `Carbs ${tg.carbs_g} g` : null, tg.fat_g ? `Fat ${tg.fat_g} g` : null, `Fiber ${tg.needs.fiber} g`, `Water about ${tg.water_l} L`].filter(Boolean)
  return `
    <div class="card food" style="margin-top:10px">
      <div class="muted small">What your body needs</div>
      <div class="headline-money">${esc(tg.headline)}</div>
      <div class="row small" style="margin:6px 0">${macro.map(m => `<span class="chip">${esc(m)}</span>`).join('')}</div>
      <ul class="small explain">${tg.explanation.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
      ${tg.conditions.map(n => `<div class="small note"><strong>${esc(n.label)}.</strong> ${esc(n.note)} <span class="muted">Confirm with ${esc(n.confirm_with)}. <a href="${esc(safeUrl(n.source_url))}" target="_blank" rel="noopener">Source</a></span></div>`).join('')}
      ${tg.assumptions.length ? `<div class="tiny muted">${tg.assumptions.map(esc).join(' ')}</div>` : ''}
      <details style="margin-top:8px"><summary class="small"><strong>Every nutrient, and how to get it</strong></summary>
        <table class="nutrients small">${tg.nutrients.map(n => `<tr class="${n.priority ? 'priority' : ''}"><th>${esc(n.name)}</th><td>${esc(n.amount)} ${esc(n.unit)}</td><td>${esc(n.how)} <span class="muted">From: ${esc(n.foods)}.</span></td></tr>`).join('')}</table>
        <p class="tiny muted">${esc(tg.formula)} x ${esc(tg.activity_factor)} activity. Sodium under ${esc(tg.sodium_limit_mg)} mg. Information with sources, not medical advice.</p>
      </details>
    </div>
    ${p?.ready ? `
    <h2>Today's meals</h2>
    <div class="stack">${p.meals.map(m => `
      <div class="card meal">
        <div class="spread"><strong>${esc(MEAL[m.meal])}</strong><span class="muted small">${esc(m.time)}</span></div>
        ${m.items.map(i => {
          const deal = p.shopping.find(s => s.id === i.id)?.deal
          return `<div class="meal-item">
            <div class="small"><strong>${esc(i.servings)} x</strong> ${esc(i.name)} <span class="muted">(${esc(i.serving)})</span>${deal ? ` <span class="chip money">${esc(deal.price_text)} at ${esc(deal.store)}${deal.walk_minutes != null ? `, ${esc(deal.walk_minutes)} min walk` : ''}</span>` : ''}</div>
            <div class="row"><button class="link small" data-food="${esc(i.id)}" data-like="1">Like</button><button class="link small" data-food="${esc(i.id)}" data-like="0">Swap</button></div>
          </div>`
        }).join('')}
      </div>`).join('')}
    </div>
    ${p.pairs.length ? `<div class="card small" style="margin-top:10px"><strong>Paired for absorption:</strong> ${p.pairs.map(esc).join('; ')}.</div>` : ''}
    <div class="card" style="margin-top:10px">
      <div class="small"><strong>How this day covers you</strong></div>
      ${p.coverage.filter(x => x.need).map(x => `<div class="bar-row small"><span>${esc(x.name)}</span><div class="bar"><div style="width:${Math.min(100, x.percent)}%;background:${x.percent >= 80 ? 'var(--money)' : 'var(--warn)'}"></div></div><span class="muted">${esc(x.have)}/${esc(x.need)} ${esc(x.unit)}</span></div>`).join('')}
      ${p.gaps.map(g => `<div class="tiny" style="color:var(--warn)">${esc(g.name)} is short. ${esc(g.tip)}</div>`).join('')}
    </div>
    <h2>Shopping near ${esc(near?.address ?? c.fields.food_area ?? 'you')}</h2>
    <div class="card small">
      ${p.shopping.map(s => `<div class="spread shop"><span>${esc(s.name)}</span><span>${s.deal ? `<span class="money">${esc(s.deal.price_text)}</span> ${esc(s.deal.store)}${s.deal.walk_minutes != null ? ` (${esc(s.deal.walk_minutes)} min)` : ''}${s.deal.valid_to ? ` <span class="muted tiny">until ${esc(prettyDate(s.deal.valid_to.slice(0, 10)))}</span>` : ''}` : '<span class="muted">regular price</span>'}${s.order_url ? ` <a href="${esc(safeUrl(s.order_url))}" target="_blank" rel="noopener">order</a>` : ''}</span></div>`).join('')}
      ${near?.stores?.length ? `<p class="tiny muted">Within ${esc(near.walk_minutes)} min: ${near.stores.slice(0, 6).map(s => `${esc(s.name)} (${esc(s.walk_minutes)} min)`).join(', ')}.</p>` : ''}
      ${near?.markets?.length ? `<p class="tiny">Farmers markets nearby: ${near.markets.map(m => `${esc(m.name)} (${esc(m.walk_minutes)} min)`).join(', ')}. Many take CalFresh and add Market Match money for produce.</p>` : ''}
      ${near?.map_error ? `<p class="tiny" style="color:var(--warn)">Map data was unavailable, so walk times are missing; deals are for your ZIP code.</p>` : ''}
      <p class="tiny muted">${esc(p.note)} ${esc(near?.note ?? '')}</p>
    </div>` : ''}`
}

function computedHeadline(c) {
  if (c.computed?.targets) return foodCard(c)
  const i = c.computed?.interest
  if (i) return `
    <div class="card" style="margin-top:10px">
      <div class="muted small">Your landlord owes you</div>
      <div class="headline-money">${usd2(i.total_owed)}</div>
      <ul class="small" style="padding-left:18px;margin:6px 0">${i.years.map(y => `<li>${esc(y.math)}</li>`).join('')}</ul>
      <div class="small muted">Next payment: ${usd2(i.next_payment.interest)} due ${esc(prettyDate(i.next_payment.due_date))}. Rates: <a href="${esc(safeUrl(i.source_url))}" target="_blank" rel="noopener">SF Rent Board</a>, checked ${esc(i.last_verified)}.</div>
      ${i.years_needing_confirmation.length ? `<div class="small" style="color:var(--warn)">Not counted (rate not verified): ${esc(i.years_needing_confirmation.join('; '))}. Ask the Rent Board.</div>` : ''}
    </div>`
  const chk = c.computed?.check
  if (chk) return `
    <div class="card" style="margin-top:10px">
      <div class="muted small">Increase asked vs allowed</div>
      <div class="headline-money" style="color:${chk.overcharge_per_month ? 'var(--danger)' : 'var(--money)'}">${chk.increase_percent}% vs ${chk.max_percent_with_banking ?? '?'}%</div>
      <div class="small">${esc(chk.math ?? '')}</div>
      <div class="small muted">${esc(chk.coverage_basis)}</div>
    </div>`
  const v = c.computed?.verdict
  if (v) return `
    <div class="card" style="margin-top:10px">
      <div class="muted small">Verdict</div>
      <div class="headline-money" style="color:${v.verdict === 'likely scam' ? 'var(--danger)' : v.verdict === 'likely real' ? 'var(--money)' : 'var(--warn)'}">${esc(v.verdict)}</div>
      <div class="small">${v.links.map(l => `${esc(l.host)}: ${l.official ? 'official domain' : 'not an official domain'}`).join('<br>')}</div>
      <div class="small muted">${esc(v.advice)}</div>
    </div>`
  const b = c.computed?.compare
  if (b) return `
    <div class="card" style="margin-top:10px">
      <div class="muted small">Possible overbilling</div>
      <div class="headline-money">${usd2(b.disputed_amount)}</div>
      <div class="small">${esc(b.math ?? '')}${b.duplicate_lines.length ? `<br>Duplicate: ${b.duplicate_lines.map(l => `${esc(l.description)} ${usd2(l.amount)}`).join(', ')}` : ''}</div>
    </div>`
  return ''
}

async function renderCase(id, auto = false) {
  let c
  try {
    c = await api(`/api/cases/${id}`)
  } catch {
    view.innerHTML = `<p>Case not found. <button class="link" onclick="location.hash='/'">Back</button></p>`
    return
  }
  if (route !== `/case/${id}`) return
  const firstLook = currentCase?.id !== c.id || (!currentCase?.computed?.targets && c.computed?.targets)
  currentCase = c
  if (firstLook) drawHelper(true)
  const typing =document.activeElement?.closest?.('.edit, .questions, #caseReply')
  if (typing || (editing.size && auto)) {
    caseTimer = setTimeout(() => renderCase(id, true), 2000)
    return
  }
  const proposed = c.actions.filter(a => a.status === 'proposed')
  const other = c.actions.filter(a => a.status !== 'proposed')
  const upcoming = c.deadlines.filter(d => !d.done && d.kind !== 'meal')
  const meals = c.deadlines.filter(d => d.kind === 'meal').length
  view.innerHTML = `
    <button class="back" onclick="location.hash='/'">&larr; Cases</button>
    <div class="spread">
      <h1>${esc(c.title)}</h1>
      <span class="status ${esc(c.status)}">${esc(STATUS[c.status])}</span>
    </div>
    <div class="row small muted" style="margin-top:6px">
      ${c.playbook_title ? `<span class="chip">${esc(c.playbook_title)}</span>` : ''}
      ${c.money_at_stake > 0 ? `<span class="chip money">${usd2(c.money_at_stake)} at stake</span>` : ''}
      ${c.money_recovered > 0 ? `<span class="chip money">${usd2(c.money_recovered)} recovered</span>` : ''}
    </div>
    ${c.busy ? `<div class="card working" style="margin-top:12px"><span class="spinner"></span><span>${esc(c.events.at(-1)?.title ?? 'Reading')}...</span></div>` : ''}
    ${computedHeadline(c)}
    ${c.summary ? `<div class="card summary" style="margin-top:10px">${esc(c.summary)}</div>` : ''}
    ${c.questions?.length && !c.busy ? `
      <div class="card questions" style="margin-top:10px">
        <strong>${esc(t('needs'))}</strong>
        ${c.questions.map((q, i) => `<div class="field-label">${esc(q.question)}</div><input data-q="${i}" data-field="${esc(q.field)}">`).join('')}
        <div class="row" style="margin-top:10px"><button class="primary" id="answer">${esc(t('send_answers'))}</button></div>
      </div>` : ''}
    ${proposed.length ? `<h2>${esc(t('approve'))} <span class="muted small">${proposed.length}</span></h2><div class="stack">${proposed.map(a => actionCard(a, c.events)).join('')}</div>` : ''}
    ${upcoming.length ? `
      <h2>${esc(t('deadlines'))}</h2>
      <div class="card">${upcoming.map(d => `
        <div class="deadline">${dateBox(d.due_at)}
          <div>
            <div class="small"><strong>${esc(d.title)}</strong> <span class="muted">${esc(relDay(d.due_at))}</span></div>
            ${d.rule_id ? `<span class="chip ${c.rules.find(r => r.id === d.rule_id)?.status ?? ''}">${esc(c.rules.find(r => r.id === d.rule_id)?.status ?? '')}</span>` : d.kind === 'checkin' ? '<span class="chip">automatic check-in</span>' : d.kind === 'event' ? '<span class="chip">calendar</span>' : ''}
            ${d.note ? `<div class="tiny muted" style="margin-top:3px">${esc(d.note)}</div>` : ''}
          </div>
        </div>`).join('')}
        ${meals ? `<p class="small">${meals} meal times are on your calendar.</p>` : ''}
        <p class="small"><a href="/api/cases/${esc(c.id)}/calendar.ics">Add to calendar</a></p>
      </div>` : ''}
    ${other.length ? `<h2>${esc(t('done'))}</h2><div class="stack">${other.slice().reverse().map(a => actionCard(a, c.events)).join('')}</div>` : ''}
    ${c.rules.length ? `
      <h2>${esc(t('rules'))}</h2>
      <div class="stack">${c.rules.map(r => `
        <details class="card"><summary class="small"><strong>${esc(r.title)}</strong> <span class="chip ${esc(r.status)}">${esc(r.status)}${r.last_verified ? ` ${esc(r.last_verified)}` : ''}</span></summary>
          <p class="small">${esc(r.rule)}</p>
          <p class="small muted">Source: <a href="${esc(safeUrl(r.source_url))}" target="_blank" rel="noopener">${esc(r.source_url)}</a><br>Confirm with: ${esc(r.confirm_with)}${r.notes ? `<br>${esc(r.notes)}` : ''}</p>
          <p class="tiny muted">Information with sources, not legal, tax, immigration or medical advice.</p>
        </details>`).join('')}</div>` : ''}
    <h2>${esc(t('timeline'))}</h2>
    <div class="card"><ul class="timeline">${c.events.map(eventLine).join('')}</ul>
      ${c.jobs.length ? `<p class="small muted">Scheduled: ${c.jobs.map(j => `${esc(j.kind)} ${esc(relDay(j.run_at))}`).join(', ')}</p>` : ''}
    </div>
    <h2>${esc(t('add'))}</h2>
    <div class="card">
      <textarea id="caseReply" rows="2" placeholder="Reply, correct a detail, or say what happened (e.g. they paid)" style="width:100%;border:1px solid var(--line);border-radius:10px;background:var(--bg);padding:10px"></textarea>
      <div class="row" style="margin-top:8px;justify-content:space-between">
        <button class="ghost" id="resolve">${c.status === 'resolved' ? 'Resolved' : 'Mark resolved'}</button>
        <button class="primary" id="sendReply">${esc(t('send'))}</button>
      </div>
    </div>`

  view.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', async () => {
    const aid = Number(b.dataset.approve)
    const editEl = view.querySelector(`[data-edit="${aid}"]`)
    const payload = editEl ? Object.fromEntries([...editEl.querySelectorAll('[name]')].map(i => [i.name, i.value])) : undefined
    if (payload && hasPlaceholder(payload)) return toast('Fill in the highlighted parts first.')
    b.disabled = true
    b.textContent = 'Working...'
    const r = await api(`/api/actions/${aid}/approve`, { payload })
    editing.delete(aid)
    toast(r.ok ? 'Done.' : `Failed: ${r.error}`)
    renderCase(id)
  }))
  view.querySelectorAll('[data-complete]').forEach(b => b.addEventListener('click', async () => {
    const aid = b.dataset.complete
    const notes = view.querySelector(`[data-notes="${aid}"]`)?.value.trim()
    b.disabled = true
    await api(`/api/actions/${aid}/complete`, { notes: notes || undefined })
    renderCase(id)
  }))
  view.querySelectorAll('[data-reject]').forEach(b => b.addEventListener('click', async () => {
    await api(`/api/actions/${b.dataset.reject}/reject`, {})
    renderCase(id)
  }))
  view.querySelectorAll('[data-edit-btn]').forEach(b => b.addEventListener('click', () => {
    const aid = Number(b.dataset.editBtn)
    if (editing.has(aid)) editing.delete(aid)
    else editing.add(aid)
    renderCase(id)
  }))
  view.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => {
    navigator.clipboard.writeText(b.dataset.copy)
    toast('Copied')
  }))
  view.querySelectorAll('[data-food]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true
    await api(`/api/cases/${id}/food`, { food: b.dataset.food, like: b.dataset.like === '1' })
    toast(b.dataset.like === '1' ? 'Got it. Handled will pick it more often.' : 'Swapped. Handled will skip it from now on.')
    renderCase(id)
  }))
  view.querySelector('#answer')?.addEventListener('click', async () => {
    const answers = Object.fromEntries([...view.querySelectorAll('[data-q]')].filter(i => i.value.trim()).map(i => [i.dataset.field, i.value.trim()]))
    if (!Object.keys(answers).length) return
    await api(`/api/cases/${id}/reply`, { answers })
    renderCase(id)
  })
  view.querySelector('#sendReply').addEventListener('click', async () => {
    const text = view.querySelector('#caseReply').value.trim()
    if (!text) return
    await api(`/api/cases/${id}/reply`, { text })
    renderCase(id)
  })
  view.querySelector('#resolve').addEventListener('click', async () => {
    const amount = c.money_at_stake > 0 ? prompt(`How much did you recover? (at stake: ${usd2(c.money_at_stake)})`, String(c.money_at_stake)) : '0'
    if (amount === null) return
    await api(`/api/cases/${id}/resolve`, { recovered: Number(amount) })
    await refreshState()
    renderCase(id)
  })

  const live = c.busy || c.actions.some(a => a.status === 'in_progress' || a.status === 'running')
  caseTimer = setTimeout(() => renderCase(id, true), live ? 1500 : 5000)
}

let galleryPack = sessionStorage.getItem('galleryPack') ?? 'all'

async function renderGallery() {
  const { packs, playbooks } = await api('/api/playbooks')
  const shown = playbooks.filter(p => galleryPack === 'all' ? p.featured : galleryPack === 'more' ? !p.featured : p.pack === galleryPack)
  const order = Object.keys(packs)
  shown.sort((a, b) => order.indexOf(a.pack) - order.indexOf(b.pack) || (a.depth === 'deep' ? -1 : 1))
  view.innerHTML = `
    <h1>Playbooks</h1>
    <p class="muted small">Each one is a declarative file: triggers, required fields, rules with sources, actions with deadlines, and follow-ups. One engine runs them all.</p>
    <div class="gallery-scroll" role="tablist">
      <button class="chip ${galleryPack === 'all' ? 'on' : ''}" data-pack="all">Featured ${playbooks.filter(p => p.featured).length}</button>
      <button class="chip ${galleryPack === 'more' ? 'on' : ''}" data-pack="more">More ${playbooks.filter(p => !p.featured).length}</button>
      ${order.map(k => `<button class="chip ${galleryPack === k ? 'on' : ''}" data-pack="${esc(k)}">${esc(packs[k])} ${playbooks.filter(p => p.pack === k).length}</button>`).join('')}
    </div>
    <div class="pack-grid" style="margin-top:12px">
      ${shown.map(p => `
        <div class="card pb-card">
          <div class="row"><span class="chip">${esc(packs[p.pack])}</span>${p.depth === 'deep' ? '<span class="chip verified">deep</span>' : ''}</div>
          <strong>${esc(p.title)}</strong>
          <p>${esc(p.pitch)}</p>
          <div class="tiny muted">${[...new Set(p.actions)].map(t => TOOL[t] ?? t).join(' &middot; ')}</div>
          <button class="ghost" data-try="${esc(p.id)}">Try with a sample</button>
        </div>`).join('')}
    </div>`
  view.querySelectorAll('[data-pack]').forEach(b => b.addEventListener('click', () => {
    galleryPack = b.dataset.pack
    sessionStorage.setItem('galleryPack', galleryPack)
    renderGallery()
  }))
  view.querySelectorAll('[data-try]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true
    const { case_id } = await api(`/api/playbooks/${b.dataset.try}/try`, {})
    await refreshState()
    go(`/case/${case_id}`)
  }))
}

async function renderSettings() {
  const [profile, personas, civic, evals] = await Promise.all([api('/api/profile'), api('/api/personas'), api('/api/civic'), api('/api/eval')])
  const i = state.integrations
  const cal = `${location.origin}/calendar.ics`
  view.innerHTML = `
    <h1>Settings</h1>
    <h2>Time</h2>
    <div class="card stack">
      <div class="spread"><span>Handled's clock</span><strong class="clock-pill">${esc(prettyDate(state.clock.today))}${state.clock.offset_days ? ` (+${state.clock.offset_days} days)` : ''}</strong></div>
      <div class="ff">
        <button class="ghost" data-ff="1">+1 day</button>
        <button class="ghost" data-ff="3">+3 days</button>
        <button class="ghost" data-ff="7">+7 days</button>
        <button class="ghost" data-ff="15">+15 days</button>
      </div>
      <p class="small muted">Fast-forward moves the clock and runs any reminders and check-ins that come due, so escalations fire right now.</p>
      <button class="ghost" id="resetClock">Back to real time</button>
    </div>
    <h2>Calendar</h2>
    <div class="card small">Subscribe your phone calendar to <a href="${esc(cal)}">${esc(cal)}</a>. Every deadline, check-in and booking shows up there.</div>
    <h2>Connections</h2>
    <div class="card small">
      Claude: ${i.claude ? 'connected' : 'not set'}<br>
      Email (Resend): ${i.email ? 'connected' : 'not set'}<br>
      Texts (Twilio): ${i.sms ? 'connected' : 'not set'}<br>
      Calls (Vapi): ${i.calls ? 'connected' : 'not set'}<br>
      Forward email or webhook notes to <code>POST ${esc(location.origin)}/api/inbound</code>
    </div>
    <h2>Who is using Handled</h2>
    <div class="card stack">
      <div class="row">${personas.map(p => `<button class="ghost" data-persona="${esc(p.id)}">${esc(p.name)} <span class="muted small">${esc(p.language)}</span></button>`).join('')}</div>
      <p class="small muted">${personas.map(p => `${esc(p.name)}: ${esc(p.persona)}`).join('<br>')}</p>
      <label class="row small"><input type="checkbox" id="fresh" checked> Start with no cases (for a clean demo)</label>
      <div class="row small">Language
        <select id="lang">${Object.entries({ en: 'English', es: 'Español', pt: 'Português', zh: '中文', tl: 'Filipino', vi: 'Tiếng Việt', ru: 'Русский' }).map(([k, v]) => `<option value="${k}" ${profile.language === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </div>
    </div>
    <h2>Your helper</h2>
    <div class="card stack small">
      <div class="row"><span id="helperPreview">${helperSettings().image ? `<img src="${esc(helperSettings().image)}" alt="" width="56" height="56" style="object-fit:contain">` : helperSvg(helperSettings())}</span>
        <label>Name <input id="helperName" value="${esc(helperSettings().name)}" maxlength="20" style="width:8em"></label>
        <label>Color <input id="helperColor" type="color" value="${esc(helperSettings().color)}"></label>
        <label>Hat <select id="helperHat">${Object.keys(HATS).map(h => `<option ${helperSettings().hat === h ? 'selected' : ''}>${h}</option>`).join('')}</select></label>
      </div>
      <div class="row">
        <label class="ghost button-like">Use my own picture (PNG) <input id="helperImage" type="file" accept="image/png,image/*" hidden></label>
        ${helperSettings().image ? '<button class="ghost" id="helperClear">Back to the drawing</button>' : ''}
        <label class="row"><input type="checkbox" id="helperHidden" ${helperSettings().hidden ? 'checked' : ''}> Hide</label>
      </div>
    </div>
    <h2>What Handled knows about you</h2>
    <div class="card small">
      ${Object.keys(profile.memory ?? {}).length ? `<dl class="kv">${Object.entries(profile.memory).map(([k, m]) => `<dt>${esc(k.replace(/_/g, ' '))}</dt><dd>${esc(typeof m.value === 'object' ? JSON.stringify(m.value) : m.value)} <span class="tiny muted">from ${esc(m.from)}, ${esc(m.at)}</span></dd>`).join('')}</dl>` : '<span class="muted">Nothing learned yet. Every answer you give is kept here, so no playbook asks twice.</span>'}
    </div>
    <h2>Give back to the City</h2>
    <div class="card small stack">
      <p>Handled can share what it sees with the City: which obligations people hit, and which steps still need a person because there is no online path. Counts only, never names or addresses.</p>
      <dl class="kv">
        <dt>Obligations handled</dt><dd>${civic.obligations.map(o => `${esc(o.playbook)} (${o.n})`).join(', ') || 'none yet'}</dd>
        <dt>No online path</dt><dd>${civic.steps_with_no_online_path.map(s => `${esc(s.host)} (${s.count})`).join(', ') || 'none yet'}</dd>
        <dt>311 reports</dt><dd>${civic.reports_311.prepared} prepared, ${civic.reports_311.closed_by_city} closed by the City</dd>
      </dl>
      <a href="/api/civic" download="handled-civic-report.json">Download the anonymous report</a>
    </div>
    <h2>How well it works</h2>
    <div class="card small">
      ${evals.routing_keyword_mode ? `<dl class="kv">
        <dt>Routing, keyword mode</dt><dd>${esc(evals.routing_keyword_mode.total)} (${Object.entries(evals.routing_keyword_mode.by_language).map(([k, v]) => `${esc(k)} ${esc(v)}`).join(', ')})</dd>
        <dt>Routing, Claude</dt><dd>${typeof evals.routing_claude === 'string' ? esc(evals.routing_claude) : `${esc(evals.routing_claude.total)} (${Object.entries(evals.routing_claude.by_language).map(([k, v]) => `${esc(k)} ${esc(v)}`).join(', ')})`}</dd>
        <dt>Sweeping check vs real City tickets</dt><dd>${evals.sweeping_rule_vs_city_tickets.schedule_matches}/${evals.sweeping_rule_vs_city_tickets.tickets_checked} agree</dd>
      </dl><p class="tiny muted">Run ${esc(evals.run_at.slice(0, 16).replace('T', ' '))} UTC with npm run eval.</p>` : esc(evals.note)}
    </div>
    <h2>Your profile</h2>
    <div class="card settings">
      <p class="small muted">Handled fills forms from this. Never put SSNs, card numbers or full ID numbers here.</p>
      <textarea id="profile" rows="16" spellcheck="false" style="font-family:ui-monospace,monospace;font-size:.8rem">${esc(JSON.stringify(profile, null, 2))}</textarea>
      <div class="row" style="margin-top:8px;justify-content:flex-end"><button class="primary" id="saveProfile">Save</button></div>
    </div>`
  view.querySelectorAll('[data-ff]').forEach(b => b.addEventListener('click', async () => {
    const r = await api('/api/clock/advance', { days: Number(b.dataset.ff) })
    await refreshState()
    toast(r.fired ? `${r.fired} scheduled ${r.fired === 1 ? 'item' : 'items'} fired` : 'Nothing due yet')
    renderSettings()
  }))
  view.querySelectorAll('[data-persona]').forEach(b => b.addEventListener('click', async () => {
    await api(`/api/personas/${b.dataset.persona}`, { fresh: view.querySelector('#fresh').checked })
    state = null
    await refreshState()
    translateChrome()
    toast(`Now using Handled as ${state.profile.name}`)
    renderSettings()
  }))
  view.querySelector('#lang').addEventListener('change', async e => {
    await api('/api/profile', { ...profile, language: e.target.value })
    await refreshState()
    translateChrome()
    renderSettings()
  })
  const helperChange = patch => {
    saveHelper({ ...helperSettings(), ...patch })
    renderSettings()
  }
  view.querySelector('#helperName').addEventListener('change', e => helperChange({ name: e.target.value.trim() || 'Pip' }))
  view.querySelector('#helperColor').addEventListener('change', e => helperChange({ color: e.target.value }))
  view.querySelector('#helperHat').addEventListener('change', e => helperChange({ hat: e.target.value }))
  view.querySelector('#helperHidden').addEventListener('change', e => helperChange({ hidden: e.target.checked }))
  view.querySelector('#helperClear')?.addEventListener('click', () => helperChange({ image: null }))
  view.querySelector('#helperImage').addEventListener('change', e => {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 400000) return toast('Pick a picture under 400 KB.')
    const reader = new FileReader()
    reader.onload = () => helperChange({ image: reader.result })
    reader.readAsDataURL(file)
  })
  view.querySelector('#resetClock').addEventListener('click', async () => {
    await api('/api/clock/reset', {})
    await refreshState()
    renderSettings()
  })
  view.querySelector('#saveProfile').addEventListener('click', async () => {
    try {
      await api('/api/profile', JSON.parse(view.querySelector('#profile').value))
      toast('Profile saved')
    } catch (e) {
      toast(`Could not save: ${e.message}`)
    }
  })
}

const composer = document.getElementById('composer')
const listening = document.getElementById('listening')
const textEl = document.getElementById('text')
let files = []

function shrink(file) {
  return new Promise(resolve => {
    const reader = new FileReader()
    reader.onload = () => {
      if (!file.type.startsWith('image/')) return resolve(reader.result)
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, 1600 / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

function showAttachments() {
  document.getElementById('attachments').innerHTML = files.map(f => f.startsWith('data:image') ? `<img src="${f}" alt="attached photo">` : '<span class="chip">PDF</span>').join('')
}

async function submit(payload) {
  const { case_id } = await api('/api/intake', payload)
  composer.hidden = true
  listening.hidden = true
  textEl.value = ''
  files = []
  showAttachments()
  await refreshState()
  go(`/case/${case_id}`)
}

document.getElementById('photo').addEventListener('change', async e => {
  files = await Promise.all([...e.target.files].map(shrink))
  e.target.value = ''
  showAttachments()
  composer.hidden = false
  textEl.placeholder = 'Anything to add? (optional)'
  textEl.focus()
})

document.getElementById('type').addEventListener('click', () => {
  composer.hidden = !composer.hidden
  listening.hidden = true
  if (!composer.hidden) textEl.focus()
})

document.getElementById('closeComposer').addEventListener('click', () => {
  composer.hidden = true
  files = []
  showAttachments()
})

document.getElementById('sendText').addEventListener('click', () => {
  const text = textEl.value.trim()
  if (!text && !files.length) return
  if (composer.dataset.mode === 'onboard') {
    composer.dataset.mode = ''
    textEl.value = ''
    return onboard(text)
  }
  submit({ text, files, source: files.length ? 'photo' : 'typed or pasted text' })
})

const Speech = window.SpeechRecognition ?? window.webkitSpeechRecognition
let recognizer = null
let heard = ''

let voiceMode = 'capture'

function startVoice(mode = 'capture') {
  voiceMode = mode
  if (!Speech) {
    toast('Voice needs Chrome or Safari. Type instead.')
    composer.hidden = false
    composer.dataset.mode = mode
    textEl.focus()
    return
  }
  composer.hidden = true
  listening.hidden = false
  heard = ''
  document.getElementById('transcript').textContent = t('listening')
  recognizer = new Speech()
  recognizer.lang = SPEECH_LANG[state?.profile?.language] ?? 'en-US'
  recognizer.continuous = true
  recognizer.interimResults = true
  recognizer.onresult = e => {
    let final = ''
    let interim = ''
    for (const r of e.results) {
      if (r.isFinal) final += r[0].transcript
      else interim += r[0].transcript
    }
    heard = final + interim
    document.getElementById('transcript').textContent = heard || t('listening')
  }
  recognizer.start()
}

document.getElementById('voice').addEventListener('click', () => startVoice('capture'))

document.getElementById('cancelVoice').addEventListener('click', () => {
  recognizer?.abort()
  listening.hidden = true
})

document.getElementById('sendVoice').addEventListener('click', () => {
  recognizer?.stop()
  const text = heard.trim()
  if (!text) {
    listening.hidden = true
    return
  }
  if (voiceMode === 'onboard') onboard(text)
  else submit({ text: `Voice note: "${text}"`, source: 'voice note' })
})

async function onboard(text) {
  listening.hidden = true
  composer.hidden = true
  const { case_id } = await api('/api/onboard', { text })
  await refreshState()
  go(`/case/${case_id}`)
}

setInterval(async () => {
  await refreshState()
  if (route === '/') renderHome()
}, 4000)

render()
