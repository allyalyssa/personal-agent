import { pipSvg } from '/pip-draw.js'

const pip = document.getElementById('pip')
const card = document.getElementById('card')
const desk = window.pipDesktop
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

let look = { name: 'Pip' }
let shown = null
let tab = 'recipe'
let preview = false
let dragging = false
let caseId = null
let allergies = null
const dismissed = JSON.parse(localStorage.getItem('pipDismissed') ?? '[]')

const getJson = async (path, opts) => (await fetch(path, { cache: 'no-store', ...opts })).json()

function recipeTab(n) {
  if (!n.recipe) return n.plate ? `<ul>${n.plate.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p class="muted">No recipe fits today.</p>'
  const r = n.recipe
  const lines = r.ingredients.map(i => [i.amount, i.item].filter(Boolean).join(' '))
  return `<a href="${esc(r.url)}" target="_blank"><strong>${esc(r.name)}</strong></a>
    <div class="muted">${esc(r.servings)} serving${r.servings === 1 ? '' : 's'} · ${esc(r.minutes)} min${r.kcal != null ? ` · ${esc(r.kcal)} kcal` : ''}</div>
    <ul>${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
    <button data-copy>Copy ingredients and link</button>`
}

function groceryTab(n) {
  const s = n.store
  const sales = (n.recipe?.ingredients ?? []).filter(i => i.deal)
  return `${s ? `<p>Shop at <strong>${esc(s.name)}</strong>, ${esc(s.walk_minutes)} min walk.${s.map_url ? ` <a href="${esc(s.map_url)}" target="_blank">Map</a>` : ''}</p>` : '<p class="muted">No store found near your address.</p>'}
    ${sales.length
      ? `<p class="sale">On sale near you this week:</p><ul>${sales.map(i => `<li>${esc(i.item)}: ${esc(i.deal.price_text)} at ${esc(i.deal.store)}${i.deal.walk_minutes != null ? ` (${esc(i.deal.walk_minutes)} min walk)` : ''}${i.deal.valid_to ? `, until ${esc(i.deal.valid_to.slice(5, 10))}` : ''}</li>`).join('')}</ul>`
      : '<p class="muted">No flyer deals on these ingredients this week.</p>'}`
}

function whenTab(n) {
  const w = n.when
  const why = w.moved_because ? `<p>Moved from ${esc(w.usual)} to ${esc(w.time)} because of <strong>${esc(w.moved_because.join(', '))}</strong> on your calendar.</p>`
    : w.quicker_because ? `<p>A quicker recipe, so it fits around <strong>${esc(w.quicker_because.join(', '))}</strong> on your calendar.</p>`
      : w.no_time_because ? `<p>No room to shop and cook around <strong>${esc(w.no_time_because.join(', '))}</strong>.</p>`
        : '<p>Your usual time; nothing on your calendar is in the way.</p>'
  return `${why}<p>Leave by ${esc(w.leave)}:</p><ul>
    ${w.walk != null ? `<li>${esc(w.walk)} min walk there</li>` : ''}<li>${esc(w.shop)} min shopping</li>${w.walk != null ? `<li>${esc(w.walk)} min walk back</li>` : ''}
    <li>${esc(w.cook)} min cooking</li><li>eat at ${esc(w.time)}</li></ul>`
}

function eatOutTab(n) {
  const e = n.eat_out
  if (!e) return '<p class="muted">No restaurant within your walking limit.</p>'
  const links = [e.website ? `<a href="${esc(e.website)}" target="_blank">Website</a>` : '', e.map_url ? `<a href="${esc(e.map_url)}" target="_blank">Map</a>` : ''].filter(Boolean).join(' · ')
  const when = e.leave_text
    ? `<p>Leave by ${esc(e.leave_text)}, eat at ${esc(e.time_text)}, back by ${esc(e.back_text)}.${e.moved_because ? ` Moved for ${esc(e.moved_because.join(', '))}.` : ''}</p>`
    : `<p>No time to walk there and eat around ${esc((e.no_time_because ?? []).join(', '))}.</p>`
  return `<p><strong>${esc(e.name)}</strong> · ${esc(e.cuisine)} · ${esc(e.walk_minutes)} min walk${links ? ` · ${links}` : ''}</p>${when}
    ${e.typical ? `<p class="muted">A typical ${esc(e.cuisine)} main is about ${esc(e.typical.kcal)} kcal (estimate; restaurant portions are often bigger)${n.kcal_target ? `. Your target for this meal: about ${esc(n.kcal_target)} kcal` : ''}.</p>` : ''}
    ${allergies ? `<p class="muted">Check the menu for: ${esc(allergies)}.</p>` : ''}
    <p>Rate this place: ${[1, 2, 3, 4, 5].map(k => `<button data-place-stars="${k}">${k}★</button>`).join(' ')}</p>`
}

const TABS = { recipe: ['Recipe', recipeTab], grocery: ['Grocery', groceryTab], out: ['Eat out', eatOutTab], when: ['Timing', whenTab] }

function draw() {
  card.hidden = !shown
  if (!shown) return
  card.innerHTML = `
    <div class="head"><strong>${esc(look.name)}</strong>${esc(shown.text)}</div>
    <div class="tabs">${Object.entries(TABS).map(([k, [label]]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${label}</button>`).join('')}</div>
    <div class="body">${TABS[tab][1](shown)}</div>
    <div class="foot"><span class="muted">Right-click ${esc(look.name)} for more</span><button data-dismiss>Dismiss</button></div>`
}

function show(n) {
  if (n?.id !== shown?.id) tab = 'recipe'
  shown = n ?? null
  draw()
}

async function refresh() {
  try {
    look = await getJson('/api/pip')
    pip.innerHTML = look.image ? `<img src="${esc(look.image)}" alt="">` : pipSvg(look, 72)
    pip.title = `${look.name} (right-click for more)`
    const { now, nudges, case_id, allergies: a } = await getJson('/api/nudges')
    caseId = case_id
    allergies = a
    show(preview
      ? nudges.find(n => n.at > now) ?? nudges[0]
      : nudges.find(n => n.leave <= now && now < n.at && !dismissed.includes(n.id)))
  } catch {}
}

card.addEventListener('click', e => {
  const b = e.target.closest('button')
  if (!b) return
  if (b.dataset.tab) {
    tab = b.dataset.tab
    draw()
  } else if (b.dataset.copy !== undefined && shown?.recipe) {
    const r = shown.recipe
    desk?.copy([r.name, r.url, '', ...r.ingredients.map(i => `- ${[i.amount, i.item].filter(Boolean).join(' ')}`)].join('\n'))
    b.textContent = 'Copied'
  } else if (b.dataset.placeStars && shown?.eat_out && caseId) {
    fetch(`/api/cases/${caseId}/rate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cuisines: shown.eat_out.cuisines, stars: Number(b.dataset.placeStars) }) })
    b.parentElement.textContent = 'Thanks, Pip will remember.'
  } else if (b.dataset.dismiss !== undefined) {
    if (shown && !preview) {
      dismissed.push(shown.id)
      localStorage.setItem('pipDismissed', JSON.stringify(dismissed.slice(-50)))
    }
    preview = false
    show(null)
  }
})

for (const el of [pip, card]) {
  el.addEventListener('mouseenter', () => desk?.interactive(true))
  el.addEventListener('mouseleave', () => dragging || desk?.interactive(false))
  el.addEventListener('contextmenu', e => {
    e.preventDefault()
    desk?.menu()
  })
}

pip.addEventListener('mousedown', e => {
  if (e.button !== 0) return
  dragging = true
  desk?.dragStart(e.screenX, e.screenY)
})
window.addEventListener('mousemove', e => dragging && desk?.dragMove(e.screenX, e.screenY))
window.addEventListener('mouseup', () => {
  dragging = false
})

desk?.onPreview(() => {
  preview = true
  refresh()
})
desk?.onRefresh(refresh)
desk?.onCheckCalendar(async () => {
  await getJson('/api/calendar/check', { method: 'POST' })
  preview = true
  refresh()
})

refresh()
setInterval(refresh, 20000)
