function luhn(digits: string) {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

const last4 = (s: string) => s.replace(/\D/g, '').slice(-4)

// SSNs, card numbers, government ID numbers and full account numbers never get stored.
// Each is replaced with a masked form that keeps the last 4 digits for reference.
export function redact(text: string) {
  return text
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, m => `[SSN ***-**-${last4(m)}]`)
    .replace(/\b(?:\d[ -]?){12,18}\d\b/g, m => (luhn(m.replace(/\D/g, '')) ? `[card ending ${last4(m)}]` : m))
    .replace(/\b((?:account|acct|member|policy|subscriber|patient|license|licence|DL|ID|passport|A-?number|alien)\s*(?:no\.?|number|#|id)?\s*[:#]?\s*)((?=[A-Z-]*\d)[A-Z0-9-]{6,})\b/gi, (_, label, value) => `${label}[ending ${value.slice(-4)}]`)
    .replace(/\b[A-Z]\d{7}\b/g, m => `[ID ending ${m.slice(-4)}]`)
    .replace(/(?<!\+)\b\d{11,}\b/g, m => `[number ending ${m.slice(-4)}]`)
}

export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redact(value) as T
  if (Array.isArray(value)) return value.map(v => redactDeep(v)) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v)])) as T
  return value
}
