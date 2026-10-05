/**
 * Registro rápido en lenguaje natural: "5 lucas uber", "almuerzo 4.500 efectivo",
 * "me pagaron 20 mil", "le presté 10 mil a mi hermano". Función pura.
 *
 * Orden de lectura: intención (gasto, ingreso, préstamo) → fecha → cuenta → monto →
 * persona (préstamos) → lo que queda es el lugar o la descripción.
 */
import { suggestCategory } from '../../lib/categorize'
import { addDaysStr, parseDate, toDateStr, weekdayIndex } from '../../lib/dates'
import { normalizeText } from '../../lib/format'
import { learnPlace } from '../../lib/insights'
import type { Account, AccountType, Category, DateStr, Transaction } from '../../lib/types'
import { CURRENCY_WORDS, findAmount, fold, MULTIPLIERS, NUMBER_WORDS, parseDigits, splitNumberSuffix } from './amount'
import { keywordCategory } from './keywords'

export interface QuickParse {
  intent: 'expense' | 'income' | 'lent' | 'borrowed'
  amount?: number
  /** Lugar o descripción ("uber", "almuerzo") */
  place?: string
  categoryId?: string
  accountId?: string
  /** Persona, para préstamos */
  person?: string
  /** YYYY-MM-DD si dijo "ayer", "anteayer", "el lunes"… */
  date?: string
  /**
   * Lo que sobra cuando el lugar se reconoce del historial ("almuerzo en el Líder" →
   * lugar "Líder", nota "Almuerzo") o, en préstamos, el motivo ("para la micro")
   */
  note?: string
  /**
   * true si `place` es un lugar ("en el Líder", o uno de tu historial) y no una
   * descripción ("almuerzo con amigos"): sirve para escribir "Gasto en Líder"
   */
  venue?: boolean
}

export interface QuickContext {
  accounts: Account[]
  categories: Category[]
  transactions: Transaction[]
  today: string
}

interface Tok {
  /** Como lo escribió (para mostrar) */
  raw: string
  /** En minúsculas y sin tildes (para comparar) */
  w: string
  used: boolean
}

/* ───────────── Vocabulario ───────────── */

const BORROWED: string[][] = [
  ['me', 'prestaron'],
  ['me', 'presto'],
  ['me', 'presta'],
  ['me', 'presto', 'plata'],
  ['pedi', 'prestado'],
  ['pedi', 'prestada'],
  ['pedi', 'plata', 'prestada'],
  ['le', 'pedi', 'prestado'],
  ['le', 'debo'],
  ['les', 'debo'],
  ['debo'],
  ['le', 'quede', 'debiendo'],
  ['quede', 'debiendo'],
  ['me', 'fio'],
  ['me', 'fiaron'],
]

const LENT: string[][] = [
  ['le', 'preste'],
  ['les', 'preste'],
  ['preste'],
  ['le', 'di', 'prestado'],
  ['le', 'pase', 'prestado'],
  ['me', 'debe'],
  ['me', 'deben'],
]

const INCOME_VERBS: string[][] = [
  ['me', 'pagaron'],
  ['me', 'pago'],
  ['recibi'],
  ['me', 'gane'],
  ['gane'],
  ['me', 'depositaron'],
  ['me', 'deposito'],
  ['me', 'transfirieron'],
  ['me', 'transfirio'],
  ['nos', 'pagaron'],
  ['pagaron'],
  ['depositaron'],
  ['transfirieron'],
  ['vendi'],
  ['me', 'llego'],
  ['me', 'llegaron'],
  ['cobre'],
  ['me', 'devolvieron'],
  ['me', 'devolvio'],
  ['me', 'cayo'],
  ['me', 'cayeron'],
  ['me', 'entro'],
  ['me', 'entraron'],
]

