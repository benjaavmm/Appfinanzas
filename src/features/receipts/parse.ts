/**
 * Interpretación de boletas chilenas (funciones puras, sin DOM: también corren en Node).
 *
 * - parseTimbre: lee el XML del timbre electrónico (PDF417) del SII. Es exacto.
 * - parseReceiptText: saca lo que pueda del texto ruidoso del OCR de boletas, facturas y vouchers.
 * - mergeReceipt: junta ambos; el timbre manda en los datos tributarios y el OCR completa el resto.
 * - normalizeRut / formatRut / rutCheckDigit: RUT con dígito verificador (módulo 11).
 */
import type { DateStr } from '../../lib/types'

export interface ReceiptItem {
  name: string
  amount: number
}

export interface ReceiptData {
  /** Monto total pagado (entero en CLP) */
  total?: number
  date?: DateStr
  /** HH:mm */
  time?: string
  /** Nombre del comercio tal como conviene mostrarlo ("Líder", "Farmacias Cruz Verde") */
  merchant?: string
  /** RUT del emisor normalizado: "76123456-7" */
  rut?: string
  /** Folio / número de boleta */
  folio?: string
  /** 'boleta' (39/41), 'factura' (33/34), 'voucher' (comprobante de tarjeta) u 'otro' */
  docType?: 'boleta' | 'factura' | 'voucher' | 'otro'
  items?: ReceiptItem[]
  /** De dónde salió cada dato: timbre electrónico (exacto) u OCR (aproximado) */
  source: 'timbre' | 'ocr' | 'ambos' | 'ninguno'
}

// ─── RUT ────────────────────────────────────────────────────────────────────

/** Dígito verificador (módulo 11) de un cuerpo de RUT: '0'-'9' o 'K' */
export const rutCheckDigit = (body: number | string): string => {
  const digits = String(body).replace(/\D/g, '')
  let sum = 0
  let mul = 2
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += Number(digits[i]) * mul
    mul = mul === 7 ? 2 : mul + 1
  }
  const r = 11 - (sum % 11)
  return r === 11 ? '0' : r === 10 ? 'K' : String(r)
}

