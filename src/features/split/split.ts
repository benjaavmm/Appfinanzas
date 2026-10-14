/**
 * Dividir una cuenta: reparte un total entre participantes (funciones puras).
 *
 * Todos los montos de entrada y salida van en la unidad normal de la moneda (pesos, dólares…),
 * igual que en el resto de la app. Por dentro se trabaja en la unidad mínima
 * (monto × 10^decimales, como enteros) para que no haya errores de redondeo con decimales.
 */
import type { DateStr, ID, Loan, Transaction } from '../../lib/types'

export interface SplitParticipant {
  /** "Yo" se representa con `me: true` */
  name: string
  me?: boolean
  /** Monto fijo opcional; si falta, se reparte lo que quede en partes iguales */
  amount?: number
}

export interface SplitShare {
  name: string
  me: boolean
  amount: number
}

export type SplitErrorCode =
  /** No hay participantes */
  | 'empty'
  /** Total o algún monto negativo o que no es un número */
  | 'invalid'
  /** Los montos fijos suman más que el total */
  | 'over'
  /** Todos tienen monto fijo y no suman el total */
  | 'mismatch'

/**
 * Error de `splitTotal`. `diff` es la diferencia (en la unidad normal de la moneda):
 * lo que sobra en 'over' y lo que falta asignar en 'mismatch'.
 */
export class SplitError extends Error {
  readonly code: SplitErrorCode
  readonly diff: number
  constructor(code: SplitErrorCode, message: string, diff = 0) {
    super(message)
    this.name = 'SplitError'
    this.code = code
    this.diff = diff
  }
}

const factorOf = (decimals: number) => 10 ** Math.max(0, Math.floor(decimals))

/** Monto → unidad mínima entera (p. ej. 12,34 USD → 1234) */
export const toMinor = (amount: number, decimals = 0): number => Math.round(amount * factorOf(decimals))

/** Unidad mínima entera → monto (p. ej. 1234 → 12,34 USD) */
export const fromMinor = (minor: number, decimals = 0): number => {
  const f = factorOf(decimals)
  // Redondear a los decimales evita colas como 0.30000000000000004
  return f === 1 ? minor : Number((minor / f).toFixed(Math.max(0, Math.floor(decimals))))
}

const isValidAmount = (n: number) => Number.isFinite(n) && n >= 0

/**
 * Reparte `total` entre los participantes.
 *
 * - Los montos fijos (`amount`) se respetan.
 * - Lo que queda se reparte en partes iguales entre quienes no tienen monto.
 * - La diferencia de redondeo (a lo más N−1 unidades mínimas) la absorbe quien pagó, o sea "yo"
 *   (el primer participante con `me: true`), aunque tenga monto fijo: así a los demás nunca se les
 *   cobra de más. Si "yo" no participa (no consumí), esas unidades se reparten de a una entre los
 *   primeros participantes sin monto.
 * - La suma de las partes es exactamente el total (en la unidad mínima).
 * - El orden del resultado es el mismo de `participants`.
 *
 * Lanza `SplitError` si no hay participantes ('empty'), si hay montos inválidos ('invalid'),
 * si los montos fijos superan el total ('over') o si todos tienen monto fijo y no suman
 * el total ('mismatch'). Usa `trySplit` si prefieres un resultado sin excepciones.
 */
