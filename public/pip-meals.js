const view = document.getElementById('view')
const toastEl = document.getElementById('toast')
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const MEAL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' }

let caseId = null

function toast(text) {
  toastEl.textContent = text
  toastEl.hidden = false
  setTimeout(() => { toastEl.hidden = true }, 2500)
}

function recipe(r) {
  const lines = r.ingredients.map(i => [i.amount, i.item].filter(Boolean).join(' '))
  const sale = i => i.deal ? ` <span class="note">on sale: ${esc(i.deal.price_text)} at ${esc(i.deal.store)}</span>` : ''
  const copy = [r.name, r.url, '', ...lines.map(l => `- ${l}`)].join('\n')
  return `
    <a class="name" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>
    <div class="facts">${esc(r.servings)} serving${r.servings === 1 ? '' : 's'} · ${esc(r.minutes)} min · ★${esc(r.rating)} (${esc(r.reviews)}) · ${esc([...r.cuisines, r.main].join(', ').replaceAll('_', ' '))}${r.kcal != null ? ` · ${esc(r.kcal)} kcal` : ''} · protein ${esc(r.protein_g)} g</div>
    <details><summary>Ingredients for you</summary><ul>${lines.map((l, k) => `<li>${esc(l)}${sale(r.ingredients[k])}</li>`).join('')}</ul></details>
    <div class="row"><button class="copy" data-copy="${esc(copy)}">Copy ingredients and link</button>
      <span class="stars">${[1, 2, 3, 4, 5].map(n => `<button data-rate="${esc(r.id)}" data-stars="${n}" title="${n} star${n === 1 ? '' : 's'}">☆</button>`).join('')}</span></div>`
}

async function load() {
  const { case_id, targets, plan, calendar_error, learned } = await (await fetch('/api/meals', { cache: 'no-store' })).json()
  caseId = case_id
  if (!plan?.ready) {
    view.innerHTML = `<h1>No meals yet</h1><p class="sub">${esc(targets?.reason ?? (targets?.missing?.length ? `Still needed: ${targets.missing.join(', ')}.` : ''))} Right-click Pip, choose "My details…", fill them in and save.</p>`
    return
  }
  view.innerHTML = `
    <h1>${esc(targets.headline)}</h1>
    ${calendar_error ? `<p class="note warn">${esc(calendar_error)}</p>` : ''}
    <p class="sub">${[targets.protein ? `Protein ${targets.protein.target} g` : null, `Fiber ${targets.needs.fiber} g`, `Water about ${targets.water_l} L`].filter(Boolean).map(esc).join(' · ')}</p>
    ${plan.meals.map(m => `
      <div class="meal">
        <div class="top"><strong>${esc(MEAL[m.meal])}</strong><span>${esc(m.time)}${m.kcal_target ? ` · about ${esc(m.kcal_target)} kcal` : ''}</span></div>
        ${m.moved_because ? `<div class="note">Moved from ${esc(m.usual_time)} for ${esc(m.moved_because.join(', '))}.</div>` : ''}
        ${m.quicker_because ? `<div class="note">Picked a quicker recipe to fit around ${esc(m.quicker_because.join(', '))}.</div>` : ''}
        ${m.no_time_because ? `<div class="note warn">No time to shop and cook around ${esc(m.no_time_because.join(', '))}.</div>` : ''}
        ${m.recipe ? recipe(m.recipe) : `<ul>${m.items.map(i => `<li>${esc(i.servings)} x ${esc(i.name)} (${esc(i.serving)})</li>`).join('')}</ul>`}
      </div>`).join('')}
    <div class="meal bars"><strong>How today covers you</strong>
      ${plan.coverage.filter(c => c.need).map(c => `<div><span>${esc(c.name)}</span><span class="bar"><span style="width:${Math.min(100, c.percent)}%${c.key === 'sodium' && c.percent > 100 ? ';background:#c0392b' : ''}"></span></span><span>${esc(c.have)}/${esc(c.need)} ${esc(c.unit)}</span></div>`).join('')}
    </div>
    <div class="meal bars"><strong>What Pip has learned</strong>
      ${learned.length ? ['cuisine', 'main'].map(kind => {
        const rows = learned.filter(t => t.kind === kind)
        return rows.length ? `<p class="sub" style="margin:8px 0 2px">${kind === 'cuisine' ? 'Cuisines' : 'Main ingredients'}</p>${rows.map(t => `<div><span>${esc(t.key.replaceAll('_', ' '))}</span><span class="bar"><span style="width:${t.score}%"></span></span><span>${esc(t.score)}% · ${esc(t.ratings)} rating${t.ratings === 1 ? '' : 's'}</span></div>`).join('')}` : ''
      }).join('') : '<p class="sub">Nothing yet. Rate a recipe and Pip starts picking more of what you like, while still trying new things.</p>'}
    </div>`
}

view.addEventListener('click', async e => {
  const b = e.target.closest('button')
  if (!b) return
  if (b.dataset.copy) {
    await navigator.clipboard.writeText(b.dataset.copy)
    return toast('Copied')
  }
  if (b.dataset.rate) {
    await fetch(`/api/cases/${caseId}/rate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipe: Number(b.dataset.rate), stars: Number(b.dataset.stars) }) })
    toast(Number(b.dataset.stars) >= 4 ? 'Got it. More like this, and still something new now and then.' : 'Got it. Pip will try other kinds of dishes.')
    load()
  }
})

load()