const EXPENSE_VERBS: string[][] = [
  ['me', 'gaste'],
  ['gaste'],
  ['gastamos'],
  ['pague'],
  ['pagamos'],
  ['pago'],
  ['me', 'compre'],
  ['compre'],
  ['compramos'],
  ['gasto'],
  ['me', 'costo'],
  ['costo'],
  ['me', 'salio'],
  ['salio'],
  ['le', 'pase'],
  ['les', 'pase'],
]

/** Sustantivos que indican ingreso: "ingreso" se quita del texto, "sueldo" se queda como descripción */
const INCOME_NOUNS_CONSUMED: string[][] = [['ingreso'], ['ingresos']]
const INCOME_NOUNS = new Set(['sueldo', 'salario', 'aguinaldo', 'remuneracion'])

/** Palabras de relleno que se quitan al inicio y al final de la descripción */
const EDGE_FILLERS = new Set([
  'en',
  'el',
  'la',
  'los',
  'las',
  'lo',
  'de',
  'del',
  'al',
  'a',
  'por',
  'para',
  'pa',
  'pal',
  'un',
  'una',
  'unos',
  'unas',
  'uno',
  'con',
  'y',
  'o',
  'como',
  'me',
  'le',
  'les',
  'se',
  'te',
  'que',
  'mi',
  'mis',
  'su',
  'sus',
  'tu',
  'tus',
  'ya',
  'eh',
  'aprox',
  'aproximadamente',
  ...CURRENCY_WORDS,
])

/** Se quitan en cualquier parte: "le presté plata a Pedro" */
const ANYWHERE_FILLERS = new Set(['plata', 'dinero'])

const ARTICLES = new Set(['mi', 'mis', 'la', 'el', 'los', 'las', 'tu', 'su', 'nuestra', 'nuestro', 'un', 'una'])
const PERSON_STOP = new Set([
  'por',
  'para',
  'pa',
  'pal',
  'en',
  'con',
  'porque',
  'que',
  'hasta',
  'y',
  'de',
  'del',
  'desde',
  'el',
  'la',
  'los',
  'las',
  'un',
  'una',
  'a',
  'al',
  'me',
  'le',
])

const ACCOUNT_GENERIC = new Set(['cuenta', 'tarjeta', 'de', 'del', 'la', 'el', 'mi', 'banco', 'cta', 'tarj', 'mis'])
const ACCOUNT_PREP = new Set(['con', 'en', 'por', 'desde', 'de', 'a', 'al', 'del'])
const ACCOUNT_ART = new Set(['la', 'el', 'mi', 'mis', 'las', 'los'])

const TYPE_PHRASES: [string[], AccountType][] = [
  [['tarjeta', 'de', 'debito'], 'debit'],
  [['tarjeta', 'de', 'credito'], 'credit'],
  [['debito'], 'debit'],
  [['redcompra'], 'debit'],
  [['credito'], 'credit'],
  [['tarjeta'], 'credit'],
  [['tc'], 'credit'],
  [['efectivo'], 'cash'],
  [['cash'], 'cash'],
]

const MONTHS: Record<string, number> = {
  enero: 1,
  ene: 1,
  febrero: 2,
  feb: 2,
  marzo: 3,
  mar: 3,
  abril: 4,
  abr: 4,
  mayo: 5,
  may: 5,
  junio: 6,
  jun: 6,
  julio: 7,
  jul: 7,
  agosto: 8,
  ago: 8,
  septiembre: 9,
  setiembre: 9,
  sep: 9,
  sept: 9,
  octubre: 10,
  oct: 10,
  noviembre: 11,
  nov: 11,
  diciembre: 12,
  dic: 12,
}

/** 0 = lunes … 6 = domingo (igual que weekdayIndex) */
const WEEKDAYS: Record<string, number> = { lunes: 0, martes: 1, miercoles: 2, jueves: 3, viernes: 4, sabado: 5, domingo: 6 }

const TIME_OF_DAY = new Set(['mañana', 'manana', 'tarde', 'noche', 'madrugada'])

/** "1/2 kilo" es una cantidad, no el 1 de febrero */
const UNITS = new Set(['kilo', 'kilos', 'kg', 'gr', 'gramos', 'litro', 'litros', 'lt', 'docena', 'metro', 'metros', 'taza'])

