/**
 * Convierte lo que se leyó de las notificaciones del banco en movimientos para revisar:
 * cuenta probable, categoría sugerida, lugar limpio y si parece duplicado.
 */
import { suggestCategory } from '../../lib/categorize'
import { toDateStr } from '../../lib/dates'
import { formatMoney, normalizeText } from '../../lib/format'
import type { Account, AccountType, Category, DateStr, FinanceData, ID, Transaction } from '../../lib/types'
import type { InboxItem } from '../../lib/ui'
import { markDuplicates } from '../import/parse'
import { parseBankText, type BankMovement } from './parse'

export interface BankDraft {
  /** Único dentro de la revisión */
  key: string
  movement: BankMovement
  date: string
  /** Pagos de tarjeta y giros en cajero son transferencias entre tus cuentas */
  type: 'expense' | 'income' | 'transfer'
  amount: number
  place: string
  accountId?: ID
  /** Cuenta de destino si es transferencia (tarjeta que se paga, efectivo en un giro) */
  toAccountId?: ID
  /** El monto viene en otra moneda (p. ej. USD): hay que escribir cuánto fue en tu moneda */
  foreign?: boolean
  /** Moneda original si no es la tuya ("USD"); se guarda en la nota con el monto original */
  currency?: string
  categoryId?: ID
  /** Ya hay un movimiento igual (mismo monto y tipo, fecha ±1 día, misma cuenta) */
  duplicate: boolean
  /** Por qué parece repetido: ya estaba anotado o viene dos veces en lo que se pegó */
  duplicateOf?: 'registrado' | 'lote'
  /** Hora HH:mm del aviso (o de cuando llegó al buzón) */
  time?: string
  /** Compras en cuotas ("en 3 cuotas"); solo se guardan si la cuenta es tarjeta de crédito */
  installments?: number
  /** Marcado para agregar */
  include: boolean
  /** Si vino del buzón automático, su id (para marcarlo como agregado) */
  inboxId?: string
}

export interface BankInput {
  movement: BankMovement
  inboxId?: string
  receivedAt?: string
}

/** Bajo esto queda sin marcar */
export const MIN_CONFIDENCE = 0.4
/** Bajo esto se muestra "Revisa" */
export const LOW_CONFIDENCE = 0.5

/* ─────────────────────────────── Lectura ─────────────────────────────── */

/** Lee el texto pegado y los avisos del buzón (cada uno por separado, con su fecha de llegada) */
export const readBankInput = (input: { text?: string; inbox?: InboxItem[] }, today: DateStr): BankInput[] => {
  const out: BankInput[] = []
  if (input.text?.trim()) for (const movement of parseBankText(input.text, today)) out.push({ movement })
  for (const item of input.inbox ?? []) {
    const day = localDay(item.receivedAt) ?? today
    for (const movement of parseBankText(item.body, day)) out.push({ movement, inboxId: item.id, receivedAt: item.receivedAt })
  }
  return out
}

/* ─────────────────────────────── Vínculos ─────────────────────────────── */

/** Clave para recordar la cuenta de una tarjeta: "card:1234" */
export const cardLinkKey = (last4: string) => `card:${last4.replace(/\D/g, '').slice(-4)}`

/** Clave para recordar la cuenta de un banco y producto: "bank:santander:credito" */
export const bankLinkKey = (bank: string, product?: BankMovement['product']) => `bank:${normalizeText(bank)}:${product ?? 'otro'}`

/* ─────────────────────────────── Fechas ─────────────────────────────── */

/** Día local (YYYY-MM-DD) de una fecha ISO del buzón */
const localDay = (iso?: string): DateStr | undefined => {
  if (!iso) return undefined
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? undefined : toDateStr(d)
}

