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
    send_email: 'Email', send_sms: 'Text message', place_call: 'Phone call', create_calendar_event: 'Calendar', prepare_form: 'Form, ready for you to submit', open_url_prefilled: 'Website', schedule_followup: 'Follow-up',
    next_deadline: 'Next up', nothing_due: 'Nothing due. Snap a photo, talk or type below.', at_stake: 'Money involved', recovered: 'Recovered', cases: 'Home', your_list: 'Your list',
    approve: 'Waiting for your OK', deadlines: 'Dates and check-ins', done: 'Done and in progress', rules: 'Sources', timeline: 'Activity', add: 'Add an update',
    needs: 'Handled needs a few details', send_answers: 'Continue', photo: 'Photo', voice: 'Voice', type: 'Type', handle: 'Handle it', cancel: 'Cancel', send: 'Send',
    intro_title: 'Life in SF comes with rules nobody explains.', intro: 'Tell Handled who you are, in any language. It finds the deadlines, the paperwork and the money, and does the follow-up.', intro_btn: 'Tell Handled about you',
    for_you: 'What this means', i_did_it: 'I did it', what_they_said: 'What did they say? (price, date, reference number)', open_phone: 'Open on your phone', listening: 'Listening...'
  },
  es: {
    open: 'Abierto', waiting_on_other_party: 'Esperando respuesta', escalated: 'Escalado', resolved: 'Resuelto',
    send_email: 'Email', send_sms: 'Mensaje de texto', place_call: 'Llamada', create_calendar_event: 'Calendario', prepare_form: 'Formulario listo para que lo envíes', open_url_prefilled: 'Enlace', schedule_followup: 'Seguimiento',
    next_deadline: 'Lo próximo', nothing_due: 'Nada pendiente. Toma una foto, habla o escribe abajo.', at_stake: 'Dinero en juego', recovered: 'Recuperado', cases: 'Inicio', your_list: 'Tu lista',
    approve: 'Esperando tu visto bueno', deadlines: 'Fechas y seguimientos', done: 'Hecho y en curso', rules: 'Fuentes', timeline: 'Actividad', add: 'Agregar una novedad',
    needs: 'Handled necesita unos datos', send_answers: 'Continuar', photo: 'Foto', voice: 'Voz', type: 'Escribir', handle: 'Resuélvelo', cancel: 'Cancelar', send: 'Enviar',
    intro_title: 'Vivir en SF viene con reglas que nadie te explica.', intro: 'Cuéntale a Handled quién eres, en tu idioma. Encuentra los plazos, los trámites y el dinero, y hace el seguimiento.', intro_btn: 'Cuéntale a Handled sobre ti',
    for_you: 'Lo que dice', i_did_it: 'Listo, lo hice', what_they_said: '¿Qué te dijeron? (precio, fecha, número de referencia)', open_phone: 'Abrir en tu teléfono', listening: 'Escuchando...'
  },
  pt: {
    open: 'Aberto', waiting_on_other_party: 'Aguardando resposta', escalated: 'Escalado', resolved: 'Resolvido',
    send_email: 'Email', send_sms: 'Mensagem de texto', place_call: 'Ligação', create_calendar_event: 'Calendário', prepare_form: 'Formulário pronto para você enviar', open_url_prefilled: 'Link', schedule_followup: 'Acompanhamento',
    next_deadline: 'A seguir', nothing_due: 'Nada pendente. Tire uma foto, fale ou escreva abaixo.', at_stake: 'Dinheiro envolvido', recovered: 'Recuperado', cases: 'Início', your_list: 'Sua lista',
    approve: 'Aguardando seu OK', deadlines: 'Datas e acompanhamentos', done: 'Feito e em andamento', rules: 'Fontes', timeline: 'Atividade', add: 'Adicionar uma novidade',
    needs: 'O Handled precisa de alguns dados', send_answers: 'Continuar', photo: 'Foto', voice: 'Voz', type: 'Escrever', handle: 'Resolver', cancel: 'Cancelar', send: 'Enviar',
    intro_title: 'Morar em SF vem com regras que ninguém explica.', intro: 'Conte ao Handled quem você é, no seu idioma. Ele encontra os prazos, a papelada e o dinheiro, e faz o acompanhamento.', intro_btn: 'Conte ao Handled sobre você',
    for_you: 'O que diz', i_did_it: 'Feito', what_they_said: 'O que disseram? (preço, data, número de referência)', open_phone: 'Abrir no seu telefone', listening: 'Ouvindo...'
  }
}
const SPEECH_LANG = { en: 'en-US', es: 'es-US', pt: 'pt-BR', zh: 'zh-CN', tl: 'fil-PH', vi: 'vi-VN', ru: 'ru-RU' }
// The app's own words follow ui_language; what Handled explains to the person stays in their language.
const t = key => (STRINGS[state?.profile?.ui_language ?? state?.profile?.language] ?? STRINGS.en)[key] ?? STRINGS.en[key] ?? key
const STATUS = new Proxy({}, { get: (_, k) => t(k) })
const TOOL = new Proxy({}, { get: (_, k) => t(k) })
const DEV = new URLSearchParams(location.search).has('dev')
const LANG_NAME = { es: 'Español', pt: 'Português', zh: '中文', tl: 'Filipino', vi: 'Tiếng Việt', ru: 'Русский' }
const STAR = '<svg viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M10 1.8l2.5 5.2 5.7.8-4.1 4 1 5.6L10 14.8l-5.1 2.6 1-5.6-4.1-4 5.7-.8z"/></svg>'
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
    return [next ? `Next: ${next.title}. Nothing goes out until you tap Approve.` : 'Nothing is waiting on you here.']
  }
  if (route === '/gallery') return ['Pick a topic and tap "See an example". It uses live City data.', "Eat well near you plans meals around what's on sale within walking distance."]
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
  // The bubble steps out of the way after a few seconds so it never sits on top of the page.
  clearTimeout(helperHide)
  if (say && tip) helperHide = setTimeout(() => el.querySelector('.helper-bubble')?.remove(), 7000)
}