export const splitTotal = (total: number, participants: SplitParticipant[], decimals = 0): SplitShare[] => {
  if (!isValidAmount(total)) throw new SplitError('invalid', 'El total debe ser un número mayor o igual a cero.')
  if (participants.length === 0) throw new SplitError('empty', 'Agrega al menos una persona para dividir la cuenta.')
  for (const p of participants) {
    if (p.amount !== undefined && !isValidAmount(p.amount))
      throw new SplitError('invalid', `El monto de ${p.me ? 'tu parte' : p.name} no es válido.`)
  }

  const totalMinor = toMinor(total, decimals)
  const minor = participants.map((p) => (p.amount === undefined ? undefined : toMinor(p.amount, decimals)))
  const fixedSum = minor.reduce<number>((s, m) => s + (m ?? 0), 0)
  const remaining = totalMinor - fixedSum

  if (remaining < 0)
    throw new SplitError('over', 'Los montos suman más que el total de la cuenta.', fromMinor(-remaining, decimals))

  const free = minor.map((m, i) => (m === undefined ? i : -1)).filter((i) => i >= 0)
  if (free.length === 0 && remaining > 0)
    throw new SplitError('mismatch', 'Los montos no alcanzan a cubrir el total de la cuenta.', fromMinor(remaining, decimals))

  const result = minor.map((m) => m ?? 0)
  if (free.length > 0) {
    const base = Math.floor(remaining / free.length)
    let leftover = remaining - base * free.length
    for (const i of free) result[i] = base
    if (leftover > 0) {
      const meIndex = participants.findIndex((p) => p.me)
      if (meIndex >= 0) result[meIndex] += leftover
      else
        for (const i of free) {
          if (leftover === 0) break
          result[i] += 1
          leftover -= 1
        }
    }
  }

  return participants.map((p, i) => ({ name: p.name, me: !!p.me, amount: fromMinor(result[i], decimals) }))
}

export type SplitResult = { ok: true; shares: SplitShare[] } | { ok: false; error: SplitError }

/** Igual que `splitTotal`, pero devuelve el error en vez de lanzarlo (cómodo para la interfaz) */
export const trySplit = (total: number, participants: SplitParticipant[], decimals = 0): SplitResult => {
  try {
    return { ok: true, shares: splitTotal(total, participants, decimals) }
  } catch (e) {
    if (e instanceof SplitError) return { ok: false, error: e }
    throw e
  }
}

export interface AssignStatus {
  /** Suma de los montos fijos */
  assigned: number
  /** Total − asignado (negativo si te pasaste) */
  left: number
  /** Cuántos participantes no tienen monto (se reparten `left`) */
  open: number
}

/** Cuánto falta por asignar en el modo "Montos distintos" */
export const assignStatus = (total: number, participants: SplitParticipant[], decimals = 0): AssignStatus => {
  const assignedMinor = participants.reduce(
    (s, p) => s + (p.amount !== undefined && Number.isFinite(p.amount) ? toMinor(p.amount, decimals) : 0),
    0,
  )
  return {
    assigned: fromMinor(assignedMinor, decimals),
    left: fromMinor(toMinor(Number.isFinite(total) ? total : 0, decimals) - assignedMinor, decimals),
    open: participants.filter((p) => p.amount === undefined).length,
  }
}

/* ───────────── Quién pagó y quién le debe a quién ───────────── */

/** Una transferencia para quedar a mano: `from` le pasa `amount` a `to` (índices de `shares`) */
export interface SplitTransfer {
  from: number
  to: number
  amount: number
}

/**
 * Quién le pasa cuánto a quién para que cada uno termine pagando solo su parte.
 *
 * - `paid[i]` es lo que pagó cada uno en la caja (mismo orden que `shares`); debe sumar lo mismo
 *   que las partes. Lo que alguien pagó de más se lo devuelven los que pagaron de menos.
 * - A quien pagó de más le pagan primero "yo" (si debo) y luego los demás en orden; si "yo" pagué
 *   de más, los que deben me pagan primero a mí. Así casi todo lo que hay que anotar pasa por mí.
 * - Lanza `SplitError('mismatch')` si lo pagado no suma el total.
 */