/* ───────────── Utilidades ───────────── */

const tokenize = (text: string): Tok[] =>
  text
    .replace(/[¿¡!?;:()[\]{}"“”«»]/g, ' ')
    .replace(/\$/g, ' $ ')
    // Una coma o un punto pegados a letras separan palabras; entre dígitos son parte del número
    .replace(/([^\d\s])[,.]/g, '$1 ')
    .replace(/[,.](?=[^\d\s])/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}$]+|[^\p{L}\p{N}$]+$/gu, ''))
    .filter(Boolean)
    .flatMap(splitNumberSuffix)
    .map((raw) => ({ raw, w: fold(raw), used: false }))

const cap = (s: string) => (s ? s.charAt(0).toLocaleUpperCase('es') + s.slice(1) : s)

/** Clave para comparar lugares: como normalizeText pero sin puntuación ("Recarga Bip!" = "recarga bip") */
const placeKey = (s: string) =>
  normalizeText(s)
    .replace(/[^\p{L}\p{N}& ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()

const matchAt = (toks: Tok[], i: number, phrase: string[]) =>
  phrase.every((p, k) => i + k < toks.length && !toks[i + k].used && toks[i + k].w === p)

/** Primera aparición de alguna de las frases (la más larga si hay varias en el mismo lugar) */
const findPhrase = (toks: Tok[], phrases: string[][]): { i: number; len: number } | null => {
  for (let i = 0; i < toks.length; i++) {
    let len = 0
    for (const p of phrases) if (p.length > len && matchAt(toks, i, p)) len = p.length
    if (len) return { i, len }
  }
  return null
}

const take = (toks: Tok[], from: number, to: number) => {
  for (let k = from; k <= to; k++) toks[k].used = true
}

/** Quita relleno al inicio y al final */
const trimFillers = (ts: Tok[]) => {
  let a = 0
  let b = ts.length
  while (a < b && EDGE_FILLERS.has(ts[a].w)) a++
  while (b > a && EDGE_FILLERS.has(ts[b - 1].w)) b--
  return ts.slice(a, b)
}

const smallNumber = (w: string | undefined) => {
  if (w === undefined) return undefined
  if (/^\d{1,3}$/.test(w)) return Number(w)
  const v = NUMBER_WORDS[w]
  return v !== undefined && v > 0 && v < 100 ? v : undefined
}

/* ───────────── Fechas ───────────── */

/** Día `day` más reciente que no sea futuro: este mes o, si no, el anterior que tenga ese día */
const recentDayOfMonth = (today: DateStr, day: number): DateStr | undefined => {
  const t = parseDate(today)
  for (let k = 0; k < 13; k++) {
    const d = new Date(t.getFullYear(), t.getMonth() - k, day)
    if (d.getDate() !== day) continue
    const s = toDateStr(d)
    if (s <= today) return s
  }
  return undefined
}

/** "3 de octubre": este año, o el anterior si todavía no llega */
const pastDayMonth = (today: DateStr, day: number, month: number, year?: number): DateStr | undefined => {
  const build = (y: number) => {
    const d = new Date(y, month - 1, day)
    return d.getMonth() === month - 1 && d.getDate() === day ? toDateStr(d) : undefined
  }
  if (year !== undefined) return build(year < 100 ? 2000 + year : year)
  const y = parseDate(today).getFullYear()
  const s = build(y)
  if (s && s <= today) return s
  return build(y - 1)
}

const detectDate = (toks: Tok[], today: DateStr): DateStr | undefined => {
  let date: DateStr | undefined
  const w = (k: number) => (k >= 0 && k < toks.length && !toks[k].used ? toks[k].w : undefined)
  const set = (d: DateStr | undefined, from: number, to: number) => {
    if (!d) return false
    date ??= d
    take(toks, from, to)
    return true
  }

  for (let i = 0; i < toks.length; i++) {
    const a = w(i)
    if (a === undefined) continue

    // Momentos del día: no cambian la fecha, pero no son parte del lugar
    if ((a === 'en' || a === 'por' || a === 'a') && w(i + 1) === 'la' && TIME_OF_DAY.has(w(i + 2) ?? '')) {
      take(toks, i, i + 2)
      continue
    }
    if (a === 'esta' && TIME_OF_DAY.has(w(i + 1) ?? '')) {
      take(toks, i, i + 1)
      continue
    }
    if ((a === 'al' || a === 'a') && w(i + 1) === 'mediodia') {
      take(toks, i, i + 1)
      continue
    }

    if (a === 'hoy') {
      set(today, i, w(i + 1) === 'dia' ? i + 1 : i)
      continue
    }
    if (a === 'ayer' || a === 'anoche') {
      set(addDaysStr(today, -1), i, i)
      continue
    }
    if (a === 'anteayer' || a === 'antier' || a === 'anteanoche') {
      set(addDaysStr(today, -2), i, i)
      continue
    }
    if (a === 'antes' && w(i + 1) === 'de' && (w(i + 2) === 'ayer' || w(i + 2) === 'anoche')) {
      set(addDaysStr(today, -2), i, i + 2)
      continue
    }
    if (a === 'hace') {
      const n = smallNumber(w(i + 1))
      const unit = w(i + 2)
      if (n && (unit === 'dia' || unit === 'dias')) set(addDaysStr(today, -n), i, i + 2)
      else if (n && (unit === 'semana' || unit === 'semanas')) set(addDaysStr(today, -7 * n), i, i + 2)
      continue
    }

    // "el lunes", "este martes", "el viernes pasado": siempre el más reciente que ya pasó
    const wd = WEEKDAYS[a]
    if (wd !== undefined && w(i - 1) !== 'a') {
      let from = i
      let to = i
      if (w(i - 1) === 'el' || w(i - 1) === 'este') from = i - 1
      if (w(i + 1) === 'pasado') to = i + 1
      const diff = (weekdayIndex(today) - wd + 7) % 7 || 7
      set(addDaysStr(today, -diff), from, to)
      continue
    }

    // 3/10, 03-10-2026
    const dm = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?$/.exec(a)
    if (dm && !UNITS.has(w(i + 1) ?? '')) {
      set(pastDayMonth(today, Number(dm[1]), Number(dm[2]), dm[3] ? Number(dm[3]) : undefined), i, i)
      continue
    }

    // "el 3", "el día 3", "3 de octubre"
    if (/^\d{1,2}$/.test(a)) {
      const day = Number(a)
      if (day < 1 || day > 31) continue
      let from = i
      if (w(from - 1) === 'dia') from--
      if (w(from - 1) === 'el') from--
      const month = w(i + 1) === 'de' ? MONTHS[w(i + 2) ?? ''] : undefined
      if (month) {
        let to = i + 2
        let year: number | undefined
        if (w(to + 1) === 'de' && /^\d{4}$/.test(w(to + 2) ?? '')) {
          year = Number(w(to + 2))
          to += 2
        } else if (/^\d{4}$/.test(w(to + 1) ?? '')) {
          year = Number(w(to + 1))
          to += 1
        }
        set(pastDayMonth(today, day, month, year), from, to)
        continue
      }
      const next = w(i + 1)
      if (from < i && !(next !== undefined && (next in MULTIPLIERS || CURRENCY_WORDS.has(next)))) {
        set(recentDayOfMonth(today, day), from, i)
      }
    }
  }
  return date
}

/* ───────────── Cuentas ───────────── */

const accountWords = (a: Account) =>
  fold(a.name)
    .split(/[^\p{L}\p{N}&]+/u)
    .filter(Boolean)

/** Consume "con la", "en", "por la"… justo antes de la cuenta */
const takeConnectors = (toks: Tok[], i: number) => {
  let k = i - 1
  if (k >= 0 && !toks[k].used && ACCOUNT_ART.has(toks[k].w)) toks[k--].used = true
  if (k >= 0 && !toks[k].used && ACCOUNT_PREP.has(toks[k].w)) toks[k].used = true
}

const detectAccount = (toks: Tok[], ctx: QuickContext): string | undefined => {
  const active = ctx.accounts.filter((a) => !a.archived)

  // 1. Nombre completo ("cuenta rut", "tarjeta de crédito"), el más largo primero
  const named = active.map((a) => ({ a, words: accountWords(a) })).sort((x, y) => y.words.length - x.words.length)
  for (const { a, words } of named) {
    if (!words.length) continue
    for (let i = 0; i < toks.length; i++) {
      if (matchAt(toks, i, words)) {
        take(toks, i, i + words.length - 1)
        takeConnectors(toks, i)
        return a.id
      }
    }
  }

  // 2. Una palabra que distingue a la cuenta ("rut", "corriente", "efectivo")
  const owners = new Map<string, Set<string>>()
  for (const { a, words } of named)
    for (const w of words) {
      if (ACCOUNT_GENERIC.has(w) || EDGE_FILLERS.has(w) || w.length < 2 || w in NUMBER_WORDS) continue
      const s = owners.get(w) ?? new Set<string>()
      s.add(a.id)
      owners.set(w, s)
    }
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].used) continue
    const ids = owners.get(toks[i].w)
    if (ids?.size === 1) {
      toks[i].used = true
      takeConnectors(toks, i)
      return [...ids][0]
    }
  }

  // 3. Tipo de cuenta ("en efectivo", "con débito", "con la tarjeta")
  for (const [phrase, type] of TYPE_PHRASES) {
    for (let i = 0; i < toks.length; i++) {
      if (!matchAt(toks, i, phrase)) continue
      take(toks, i, i + phrase.length - 1)
      takeConnectors(toks, i)
      const candidates = active.filter((a) => a.type === type)
      if (candidates.length <= 1) return candidates[0]?.id
      // Si hay varias del mismo tipo, la que más usas
      const uses = new Map<string, number>()
      for (const t of ctx.transactions) uses.set(t.accountId, (uses.get(t.accountId) ?? 0) + 1)
      return [...candidates].sort((x, y) => (uses.get(y.id) ?? 0) - (uses.get(x.id) ?? 0))[0].id
    }
  }
  return undefined
}