let helperHide = null

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
  if (!notes.length || !DEV) return ''
  return `<div class="card small dev" style="margin-bottom:16px">${notes.map(esc).join('<br>')}</div>`
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
  document.querySelector('[data-go="gallery"].tab').textContent = 'Topics'
}

function renderHome() {
  const s = state
  const next = s.next_deadline
  const first = s.profile.name?.split(' ')[0]
  view.innerHTML = `
    ${integrationWarning()}
    <h1>${first ? `Hi, ${esc(first)}` : 'Handled'}</h1>
    <p class="muted" style="margin:4px 0 16px">${s.cases.length ? `${s.totals.open} open, ${s.cases.reduce((n, c) => n + c.pending_approvals, 0)} waiting for your OK.` : esc(t('nothing_due'))}</p>
    ${next ? `
      <button class="card next" data-case="${esc(next.case_id)}">
        ${dateBox(next.due_at)}
        <div>
          <div class="label">${esc(t('next_deadline'))} · ${esc(relDay(next.due_at))}</div>
          <div class="what">${esc(next.title)}</div>
          <div class="meta">${esc(next.case_title)}</div>
        </div>
      </button>` : ''}
    <div class="totals">
      <div class="card stat"><div class="label">${esc(t('at_stake'))}</div><div class="n">${usd(s.totals.at_stake)}</div></div>
      <div class="card stat money"><div class="label">${esc(t('recovered'))}</div><div class="n">${usd(s.totals.recovered)}</div></div>
    </div>
    <h2>${esc(t('your_list'))}${s.cases.length ? `<span class="count">${s.cases.length}</span>` : ''}</h2>
    <div class="stack">
      ${s.cases.length ? s.cases.map(caseCard).join('') : `
        <div class="card empty">
          <div class="big">${esc(t('intro_title'))}</div>
          <p class="muted">${esc(t('intro'))}</p>
          <button class="primary" data-onboard>${esc(t('intro_btn'))}</button>
          <p><button class="link" data-go-gallery>See what Handled can do</button></p>
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
        ${c.money_at_stake > 0 ? `<span class="chip money num">${usd(c.money_at_stake)}</span>` : c.money_recovered > 0 ? `<span class="chip money num">${usd(c.money_recovered)} back</span>` : c.status !== 'open' ? `<span class="status ${esc(c.status)}">${esc(STATUS[c.status])}</span>` : ''}
      </div>
      ${c.busy ? `<div class="meta working"><span class="spinner"></span>Working on it</div>` : c.next_deadline ? `<div class="meta"><span>${esc(c.next_deadline.title)}</span><span>${esc(relDay(c.next_deadline.due_at))}</span></div>` : ''}
      ${c.pending_approvals ? `<div class="needs"><span class="dot"></span>${c.pending_approvals} waiting for your OK</div>` : ''}
    </button>`
}

function hasPlaceholder(v) {
  return /\[[a-z_.0-9]+\]/.test(JSON.stringify(v))
}

function markPlaceholders(text) {
  return esc(text).replace(/\[([a-z_.0-9]+)\]/g, '<span class="placeholder">fill in</span>')
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
      <div class="preview" style="margin-top:8px">${markPlaceholders(p.body)}</div>`
  }
  if (a.tool === 'send_sms') {
    if (isEditing) return `<div class="edit" data-edit="${a.id}"><div class="field-label">To</div><input name="to" value="${esc(p.to)}"><div class="field-label">Message</div><textarea name="body" style="min-height:90px">${esc(p.body)}</textarea></div>`
    return `<dl class="kv"><dt>To</dt><dd>${markPlaceholders(p.to)}</dd></dl><div class="preview" style="margin-top:8px">${markPlaceholders(p.body)}</div>`
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

const ACTION_STATUS = { done: 'Done', handoff: 'Ready on your phone', failed: "Didn't go through", in_progress: 'In progress', running: 'Working', rejected: 'Skipped' }

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
        ${!proposed ? `<span class="chip ${a.status === 'done' ? 'verified' : a.status === 'failed' ? 'alert' : ''}">${esc(ACTION_STATUS[a.status] ?? a.status)}</span>` : ''}
      </div>
      ${a.payload.for_you ? `<div class="for-you"><span class="label">${esc(t('for_you'))}${LANG_NAME[state.profile.language] ? ` · ${LANG_NAME[state.profile.language]}` : ''}</span>${esc(a.payload.for_you)}</div>` : ''}
      <div style="margin-top:12px">${actionBody(a, isEditing)}</div>
      ${a.status === 'failed' && a.result?.error ? `<p class="small" style="color:var(--danger)">${esc(a.result.error)}</p>` : ''}
      ${a.status === 'handoff' ? `
        <div class="stack" style="margin-top:10px">
          <a class="primary" style="display:block;text-align:center;text-decoration:none" href="${esc(safeUrl(a.result.url))}">${esc(t('open_phone'))}</a>
          ${a.tool === 'place_call' ? `<textarea data-notes="${a.id}" rows="3" class="field" placeholder="${esc(t('what_they_said'))}"></textarea>` : ''}
          <button class="ghost" data-complete="${a.id}">${esc(t('i_did_it'))}</button>
        </div>` : ''}
      ${a.tool === 'place_call' ? callResult(a, events) : ''}
      ${a.tool === 'open_url_prefilled' && a.status === 'done' ? `<p class="small"><a href="${esc(safeUrl(a.result.url))}" target="_blank" rel="noopener">Open</a></p>` : ''}
      ${proposed ? `
        ${blocked && !isEditing ? `<p class="small" style="color:var(--accent)">Fill in the highlighted spots first.</p>` : ''}
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
  return `<li class="${esc(e.kind)}"><div class="small">${esc(e.title.replace(/^Looked up DataSF (\w+)/, 'Checked City data ($1)').replace(/^Matched playbook by keywords: /, 'Recognized: '))}${extra}</div><div class="tiny muted">${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div></li>`
}

const MEAL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' }

function recipeBlock(r) {
  const lines = r.ingredients.map(i => [i.amount, i.item].filter(Boolean).join(' '))
  const copy = [r.name, r.url, '', ...lines.map(l => `- ${l}`)].join('\n')
  return `<div class="recipe">
    <a class="recipe-title" href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener">${esc(r.name)}</a>
    <div class="meta num"><span>${esc(r.minutes)} min</span>${r.kcal != null ? `<span>${esc(r.kcal)} kcal</span>` : ''}${r.protein_g != null ? `<span>${esc(r.protein_g)} g protein</span>` : ''}<span>${esc(r.rating)} stars, ${esc(r.reviews)} reviews</span></div>
    <details><summary class="small">Ingredients, sized for you (${esc(r.servings)} serving${r.servings === 1 ? '' : 's'})</summary><ul class="small">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul></details>
    <div class="recipe-foot">
      <button class="link small" data-copy="${esc(copy)}">Copy list</button>
      <span class="stars" role="group" aria-label="Rate this recipe">${[1, 2, 3, 4, 5].map(n => `<button data-rate="${esc(r.id)}" data-stars="${n}" aria-label="Rate ${n} of 5">${STAR}</button>`).join('')}</span>
    </div>
  </div>`
}

function foodCard(c) {
  const tg = c.computed.targets
  const p = c.computed.plan
  const near = c.fields.nearby
  if (!tg.ready) return `<div class="card" style="margin-top:16px"><div class="small">${esc(tg.reason ?? `Add your ${tg.missing.join(' and ')} so Handled can work out your targets.`)}</div></div>`
  const macro = [tg.protein && ['Protein', `${tg.protein.target} g`], tg.carbs_g && ['Carbs', `${tg.carbs_g} g`], tg.fat_g && ['Fat', `${tg.fat_g} g`], ['Fiber', `${tg.needs.fiber} g`]].filter(Boolean)
  const lang = LANG_NAME[state.profile.language]
  const where = d => d.walk_minutes != null ? `${d.store}, ${d.walk_minutes} min walk` : d.store
  return `
    <div class="card food" style="margin-top:16px">
      <div class="label">What your body needs each day</div>
      <div class="hero-number num" style="margin-top:4px">${tg.calories ? `${esc(tg.calories.toLocaleString('en-US'))} <span style="font-size:1rem;font-weight:500;color:var(--muted);letter-spacing:0">calories</span>` : esc(tg.headline)}</div>
      <div class="macros">${macro.map(([k, v]) => `<div><div class="label">${k}</div><div class="v">${esc(v)}</div></div>`).join('')}</div>
      ${lang ? `<div class="label" style="margin-top:16px">${state.profile.language === 'pt' ? 'Para você' : 'Para ti'} · ${esc(lang)}</div>` : ''}
      <ul class="explain">${tg.explanation.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
      ${tg.conditions.map(n => `<div class="callout"><strong>${esc(n.label)}.</strong> ${esc(n.note)} <span class="muted">Confirm with ${esc(n.confirm_with)}. <a href="${esc(safeUrl(n.source_url))}" target="_blank" rel="noopener">Source</a></span></div>`).join('')}
      ${tg.assumptions.length ? `<p class="tiny muted">${tg.assumptions.map(esc).join(' ')}</p>` : ''}
      <details style="margin-top:16px"><summary class="small">Every nutrient, and how to get it</summary>
        <table class="nutrients small">${tg.nutrients.map(n => `<tr class="${n.priority ? 'priority' : ''}"><th>${esc(n.name)}</th><td>${esc(n.amount)} ${esc(n.unit)}</td><td>${esc(n.how)} <span class="muted">From ${esc(n.foods)}.</span></td></tr>`).join('')}</table>
        <p class="tiny muted">${esc(tg.formula)}, activity factor ${esc(tg.activity_factor)}. Sodium under ${esc(tg.sodium_limit_mg)} mg. Information with sources, not medical advice.</p>
      </details>
    </div>
    ${p?.ready ? `
    <h2>Today's meals</h2>
    <div class="stack">${p.meals.map(m => `
      <div class="card meal">
        <div class="meal-head"><strong>${esc(MEAL[m.meal])}</strong><span class="meta num">${m.time ? `<span>${esc(m.time)}</span>` : ''}${m.kcal_target ? `<span>about ${esc(m.kcal_target)} kcal</span>` : ''}</span></div>
        ${m.recipe ? recipeBlock(m.recipe) : ''}
        ${m.items.map(i => `<div class="meal-item">
            <div class="small"><span class="num">${esc(i.servings)} x</span> ${esc(i.name)} <span class="muted">${esc(i.serving)}</span></div>
            <div class="row"><button class="link small" data-food="${esc(i.id)}" data-like="1">Like</button><button class="link small" data-food="${esc(i.id)}" data-like="0">Swap</button></div>
          </div>`).join('')}
        ${m.deals?.length ? `<div class="on-sale">On sale near you: ${m.deals.slice(0, 3).map(d => `${esc(d.food)} ${esc(d.price_text)} at ${esc(where(d))}`).join('; ')}</div>` : ''}
      </div>`).join('')}
    </div>
    ${p.pairs.length ? `<div class="callout" style="background:var(--brand-soft)"><strong>Eat together for better absorption.</strong> ${p.pairs.map(esc).join('; ')}.</div>` : ''}
    <div class="card" style="margin-top:8px">
      <div class="small" style="font-weight:600">How today's meals add up</div>
      ${p.coverage.filter(x => x.need).map(x => `<div class="bar-row"><span>${esc(x.name)}</span><div class="bar"><div style="width:${Math.min(100, x.percent)}%;background:${x.percent >= 80 ? 'var(--money)' : 'var(--accent)'}"></div></div><span class="muted num">${esc(Math.round(x.have))} / ${esc(x.need)} ${esc(x.unit)}</span></div>`).join('')}
      ${p.gaps.map(g => `<p class="tiny" style="color:var(--accent);margin-bottom:0">${esc(g.name)} is low. ${esc(g.tip)}</p>`).join('')}
    </div>
    <h2>Shopping list${p.on_sale_count ? `<span class="count">${esc(p.on_sale_count)} on sale near you</span>` : ''}</h2>
    <div class="card">
      ${p.shopping.slice(0, 14).map(s => `<div class="shop"><span>${esc(s.name)}</span><span>${s.deal ? `<span class="num" style="color:var(--money);font-weight:600">${esc(s.deal.price_text)}</span><br><span class="tiny muted">${esc(where(s.deal))}${s.deal.valid_to ? `, until ${esc(prettyDate(s.deal.valid_to.slice(0, 10)).replace(/, \d{4}$/, ''))}` : ''}</span>` : ''}${s.order_url ? ` <a class="small" href="${esc(safeUrl(s.order_url))}" target="_blank" rel="noopener">Order</a>` : ''}</span></div>`).join('')}
      ${near?.markets?.length ? `<p class="small" style="margin-top:12px">Farmers markets nearby: ${near.markets.map(m => `${esc(m.name)} (${esc(m.walk_minutes)} min)`).join(', ')}. Many take CalFresh and add Market Match money for produce.</p>` : ''}
      ${near?.map_error ? `<p class="tiny" style="color:var(--accent)">We couldn't load walk times. These deals are for your ZIP code.</p>` : ''}
    </div>
    <p class="tiny muted">Deals from this week's store flyers near ${esc(near?.address ?? c.fields.food_area ?? 'you')}. Recipes from Food.com, scaled to your portions. Nutrient values from USDA FoodData Central.</p>` : ''}`
}

function computedHeadline(c) {
  if (c.computed?.targets) return foodCard(c)
  const i = c.computed?.interest
  if (i) return `
    <div class="card" style="margin-top:16px">
      <div class="label">Your landlord owes you</div>
      <div class="hero-number money" style="margin-top:4px">${usd2(i.total_owed)}</div>
      ${i.net_minimum != null && i.net_minimum < i.total_owed ? `<div class="meta">At least ${usd2(i.net_minimum)} after the Rent Board fee share they may keep</div>` : ''}
      <ul class="explain num">${i.years.map(y => `<li>${esc(y.math.replace(/^(\d{4}-\d{2}-\d{2})/, d => prettyDate(d).replace(/^\w+, /, '')))}</li>`).join('')}</ul>
      <p class="small muted" style="margin-bottom:0">Next payment ${usd2(i.next_payment.interest)}, due ${esc(prettyDate(i.next_payment.due_date))}. Rates from the <a href="${esc(safeUrl(i.source_url))}" target="_blank" rel="noopener">SF Rent Board</a>, checked ${esc(prettyDate(i.last_verified).replace(/^\w+, /, ''))}.</p>
      ${i.years_needing_confirmation.length ? `<div class="callout">Not counted yet, because the rate isn't confirmed: ${esc(i.years_needing_confirmation.join('; '))}. Ask the Rent Board.</div>` : ''}
    </div>`
  const chk = c.computed?.check
  const ticket = c.fields.citation
  if (chk && 'contest_grounds' in chk) return `
    <div class="card" style="margin-top:16px">
      <div class="label">Street-cleaning check${ticket?.found ? ` · citation ${esc(ticket.number ?? ticket.citation_number ?? c.fields.citation_number)}` : ''}</div>
      <div class="hero-number" style="margin-top:4px;font-size:1.75rem;color:${chk.contest_grounds ? 'var(--money)' : 'var(--ink)'}">${chk.contest_grounds ? 'You have grounds to protest' : chk.scheduled ? 'The ticket matches the schedule' : 'No schedule found'}</div>
      ${ticket?.found ? `<div class="meta num" style="margin-top:8px"><span>${usd2(ticket.fine)}</span><span>${esc(ticket.location)}</span><span>${esc(chk.issued)}</span></div>` : ''}
      <p class="small" style="margin-bottom:0">${esc(chk.explanation)}</p>
      ${chk.scheduled ? '<p class="small muted" style="margin-bottom:0">A protest the City will reject costs you time. Handled points you to payment plans instead.</p>' : ''}
    </div>`
  if (chk) return `
    <div class="card" style="margin-top:16px">
      <div class="label">Increase asked vs allowed</div>
      <div class="headline-money" style="color:${chk.overcharge_per_month ? 'var(--danger)' : 'var(--money)'}">${chk.increase_percent}% vs ${chk.max_percent_with_banking ?? '?'}%</div>
      <div class="small">${esc(chk.math ?? '')}</div>
      <div class="small muted">${esc(chk.coverage_basis)}</div>
    </div>`
  const v = c.computed?.verdict
  if (v) return `
    <div class="card" style="margin-top:16px">
      <div class="label">Our read</div>
      <div class="headline-money" style="color:${v.verdict === 'likely scam' ? 'var(--danger)' : v.verdict === 'likely real' ? 'var(--money)' : 'var(--accent)'}">${esc(v.verdict)}</div>
      <div class="small">${v.links.map(l => `${esc(l.host)}: ${l.official ? 'official website' : 'not an official website'}`).join('<br>')}</div>
      <div class="small muted">${esc(v.advice)}</div>
    </div>`
  const b = c.computed?.compare
  if (b) return `
    <div class="card" style="margin-top:16px">
      <div class="label">Possible overbilling</div>
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
    view.innerHTML = `<p>We can't find that. <button class="link" onclick="location.hash='/'">Back to your list</button></p>`
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
    <button class="back" onclick="location.hash='/'">&larr; ${esc(t('your_list'))}</button>
    <div class="case-head">
      <h1>${esc(c.title)}</h1>
      <div class="meta">${c.status !== 'open' ? `<span>${esc(STATUS[c.status])}</span>` : ''}${proposed.length ? `<span>${proposed.length} waiting for your OK</span>` : ''}${upcoming[0] ? `<span>Next date ${esc(relDay(upcoming[0].due_at))}</span>` : ''}${c.money_recovered > 0 ? `<span>${usd2(c.money_recovered)} recovered</span>` : ''}</div>
    </div>
    ${c.busy ? `<div class="card working" style="margin-top:16px"><span class="spinner"></span><span>Looking this over...</span></div>` : ''}
    ${computedHeadline(c)}
    ${c.summary ? `<div class="card summary" style="margin-top:16px">${esc(c.summary)}</div>` : ''}
    ${c.questions?.length && !c.busy ? `
      <div class="card questions" style="margin-top:16px">
        <div style="font-weight:600">${esc(t('needs'))}</div>
        ${c.questions.map((q, i) => `<label class="field-label" for="q${i}">${esc(q.question)}</label><input id="q${i}" data-q="${i}" data-field="${esc(q.field)}">`).join('')}
        <div class="row" style="margin-top:16px"><button class="primary" id="answer">${esc(t('send_answers'))}</button></div>
      </div>` : ''}
    ${proposed.length ? `<h2>${esc(t('approve'))}<span class="count">${proposed.length}</span></h2><p class="small muted" style="margin-top:-4px">Nothing goes out until you tap Approve.</p><div class="stack">${proposed.map(a => actionCard(a, c.events)).join('')}</div>` : ''}
    ${upcoming.length || meals ? `
      <h2>${esc(t('deadlines'))}</h2>
      <div class="card">${upcoming.map(d => {
        const r = c.rules.find(x => x.id === d.rule_id)
        return `
        <div class="deadline">${dateBox(d.due_at)}
          <div>
            <div class="small" style="font-weight:600">${esc(d.title)}</div>
            <div class="meta"><span>${esc(relDay(d.due_at))}</span>${r ? `<span>${r.status === 'verified' ? `Rule checked ${esc(prettyDate(r.last_verified).replace(/^\w+, /, '').replace(/, \d{4}$/, ''))}` : 'Rule not checked yet'}</span>` : d.kind === 'checkin' ? '<span>Automatic check-in</span>' : d.kind === 'event' ? '<span>On your calendar</span>' : ''}</div>
            ${d.note ? `<div class="tiny muted" style="margin-top:4px">${esc(d.note)}</div>` : ''}
          </div>
        </div>`
      }).join('')}
        ${meals ? `<p class="small" style="margin-bottom:0">${meals} meal times are on your calendar this week.</p>` : ''}
        <p class="small" style="margin-bottom:0"><a href="/api/cases/${esc(c.id)}/calendar.ics">Add to my calendar</a></p>
      </div>` : ''}
    ${other.length ? `<h2>${esc(t('done'))}</h2><div class="stack">${other.slice().reverse().map(a => actionCard(a, c.events)).join('')}</div>` : ''}
    ${c.rules.length ? `
      <h2>${esc(t('rules'))}</h2>
      <div class="card sources">${c.rules.map(r => `
        <details><summary class="small"><span style="font-weight:600">${esc(r.title)}</span> <span class="chip ${esc(r.status)}">${r.status === 'verified' ? `Checked ${esc(prettyDate(r.last_verified).replace(/^\w+, /, '').replace(/, \d{4}$/, ''))}` : 'Not checked yet'}</span></summary>
          <p class="small">${esc(r.rule)}</p>
          <p class="small muted"><a href="${esc(safeUrl(r.source_url))}" target="_blank" rel="noopener">Source</a> · Confirm with ${esc(r.confirm_with)}</p>
        </details>`).join('')}
        <p class="tiny muted" style="margin:12px 0 0">Information with sources, not legal, tax, immigration or medical advice.</p>
      </div>` : ''}
    <details class="card" style="margin-top:32px" ${DEV ? 'open' : ''}><summary class="small" style="font-weight:600">${esc(t('timeline'))}</summary>
      <ul class="timeline">${c.events.filter(e => DEV || !['route', 'plan', 'question', 'fields'].includes(e.kind)).map(eventLine).join('')}</ul>
      ${DEV && c.jobs.length ? `<p class="small muted">Scheduled: ${c.jobs.map(j => `${esc(j.kind)} ${esc(relDay(j.run_at))}`).join(', ')}</p>` : ''}
    </details>
    <h2>${esc(t('add'))}</h2>
    <div class="card">
      <textarea id="caseReply" class="field" rows="2" aria-label="${esc(t('add'))}" placeholder="Add an update or fix a detail. For example: they paid."></textarea>
      <div class="row" style="margin-top:8px;justify-content:space-between">
        <button class="ghost" id="resolve">${c.status === 'resolved' ? 'Resolved' : 'Mark as done'}</button>
        <button class="primary" id="sendReply">${esc(t('send'))}</button>
      </div>
    </div>`

  view.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', async () => {
    const aid = Number(b.dataset.approve)
    const editEl = view.querySelector(`[data-edit="${aid}"]`)
    const payload = editEl ? Object.fromEntries([...editEl.querySelectorAll('[name]')].map(i => [i.name, i.value])) : undefined
    if (payload && hasPlaceholder(payload)) return toast('Fill in the highlighted spots first.')
    b.disabled = true
    b.textContent = 'One moment...'
    const r = await api(`/api/actions/${aid}/approve`, { payload })
    editing.delete(aid)
    toast(r.ok ? 'Done.' : `That didn't go through. ${r.error}`)
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
  view.querySelectorAll('[data-rate]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true
    await api(`/api/cases/${id}/rate`, { recipe: Number(b.dataset.rate), stars: Number(b.dataset.stars) })
    toast(Number(b.dataset.stars) >= 4 ? 'Noted. More like this, plus something new now and then.' : "Noted. We'll try other kinds of dishes.")
    renderCase(id)
  }))
  view.querySelectorAll('[data-food]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true
    await api(`/api/cases/${id}/food`, { food: b.dataset.food, like: b.dataset.like === '1' })
    toast(b.dataset.like === '1' ? "Noted. You'll see this more often." : "Swapped. You won't see it again.")
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
    const amount = c.money_at_stake > 0 ? prompt(`How much did you get back? (Amount owed: ${usd2(c.money_at_stake)})`, String(c.money_at_stake)) : '0'
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
    <h1>Topics</h1>
    <p class="muted" style="margin-top:4px">Pick something you're dealing with and see how Handled works through it, with live City data.</p>
    <div class="filters" role="tablist">
      <button role="tab" class="${galleryPack === 'all' ? 'on' : ''}" data-pack="all">Common</button>
      ${order.filter(k => playbooks.some(p => p.pack === k)).map(k => `<button role="tab" class="${galleryPack === k ? 'on' : ''}" data-pack="${esc(k)}">${esc(packs[k])}</button>`).join('')}
      <button role="tab" class="${galleryPack === 'more' ? 'on' : ''}" data-pack="more">Everything else</button>
    </div>
    <div class="pack-grid" style="margin-top:16px">
      ${shown.map(p => `
        <div class="card pb-card">
          <div class="label">${esc(packs[p.pack])}</div>
          <div style="font-weight:600;line-height:1.3">${esc(p.title)}</div>
          <p>${esc(p.pitch)}</p>
          <div><button class="ghost" data-try="${esc(p.id)}">See an example</button></div>
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
    <h2>Your language</h2>
    <div class="card">
      <label class="field-label" for="lang" style="margin-top:0">Handled explains things to you in</label>
      <select id="lang" class="field">${Object.entries({ en: 'English', es: 'Español', pt: 'Português', zh: '中文', tl: 'Filipino', vi: 'Tiếng Việt', ru: 'Русский' }).map(([k, v]) => `<option value="${k}" ${profile.language === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <p class="small muted" style="margin-bottom:0">It writes to landlords, employers and the City in English, and shows you what each message says.</p>
    </div>
    <h2>Your helper</h2>
    <div class="card stack small">
      <div class="row" style="gap:16px"><span id="helperPreview">${helperSettings().image ? `<img src="${esc(helperSettings().image)}" alt="" width="48" height="48" style="object-fit:contain">` : helperSvg(helperSettings())}</span>
        <label>Name <input id="helperName" class="field" value="${esc(helperSettings().name)}" maxlength="20" style="width:8em;min-height:36px;padding:4px 8px"></label>
        <label>Color <input id="helperColor" type="color" value="${esc(helperSettings().color)}"></label>
        <label>Hat <select id="helperHat" class="field" style="width:auto;min-height:36px;padding:4px 8px">${Object.keys(HATS).map(h => `<option ${helperSettings().hat === h ? 'selected' : ''}>${h}</option>`).join('')}</select></label>
      </div>
      <div class="row">
        <label class="button-like">Use my own picture <input id="helperImage" type="file" accept="image/png,image/*" hidden></label>
        ${helperSettings().image ? '<button class="ghost" id="helperClear">Back to the drawing</button>' : ''}
        <label class="row"><input type="checkbox" id="helperHidden" ${helperSettings().hidden ? 'checked' : ''}> Hide</label>
      </div>
    </div>
    <h2>What Handled knows about you</h2>
    <div class="card small">
      ${Object.keys(profile.memory ?? {}).length ? `<dl class="kv">${Object.entries(profile.memory).map(([k, m]) => `<dt>${esc(k.replace(/_/g, ' ').replace(/^\w/, x => x.toUpperCase()))}</dt><dd>${esc(typeof m.value === 'object' ? JSON.stringify(m.value) : m.value)}</dd>`).join('')}</dl>` : '<span class="muted">Nothing yet. Handled saves your answers here so it never asks twice.</span>'}
    </div>
    <h2>Calendar</h2>
    <div class="card small">Add every date and check-in to your phone's calendar. <a href="${esc(cal)}">Subscribe</a></div>
    <h2>Help the City improve</h2>
    <div class="card small">
      <p style="margin-top:0">Handled can share what people needed help with, and which City steps still have no online option. Counts only, never names or addresses.</p>
      <dl class="kv">
        <dt>Needed help with</dt><dd>${civic.obligations.map(o => `${esc(o.playbook.replace(/_/g, ' '))} (${o.n})`).join(', ') || 'Nothing yet'}</dd>
        <dt>No online option</dt><dd>${civic.steps_with_no_online_path.map(s => `${esc(s.host)} (${s.count})`).join(', ') || 'None yet'}</dd>
        <dt>311 reports</dt><dd>${civic.reports_311.prepared} prepared, ${civic.reports_311.closed_by_city} closed by the City</dd>
      </dl>
      <p style="margin-bottom:0"><a href="/api/civic" download="handled-civic-report.json">Download the anonymous report</a></p>
    </div>
    <h2>How we check our work</h2>
    <div class="card small">
      ${evals.routing_keyword_mode ? `<dl class="kv">
        <dt>Understands what you sent</dt><dd>${esc(evals.routing_keyword_mode.total)} test messages in English, Spanish and Portuguese</dd>
        <dt>Parking ticket check</dt><dd>Agrees with the City on ${evals.sweeping_rule_vs_city_tickets.schedule_matches} of ${evals.sweeping_rule_vs_city_tickets.tickets_checked} real street-cleaning tickets</dd>
        <dt>Deposit interest</dt><dd>Rates checked against the SF Rent Board</dd>
      </dl>` : '<span class="muted">Not run yet.</span>'}
    </div>
    <details class="card dev" style="margin-top:32px" ${DEV ? 'open' : ''}>
      <summary class="small" style="font-weight:600">Demo tools</summary>
      <div class="stack" style="margin-top:12px">
        <div class="spread small"><span>Handled's clock</span><strong class="clock-pill">${esc(prettyDate(state.clock.today))}${state.clock.offset_days ? ` (+${state.clock.offset_days} days)` : ''}</strong></div>
        <div class="ff">
          <button class="ghost" data-ff="1">+1 day</button>
          <button class="ghost" data-ff="3">+3 days</button>
          <button class="ghost" data-ff="7">+7 days</button>
          <button class="ghost" data-ff="15">+15 days</button>
        </div>
        <p class="tiny muted">Moves the clock forward and runs any reminders and check-ins that come due.</p>
        <button class="ghost" id="resetClock">Back to real time</button>
        <div class="field-label">Persona</div>
        <div class="row">${personas.map(p => `<button class="ghost" data-persona="${esc(p.id)}">${esc(p.name)}</button>`).join('')}</div>
        <label class="row small"><input type="checkbox" id="fresh" checked> Start with an empty list</label>
        <div class="field-label">Connected services</div>
        <dl class="kv"><dt>Smart reading</dt><dd>${i.claude ? 'On' : 'Off'}</dd><dt>Email</dt><dd>${i.email ? 'On' : 'Off, opens your mail app'}</dd><dt>Texts</dt><dd>${i.sms ? 'On' : 'Off, opens your messages app'}</dd><dt>Calls</dt><dd>${i.calls ? 'On' : 'Off, opens your dialer'}</dd></dl>
        <p class="tiny muted">Forward emails or meeting notes to POST ${esc(location.origin)}/api/inbound</p>
        <div class="field-label">Profile</div>
        <div class="settings">
          <p class="tiny muted">Handled uses this to fill out forms. Don't enter your SSN, card numbers or full ID numbers.</p>
          <textarea id="profile" rows="12" spellcheck="false" style="font-family:ui-monospace,monospace;font-size:.8rem">${esc(JSON.stringify(profile, null, 2))}</textarea>
          <div class="row" style="margin-top:8px;justify-content:flex-end"><button class="primary" id="saveProfile">Save</button></div>
        </div>
      </div>
    </details>`
  view.querySelectorAll('[data-ff]').forEach(b => b.addEventListener('click', async () => {
    const r = await api('/api/clock/advance', { days: Number(b.dataset.ff) })
    await refreshState()
    toast(r.fired ? `Ran ${r.fired} ${r.fired === 1 ? 'reminder or check-in' : 'reminders and check-ins'}` : 'Nothing due yet')
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
      toast("That didn't save. Check the format and try again.")
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