const localTime = (iso?: string): string | undefined => {
  if (!iso || /^\d{4}-\d{2}-\d{2}$/.test(iso)) return undefined
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return undefined
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const dayNumber = (s: DateStr) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000

/* ─────────────────────────────── Cuentas ─────────────────────────────── */

/** Otros nombres con que la gente llama a sus cuentas de cada banco */
const BANK_ALIASES: Record<string, string[]> = {
  bancoestado: ['banco estado', 'estado', 'cuenta rut', 'cuentarut', 'rut'],
  'banco de chile': ['bancochile', 'banco chile', 'edwards', 'banchile'],
  santander: ['santander'],
  bci: ['bci'],
  itau: ['itau'],
  scotiabank: ['scotia'],
  falabella: ['falabella', 'cmr'],
  ripley: ['ripley'],
  'mercado pago': ['mercadopago'],
}

/** Palabras que no sirven para reconocer el banco en el nombre de una cuenta */
const GENERIC = new Set(['banco', 'de', 'del', 'chile', 'tarjeta', 'cuenta'])

const bankAliases = (bank: string): string[] => {
  const b = normalizeText(bank)
  const set = new Set<string>([b, b.replace(/\s+/g, '')])
  const rest = b
    .replace(/^banco\s+(de\s+|del\s+)?/, '')
    .split(' ')
    .filter((w) => !GENERIC.has(w))
    .join(' ')
  if (rest.length >= 3) set.add(rest)
  for (const [k, list] of Object.entries(BANK_ALIASES))
    if (
      b.replace(/\s+/g, '') === k.replace(/\s+/g, '') ||
      b.includes(k) ||
      list.some((x) => b === x || (x.length >= 5 && b.includes(x)))
    ) {
      set.add(k)
      for (const x of list) set.add(x)
    }
  return [...set].filter((x) => x.length >= 3)
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** ¿El nombre de la cuenta menciona el banco? ("Cuenta RUT" ↔ BancoEstado, "CMR" ↔ Falabella) */
const nameMatchesBank = (name: string, bank: string): boolean => {
  const n = normalizeText(name)
  const compact = n.replace(/\s+/g, '')
  return bankAliases(bank).some(
    (a) =>
      new RegExp(`(^|[^a-z0-9])${escapeRe(a)}($|[^a-z0-9])`).test(n) ||
      (a.length >= 5 && compact.includes(a.replace(/\s+/g, ''))),
  )
}

const TYPES_BY_PRODUCT: Record<NonNullable<BankMovement['product']>, AccountType[][]> = {
  credito: [['credit']],
  debito: [['debit'], ['savings', 'other']],
  cuenta: [['debit'], ['savings', 'other']],
  prepago: [['debit', 'other']],
}

interface Ctx {
  active: Account[]
  links: Record<string, ID>
  defaultId?: ID
}

const byId = (ctx: Ctx, id?: ID) => (id ? ctx.active.find((a) => a.id === id) : undefined)

/** Entre varias candidatas: la del banco, la por defecto o la primera */
const preferBank = (list: Account[], ctx: Ctx, bank?: string): Account | undefined => {
  if (list.length <= 1) return list[0]
  const named = bank ? list.filter((a) => nameMatchesBank(a.name, bank)) : []
  const pool = named.length ? named : list
  return pool.find((a) => a.id === ctx.defaultId) ?? pool[0]
}

/**
 * Cuenta de origen probable: vínculo aprendido de la tarjeta, del banco y producto, el tipo de
 * cuenta según el producto (crédito, débito…), el nombre del banco y, al final, la cuenta por defecto.
 */
const pickAccount = (
  m: BankMovement,
  ctx: Ctx,
  ok: (a: Account) => boolean = () => true,
  product: BankMovement['product'] = m.product,
): Account | undefined => {
  const usable = ctx.active.filter(ok)
  if (!usable.length) return undefined
  const linked = (key: string) => {
    const a = byId(ctx, ctx.links[key])
    return a && ok(a) ? a : undefined
  }
  if (m.cardLast4) {
    const a = linked(cardLinkKey(m.cardLast4))
    if (a) return a
  }
  if (m.bank) {
    const a = linked(bankLinkKey(m.bank, product))
    if (a) return a
  }
  // "Visa 1234": los dígitos de la tarjeta en el nombre de la cuenta
  if (m.cardLast4) {
    const re = new RegExp(`(^|\\D)${escapeRe(m.cardLast4)}($|\\D)`)
    const a = usable.find((x) => re.test(x.name))
    if (a) return a
  }
  if (product)
    for (const types of TYPES_BY_PRODUCT[product]) {
      const a = preferBank(
        usable.filter((x) => types.includes(x.type)),
        ctx,
        m.bank,
      )
      if (a) return a
    }
  else if (m.bank) {
    const a = preferBank(
      usable.filter((x) => x.type !== 'cash' && nameMatchesBank(x.name, m.bank!)),
      ctx,
      m.bank,
    )
    if (a) return a
  }
  return usable.find((a) => a.id === ctx.defaultId) ?? usable[0]
}

/** Tarjeta de crédito que se está pagando */
const pickCard = (m: BankMovement, ctx: Ctx): Account | undefined => {
  const cards = ctx.active.filter((a) => a.type === 'credit')
  if (m.cardLast4) {
    const a = byId(ctx, ctx.links[cardLinkKey(m.cardLast4)])
    if (a?.type === 'credit') return a
    const re = new RegExp(`(^|\\D)${escapeRe(m.cardLast4)}($|\\D)`)
    const named = cards.find((x) => re.test(x.name))
    if (named) return named
  }
  if (m.bank) {
    const a = byId(ctx, ctx.links[bankLinkKey(m.bank, 'credito')])
    if (a?.type === 'credit') return a
  }
  return preferBank(cards, ctx, m.bank)
}

const pickCash = (ctx: Ctx): Account | undefined =>
  preferBank(
    ctx.active.filter((a) => a.type === 'cash'),
    ctx,
  )

/* ─────────────────────────────── Categorías ─────────────────────────────── */

/** "Otros gastos" / "Otros ingresos" (o la primera del tipo) */
export const fallbackCategory = (kind: 'expense' | 'income', categories: Category[]): ID | undefined => {
  const preferred = kind === 'income' ? 'i-otros' : 'c-otros'
  return (
    categories.find((c) => c.id === preferred)?.id ??
    categories.find((c) => c.kind === kind && /^otr[oa]s?\b/i.test(normalizeText(c.name)))?.id ??
    categories.find((c) => c.kind === kind)?.id
  )
}

/** Lugar limpio y categoría sugerida para un tipo */
export const suggestFor = (
  merchant: string | undefined,
  type: 'expense' | 'income' | 'transfer',
  data: Pick<FinanceData, 'transactions' | 'categories'>,
): { place: string; categoryId?: ID } => {
  const raw = (merchant ?? '').trim()
  const kind = type === 'income' ? 'income' : 'expense'
  const s = raw ? suggestCategory(raw, kind, data) : {}
  const place = (s.place ?? '').trim() || raw
  if (type === 'transfer') return { place }
  return { place, categoryId: s.categoryId ?? fallbackCategory(kind, data.categories) }
}

/* ─────────────────────────────── Duplicados ─────────────────────────────── */

/** Transferencias ya registradas: mismo monto, mismas cuentas, fecha ±1 día (1 a 1) */
const transferDuplicates = (drafts: BankDraft[], existing: Transaction[]): boolean[] => {
  const result = drafts.map(() => false)
  const used = new Set<ID>()
  for (const tolerance of [0, 1])
    drafts.forEach((d, i) => {
      if (result[i] || d.type !== 'transfer') return
      const day = dayNumber(d.date)
      const hit = existing.find(
        (t) =>
          !used.has(t.id) &&
          t.type === 'transfer' &&
          t.accountId === d.accountId &&
          (!d.toAccountId || !t.toAccountId || t.toAccountId === d.toAccountId) &&
          Math.round(t.amount * 100) === Math.round(d.amount * 100) &&
          Math.abs(dayNumber(t.date) - day) <= tolerance,
      )
      if (hit) {
        used.add(hit.id)
        result[i] = true
      }
    })
  return result
}

/** Gastos e ingresos ya registrados, cuenta por cuenta (reusa la lógica de la cartola) */
const flowDuplicates = (drafts: BankDraft[], existing: Transaction[]): boolean[] => {
  const result = drafts.map(() => false)
  const groups = new Map<string, number[]>()
  drafts.forEach((d, i) => {
    if (d.type === 'transfer' || d.foreign) return
    const k = d.accountId ?? ''
    groups.set(k, [...(groups.get(k) ?? []), i])
  })
  for (const [accountId, idx] of groups) {
    const rows = idx.map((i) => ({
      row: i,
      date: drafts[i].date,
      description: drafts[i].place,
      amount: drafts[i].amount,
      type: drafts[i].type as 'expense' | 'income',
    }))
    markDuplicates(rows, existing, accountId || undefined).forEach((dup, j) => {
      if (dup) result[idx[j]] = true
    })
  }
  return result
}

/** El mismo aviso dos veces en lo que se pegó (o pegado y también en el buzón) */
const sameMovement = (a: BankDraft, b: BankDraft): boolean => {
  if (a.type !== b.type || a.accountId !== b.accountId) return false
  if (Math.round(a.amount * 100) !== Math.round(b.amount * 100)) return false
  if ((a.movement.currency ?? '') !== (b.movement.currency ?? '')) return false
  if (Math.abs(dayNumber(a.date) - dayNumber(b.date)) > 1) return false
  if (normalizeText(a.movement.raw) === normalizeText(b.movement.raw)) return true
  if (a.movement.time && b.movement.time && a.movement.time !== b.movement.time) return false
  const pa = normalizeText(a.place)
  const pb = normalizeText(b.place)
  return !pa || !pb || pa === pb
}

/* ─────────────────────────────── Revisión ─────────────────────────────── */

export const buildBankDrafts = (moves: BankInput[], data: FinanceData, today: string): BankDraft[] => {
  const ctx: Ctx = {
    active: data.accounts.filter((a) => !a.archived),
    links: data.settings.bankLinks ?? {},
    defaultId: data.settings.defaultAccountId,
  }
  const local = (data.settings.currency || 'CLP').toUpperCase()

  const drafts = moves.map(({ movement: m, inboxId, receivedAt }, i): BankDraft => {
    const arrived = localDay(receivedAt)
    const date = m.date ?? arrived ?? today
    // La hora de llegada al buzón sirve si el aviso no trae la suya y es del mismo día
    const time = m.time ?? (arrived && date === arrived ? localTime(receivedAt) : undefined)

    let type: BankDraft['type'] = m.type
    let accountId: ID | undefined
    let toAccountId: ID | undefined
    if (m.kind === 'pago_tarjeta') {
      const card = pickCard(m, ctx)
      // El pago sale de una cuenta, no de la tarjeta que se paga
      const from =
        card &&
        pickAccount(m, ctx, (a) => a.type !== 'credit' && a.id !== card.id, m.product === 'credito' ? 'cuenta' : m.product)
      if (card && from) {
        type = 'transfer'
        accountId = from.id
        toAccountId = card.id
      } else accountId = (from ?? pickAccount(m, ctx, (a) => a.type !== 'credit') ?? pickAccount(m, ctx))?.id
    } else if (m.kind === 'giro') {
      const cash = pickCash(ctx)
      const from = cash && pickAccount(m, ctx, (a) => a.id !== cash.id)
      if (cash && from) {
        type = 'transfer'
        accountId = from.id
        toAccountId = cash.id
      } else accountId = pickAccount(m, ctx)?.id
    } else accountId = pickAccount(m, ctx)?.id

    const currency = (m.currency || 'CLP').toUpperCase()
    const foreign = currency !== local
    const { place, categoryId } = suggestFor(m.merchant, type, data)

    return {
      key: `b${i}`,
      movement: m,
      date,
      type,
      amount: m.amount,
      place,
      accountId,
      toAccountId,
      foreign: foreign || undefined,
      currency: foreign ? currency : undefined,
      categoryId,
      duplicate: false,
      time,
      installments: (m.installments ?? 0) > 1 ? m.installments : undefined,
      include: true,
      inboxId,
    }
  })

  const flows = flowDuplicates(drafts, data.transactions)
  const transfers = transferDuplicates(drafts, data.transactions)
  drafts.forEach((d, i) => {
    if (flows[i] || transfers[i]) {
      d.duplicate = true
      d.duplicateOf = 'registrado'
    } else if (drafts.slice(0, i).some((prev) => sameMovement(prev, d))) {
      d.duplicate = true
      d.duplicateOf = 'lote'
    }
    d.include = !d.duplicate && !d.foreign && d.movement.confidence >= MIN_CONFIDENCE
  })
  return drafts
}

/** Qué le falta a un movimiento para poder agregarlo (null si está listo) */
export const draftProblem = (d: BankDraft): string | null => {
  if (d.foreign) return `Escribe cuánto fue en tu moneda (vino en ${d.currency ?? 'otra moneda'})`
  if (!(d.amount > 0)) return 'Falta el monto'
  if (!d.accountId) return 'Elige la cuenta'
  if (d.type === 'transfer' && (!d.toAccountId || d.toAccountId === d.accountId)) return 'Elige a qué cuenta va'
  return null
}

/** "Monto original: US$25,99" para compras en otra moneda */
const foreignNote = (d: BankDraft): string | undefined => {
  if (!d.currency) return undefined
  let money: string
  try {
    money = formatMoney(d.movement.amount, d.currency, 'es-CL')
  } catch {
    money = `${d.currency} ${d.movement.amount}`
  }
  return `Monto original: ${money}`
}

export const draftToTx = (d: BankDraft, accounts: Pick<Account, 'id' | 'type'>[] = []): Omit<Transaction, 'id' | 'createdAt'> => {
  const account = accounts.find((a) => a.id === d.accountId)
  const installments = d.installments ?? d.movement.installments
  const note = foreignNote(d)
  return {
    type: d.type,
    amount: d.amount,
    date: d.date,
    accountId: d.accountId ?? '',
    toAccountId: d.type === 'transfer' ? d.toAccountId : undefined,
    categoryId: d.type === 'transfer' ? undefined : d.categoryId,
    place: d.place || undefined,
    ...(d.time ? { time: d.time } : {}),
    ...(d.type === 'expense' && account?.type === 'credit' && installments && installments > 1 ? { installments } : {}),
    ...(note ? { note } : {}),
  }
}

/** Recuerda qué cuenta corresponde a esa tarjeta/banco para la próxima vez */
export const accountLinksFrom = (drafts: BankDraft[]): Record<string, ID> => {
  const links: Record<string, ID> = {}
  for (const d of drafts) {
    if (!d.include || !d.accountId) continue
    const m = d.movement
    // En el pago de la tarjeta, los dígitos son los de la tarjeta que se paga (la de destino)
    if (m.kind === 'pago_tarjeta' && d.type === 'transfer') {
      if (m.cardLast4 && d.toAccountId) links[cardLinkKey(m.cardLast4)] = d.toAccountId
      continue
    }
    if (m.cardLast4) links[cardLinkKey(m.cardLast4)] = d.accountId
    if (m.bank) links[bankLinkKey(m.bank, m.product)] = d.accountId
  }
  return links
}

/* ─────────────────────────────── Textos ─────────────────────────────── */

const KIND_LABEL: Record<BankMovement['kind'], string> = {
  compra: 'Compra',
  transferencia_recibida: 'Transferencia recibida',
  transferencia_enviada: 'Transferencia enviada',
  pago: 'Pago',
  pago_tarjeta: 'Pago de tarjeta',
  giro: 'Giro en cajero',
  abono: 'Abono',
  cargo: 'Cargo',
  devolucion: 'Devolución',
  otro: 'Movimiento',
}

/** "Compra", "Transferencia recibida", "Giro en cajero"… */
export const kindLabel = (m: Pick<BankMovement, 'kind'>) => KIND_LABEL[m.kind] ?? 'Movimiento'