/* ───────────── Personas (préstamos) ───────────── */

const personFrom = (ts: Tok[]): Tok[] => {
  let a = 0
  while (a < ts.length && ARTICLES.has(ts[a].w)) a++
  const out: Tok[] = []
  for (let k = a; k < ts.length && out.length < 3; k++) {
    if (PERSON_STOP.has(ts[k].w) || parseDigits(ts[k].w) !== null) break
    out.push(ts[k])
  }
  return out
}

const detectPerson = (toks: Tok[], intentStart: number): string | undefined => {
  const free = toks.filter((t) => !t.used)
  let person: Tok[] = []

  // "a mi hermano", "al Pedro", "a la Cata"
  for (let k = 0; k < free.length - 1 && !person.length; k++) {
    if (free[k].w !== 'a' && free[k].w !== 'al') continue
    const p = personFrom(free.slice(k + 1))
    if (p.length) {
      free[k].used = true
      // Los artículos entre "a" y el nombre también se consumen
      for (let j = k + 1; free[j] !== p[0]; j++) free[j].used = true
      person = p
    }
  }

  // "mi mamá me prestó…": antes del verbo
  if (!person.length && intentStart > 0) {
    const before = toks.slice(0, intentStart).filter((t) => !t.used)
    const p = personFrom(before)
    if (p.length && p.length === before.length - before.findIndex((t) => t === p[0])) {
      for (const t of before) t.used = true
      person = p
    }
  }

  // "me prestó la Cata 5 lucas": lo primero que queda después del verbo
  if (!person.length) {
    const after = toks.slice(intentStart).filter((t) => !t.used)
    let a = 0
    while (a < after.length && ARTICLES.has(after[a].w)) a++
    const p = a < after.length && !PERSON_STOP.has(after[a].w) ? personFrom(after) : []
    if (p.length) {
      for (let j = 0; after[j] !== p[p.length - 1]; j++) after[j].used = true
      person = p
    }
  }

  for (const t of person) t.used = true
  return person.length ? cap(person.map((t) => t.raw).join(' ')) : undefined
}

