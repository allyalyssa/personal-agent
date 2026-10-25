export const PIP_DEFAULT = { name: 'Pip', color: '#2bb673', hat: 'sprout', image: null, hidden: false }

export const HATS = {
  none: '',
  sprout: '<path d="M32 16 v-8" stroke="#2f7d32" stroke-width="3"/><path d="M32 9 q-9 -6 -13 2 q8 3 13 -2" fill="#4caf50"/><path d="M32 9 q9 -6 13 2 q-8 3 -13 -2" fill="#66bb6a"/>',
  chef: '<rect x="20" y="10" width="24" height="9" rx="2" fill="#fff" stroke="#ccc"/><circle cx="24" cy="9" r="6" fill="#fff" stroke="#ccc"/><circle cx="32" cy="6" r="7" fill="#fff" stroke="#ccc"/><circle cx="40" cy="9" r="6" fill="#fff" stroke="#ccc"/>',
  cap: '<path d="M12 22 q20 -18 40 0 z" fill="#1e5aa8"/><rect x="34" y="19" width="20" height="4" rx="2" fill="#1e5aa8"/>',
  bow: '<path d="M32 18 l-10 -6 v12 z M32 18 l10 -6 v12 z" fill="#e5484d"/><circle cx="32" cy="18" r="3" fill="#b91c1c"/>',
  glasses: '<circle cx="24" cy="34" r="7" fill="none" stroke="#123" stroke-width="2"/><circle cx="40" cy="34" r="7" fill="none" stroke="#123" stroke-width="2"/><path d="M31 34 h2" stroke="#123" stroke-width="2"/>'
}

const COLOR = /^#[0-9a-f]{3,8}$/i

export function pipSvg(s, size = 56) {
  const color = COLOR.test(s.color ?? '') ? s.color : PIP_DEFAULT.color
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">
    <ellipse cx="32" cy="40" rx="24" ry="21" fill="${color}"/>
    <ellipse cx="32" cy="48" rx="13" ry="8" fill="#fff" opacity=".25"/>
    <circle cx="24" cy="34" r="4.5" fill="#fff"/><circle cx="40" cy="34" r="4.5" fill="#fff"/>
    <circle cx="25" cy="35" r="2.2" fill="#123"/><circle cx="41" cy="35" r="2.2" fill="#123"/>
    <path d="M26 45 q6 5 12 0" stroke="#123" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    ${HATS[s.hat] ?? ''}
  </svg>`
}