export const settleSplit = (shares: SplitShare[], paid: number[], decimals = 0): SplitTransfer[] => {
  if (paid.length !== shares.length || paid.some((p) => !isValidAmount(p)))
    throw new SplitError('invalid', 'Revisa cuánto pagó cada uno.')
  const shareMinor = shares.map((s) => toMinor(s.amount, decimals))
  const paidMinor = paid.map((p) => toMinor(p, decimals))
  const diff = paidMinor.reduce((a, b) => a + b, 0) - shareMinor.reduce((a, b) => a + b, 0)
  if (diff !== 0)
    throw new SplitError(
      'mismatch',
      diff > 0 ? 'Lo pagado suma más que el total.' : 'Lo pagado no alcanza el total.',
      fromMinor(Math.abs(diff), decimals),
    )
  const net = paidMinor.map((p, i) => p - shareMinor[i])
  // "Yo" primero; después, el orden en que se agregaron
  const order = shares.map((_, i) => i).sort((a, b) => Number(shares[b].me) - Number(shares[a].me) || a - b)
  const creditors = order.filter((i) => net[i] > 0).map((i) => ({ i, left: net[i] }))
  const debtors = order.filter((i) => net[i] < 0).map((i) => ({ i, left: -net[i] }))
  const out: SplitTransfer[] = []
  let c = 0
  for (const d of debtors) {
    while (d.left > 0 && c < creditors.length) {
      const cr = creditors[c]
      const amount = Math.min(d.left, cr.left)
      out.push({ from: d.i, to: cr.i, amount: fromMinor(amount, decimals) })
      d.left -= amount
      cr.left -= amount
      if (cr.left === 0) c++
    }
  }
  return out
}

/* ───────────── Mensajes para cobrar ───────────── */

type Fmt = (n: number) => string

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name.trim()

export interface ChargeTextInput {
  /** Persona a la que se le cobra */
  name: string
  /** Lo que me tiene que pasar */
  amount: number
  /** Total de la cuenta */
  total: number
  /** Su parte (si pagó algo, se explica de dónde sale `amount`) */
  share?: number
  /** Lo que ya pagó en la caja */
  paid?: number
  /** "¿Qué fue?" (opcional): "Cena en Liguria", "Asado"… */
  what?: string
  /** Formateador de dinero (debe mostrar el monto aunque la app oculte montos) */
  fmt: Fmt
  /** Fecha límite ya formateada para leer, sin artículo: "12 de octubre" */
  due?: string
}

/**
 * Texto para cobrar por WhatsApp:
 * "Hola Pedro! Cena en Liguria salió $30.000, tu parte es $10.000 🙌"
 * Si pagó una parte: "… tu parte es $15.750. Como pagaste $6.500, me pasas $9.250 🙌"
 */
export const chargeText = ({ name, amount, total, share, paid, what, fmt, due }: ChargeTextInput): string => {
  const subject = what?.trim() ? capitalize(what.trim()) : 'La cuenta'
  const greeting = name.trim() ? `Hola ${firstName(name)}!` : 'Hola!'
  const dueText = due ? ` ¿Me lo pasas antes del ${due}? 😊` : ''
  if (paid && paid > 0 && share !== undefined)
    return `${greeting} ${subject} salió ${fmt(total)}, tu parte es ${fmt(share)}. Como pagaste ${fmt(paid)}, me pasas ${fmt(amount)} 🙌${dueText}`
  return `${greeting} ${subject} salió ${fmt(total)}, tu parte es ${fmt(amount)} 🙌${dueText}`
}

/** Una línea del resumen: quién le pasa cuánto a quién (con nombres) */
export interface NamedTransfer {
  from: string
  to: string
  amount: number
  /** `to` soy yo */
  toMe?: boolean
  /** `from` soy yo */
  fromMe?: boolean
}

/**
 * Resumen para mandar a un grupo:
 * "Asado salió $30.000. Pedro: $10.000 · Juan: $10.000 🙌" (todos me pagan a mí)
 * "Asado salió $30.000. Para quedar a mano: Pedro → Benja $10.000 · Juan → Cami $5.000 🙌"
 */
export const groupChargeText = ({
  transfers,
  total,
  what,
  fmt,
}: {
  transfers: NamedTransfer[]
  total: number
  what?: string
  fmt: Fmt
}): string => {
  const subject = what?.trim() ? capitalize(what.trim()) : 'La cuenta'
  const lines = transfers.filter((t) => t.amount > 0)
  if (lines.every((t) => t.toMe))
    return `${subject} salió ${fmt(total)}. ${lines.map((t) => `${t.from.trim()}: ${fmt(t.amount)}`).join(' · ')} 🙌`
  const list = lines.map((t) => `${t.from.trim()} → ${t.to.trim()} ${fmt(t.amount)}`).join(' · ')
  return `${subject} salió ${fmt(total)}. Para quedar a mano: ${list} 🙌`
}