/* ───────────── Lugar y categoría ───────────── */

interface KnownPlace {
  name: string
  categoryId?: string
  accountId?: string
}

/** Lugares de tu historial (del tipo indicado) por clave normalizada */
const knownPlaces = (txs: Transaction[], type: 'expense' | 'income') => {
  const map = new Map<string, { name: string; date: string; cats: Map<string, number>; accs: Map<string, number> }>()
  for (const t of txs) {
    if (t.type !== type || !t.place) continue
    const k = placeKey(t.place)
    if (!k) continue
    const e = map.get(k) ?? { name: t.place.trim(), date: t.date, cats: new Map(), accs: new Map() }
    if (t.date >= e.date) {
      e.date = t.date
      e.name = t.place.trim()
    }
    if (t.categoryId) e.cats.set(t.categoryId, (e.cats.get(t.categoryId) ?? 0) + 1)
    e.accs.set(t.accountId, (e.accs.get(t.accountId) ?? 0) + 1)
    map.set(k, e)
  }
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  const out = new Map<string, KnownPlace>()
  for (const [k, e] of map) out.set(k, { name: e.name, categoryId: top(e.cats), accountId: top(e.accs) })
  return out
}

/** Prefijos que permiten separar el lugar de la descripción: "almuerzo [en el] Líder" */
const PLACE_LEAD = new Set(['en', 'el', 'la', 'los', 'las', 'del', 'de', 'al'])

