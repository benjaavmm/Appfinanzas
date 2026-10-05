export interface MoneyOptions {
  /** Muestra siempre el signo (+/−) */
  sign?: boolean
  /** Formato compacto: $1,2 M */
  compact?: boolean
}

export const CURRENCIES: { code: string; name: string; locale: string }[] = [
  { code: 'CLP', name: 'Peso chileno', locale: 'es-CL' },
  { code: 'USD', name: 'Dólar estadounidense', locale: 'en-US' },
  { code: 'EUR', name: 'Euro', locale: 'es-ES' },
  { code: 'ARS', name: 'Peso argentino', locale: 'es-AR' },
  { code: 'MXN', name: 'Peso mexicano', locale: 'es-MX' },
  { code: 'COP', name: 'Peso colombiano', locale: 'es-CO' },
  { code: 'PEN', name: 'Sol peruano', locale: 'es-PE' },
  { code: 'UYU', name: 'Peso uruguayo', locale: 'es-UY' },
  { code: 'BRL', name: 'Real brasileño', locale: 'pt-BR' },
]

const cache = new Map<string, Intl.NumberFormat>()

const getFormatter = (currency: string, locale: string, compact: boolean) => {
  const key = `${currency}|${locale}|${compact}`
  let f = cache.get(key)
  if (!f) {
    f = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      notation: compact ? 'compact' : 'standard',
      maximumFractionDigits: compact ? 1 : currencyDecimals(currency),
      minimumFractionDigits: compact ? 0 : undefined,
    })
    cache.set(key, f)
  }
  return f
}

export const currencyDecimals = (currency: string): number =>
  new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2

export const formatMoney = (amount: number, currency = 'CLP', locale = 'es-CL', opts: MoneyOptions = {}): string => {
  const f = getFormatter(currency, locale, !!opts.compact)
  const abs = f.format(Math.abs(amount))
  if (amount < 0) return `−${abs}`
  if (opts.sign && amount > 0) return `+${abs}`
  return abs
}

const separators = (locale: string) => {
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6)
  return {
    group: parts.find((p) => p.type === 'group')?.value ?? '.',
    decimal: parts.find((p) => p.type === 'decimal')?.value ?? ',',
  }
}

/** Formatea el valor canónico ("1234.5") para mostrarlo mientras se escribe: "1.234,5" */
export const formatAmountInput = (raw: string, locale: string, decimals: number): string => {
  if (!raw) return ''
  const [intPart, decPart] = raw.split('.')
  const grouped = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Number(intPart || '0'))
  if (decimals > 0 && decPart !== undefined) return `${grouped}${separators(locale).decimal}${decPart}`
  return grouped
}

/** Convierte lo que muestra el input ("1.234,5") en el valor canónico ("1234.5") */
export const sanitizeAmountInput = (text: string, locale: string, decimals: number): string => {
  const { group, decimal } = separators(locale)
  let t = text
    .replace(/[\s\u00a0\u202f]/g, '')
    .split(group)
    .join('')
  if (decimal !== '.') t = t.split(decimal).join('.')
  t = t.replace(/[^\d.]/g, '')
  const [int = '', ...rest] = t.split('.')
  const intClean = int.replace(/^0+(?=\d)/, '').slice(0, 13)
  if (decimals === 0 || rest.length === 0) return intClean
  return `${intClean || '0'}.${rest.join('').slice(0, decimals)}`
}

export const pct = (value: number, digits = 0): string =>
  `${(value * 100).toLocaleString('es-CL', { maximumFractionDigits: digits })}%`

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export const normalizeText = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ')