/* ───────────── Qué se guarda ───────────── */

type NewTx = Omit<Transaction, 'id' | 'createdAt'>
type NewLoan = Omit<Loan, 'id' | 'createdAt' | 'payments'>

export interface SplitPlanInput {
  shares: SplitShare[]
  /** Cuánto pagó cada uno en la caja (mismo orden que `shares`). Sin esto: pagué todo yo. */
  paid?: number[]
  decimals?: number
  what?: string
  accountId: ID
  categoryId?: ID
  date: DateStr
  /** Plazo para quedar a mano (opcional) */
  dueDate?: DateStr
  splitId: ID
}

export interface SplitPlan {
  /** Mi gasto: solo mi parte (si es mayor a 0) */
  expense?: NewTx
  /** "Yo presté" a quien me debe y "Me prestaron" a quien le debo, uno por persona */
  loans: NewLoan[]
  /** Todo lo que hay que pasarse para quedar a mano, con nombres (incluye lo que no pasa por mí) */
  transfers: NamedTransfer[]
  /** Lo que pagué yo (lo que realmente sale de mi cuenta) */
  myPaid: number
  /** Mi parte */
  mine: number
}

/**
 * Arma lo que se registra: un gasto solo por mi parte y, por cada persona con la que quedo
 * debiendo o me queda debiendo, un préstamo, todos desde la misma cuenta y con el mismo `splitId`.
 * Así la cuenta baja exactamente lo que pagué, solo mi parte cuenta como gasto, lo que me deben
 * queda en "Te deben" y lo que debo, en "Debes".
 */
export const planSplit = ({
  shares,
  paid,
  decimals = 0,
  what,
  accountId,
  categoryId,
  date,
  dueDate,
  splitId,
}: SplitPlanInput): SplitPlan => {
  const label = what?.trim() || undefined
  const total = fromMinor(
    shares.reduce((s, x) => s + toMinor(x.amount, decimals), 0),
    decimals,
  )
  // Si "yo" no está en la lista (no consumí) igual soy quien pagó: se me agrega con parte 0
  const all: SplitShare[] = shares.some((s) => s.me) ? shares : [{ name: 'Tú', me: true, amount: 0 }, ...shares]
  const paidAll = paid ? (shares.some((s) => s.me) ? paid : [0, ...paid]) : all.map((s) => (s.me ? total : 0))
  const transfers = settleSplit(all, paidAll, decimals)

  const mineMinor = all.filter((s) => s.me).reduce((sum, s) => sum + toMinor(s.amount, decimals), 0)
  const mine = fromMinor(mineMinor, decimals)
  const people = all.filter((s) => s.amount > 0).length
  const expense: NewTx | undefined =
    mine > 0
      ? {
          type: 'expense',
          amount: mine,
          accountId,
          categoryId,
          date,
          place: label,
          note: `Cuenta dividida entre ${people}`,
          splitId,
        }
      : undefined

  const note = label ? `Parte de ${label}` : 'Parte de una cuenta dividida'
  const loans: NewLoan[] = []
  for (const t of transfers) {
    const fromMe = all[t.from].me
    const toMe = all[t.to].me
    if (fromMe === toMe || t.amount <= 0) continue
    loans.push({
      direction: toMe ? 'lent' : 'borrowed',
      person: (toMe ? all[t.from] : all[t.to]).name.trim(),
      amount: t.amount,
      date,
      dueDate: dueDate || undefined,
      accountId,
      note,
      splitId,
    })
  }
  const myPaid = fromMinor(
    all.reduce((sum, s, i) => sum + (s.me ? toMinor(paidAll[i], decimals) : 0), 0),
    decimals,
  )
  return {
    expense,
    loans,
    transfers: transfers.map((t) => ({
      from: all[t.from].name,
      to: all[t.to].name,
      amount: t.amount,
      toMe: all[t.to].me,
      fromMe: all[t.from].me,
    })),
    myPaid,
    mine,
  }
}