const splitKnownPlace = (desc: Tok[], known: Map<string, KnownPlace>) => {
  let best: { a: number; b: number; place: KnownPlace } | null = null
  for (let a = 0; a < desc.length; a++) {
    for (let b = desc.length; b > a; b--) {
      if (best && b - a <= best.b - best.a) break
      const key = placeKey(
        desc
          .slice(a, b)
          .map((t) => t.raw)
          .join(' '),
      )
      const place = known.get(key)
      if (!place) continue
      // Debe ser todo el texto, ir al inicio, o venir después de "en", "el", "del"…
      if (a === 0 || PLACE_LEAD.has(desc[a - 1].w)) best = { a, b, place }
    }
  }
  if (!best) return null
  const rest = trimFillers([...desc.slice(0, best.a), ...desc.slice(best.b)])
  return { place: best.place, note: rest.length ? cap(rest.map((t) => t.raw).join(' ')) : undefined }
}

const validCategory = (ctx: QuickContext, id: string | undefined, kind: 'expense' | 'income') =>
  id && ctx.categories.some((c) => c.id === id && c.kind === kind) ? id : undefined

const validAccount = (ctx: QuickContext, id: string | undefined) =>
  id && ctx.accounts.some((a) => a.id === id && !a.archived) ? id : undefined

/* ───────────── Principal ───────────── */