/** Formatea y valida un RUT chileno; devuelve null si el dígito verificador no cuadra */
export const normalizeRut = (raw: string): string | null => {
  if (!raw) return null
  let s = sinTildes(String(raw)).toUpperCase()
  // Etiqueta "R.U.T.:" pegada al número
  s = s.replace(/^\s*R\s*\.?\s*U\s*\.?\s*T\s*\.?\s*(?:N\s*[°º.]?\s*)?[:.]?\s*/, '')
  s = s.replace(/[\u2010-\u2015\u2212]/g, '-').replace(/[\s.,'´`·_]/g, '')
  const m = s.match(/^([0-9OQIL|]{6,9})-([0-9KO])$/) ?? s.match(/^([0-9OQIL|]{6,8})([0-9KO])$/)
  if (!m) return null
  // Ruido típico del OCR en el cuerpo: O↔0, I/l↔1
  const body = m[1].replace(/[OQ]/g, '0').replace(/[IL|]/g, '1')
  const dv = m[2] === 'O' ? '0' : m[2]
  const n = parseInt(body, 10)
  if (!Number.isFinite(n) || n < 100_000 || n > 99_999_999) return null
  return rutCheckDigit(n) === dv ? `${n}-${dv}` : null
}

/** "76123456-0" → "76.123.456-0" (para mostrar) */
export const formatRut = (rut: string): string => {
  const norm = normalizeRut(rut)
  if (!norm) return rut
  const [body, dv] = norm.split('-')
  return `${body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv}`
}

// ─── Texto ──────────────────────────────────────────────────────────────────

function sinTildes(s: string) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/** Mayúsculas, sin tildes y con espacios simples: la forma en que se buscan las palabras clave */
const upper = (s: string) =>
  sinTildes(s)
    .toUpperCase()
    .replace(/[\s\u00a0\u2007\u202f]+/g, ' ')
    .trim()

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Clases de caracteres que el OCR suele confundir con cada letra */
const FUZZY: Record<string, string> = {
  A: '[A4]',
  B: '[B8]',
  E: '[E3]',
  G: '[G6]',
  I: '[I1L|!]',
  L: '[L1I|]',
  O: '[O0Q]',
  S: '[S5$]',
  T: '[T7]',
}
const fz = (word: string) =>
  word
    .split('')
    .map((c) => (c === ' ' ? '\\s*' : (FUZZY[c] ?? esc(c))))
    .join('')

/**
 * Palabra(s) clave con bordes (no pegadas a otras letras). Las palabras simples de 4+ letras
 * toleran las confusiones del OCR ("T0TAL", "FECH4"); se exige al menos una letra de verdad
 * al comienzo para que un número como "70741" no pase por "TOTAL".
 */
const kw = (alts: string[]) =>
  new RegExp(
    `(?<![A-Z0-9])(?=[^A-Z]{0,3}[A-Z])(?:${alts.map((a) => (/^[A-Z]{4,}(?: [A-Z]+)*$/.test(a) ? fz(a) : a)).join('|')})(?![A-Z])`,
  )

const TOTAL = '[T7I][O0Q]\\s?[T7I][A4]\\s?[L1I|]'
const MONTO = 'M[O0Q]N[T7][O0Q]'
const BOLETA = '[B8][O0Q][L1I][E3][T7][A4]'
const FACTURA = 'F[A4]C[T7]UR[A4]'
const ELECTR = '[E3][L1I][E3]C[T7]R'
const NUM = '(?:N\\s*[°ºO0*.:]?|NRO\\.?|NUM(?:ERO)?\\.?|#)'

const MAX_AMOUNT = 999_999_999

// ─── Montos ─────────────────────────────────────────────────────────────────

interface Money {
  value: number
  /** Interpretación alternativa cuando un "$" se leyó como "5" pegado al número */
  alt?: number
  currency: boolean
  grouped: boolean
  negative: boolean
  digits: string
}

const moneyRe = (spaced: boolean) =>
  new RegExp(
    String.raw`(-)?(?:(CLP|\$|(?<![A-Z])S)\s*)?(-)?(?<![\d.,])(\d{1,3}(?:\.\d{3})+|\d{1,3}(?:,\d{3})+` +
      (spaced ? String.raw`|\d{1,3}(?: \d{3})+` : '') +
      String.raw`|\d+)(?:[.,](\d{1,2}))?(-(?!\d))?(?![\d]|[.,]\d)`,
    'g',
  )
const MONEY_RE = moneyRe(false)
const MONEY_SPACED_RE = moneyRe(true)

const scanMoney = (s: string, spaced = false): Money[] => {
  const out: Money[] = []
  for (const m of s.matchAll(spaced ? MONEY_SPACED_RE : MONEY_RE)) {
    const num = m[4]
    const digits = num.replace(/\D/g, '')
    const grouped = /\D/.test(num)
    const currency = !!m[2]
    let alt: number | undefined
    if (!currency && digits.length >= 3 && digits[0] === '5' && digits[1] !== '0') {
      const firstGroup = num.split(/\D/)[0]
      if (!grouped || firstGroup.length >= 2) alt = parseInt(digits.slice(1), 10)
    }
    out.push({
      value: parseInt(digits, 10),
      alt,
      currency,
      grouped,
      negative: !!(m[1] || m[3] || m[6]),
      digits,
    })
  }
  return out
}

const looksMoney = (t: Money) => t.currency || t.grouped || (t.digits.length >= 3 && t.digits.length <= 6 && t.digits[0] !== '0')

/** El monto de una línea con palabra clave: el último que parezca plata */
const pickAmount = (toks: Money[], opts: { strict?: boolean; negative?: boolean } = {}): Money | undefined => {
  const ok = toks.filter(
    (t) =>
      (opts.negative || !t.negative) &&
      t.value >= 10 &&
      t.value <= MAX_AMOUNT &&
      !(t.digits.length > 1 && t.digits[0] === '0') &&
      (t.currency || t.grouped || t.digits.length <= 7),
  )
  const money = ok.filter((t) => t.currency || t.grouped)
  return money.at(-1) ?? (opts.strict ? undefined : ok.at(-1))
}

// Cosas con números que NO son montos; se borran (con espacios, para no mover posiciones)
const NUM_DATE_RE = /(?<![\d.,])(\d{1,2})\s?([/\-.])\s?(\d{1,2})\s?([/\-.])\s?(\d{4}|\d{2})(?![\d])/g
const ISO_DATE_RE = /(?<![\d.,])((?:19|20)\d{2})\s?([/\-.])\s?(\d{1,2})\s?\2\s?(\d{1,2})(?!\d)/g
const TEXT_DATE_RE = /(?<!\d)(\d{1,2})\s*(?:DE\s+|[-/.,]\s*|\s*)([A-Z0]{3,10})\.?\s*(?:DEL?\s+|[-/.,]\s*|\s*)(\d{4}|\d{2})(?!\d)/g
const TIME_RE =
  /(?<!\d)(?<!\d[:;])([01]?\d|2[0-3])\s?[:;]\s?([0-5]\d)(?:\s?[:;]\s?([0-5]\d))?(?:\s?([AP])\.?\s?M\.?(?![A-Z]))?(?!\d)/g
const RUT_LIKE_RE = /(?<![\dA-Z])[0-9O]{1,2}[.,]?\s?[0-9O]{3}[.,]?\s?[0-9O]{3}\s?[-\u2010-\u2015]\s?[0-9KO](?![\dA-Z])/g
const RUT_LIKE_ONE_RE = new RegExp(RUT_LIKE_RE.source)
const PERCENT_RE = /\d+(?:[.,]\d+)?\s?%/g
const CARD_RE = /(?:[*X#•·]\s?){3,}[\s-]*\d{2,4}|(?:TERMINADA|TERMINA|FINAL)\s*(?:EN\s*)?\d{4}/g
const PHONE_RE = /\+?\s?56[\s-]?\(?\d\)?[\s-]?\d{3,4}[\s-]?\d{4}|(?<![\d.,])[29][\s-]\d{4}[\s-]?\d{4}(?!\d)/g
const LONG_NUM_RE = /(?<![\d.,])\d{8,}(?![\d])/g

const blank = (m: string) => ' '.repeat(m.length)

const cleanAmounts = (up: string) =>
  up
    .replace(RUT_LIKE_RE, blank)
    .replace(ISO_DATE_RE, blank)
    .replace(NUM_DATE_RE, blank)
    .replace(TEXT_DATE_RE, (m, _d: string, w: string) => (monthOf(w) ? blank(m) : m))
    .replace(TIME_RE, blank)
    .replace(PERCENT_RE, blank)
    .replace(CARD_RE, blank)
    .replace(PHONE_RE, blank)
    .replace(LONG_NUM_RE, blank)

// ─── Palabras clave del total ───────────────────────────────────────────────

const IVA_INCL_RE = /(?:C\/\s*|CON\s+)?[I1L]VA\s*INC[A-Z.]*|INCLUYE\s+[I1L]VA|C\/\s*[I1L]VA|CON\s+[I1L]VA/g

const P1_RE = kw([
  `${TOTAL}\\s*(?:A\\s*)?P[A4]G[A4]R`,
  `${MONTO}\\s*${TOTAL}`,
  `(?:IMPORTE|VALOR)\\s*${TOTAL}`,
  `${TOTAL}\\s*(?:DE\\s*(?:LA\\s*)?)?(?:COMPRA|VENTA|PAGADO|BOLETA|DOCUMENTO|FACTURA|OPERACION|TRANSACCION|CLP)`,
  `${MONTO}\\s*(?:DE\\s*(?:LA\\s*)?)?(?:PAGADO|COMPRA|VENTA|OPERACION|TRANSACCION|A\\s*PAGAR)`,
  `A\\s*P[A4]G[A4]R`,
])
const P2_RE = kw([TOTAL])
const P3_RE = kw([MONTO, 'VALOR', 'IMPORTE'])
const P4_RE = kw(['TARJETA', 'DEBITO', 'CREDITO', 'REDCOMPRA', 'PAGO', 'PAGADO', 'VISA', 'MASTERCARD', 'AMEX'])

const SUBTOTAL_RE = kw([`SUB\\s*-?\\s*${TOTAL}`])
const NETO_RE = kw([fz('NETO')])
const IVA_RE = kw(['[I1L|]V[A4]'])
const EXENTO_RE = kw(['EXENTOS?'])
const DESC_RE = kw(['DESCUENTOS?', 'DESCTOS?\\.?', 'DSCTOS?\\.?', 'DCTOS?\\.?', `${fz('AHORRO')}S?`, 'AHORRASTE'])
const EFECTIVO_RE = kw([fz('EFECTIVO')])
const VUELTO_RE = kw([fz('VUELTO'), fz('CAMBIO')])

/** Líneas que tienen montos pero no son el total */
const NOT_TOTAL_RE = kw([
  `SUB\\s*-?\\s*${TOTAL}`,
  fz('NETO'),
  '[I1L|]V[A4]',
  'DESC(?:UENTOS?|TOS?)?\\.?',
  'DSCTOS?\\.?',
  'DCTOS?\\.?',
  `${fz('AHORRO')}S?`,
  'AHORRASTE',
  fz('VUELTO'),
  fz('EFECTIVO'),
  fz('CAMBIO'),
  fz('PROPINA'),
  'ITEMS?',
  'ITEM\\(S\\)',
  'ARTICULOS?',
  'ARTS?\\.?',
  'PRODUCTOS',
  'UNIDADES',
  'BULTOS',
  'PUNTOS',
  'SALDO',
  'EXENTOS?',
  'IMPUESTOS?',
  'IMPTO\\.?',
  'I\\.?L\\.?A\\.?',
  `${fz('CUOTA')}S?`,
  'INTERES(?:ES)?',
  `${fz('LITRO')}S?`,
  'LTS?\\.?',
  'PRECIO',
  'UNITARIO',
  'P\\.?\\s?UNIT\\.?',
  'CANT(?:IDAD)?\\.?',
  'DONACION(?:ES)?',
  'REDONDEO',
  'ESPECIFICO',
  'SUGERID[AO]',
  'RETENCION',
])
const PER_LITER_RE = /\/\s?[L1I|](?:[T7][S5]?|ITRO)?(?![A-Z])/

/** Líneas cuyos números suelen ser códigos, no plata */
const CODE_LINE_RE = kw([
  'AUT\\.?',
  'AUTORIZ[A-Z]*',
  'COD\\.?',
  'CODIGO',
  'OPERACION',
  'OPER\\.?',
  'TRX',
  'TRANSACCION',
  'REF\\.?',
  'REFERENCIA',
  'LOTE',
  'TERMINAL',
  'TERM\\.?',
  'CAJA',
  'LOCAL',
  'SUCURSAL',
  'CAJERO',
  'VENDEDOR',
  'FOLIO',
  'NRO\\.?',
  BOLETA,
  FACTURA,
  'RUT',
  'R\\.U\\.T\\.?',
  'FONO',
  'TEL\\.?',
  'TELEFONO',
  `${fz('CUOTA')}S?`,
  'ID',
  'TICKET',
  'SII',
  'RES\\.?',
  'RESOLUCION',
  'CLIENTE',
  'SURTIDOR',
  'MANGUERA',
  'BOMBA',
  'ISLA',
  'KM',
  'KILOMETRAJE',
  'PATENTE',
  'TARJETA',
  'TURNO',
  'SERIE',
  'MAQUINA',
  'POS',
  'ORDEN',
  'PEDIDO',
  'MESA',
  'N\\s*[°º]',
])

const NOT_TOTAL_G = new RegExp(NOT_TOTAL_RE.source, 'g')
const LEVELS: [number, RegExp][] = [
  [1, P1_RE],
  [2, P2_RE],
  [3, P3_RE],
  [4, P4_RE],
]

/** Fin del campo que parte en `from`: la primera palabra (3+ letras) después del primer dígito */
const fieldEnd = (c: string, from: number) => {
  const d = c.slice(from).search(/\d/)
  if (d < 0) return c.length
  const w = c.slice(from + d).search(/[A-Z]{3,}/)
  return w < 0 ? c.length : from + d + w
}

interface TotalLine {
  /** 1 = "TOTAL A PAGAR"/"MONTO TOTAL"…, 2 = "TOTAL", 3 = "MONTO"/"VALOR", 4 = medio de pago */
  p: number
  /** Dónde termina la palabra clave y dónde termina su campo (la línea puede traer varios) */
  end: number
  segEnd: number
  /** Línea sin fechas, horas, RUT, % ni números de tarjeta */
  c: string
}

const classifyTotal = (up: string): TotalLine | null => {
  const s = up.replace(IVA_INCL_RE, blank)
  const c = cleanAmounts(s)
  for (const [p, re] of LEVELS) {
    const m = re.exec(s)
    if (!m) continue
    const end = m.index + m[0].length
    // El campo parte después del último número anterior ("EFECTIVO 20.000  TOTAL 12.990")
    let fieldStart = 0
    for (const d of c.slice(0, m.index).matchAll(/\d+/g)) fieldStart = (d.index ?? 0) + d[0].length
    const firstDigit = c.slice(end).search(/\d/)
    const labelEnd = firstDigit < 0 ? c.length : end + firstDigit
    const segEnd = fieldEnd(c, end)
    // "SUBTOTAL", "TOTAL ITEMS", "MONTO CUOTA", "MONTO NETO"…: no es el total
    for (const x of s.matchAll(NOT_TOTAL_G)) {
      const xi = x.index ?? 0
      if (xi >= fieldStart && xi < labelEnd) return null
    }
    if (PER_LITER_RE.test(c.slice(fieldStart, segEnd))) return null
    return { p, end, segEnd, c }
  }
  return null
}

// ─── Fechas y horas ─────────────────────────────────────────────────────────

const MONTHS: [string, number][] = [
  ['ENERO', 1],
  ['FEBRERO', 2],
  ['MARZO', 3],
  ['ABRIL', 4],
  ['MAYO', 5],
  ['JUNIO', 6],
  ['JULIO', 7],
  ['AGOSTO', 8],
  ['SEPTIEMBRE', 9],
  ['SETIEMBRE', 9],
  ['OCTUBRE', 10],
  ['NOVIEMBRE', 11],
  ['DICIEMBRE', 12],
  ['JANUARY', 1],
  ['APRIL', 4],
  ['AUGUST', 8],
  ['DECEMBER', 12],
]

function monthOf(word: string): number | null {
  const w = word.replace(/0/g, 'O').replace(/\.$/, '')
  if (w.length < 3) return null
  for (const [name, m] of MONTHS) if (name.startsWith(w)) return m
  return null
}

const pad = (n: number) => String(n).padStart(2, '0')

const validDate = (y: number, m: number, d: number): string | null => {
  if (y < 2000 || y > 2099 || m < 1 || m > 12 || d < 1) return null
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate()
  if (d > dim) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

const year4 = (y: string) => (y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10))

/** Todas las fechas de una línea, en formato AAAA-MM-DD */
const datesIn = (up: string): string[] => {
  const out: string[] = []
  for (const m of up.matchAll(ISO_DATE_RE)) {
    const d = validDate(parseInt(m[1], 10), parseInt(m[3], 10), parseInt(m[4], 10))
    if (d) out.push(d)
  }
  const s = up.replace(ISO_DATE_RE, blank)
  for (const m of s.matchAll(NUM_DATE_RE)) {
    // Con año de 2 dígitos se exige el mismo separador (para no leer montos como fechas)
    if (m[5].length === 2 && m[2] !== m[4]) continue
    const a = parseInt(m[1], 10)
    const b = parseInt(m[3], 10)
    const y = year4(m[5])
    const d = validDate(y, b, a) ?? validDate(y, a, b)
    if (d) out.push(d)
  }
  for (const m of s.matchAll(TEXT_DATE_RE)) {
    const month = monthOf(m[2])
    if (!month) continue
    const d = validDate(year4(m[3]), month, parseInt(m[1], 10))
    if (d) out.push(d)
  }
  return out
}

const timesIn = (up: string): string[] => {
  const out: string[] = []
  const s = up.replace(ISO_DATE_RE, blank).replace(NUM_DATE_RE, blank)
  for (const m of s.matchAll(TIME_RE)) {
    let h = parseInt(m[1], 10)
    if (m[4] === 'P' && h < 12) h += 12
    if (m[4] === 'A' && h === 12) h = 0
    out.push(`${pad(h)}:${m[2]}`)
  }
  // "HORA: 14.32" (el OCR a veces lee ":" como ".")
  if (!out.length) {
    const m = s.match(/HORA\S*\s*[:.]?\s*([01]?\d|2[0-3])\s?[.h]\s?([0-5]\d)(?![\d.,])/)
    if (m) out.push(`${pad(parseInt(m[1], 10))}:${m[2]}`)
  }
  return out
}

const DATE_LABEL_RE = kw(['FECHA', 'FEC\\.?', 'EMISION', 'EMITIDA?', 'DATE'])
const DATE_BAD_RE = kw([
  'VENC[A-Z]*',
  'VTO\\.?',
  'RES\\.?',
  'RESOL[A-Z]*',
  'VALID[A-Z]*',
  'VIGEN[A-Z]*',
  'HASTA',
  'EXPIRA[A-Z]*',
  'CADUC[A-Z]*',
  'NACIM[A-Z]*',
  'PLAZO',
  'DESDE',
  'PROXIM[OA]',
  'INICIO',
  'CONTRATO',
  'CANJE[A-Z]*',
])
const TIME_LABEL_RE = kw(['HORA', 'HRS?\\.?'])
const TIME_BAD_RE = kw(['HORARIO', 'ATENCION', 'ABIERTO', 'LUNES', 'DOMINGO', 'LUN', 'DOM'])

// ─── Comercios ──────────────────────────────────────────────────────────────

interface Brand {
  name: string
  keys: string[]
  /** Peso: marcas propias 30; submarcas 40; razones sociales 15 */
  w?: number
  /** Palabra común o calle: solo vale si encabeza una línea del encabezado */
  risky?: boolean
}

const BRANDS: Brand[] = [
  { name: 'Líder Express', keys: ['EXPRESS DE LIDER', 'LIDER EXPRESS', 'EXPRESS LIDER'], w: 40 },
  { name: 'aCuenta', keys: ['SUPERBODEGA ACUENTA', 'SUPER BODEGA ACUENTA'], w: 40 },
  { name: 'aCuenta', keys: ['ACUENTA'], w: 40, risky: true },
  { name: 'Líder', keys: ['HIPER LIDER', 'HIPERMERCADO LIDER', 'LIDER'] },
  { name: 'Líder', keys: ['WALMART CHILE', 'WALMART'], w: 15 },
  { name: 'Jumbo', keys: ['JUMBO'] },
  { name: 'Santa Isabel', keys: ['SUPERMERCADO SANTA ISABEL', 'SUPERMERCADOS SANTA ISABEL'] },
  { name: 'Santa Isabel', keys: ['SANTA ISABEL'], risky: true },
  { name: 'Unimarc', keys: ['UNIMARC'] },
  { name: 'Unimarc', keys: ['RENDIC HERMANOS', 'RENDIC'], w: 15 },
  { name: 'Tottus', keys: ['HIPERMERCADOS TOTTUS', 'TOTTUS'] },
  { name: 'Mayorista 10', keys: ['MAYORISTA 10', 'MAYORISTA10'] },
  { name: 'Mayorista 10', keys: ['SUPER 10'], risky: true },
  { name: 'Alvi', keys: ['ALVI'] },
  { name: 'OK Market', keys: ['OK MARKET', 'OKMARKET'] },
  { name: 'Oxxo', keys: ['OXXO'] },
  { name: 'Pronto', keys: ['PRONTO COPEC'], w: 40 },
  { name: 'Pronto', keys: ['PRONTO'], risky: true },
  { name: 'Copec', keys: ['COPEC', 'COMPANIA DE PETROLEOS DE CHILE'] },
  { name: 'Shell', keys: ['SHELL'] },
  { name: 'Shell', keys: ['ENEX'], w: 15 },
  { name: 'Aramco', keys: ['ARAMCO', 'PETROBRAS'] },
  { name: 'Aramco', keys: ['ESMAX'], w: 15 },
  { name: 'Cruz Verde', keys: ['FARMACIAS CRUZ VERDE', 'CRUZ VERDE', 'CRUZVERDE'] },
  { name: 'Salcobrand', keys: ['SALCOBRAND', 'SALCO BRAND'] },
  { name: 'Farmacias Ahumada', keys: ['FARMACIAS AHUMADA', 'FARMACIA AHUMADA'] },
  { name: 'Farmacias Ahumada', keys: ['AHUMADA', 'FASA'], risky: true },
  { name: 'Dr. Simi', keys: ['DR SIMI', 'DOCTOR SIMI', 'FARMACIAS SIMILARES', 'FARMACIAS DR SIMI'] },
  { name: 'Knop', keys: ['FARMACIAS KNOP', 'LABORATORIO KNOP'] },
  { name: 'Falabella', keys: ['FALABELLA'] },
  { name: 'Paris', keys: ['PARIS'], risky: true },
  { name: 'Ripley', keys: ['RIPLEY'] },
  { name: 'Hites', keys: ['HITES'] },
  { name: 'La Polar', keys: ['EMPRESAS LA POLAR', 'LA POLAR', 'LAPOLAR'] },
  { name: 'Zara', keys: ['ZARA'] },
  { name: 'Tricot', keys: ['TRICOT'] },
  { name: 'abcdin', keys: ['ABCDIN', 'ABC DIN'] },
  { name: 'Corona', keys: ['CORONA'], risky: true },
  { name: 'Sodimac', keys: ['SODIMAC', 'HOMECENTER', 'HOME CENTER'] },
  { name: 'Easy', keys: ['EASY'], risky: true },
  { name: 'Construmart', keys: ['CONSTRUMART'] },
  { name: 'Casaideas', keys: ['CASAIDEAS', 'CASA IDEAS'] },
  { name: 'IKEA', keys: ['IKEA'] },
  { name: 'Starbucks', keys: ['STARBUCKS'] },
  { name: "McDonald's", keys: ['MCDONALDS', 'MC DONALDS', 'MCDONALD'] },
  { name: "McDonald's", keys: ['ARCOS DORADOS'], w: 15 },
  { name: 'Burger King', keys: ['BURGER KING'] },
  { name: 'KFC', keys: ['KFC', 'KENTUCKY FRIED'] },
  { name: 'Doggis', keys: ['DOGGIS'] },
  { name: 'Juan Maestro', keys: ['JUAN MAESTRO'] },
  { name: 'Telepizza', keys: ['TELEPIZZA', 'TELE PIZZA'] },
  { name: "Papa John's", keys: ['PAPA JOHNS', 'PAPA JOHN'] },
  { name: "Domino's", keys: ['DOMINOS PIZZA', 'DOMINOS'] },
  { name: 'Pizza Hut', keys: ['PIZZA HUT'] },
  { name: 'Little Caesars', keys: ['LITTLE CAESARS'] },
  { name: 'Subway', keys: ['SUBWAY'] },
  { name: "Wendy's", keys: ['WENDYS'] },
  { name: "Dunkin'", keys: ['DUNKIN'] },
  { name: 'Juan Valdez', keys: ['JUAN VALDEZ'] },
  { name: 'Castaño', keys: ['CASTANO'], risky: true },
  { name: 'Preunic', keys: ['PREUNIC'] },
  { name: 'DBS', keys: ['DBS BEAUTY STORE', 'DBS BEAUTY'] },
  { name: 'DBS', keys: ['DBS'], risky: true },
  { name: 'Maicao', keys: ['MAICAO'] },
  { name: 'Lápiz López', keys: ['LAPIZ LOPEZ'] },
  { name: 'Librería Nacional', keys: ['LIBRERIA NACIONAL'] },
  { name: 'SuperZoo', keys: ['SUPERZOO', 'SUPER ZOO'] },
  { name: 'Decathlon', keys: ['DECATHLON'] },
  { name: 'Cinemark', keys: ['CINEMARK'] },
  { name: 'Cineplanet', keys: ['CINEPLANET'] },
  { name: 'Entel', keys: ['ENTEL'] },
  { name: 'Movistar', keys: ['MOVISTAR'] },
]

/** Lo que el OCR confunde entre letras y números, llevado a una sola forma */
const skeleton = (s: string) =>
  upper(s)
    .replace(/0/g, 'O')
    .replace(/[1|!]/g, 'I')
    .replace(/[5$]/g, 'S')
    .replace(/8/g, 'B')
    .replace(/[^A-Z0-9&]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

interface BrandKey {
  name: string
  letters: string
  re: RegExp
  w: number
  risky: boolean
  /** Números de 2+ dígitos que son parte de la marca ("SUPER 10") */
  numbers: number
}

const BRAND_KEYS: BrandKey[] = BRANDS.flatMap((b) =>
  b.keys.map((k) => {
    const letters = skeleton(k).replace(/ /g, '')
    return {
      name: b.name,
      letters,
      re: new RegExp(`(?<![A-Z0-9])${letters.split('').map(esc).join(' ?')}(?![A-Z0-9])`),
      w: b.w ?? 30,
      risky: !!b.risky,
      numbers: (k.match(/\d{2,}/g) ?? []).length,
    }
  }),
)
const BRAND_NAMES = new Set(BRANDS.map((b) => b.name).concat('H&M'))

/** Distancia de edición; corta apenas se pasa de `max` (devuelve max + 1) */
const levenshtein = (a: string, b: string, max: number): number => {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (cur[j] < rowMin) rowMin = cur[j]
    }
    if (rowMin > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

/** ¿Aparece la clave, con 1–2 errores, alineada con palabras completas? */
const fuzzyWords = (s1: string, key: string, maxEd: number): boolean => {
  const words = s1.split(' ')
  for (let i = 0; i < words.length; i++) {
    let concat = ''
    for (let j = i; j < Math.min(words.length, i + 4); j++) {
      concat += words[j]
      if (concat.length > key.length + 1) break
      if (Math.abs(concat.length - key.length) <= 1 && levenshtein(concat, key, maxEd) <= maxEd) return true
    }
  }
  return false
}

interface BrandHit {
  name: string
  score: number
}

const brandInLine = (raw: string, up: string, idx: number, header: boolean): BrandHit | undefined => {
  if (/(?<![A-Z])H\s?&\s?M(?![A-Z])/.test(up)) return { name: 'H&M', score: 40 + (header ? 20 - idx * 0.5 : 5) }
  const s1 = skeleton(raw)
  if (!s1) return undefined
  const compact = s1.replace(/ /g, '')
  // Las marcas van en líneas cortas (logo, razón social); en las largas solo se buscan exactas
  const fuzzyLine = compact.length <= 40
  let best: BrandHit | undefined
  for (const k of BRAND_KEYS) {
    let exact = false
    // Sin espacios, una coincidencia exacta tiene que aparecer tal cual: filtro barato antes del regex
    const maybe = compact.includes(k.letters)
    if (k.risky) {
      if (!header || !maybe) continue
      const m = k.re.exec(s1)
      if (!m || m.index !== 0) continue
      // Con números aparte de los de la marca suele ser una dirección ("Santa Isabel 0123")
      if ((up.match(/\d{2,}/g) ?? []).length > k.numbers) continue
      exact = true
    } else if (maybe && k.re.test(s1)) {
      exact = true
    } else {
      const len = k.letters.length
      const fuzzyOk = fuzzyLine && (len >= 6 || (len === 5 && compact.length <= len + 3))
      if (!fuzzyOk || !fuzzyWords(s1, k.letters, len >= 9 ? 2 : 1)) continue
    }
    const score = k.w + (exact ? 10 : 0) + (header ? 20 - idx * 0.5 : 5) + k.letters.length * 0.3
    if (!best || score > best.score) best = { name: k.name, score }
  }
  return best
}

const GENERIC_RE = kw([
  'SUSHI',
  'LIBRERIA',
  'PANADERIA',
  'PASTELERIA',
  'BOTILLERIA',
  'FERRETERIA',
  'FARMACIAS?',
  'MINI ?MARKET',
  'MINIMERCADO',
  'VERDULERIA',
  'FRUTERIA',
  'CARNICERIA',
  'PESCADERIA',
  'PELUQUERIA',
  'BARBERIA',
  'VETERINARIA',
  'RESTAURANTE?',
  'RESTOBAR',
  'CAFETERIA',
  'CAFE',
  'PIZZERIA',
  'SANGUCHERIA',
  'FUENTE DE SODA',
  'BAZAR',
  'EMPORIO',
  'ALMACEN',
  'KIOSKO',
  'KIOSCO',
  'OPTICA',
  'JUGUETERIA',
  'ZAPATERIA',
  'LAVANDERIA',
  'SERVICENTRO',
  'SUPERMERCADOS?',
  'HELADERIA',
  'CERVECERIA',
  'PERFUMERIA',
  'JOYERIA',
  'FLORERIA',
  'PAPELERIA',
  'DISTRIBUIDORA',
])

const HEADER_SKIP_RE = kw([
  'RUT',
  'R\\.?\\s?U\\.?\\s?T\\.?',
  BOLETA,
  FACTURA,
  `${ELECTR}[A-Z]*`,
  'GIRO',
  'SII',
  'S\\.I\\.I\\.?',
  'RESOLUCION',
  'RES',
  'TIMBRE',
  'COMPROBANTE',
  'VOUCHER',
  'TRANSBANK',
  'REDCOMPRA',
  'GETNET',
  'KLAP',
  'WEBPAY',
  'VENTA',
  'VTA',
  'DEBITO',
  'CREDITO',
  'TARJETA',
  'ORIGINAL',
  'COPIA',
  'CLIENTE',
  'DUPLICADO',
  'MATRIZ',
  'SUCURSAL',
  'LOCAL',
  'CAJA',
  'CAJERO',
  'TERMINAL',
  'FECHA',
  'HORA',
  'FOLIO',
  'NRO',
  'DIRECCION',
  'DIR',
  'AV',
  'AVDA',
  'AVENIDA',
  'CALLE',
  'PASAJE',
  'PSJE',
  'CAMINO',
  'RUTA',
  'KM',
  'OFICINA',
  'OF',
  'DEPTO',
  'PISO',
  'TEL',
  'TELEFONO',
  'FONO',
  'FAX',
  'E?-?MAIL',
  'BIENVENID[OA]S?',
  'GRACIAS',
  'ATENDIDO',
  'VENDEDOR',
  'COMUNA',
  'DOCUMENTO',
  'TRIBUTARIO',
  'NOTA',
  'GUIA',
  'DESPACHO',
  'TICKET',
  'PEDIDO',
  'ORDEN',
  'MESA',
  'GARZON',
  'MESERO',
  'ACTIVIDAD(?:ES)?',
  'COMERCIALIZACION',
  TOTAL,
  'SUBTOTAL',
  MONTO,
  'VALOR',
  'DESCRIPCION',
  'DETALLE',
  'CANTIDAD',
  'PRECIO',
  'IVA',
  'NETO',
  'AUTORIZACION',
  'OPERACION',
  `${fz('CUOTA')}S?`,
  'N\\s*[°º]',
  'ACEPTO',
  'PAGAR',
  'CONTRATO',
  'EMISOR',
  'VERIFIQUE',
])

const COMMUNES = new Set(
  (
    'SANTIAGO,SANTIAGO CENTRO,PROVIDENCIA,LAS CONDES,VITACURA,NUNOA,MAIPU,LA FLORIDA,PUENTE ALTO,LA REINA,PENALOLEN,MACUL,' +
    'SAN MIGUEL,ESTACION CENTRAL,QUILICURA,RECOLETA,INDEPENDENCIA,LO BARNECHEA,HUECHURABA,CONCHALI,RENCA,PUDAHUEL,' +
    'CERRILLOS,LA CISTERNA,SAN BERNARDO,SAN JOAQUIN,QUINTA NORMAL,LO PRADO,CERRO NAVIA,EL BOSQUE,LA GRANJA,LA PINTANA,' +
    'SAN RAMON,LO ESPEJO,PEDRO AGUIRRE CERDA,COLINA,LAMPA,BUIN,TALAGANTE,MELIPILLA,VINA DEL MAR,VALPARAISO,CONCEPCION,' +
    'TEMUCO,ANTOFAGASTA,LA SERENA,COQUIMBO,RANCAGUA,TALCA,CHILLAN,PUERTO MONTT,VALDIVIA,OSORNO,IQUIQUE,ARICA,CALAMA,' +
    'COPIAPO,PUNTA ARENAS,LOS ANGELES,QUILPUE,VILLA ALEMANA,TALCAHUANO,CURICO,SAN ANTONIO,CHILE,REGION METROPOLITANA,RM,R M'
  ).split(','),
)

const isCommuneLine = (up: string) => {
  const parts = up
    .replace(/[.()]/g, ' ')
    .split(/[-,/]|\s{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  return parts.length > 0 && parts.every((p) => COMMUNES.has(p))
}

const isSensibleHeader = (up: string) => {
  if (up.length < 3 || up.length > 45) return false
  if (/\d{2,}/.test(up)) return false
  if (/@|WWW|HTTP|\.CL(?![A-Z])|\.COM(?![A-Z])/.test(up)) return false
  if (HEADER_SKIP_RE.test(up) || isCommuneLine(up)) return false
  const letters = (up.match(/[A-Z]/g) ?? []).length
  const nonSpace = up.replace(/\s/g, '').length
  if (letters < 3 || letters / nonSpace < 0.7) return false
  if (!/(?=[A-Z]*[AEIOU])(?=[A-Z]*[B-DF-HJ-NP-TV-Z])[A-Z]{3,}/.test(up)) return false
  return up.split(' ').length <= 6
}

const SMALL_WORDS = new Set(['de', 'del', 'y', 'e', 'en', 'a', 'al', 'por', 'con', 'para', 'o'])
const NO_ACCENT_ERIA = new Set(['materia', 'miseria', 'histeria', 'bacteria', 'arteria', 'criteria'])
/** Tildes que el OCR suele perder en nombres de comercios */
const ACCENTS: Record<string, string> = {
  almacen: 'almacén',
  cafe: 'café',
  compania: 'compañía',
  optica: 'óptica',
  electronica: 'electrónica',
  electronicos: 'electrónicos',
  informatica: 'informática',
  informaticos: 'informáticos',
  tecnico: 'técnico',
  tecnicos: 'técnicos',
  musica: 'música',
  jardin: 'jardín',
  rapido: 'rápido',
  rapida: 'rápida',
}

const titleCase = (s: string) =>
  s
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => {
      const lw = w.toLowerCase()
      if (i > 0 && SMALL_WORDS.has(lw)) return lw
      if (/[\d&]/.test(w)) return w.toUpperCase()
      const letters = sinTildes(w).replace(/[^A-Za-z]/g, '')
      // Siglas cortas sin vocales: "KFC", "DBS"
      if (letters.length >= 2 && letters.length <= 4 && !/[AEIOUYaeiouy]/.test(letters)) return w.toUpperCase()
      let t = lw
      if (/^[a-zñ]{4,}eria$/.test(t) && !NO_ACCENT_ERIA.has(t)) t = t.replace(/eria$/, 'ería')
      t = ACCENTS[t] ?? t
      return t.charAt(0).toUpperCase() + t.slice(1)
    })
    .join(' ')

const LEGAL_FORM_RE =
  /[\s,.-]+(?:S\.?\s?A\.?|S\.?\s?P\.?\s?A\.?|LTDA\.?|LIMITADA|E\.?\s?I\.?\s?R\.?\s?L\.?|Y\s+C[IÍ]A\.?|&\s*C[IÍ]A\.?|C[IÍ]A\.?)\s*$/i

/** Limpia un nombre de comercio y lo deja en formato título, sin "S.A.", "SpA", "Ltda." */
const prettyMerchant = (raw: string): string | undefined => {
  let s = raw
    .replace(/[|_~*=#<>{}[\]"“”«»]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  s = s.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}.)'&]+$/u, '')
  for (let k = 0; k < 3; k++) s = s.replace(LEGAL_FORM_RE, '').trim()
  // "Sushi Kai - Providencia" → "Sushi Kai"
  const parts = s.split(/\s+[-–]\s+/)
  if (parts.length > 1 && isCommuneLine(upper(parts[parts.length - 1]))) s = parts.slice(0, -1).join(' - ')
  s = s.replace(/[\s,.-]+$/, '').trim()
  if (s.replace(/[^\p{L}]/gu, '').length < 2) return undefined
  const t = titleCase(s)
  return t.length > 40 ? t.slice(0, 40).replace(/\s+\S*$/, '') : t
}

const cleanItemName = (raw: string): string | undefined => {
  let s = raw
    .replace(/[|_~=#<>{}[\]"“”«»]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  s = s.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}%)]+$/u, '')
  if ((s.match(/\p{L}/gu) ?? []).length < 2) return undefined
  const lower = s.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

// ─── Timbre electrónico (XML TED) ───────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ntilde: 'ñ',
  Ntilde: 'Ñ',
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  Aacute: 'Á',
  Eacute: 'É',
  Iacute: 'Í',
  Oacute: 'Ó',
  Uacute: 'Ú',
  uuml: 'ü',
  Uuml: 'Ü',
  deg: '°',
  ordm: 'º',
  ordf: 'ª',
}

const ENTITY_RE = /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi

/** Entidades XML/HTML; dos pasadas por si vienen doblemente escapadas ("&amp;#209;") */
const decodeEntities = (s: string): string => {
  let out = s
  for (let pass = 0; pass < 2; pass++) {
    const next = out.replace(ENTITY_RE, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
      }
      return NAMED_ENTITIES[e] ?? m
    })
    if (next === out) break
    out = next
  }
  return out
}

// Bytes 0x80–0x9F en Windows-1252 (para deshacer "Ã‘" → "Ñ")
const CP1252_CHARS = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ'
const MOJIBAKE_RE = new RegExp(`([\u00c2\u00c3])([\u00a0-\u00bf${CP1252_CHARS}\u0080-\u009f])`, 'g')

/** Texto UTF-8 que se decodificó como Latin-1/Windows-1252 ("CAMPAÃ‘A" → "CAMPAÑA") */
const fixMojibake = (s: string) =>
  s.replace(MOJIBAKE_RE, (m, a: string, b: string) => {
    const i = CP1252_CHARS.indexOf(b)
    const lo = i >= 0 ? 0x80 + i : b.charCodeAt(0)
    if (lo < 0x80 || lo > 0xbf) return m
    return String.fromCharCode(((a.charCodeAt(0) & 0x1f) << 6) | (lo & 0x3f))
  })

const xmlText = (s: string) => fixMojibake(decodeEntities(s)).replace(/\s+/g, ' ').trim()

const tagValue = (xml: string, name: string): string | undefined => {
  const m = xml.match(new RegExp(`<\\s*${name}\\s*>([\\s\\S]*?)<\\s*/\\s*${name}\\s*>`, 'i'))
  return m ? xmlText(m[1]) : undefined
}

/**
 * Lee el contenido del timbre electrónico (código PDF417 de las boletas/facturas del SII),
 * que es un XML <TED><DD><RE/><TD/><F/><FE/><RR/><RSR/><MNT/><IT1/>…</DD></TED>.
 * Devuelve null si el texto no es un timbre.
 *
 * Además del contrato, si el timbre trae el CAF completo usa su <RS> (razón social del emisor)
 * como nombre del comercio. RR/RSR se ignoran: son del receptor.
 */
export const parseTimbre = (text: string): ReceiptData | null => {
  if (!text) return null
  // Algunos lectores entregan el XML escapado ("&lt;TED…")
  if (!/<\s*TED\b/i.test(text) && /&lt;\s*TED\b/i.test(text)) text = text.replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  if (!/<\s*TED\b/i.test(text)) return null
  // Razón social del emisor, dentro del CAF (antes de quitarlo)
  const rs = tagValue(text, 'RS')
  // El CAF repite RE y TD: se quita para no confundirse si viene antes que los del DD
  let xml = text.replace(/<\s*CAF\b[\s\S]*?<\s*\/\s*CAF\s*>/gi, ' ')
  const open = xml.search(/<\s*CAF\b/i)
  if (open >= 0) {
    const rest = xml.slice(open)
    const stop = rest.search(/<\s*TSTED\b|<\s*\/\s*DD\s*>/i)
    xml = xml.slice(0, open) + (stop >= 0 ? rest.slice(stop) : '')
  }

  const rut = normalizeRut(tagValue(xml, 'RE') ?? '')
  const mntRaw = (tagValue(xml, 'MNT') ?? '').replace(/[\s.,]/g, '')
  const total = /^\d{1,12}$/.test(mntRaw) ? parseInt(mntRaw, 10) : NaN
  if (!rut || !Number.isFinite(total) || total <= 0) return null

  const out: ReceiptData = { source: 'timbre', total, rut }

  const td = parseInt(tagValue(xml, 'TD') ?? '', 10)
  if (Number.isFinite(td)) out.docType = td === 39 || td === 41 ? 'boleta' : td === 33 || td === 34 ? 'factura' : 'otro'

  const folio = (tagValue(xml, 'F') ?? '').replace(/\D/g, '')
  if (folio && parseInt(folio, 10) > 0) out.folio = String(parseInt(folio, 10))

  const ts = tagValue(xml, 'TSTED') ?? ''
  const tsm = ts.match(/(\d{4})-(\d{2})-(\d{2})[T\s]+(\d{2}):(\d{2})/)
  const fe = (tagValue(xml, 'FE') ?? '').match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
  const date =
    (fe && validDate(parseInt(fe[1], 10), parseInt(fe[2], 10), parseInt(fe[3], 10))) ||
    (tsm && validDate(parseInt(tsm[1], 10), parseInt(tsm[2], 10), parseInt(tsm[3], 10)))
  if (date) out.date = date
  if (tsm && parseInt(tsm[4], 10) < 24 && parseInt(tsm[5], 10) < 60) out.time = `${tsm[4]}:${tsm[5]}`

  if (rs) {
    const brand = brandInLine(rs, upper(rs), 0, true)
    const merchant = brand?.name ?? prettyMerchant(rs)
    if (merchant) out.merchant = merchant
  }

  const it1 = tagValue(xml, 'IT1')
  const itemName = it1 ? cleanItemName(it1) : undefined
  if (itemName) out.items = [{ name: itemName, amount: total }]

  return out
}

// ─── Texto del OCR ──────────────────────────────────────────────────────────

interface Line {
  raw: string
  up: string
  /** Hubo una línea en blanco antes (separa bloques/columnas en la salida del OCR) */
  gap: boolean
}

/** Letras que el OCR mete dentro de números: "1.O90" → "1.090", "2l.5OO" → "21.500" */
const fixDigits = (s: string) => {
  let out = s
  for (let k = 0; k < 8; k++) {
    const next = out
      // Solo dentro de números que no están pegados a una palabra ("PREC1O" no se toca)
      .replace(
        /(?<=(?:^|[^A-Za-z\d.,/:-])[\d.,/:-]*\d[.,/:-]?)[Oo](?=[.,/:-]?\d|[.,/:-]?[Oo](?![A-Za-z])|[.,/:-]?(?:\s|$))/g,
        '0',
      )
      .replace(/(?<![A-Za-z\d])[Oo](?=\d)/g, '0')
      .replace(/(?<=(?:^|[^A-Za-z\d.,])[\d.,]*\d[.,]?)[Il|](?=[.,]?\d)/g, '1')
    if (next === out) break
    out = next
  }
  return out
}

/** "T O T A L" → "TOTAL" (el OCR a veces separa letras de títulos espaciados) */
const joinSpacedLetters = (s: string) => s.replace(/(?<![\p{L}\d])(?:\p{L} ){2,}\p{L}(?![\p{L}\d])/gu, (m) => m.replace(/ /g, ''))

const splitLines = (text: string): Line[] => {
  const out: Line[] = []
  let gap = false
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const t = joinSpacedLetters(fixDigits(raw.replace(/\s+/g, ' ').trim()))
    if (!t || !/[\p{L}\p{N}]/u.test(t)) {
      gap = true
      continue
    }
    out.push({ raw: t, up: upper(t), gap })
    gap = false
  }
  return out
}

const ITEM_RE =
  /^(.*?[\p{L}].*?)\s+(-)?(?:\$\s*|S(?=\d))?(\d{1,3}(?:\.\d{3})+|\d{1,3}(?:,\d{3})+|\d{1,7})(?:[.,]\d{1,2})?(-)?\s*(?:[A-Za-z*]{1,2})?\s*$/u

const ITEM_SKIP_RE = kw([
  TOTAL,
  `SUB\\s*-?\\s*${TOTAL}`,
  fz('NETO'),
  '[I1L|]V[A4]',
  'DESCUENTOS?',
  'DESCTOS?\\.?',
  'DSCTOS?\\.?',
  'DCTOS?\\.?',
  `${fz('AHORRO')}S?`,
  fz('VUELTO'),
  fz('EFECTIVO'),
  fz('CAMBIO'),
  fz('PROPINA'),
  'TARJETA',
  'DEBITO',
  'CREDITO',
  'REDCOMPRA',
  'PAGO',
  'SALDO',
  'PUNTOS',
  `${fz('CUOTA')}S?`,
  `${fz('LITRO')}S?`,
  'LTS?',
  'PRECIO',
  'RUT',
  'R\\.U\\.T\\.?',
  'FOLIO',
  'FECHA',
  'HORA',
  'CAJA',
  'CAJERO',
  'LOCAL',
  'SUCURSAL',
  'TERMINAL',
  BOLETA,
  FACTURA,
  MONTO,
  'VALOR',
  'EXENTOS?',
  'IMPUESTOS?',
  'IMPTO\\.?',
  'I\\.?L\\.?A\\.?',
  'ITEMS?',
  'ARTICULOS?',
  'AUTORIZ[A-Z]*',
  'AUT\\.?',
  'OPERACION',
  'FONO',
  'TEL\\.?',
  'TELEFONO',
  'GIRO',
  'DONACION(?:ES)?',
  'REDONDEO',
  'TRANSBANK',
  'VISA',
  'MASTERCARD',
  'CLIENTE',
  'VENDEDOR',
  'SURTIDOR',
  'MANGUERA',
  'BOMBA',
  'N\\s*[°º]',
  'NRO\\.?',
  'COD\\.?',
  'CODIGO',
  'TICKET',
  'ATENDIDO',
  'CANT(?:IDAD)?\\.?',
  'KILOMETRAJE',
  'PATENTE',
  'RES\\.?',
  'RESOLUCION',
  'SII',
  'ESPECIFICO',
  'AV',
  'AVDA',
  'AVENIDA',
  'CALLE',
])

const HEADER_MARK_RE = kw([
  'RUT',
  'R\\.?\\s?U\\.?\\s?T\\.?',
  BOLETA,
  FACTURA,
  'FOLIO',
  'FECHA',
  'HORA',
  'GIRO',
  'CAJA',
  'CAJERO',
  'LOCAL',
  'SUCURSAL',
  'TERMINAL',
  'DESCRIPCION',
  'DETALLE',
  'CANT(?:IDAD)?\\.?',
  'SII',
  'RESOLUCION',
  'VENDEDOR',
  'ATENDIDO',
  'AV',
  'AVDA',
  'AVENIDA',
  'CALLE',
  'FONO',
  'TEL\\.?',
  'TELEFONO',
  'N\\s*[°º]',
  'NRO\\.?',
])

const parseItemLine = (l: Line): ReceiptItem | undefined => {
  if (ITEM_SKIP_RE.test(l.up) || PER_LITER_RE.test(l.up)) return undefined
  if (datesIn(l.up).length || timesIn(l.up).length) return undefined
  if (RUT_LIKE_ONE_RE.test(l.up)) return undefined
  const m = l.raw.match(ITEM_RE)
  if (!m || m[2] || m[4]) return undefined
  const num = m[3]
  const grouped = /\D/.test(num)
  const amount = parseInt(num.replace(/\D/g, ''), 10)
  if (!grouped && (amount < 100 || num[0] === '0')) return undefined
  if (amount <= 0 || amount > MAX_AMOUNT) return undefined
  let name = m[1]
  name = name.replace(/^\s*\d{4,14}\s+/, '') // código de barras
  name = name.replace(/^\s*\d{1,3}\s*[xX*]\s*\$?\s*\d[\d.,]*\s+(?=\p{L})/u, '') // "2 X $1.250 HELADO"
  name = name.replace(/^\s*\d{1,2}\s*[xX*]?\s+(?=\p{L}{2})/u, '') // cantidad al inicio
  for (let k = 0; k < 3; k++) {
    name = name
      .replace(/\s*[=:]\s*$/, '')
      .replace(/\s+\d+(?:[.,]\d+)?\s*(?:UN|UND|UNID|KG|GR?|LTS?|L|ML|CC|U)?\.?\s*[xX*@]\s*\$?\s*\d[\d.,]*\s*$/i, '') // "2 X 990"
      .replace(/\s+[xX@*]\s*\$?\s*\d[\d.,]*\s*$/, '')
      .replace(/\s+\$?\s*\d{1,3}(?:[.,]\d{3})+\s*$/, '') // precio unitario
      .replace(/\s+\$\s*\d+\s*$/, '')
      .replace(/\s+\d+\s*(?:UN|UND|UNID)\.?\s*$/i, '')
  }
  const clean = cleanItemName(name)
  if (!clean) return undefined
  const letters = sinTildes(clean).replace(/[^A-Za-z]/g, '')
  if (letters.length < 3 || !/[aeiouAEIOU]/.test(letters)) return undefined
  return { name: clean.slice(0, 60), amount }
}

const DOC_VOUCHER_RE = kw([
  'COMPROBANTE\\s*DE\\s*VENTA',
  'COMPROBANTE\\s*DE\\s*PAGO',
  'TRANSBANK',
  'REDCOMPRA',
  'GETNET',
  'KLAP',
  'VOUCHER',
  'WEBPAY',
])

const docTypeOf = (L: Line[], headerEnd: number): ReceiptData['docType'] => {
  const strongBoleta = new RegExp(`${BOLETA}\\s*(?:${ELECTR}|DE\\s+VENTA)`)
  const strongFactura = new RegExp(`${FACTURA}\\s*(?:${ELECTR}|DE\\s+VENTA|EXENTA|AFECTA)`)
  const title = (word: string) => new RegExp(`^\\W*${word}(?:\\s+${ELECTR}[A-Z]*)?\\s*(?:${NUM}\\s*\\d+)?\\s*$`)
  const titleBoleta = title(BOLETA)
  const titleFactura = title(FACTURA)
  for (let i = 0; i < L.length; i++) {
    const s = L[i].up
    if (strongBoleta.test(s) || (i < headerEnd && titleBoleta.test(s))) return 'boleta'
    if (strongFactura.test(s) || (i < headerEnd && titleFactura.test(s))) return 'factura'
    if (i < headerEnd && /^\W*(?:NOTA\s+DE\s+(?:CREDITO|DEBITO)|GUIA\s+DE\s+DESPACHO)/.test(s)) return 'otro'
  }
  const all = L.map((l) => l.up).join('\n')
  if (DOC_VOUCHER_RE.test(all)) return 'voucher'
  if (/TARJETA/.test(all) && kw(['AUTORIZ[A-Z]*', 'COD\\.?\\s*AUT\\.?', 'AUT\\.?']).test(all)) return 'voucher'
  if (new RegExp(`(?<![A-Z])${FACTURA}(?![A-Z])`).test(all)) return 'factura'
  if (new RegExp(`(?<![A-Z])${BOLETA}(?![A-Z])`).test(all)) return 'boleta'
  return undefined
}

const folioOf = (L: Line[]): string | undefined => {
  const norm = (d: string) => {
    const n = parseInt(d, 10)
    return n > 0 ? String(n) : undefined
  }
  const res = [
    new RegExp(`F[O0]L[I1L][O0]\\s*${NUM}?\\s*[:.#]?\\s*(\\d{1,10})(?![\\d.,-])`),
    new RegExp(
      `(?:${BOLETA}|${FACTURA}|DOCUMENTO|TICKET|DTE)(?:\\s+[A-Z][A-Z0-9]*){0,2}?\\s*${NUM}\\s*[:.]?\\s*(\\d{1,10})(?![\\d.,-])`,
    ),
    new RegExp(`${NUM}\\s*(?:DE\\s+)?(?:${BOLETA}|DOCUMENTO|TICKET)\\s*[:.]?\\s*(\\d{1,10})(?![\\d.,-])`),
  ]
  for (const re of res) {
    for (const l of L) {
      const m = l.up.match(re)
      const f = m && norm(m[1])
      if (f) return f
    }
  }
  // "N° 12345" sola, justo bajo el título "BOLETA ELECTRONICA"
  const titleRe = new RegExp(`${BOLETA}|${FACTURA}`)
  for (let i = 0; i < L.length; i++) {
    if (!titleRe.test(L[i].up)) continue
    for (let j = i + 1; j <= Math.min(L.length - 1, i + 2); j++) {
      const m = L[j].up.match(new RegExp(`^\\W*${NUM}\\s*[:.]?\\s*(\\d{1,10})\\W*$`))
      const f = m && norm(m[1])
      if (f) return f
    }
  }
  return undefined
}

const rutOf = (L: Line[]): string | undefined => {
  let best: { rut: string; score: number } | undefined
  const LABEL = /R\s?\.?\s?U\s?\.?\s?T\s?\.?\s*(?:N\s*[°º.]?\s*)?[:.]?\s*([0-9O][0-9O.,\s]{5,12}\s?-?\s?[0-9KO])(?![0-9A-Z])/
  L.forEach((l, idx) => {
    const found: { raw: string; labeled: boolean }[] = []
    const lm = l.up.match(LABEL)
    if (lm) found.push({ raw: lm[1], labeled: true })
    for (const m of l.up.matchAll(RUT_LIKE_RE)) found.push({ raw: m[0], labeled: /R\s?\.?\s?U\s?\.?\s?T/.test(l.up) })
    for (const f of found) {
      const rut = normalizeRut(f.raw)
      if (!rut) continue
      const receptor =
        /SENOR|CLIENTE|RECEPTOR|COMPRADOR|RAZON SOCIAL\s*:/.test(l.up) || (idx > 0 && /SENOR|CLIENTE/.test(L[idx - 1].up))
      const score = (f.labeled ? 2 : 0) + (idx < L.length / 2 ? 1 : 0) - (receptor ? 5 : 0) - idx * 0.01
      if (!best || score > best.score) best = { rut, score }
    }
  })
  return best?.rut
}

const dateTimeOf = (L: Line[]): { date?: string; time?: string } => {
  const hits: { date: string; idx: number; score: number }[] = []
  const counts = new Map<string, number>()
  L.forEach((l, idx) => {
    for (const d of datesIn(l.up)) {
      counts.set(d, (counts.get(d) ?? 0) + 1)
      let score = 0
      if (DATE_LABEL_RE.test(l.up)) score += 10
      else if (idx > 0 && DATE_LABEL_RE.test(L[idx - 1].up) && !datesIn(L[idx - 1].up).length) score += 6
      if (timesIn(l.up).length) score += 5
      if (DATE_BAD_RE.test(l.up)) score -= 25
      hits.push({ date: d, idx, score })
    }
  })
  const latest = hits.reduce((a, h) => (h.date > a ? h.date : a), '')
  let best: (typeof hits)[number] | undefined
  for (const h of hits) {
    const s = h.score + ((counts.get(h.date) ?? 1) - 1) * 3 + (h.date === latest ? 2 : 0)
    if (!best || s > best.score) best = { ...h, score: s }
  }
  const date = best?.date

  let bestTime: { time: string; score: number } | undefined
  L.forEach((l, idx) => {
    for (const t of timesIn(l.up)) {
      let score = 0
      if (best && idx === best.idx) score += 10
      else if (best && Math.abs(idx - best.idx) === 1) score += 4
      if (TIME_LABEL_RE.test(l.up)) score += 6
      if (TIME_BAD_RE.test(l.up)) score -= 10
      if (!bestTime || score > bestTime.score) bestTime = { time: t, score }
    }
  })
  return { date, time: bestTime && bestTime.score > -10 ? bestTime.time : undefined }
}

/** Extrae lo que pueda del texto reconocido por OCR de una foto de boleta o voucher */
export const parseReceiptText = (text: string): ReceiptData => {
  const L = splitLines(text ?? '')
  const n = L.length
  if (!n) return { source: 'ninguno' }

  const classes = L.map((l) => classifyTotal(l.up))

  // Dónde empiezan los totales (los ítems van antes)
  const firstTotalIdx = L.findIndex((l, i) => (classes[i] && classes[i]!.p <= 2) || SUBTOTAL_RE.test(l.up) || NETO_RE.test(l.up))

  // ── Ítems
  const itemsEnd = firstTotalIdx >= 0 ? firstTotalIdx : n
  let itemsStart = 0
  const markLimit = firstTotalIdx >= 0 ? firstTotalIdx : Math.ceil(n / 2)
  for (let i = 0; i < markLimit; i++) {
    const l = L[i]
    if (HEADER_MARK_RE.test(l.up) || datesIn(l.up).length || timesIn(l.up).length || RUT_LIKE_ONE_RE.test(l.up))
      itemsStart = i + 1
  }
  const items: ReceiptItem[] = []
  let firstItemIdx = -1
  let lastItemIdx = -1
  for (let i = itemsStart; i < itemsEnd && items.length < 40; i++) {
    const it = parseItemLine(L[i])
    if (it) {
      if (firstItemIdx < 0) firstItemIdx = i
      lastItemIdx = i
      items.push(it)
    }
  }
  const itemsSum = items.reduce((a, it) => a + it.amount, 0)

  // ── Montos con etiqueta (sirven para confirmar el total)
  const isLabelOnly = (l: Line) => /[A-Z]{3}/.test(l.up) && l.up.length <= 40 && !scanMoney(cleanAmounts(l.up)).length
  const amountOnly = (l: Line): Money | undefined => {
    const c = cleanAmounts(l.up)
    const toks = scanMoney(c, true)
    if (toks.length !== 1) return undefined
    const rest = c.replace(/CLP|\$/g, '').replace(/[\d.,\s:-]/g, '')
    if (rest.replace(/[^A-Z]/g, '').length > 1) return undefined
    return pickAmount(toks, { negative: true })
  }
  /** Montos en columna aparte: "SUBTOTAL / IVA / TOTAL" y luego "10.916 / 2.074 / 12.990" */
  const pairedAmount = (idx: number): Money | undefined => {
    let s = idx
    while (s > 0 && !L[s].gap && isLabelOnly(L[s - 1])) s--
    let e = idx
    while (e + 1 < n && !L[e + 1].gap && isLabelOnly(L[e + 1])) e++
    const vals: Money[] = []
    for (let j = e + 1; j < n && vals.length <= e - s + 1; j++) {
      const a = amountOnly(L[j])
      if (!a) break
      vals.push(a)
    }
    if (vals.length === e - s + 1) return vals[idx - s]
    if (idx === e && vals.length) return vals[0]
    return undefined
  }
  const amountAfter = (
    idx: number,
    c: string,
    end: number,
    segEnd: number,
    opts: { strict?: boolean; negative?: boolean } = {},
  ) => {
    const toks = scanMoney(c.slice(end, segEnd), true)
    return pickAmount(toks, opts) ?? (opts.strict ? undefined : pairedAmount(idx))
  }
  const labeled = (re: RegExp): number[] => {
    const out: number[] = []
    L.forEach((l, idx) => {
      const s = l.up.replace(IVA_INCL_RE, blank)
      const m = re.exec(s)
      if (!m) return
      const c = cleanAmounts(s)
      const end = m.index + m[0].length
      const t = amountAfter(idx, c, end, fieldEnd(c, end), { negative: true })
      if (t) out.push(t.value)
    })
    return out
  }

  // ── Total
  const refs = new Set<number>()
  const subtotal = labeled(SUBTOTAL_RE)[0]
  const neto = labeled(NETO_RE)[0]
  const iva = labeled(IVA_RE)[0]
  const exento = labeled(EXENTO_RE)[0] ?? 0
  const discounts = labeled(DESC_RE)
  // Rebajas sin palabra clave: líneas con un monto negativo ("PROMO 2X1   -990")
  for (const l of L) {
    if (DESC_RE.test(l.up) || !/[A-Z]{3}/.test(l.up)) continue
    const last = scanMoney(cleanAmounts(l.up)).at(-1)
    if (last?.negative) discounts.push(last.value)
  }
  const efectivo = labeled(EFECTIVO_RE)[0]
  const vuelto = labeled(VUELTO_RE)[0]
  const discountOptions = discounts.length ? [discounts.reduce((a, b) => a + b, 0), Math.max(...discounts)] : []
  if (subtotal) {
    refs.add(subtotal)
    for (const d of discountOptions) refs.add(subtotal - d)
  }
  if (neto && iva) refs.add(neto + iva + exento)
  if (efectivo && vuelto !== undefined) refs.add(efectivo - vuelto)
  if (items.length >= 2) {
    refs.add(itemsSum)
    for (const d of discountOptions) refs.add(itemsSum - d)
  }
  const lineVals = L.map(
    (l) =>
      new Set(
        scanMoney(cleanAmounts(l.up))
          .filter(looksMoney)
          .map((t) => t.value),
      ),
  )
  const confirmed = (v: number, idx: number) => refs.has(v) || lineVals.some((set, j) => j !== idx && set.has(v))

  const BASE = [0, 100, 80, 60, 40]
  let best: { value: number; score: number } | undefined
  classes.forEach((c, idx) => {
    if (!c) return
    const t = amountAfter(idx, c.c, c.end, c.segEnd, { strict: c.p === 4 })
    if (!t) return
    let value = t.value
    if (t.alt !== undefined && t.alt >= 10 && !confirmed(value, idx) && confirmed(t.alt, idx)) value = t.alt
    const score = BASE[c.p] + (confirmed(value, idx) ? 15 : 0) + (t.currency ? 3 : 0) + (2 * idx) / n
    if (!best || score > best.score) best = { value, score }
  })
  let total = best?.value

  // Sin palabra clave: el mayor monto plausible del tercio inferior
  if (total === undefined) {
    const pool = (from: number, strictMoney: boolean) => {
      const vals: number[] = []
      for (let i = from; i < n; i++) {
        const up = L[i].up
        if (NOT_TOTAL_RE.test(up) || CODE_LINE_RE.test(up) || PER_LITER_RE.test(up)) continue
        for (const t of scanMoney(cleanAmounts(up))) {
          if (t.negative || t.value < 10 || t.value > MAX_AMOUNT) continue
          if (strictMoney ? t.currency || t.grouped : looksMoney(t)) vals.push(t.value)
        }
      }
      return vals
    }
    let vals = pool(Math.floor((n * 2) / 3), false)
    if (!vals.length) vals = pool(Math.floor(n / 3), true)
    if (vals.length) total = items.length >= 2 && vals.includes(itemsSum) ? itemsSum : Math.max(...vals)
  }

  // ── Comercio
  let headerEnd = firstItemIdx >= 0 ? firstItemIdx : firstTotalIdx >= 0 ? firstTotalIdx : n
  headerEnd = Math.min(headerEnd, Math.max(8, Math.ceil(n * 0.35)))
  headerEnd = Math.max(headerEnd, Math.min(n, 3))
  // Pie: las últimas líneas, pero nunca las de ítems ("ACEITE SHELL HELIX" no es Shell)
  const footerStart = Math.max(n - 6, lastItemIdx + 1, firstTotalIdx)
  let brand: BrandHit | undefined
  L.forEach((l, idx) => {
    const header = idx < headerEnd
    if (!header && idx < footerStart) return
    const hit = brandInLine(l.raw, l.up, idx, header)
    if (hit && (!brand || hit.score > brand.score)) brand = hit
  })
  let merchant = brand?.name
  const { date, time } = dateTimeOf(L)
  const rut = rutOf(L)
  const docType = docTypeOf(L, headerEnd)
  // Adivinar el nombre por la primera línea solo si el texto parece de verdad una boleta
  const looksLikeReceipt = total !== undefined || !!date || !!rut || !!docType || items.length > 0
  if (!merchant && looksLikeReceipt) {
    const head = L.slice(0, Math.min(headerEnd, 8))
    const sensible = head.filter((l) => isSensibleHeader(l.up))
    const chosen = sensible.find((l) => GENERIC_RE.test(l.up)) ?? sensible[0]
    if (chosen) merchant = prettyMerchant(chosen.raw)
    if (!merchant) {
      for (const l of head) {
        const m = GENERIC_RE.exec(l.up)
        if (m && !/^(?:DISTRIBUIDORA|SUPERMERCADOS?|ALMACEN|BAZAR)$/.test(m[0])) {
          merchant = titleCase(m[0])
          break
        }
      }
    }
  }

  const out: ReceiptData = { source: total !== undefined || merchant || date ? 'ocr' : 'ninguno' }
  if (total !== undefined) out.total = total
  if (date) out.date = date
  if (time) out.time = time
  if (merchant) out.merchant = merchant
  if (rut) out.rut = rut
  const folio = folioOf(L)
  if (folio) out.folio = folio
  if (docType) out.docType = docType
  if (items.length) out.items = items
  return out
}

// ─── Combinar ───────────────────────────────────────────────────────────────

/** Combina timbre (prioritario para total/fecha/RUT/folio) y OCR (comercio, hora, ítems) */
export const mergeReceipt = (timbre: ReceiptData | null, ocr: ReceiptData | null): ReceiptData => {
  if (!timbre && !ocr) return { source: 'ninguno' }
  if (!timbre) return { ...ocr! }
  if (!ocr) return { ...timbre }

  const out: ReceiptData = { source: 'timbre' }
  let fromOcr = false
  /** El dato del timbre si lo trae; si no, el del OCR */
  const take = <K extends 'total' | 'date' | 'rut' | 'folio' | 'docType' | 'time'>(k: K) => {
    if (timbre[k] !== undefined) out[k] = timbre[k]
    else if (ocr[k] !== undefined) {
      out[k] = ocr[k]
      fromOcr = true
    }
  }
  take('total')
  take('date')
  take('rut')
  take('folio')
  take('docType')
  take('time')

  // Comercio: manda el OCR, salvo que el timbre reconozca una marca y el OCR no
  const known = (m?: string) => !!m && BRAND_NAMES.has(m)
  if (ocr.merchant && (known(ocr.merchant) || !known(timbre.merchant))) {
    out.merchant = ocr.merchant
    fromOcr = true
  } else if (timbre.merchant) out.merchant = timbre.merchant

  const ocrItems = ocr.items?.length ?? 0
  if (ocrItems > (timbre.items?.length ?? 0)) {
    out.items = ocr.items
    fromOcr = true
  } else if (timbre.items?.length) out.items = timbre.items

  out.source = fromOcr ? 'ambos' : 'timbre'
  return out
}
