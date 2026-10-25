import { HATS, pipSvg } from '/pip-draw.js'

const $ = id => document.getElementById(id)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const post = async (path, data) => (await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })).json()

const SECTIONS = [
  ['Where and when', [
    ['food.area', 'Where you shop or eat most days', 'text', 'Street address, e.g. 1000 Guerrero St'],
    ['food.meal_times', 'Meal times', 'text', '08:00, 12:30, 19:00'],
    ['food.calendar_url', 'Google Calendar secret iCal link', 'password', 'Google Calendar > Settings > your calendar > Integrate calendar > Secret address in iCal format'],
    ['food.max_walk_minutes', 'Longest walk to a store (min)', 'number'],
    ['food.max_cook_minutes', 'Longest you want to cook (min)', 'number'],
    ['food.shop_minutes', 'Time in the store (min)', 'number'],
    ['food.delivery', 'Show delivery options', 'check']
  ]],
  ['Your body', [
    ['body.age', 'Age', 'number'],
    ['body.sex', 'Sex (for the calorie equation)', ['female', 'male', 'other']],
    ['body.height', 'Height', 'text', `5'6" or 168 cm`],
    ['body.weight', 'Weight', 'text', '140 lb or 64 kg'],
    ['body.goal', 'Goal', ['lose fat', 'maintain', 'build muscle']],
    ['body.exercise', 'Exercise', 'text', 'lift 3 times a week'],
    ['body.conditions', 'Health conditions', 'text', 'anemia, diabetes, pregnancy...'],
    ['body.body_fat_pct', 'Body fat % (optional)', 'number'],
    ['body.ethnicity', 'Ethnicity (optional, BMI cutoffs only)', 'text']
  ]],
  ['Food', [
    ['food.allergies', 'Allergies or intolerances', 'text', 'none'],
    ['food.diet', 'Diet', 'text', 'vegetarian, halal...'],
    ['food.likes', 'Foods you like', 'text'],
    ['food.dislikes', "Foods you won't eat", 'text']
  ]],
  ['You', [
    ['phone', 'Phone (for the grocery list text)', 'text'],
    ['language', 'Language', ['en', 'es', 'pt', 'zh', 'tl', 'vi', 'ru']]
  ]]
]

const read = (o, path) => path.split('.').reduce((v, k) => v?.[k], o)

function setPath(o, path, v) {
  const keys = path.split('.')
  const last = keys.pop()
  keys.reduce((x, k) => (x[k] ??= {}), o)[last] = v
}

function input(path, label, type, placeholder, value) {
  if (type === 'check') return `<label class="check"><input type="checkbox" data-path="${path}" ${value ? 'checked' : ''}> ${esc(label)}</label>`
  if (Array.isArray(type)) return `<label>${esc(label)} <select data-path="${path}"><option value=""></option>${type.map(o => `<option ${String(value ?? '') === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`
  return `<label>${esc(label)} <input data-path="${path}" type="${type}" placeholder="${esc(placeholder ?? '')}" value="${esc(value ?? '')}"></label>`
}

async function showDetails() {
  const d = await (await fetch('/api/details', { cache: 'no-store' })).json()
  $('form').innerHTML = SECTIONS.map(([title, fields]) => `<h2>${esc(title)}</h2>${fields.map(([path, label, type, ph]) => input(path, label, type, ph, read(d, path))).join('')}`).join('')
}

$('save').addEventListener('click', async () => {
  const out = { body: {}, food: {} }
  for (const el of document.querySelectorAll('[data-path]')) {
    const v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value.trim()
    setPath(out, el.dataset.path, v)
  }
  $('save').disabled = true
  $('status').textContent = 'Looking up stores near you and planning your meals...'
  try {
    const r = await post('/api/details', out)
    $('status').textContent = r.ready ? 'Saved. Your meals are planned.' : `Saved. ${r.reason ?? `Still needed: ${r.missing.join(', ')}.`}`
  } catch {
    $('status').textContent = 'Could not reach Handled. Is it running?'
  }
  $('save').disabled = false
})

let look = {}

function drawLook() {
  $('preview').innerHTML = look.image ? `<img src="${esc(look.image)}" alt="">` : pipSvg(look, 72)
  $('name').value = look.name
  $('color').value = look.color
  $('hat').innerHTML = Object.keys(HATS).map(h => `<option ${look.hat === h ? 'selected' : ''}>${h}</option>`).join('')
}

async function saveLook(patch) {
  look = await post('/api/pip', patch)
  drawLook()
}

$('name').addEventListener('change', e => saveLook({ name: e.target.value.trim() || 'Pip' }))
$('color').addEventListener('change', e => saveLook({ color: e.target.value }))
$('hat').addEventListener('change', e => saveLook({ hat: e.target.value }))
$('drawing').addEventListener('click', () => saveLook({ image: null }))
$('image').addEventListener('change', e => {
  const file = e.target.files[0]
  if (!file) return
  const img = new Image()
  img.onload = () => {
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 160 / Math.max(img.width, img.height))
    canvas.width = Math.round(img.width * scale)
    canvas.height = Math.round(img.height * scale)
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
    URL.revokeObjectURL(img.src)
    saveLook({ image: canvas.toDataURL('image/png') })
  }
  img.src = URL.createObjectURL(file)
})

function route() {
  const tab = location.hash === '#look' ? 'look' : 'details'
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab))
  $('look').hidden = tab !== 'look'
  $('details').hidden = tab !== 'details'
  $('footer').hidden = tab !== 'details'
}

window.addEventListener('hashchange', route)
route()
look = await (await fetch('/api/pip', { cache: 'no-store' })).json()
drawLook()
showDetails()