export const parseQuickText = (text: string, ctx: QuickContext): QuickParse => {
  const toks = tokenize(text)
  if (!toks.length) return { intent: 'expense' }

  // 1. Intención
  let intent: QuickParse['intent'] = 'expense'
  let intentStart = -1
  let incomeHint: string | undefined
  const borrowed = findPhrase(toks, BORROWED)
  const lent = findPhrase(toks, LENT)
  const loan =
    borrowed && (!lent || borrowed.i <= lent.i)
      ? { ...borrowed, d: 'borrowed' as const }
      : lent
        ? { ...lent, d: 'lent' as const }
        : null
  if (loan) {
    intent = loan.d
    intentStart = loan.i
    take(toks, loan.i, loan.i + loan.len - 1)
  } else {
    const inc = findPhrase(toks, INCOME_VERBS)
    const exp = !inc && findPhrase(toks, EXPENSE_VERBS)
    const noun = !inc && !exp && findPhrase(toks, INCOME_NOUNS_CONSUMED)
    const hit = inc || exp || noun
    if (hit) {
      intent = exp ? 'expense' : 'income'
      intentStart = hit.i
      if (inc && toks[hit.i].w === 'vendi') incomeHint = 'i-ventas'
      take(toks, hit.i, hit.i + hit.len - 1)
    } else if (toks.some((t) => INCOME_NOUNS.has(t.w))) intent = 'income'
  }
  for (const t of toks) if (ANYWHERE_FILLERS.has(t.w)) t.used = true

  // 2. Fecha, 3. cuenta, 4. monto
  const date = detectDate(toks, ctx.today)
  let accountId = detectAccount(toks, ctx)
  const words = toks.map((t) => t.w)
  const amountMatch = findAmount(words, (k) => !toks[k].used)
  if (amountMatch) take(toks, amountMatch.start, amountMatch.end)

  const result: QuickParse = { intent, amount: amountMatch?.value, accountId, date }

  // 5. Préstamos: persona y motivo
  if (intent === 'lent' || intent === 'borrowed') {
    result.person = detectPerson(toks, Math.max(0, intentStart))
    const rest = trimFillers(toks.filter((t) => !t.used))
    if (rest.length) result.note = cap(rest.map((t) => t.raw).join(' '))
    return clean(result)
  }

  // 6. Lugar o descripción y categoría
  const kind = intent
  const free = toks.filter((t) => !t.used)
  const desc = trimFillers(free)
  let categoryId: string | undefined
  if (desc.length) {
    // "gasté 5 lucas en uber": lo que viene después de "en" es un lugar
    if (free.slice(0, free.indexOf(desc[0])).some((t) => t.w === 'en')) result.venue = true
    const known = knownPlaces(ctx.transactions, kind)
    const split = splitKnownPlace(desc, known)
    if (split) {
      result.place = split.place.name
      result.note = split.note
      result.venue = true
      if (kind === 'expense') {
        const learned = learnPlace(ctx.transactions, split.place.name)
        categoryId = validCategory(ctx, learned?.categoryId, 'expense')
        accountId ??= validAccount(ctx, learned?.accountId)
      } else {
        categoryId = validCategory(ctx, split.place.categoryId, 'income')
        accountId ??= validAccount(ctx, split.place.accountId)
      }
    } else {
      // "pan y bebida en el almacén": el lugar es lo que va después del último "en"
      let placeToks = desc
      const k = kind === 'expense' ? desc.map((t) => t.w).lastIndexOf('en') : -1
      if (k > 0 && k < desc.length - 1) {
        const left = trimFillers(desc.slice(0, k))
        const right = trimFillers(desc.slice(k + 1))
        if (left.length && right.length) {
          placeToks = right
          result.note = cap(left.map((t) => t.raw).join(' '))
          result.venue = true
        }
      }
      const placeText = placeToks.map((t) => t.raw).join(' ')
      result.place = cap(placeText)
      const s = suggestCategory(placeText, kind, { transactions: ctx.transactions, categories: ctx.categories })
      categoryId = validCategory(ctx, s.categoryId, kind)
      if (s.place && placeKey(s.place) === placeKey(placeText)) {
        result.place = s.place
        result.venue = true
      }
    }
    categoryId ??= validCategory(
      ctx,
      keywordCategory(
        desc.map((t) => t.w),
        kind,
      ),
      kind,
    )
  }
  categoryId ??= validCategory(ctx, incomeHint, 'income')
  result.categoryId = categoryId
  result.accountId = accountId
  return clean(result)
}

const clean = (r: QuickParse): QuickParse => {
  const out = { ...r }
  for (const k of Object.keys(out) as (keyof QuickParse)[]) if (out[k] === undefined) delete out[k]
  return out
}
