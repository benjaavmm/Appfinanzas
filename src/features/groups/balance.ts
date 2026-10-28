/**
 * Saldos de un grupo (funciones puras): cuánto puso y cuánto le toca a cada uno, y la forma
 * más corta de quedar a mano. Montos en la unidad normal de la moneda; por dentro, enteros
 * en la unidad mínima para que no haya errores de redondeo.
 */
import { fromMinor, splitTotal, toMinor } from '../split/split'
import type { DateStr } from '../../lib/types'

export interface GroupMember {
  id: string
  name: string
  /** Tiene cuenta en la app (se unió con el link) */
  joined: boolean
  /** Soy yo */
  me: boolean
}

export interface GroupEntry {
  id: string
  kind: 'expense' | 'payment'
  description?: string | null
  amount: number
  date: DateStr
  /** En un gasto, quién pagó; en un pago, quién le pasó la plata a otro */
  paidBy: string
  /** Cuánto le toca a cada uno (en un pago: a quién se le pagó) */
  shares: Record<string, number>
  createdAt: string
}

export interface Group {
  id: string
  name: string
  emoji: string
  currency: string
  inviteCode?: string
  members: GroupMember[]
  entries: GroupEntry[]
  updatedAt?: string
}

/** Saldo de cada integrante: positivo = le deben, negativo = debe */
export const groupBalances = (group: Pick<Group, 'members' | 'entries'>, decimals = 0): Record<string, number> => {
  const minor: Record<string, number> = Object.fromEntries(group.members.map((m) => [m.id, 0]))
  for (const e of group.entries) {
    if (e.paidBy in minor) minor[e.paidBy] += toMinor(e.amount, decimals)
    for (const [id, v] of Object.entries(e.shares)) if (id in minor) minor[id] -= toMinor(v, decimals)
  }
  return Object.fromEntries(Object.entries(minor).map(([id, v]) => [id, fromMinor(v, decimals)]))
}

export interface GroupTransfer {
  from: string
  to: string
  amount: number
}

/**
 * Quién le paga a quién para quedar a mano, con pocas transferencias: el que más debe le paga
 * al que más le deben. "Yo" va primero si debo o me deben, así lo mío queda en una o dos.
 */
export const settleGroup = (group: Pick<Group, 'members' | 'entries'>, decimals = 0): GroupTransfer[] => {
  const bal = groupBalances(group, decimals)
  const me = group.members.find((m) => m.me)?.id
  const order = (a: { id: string; left: number }, b: { id: string; left: number }) =>
    Number(b.id === me) - Number(a.id === me) || b.left - a.left || a.id.localeCompare(b.id)
  const creditors = Object.entries(bal)
    .map(([id, v]) => ({ id, left: toMinor(v, decimals) }))
    .filter((x) => x.left > 0)
    .sort(order)
  const debtors = Object.entries(bal)
    .map(([id, v]) => ({ id, left: -toMinor(v, decimals) }))
    .filter((x) => x.left > 0)
    .sort(order)
  const out: GroupTransfer[] = []
  let c = 0
  for (const d of debtors) {
    while (d.left > 0 && c < creditors.length) {
      const cr = creditors[c]
      const amount = Math.min(d.left, cr.left)
      out.push({ from: d.id, to: cr.id, amount: fromMinor(amount, decimals) })
      d.left -= amount
      cr.left -= amount
      if (cr.left === 0) c++
    }
  }
  return out
}

/** Lo mío en el grupo: saldo, lo que me deben y lo que debo (según cómo quedar a mano) */
export const myStanding = (group: Group, decimals = 0) => {
  const me = group.members.find((m) => m.me)?.id
  const balance = me ? (groupBalances(group, decimals)[me] ?? 0) : 0
  const transfers = settleGroup(group, decimals)
  const owedToMe = transfers.filter((t) => t.to === me)
  const iOwe = transfers.filter((t) => t.from === me)
  return { meId: me, balance, transfers, owedToMe, iOwe }
}

/** Partes iguales entre los elegidos; el redondeo lo absorbe quien pagó (o el primero) */
export const equalShares = (amount: number, memberIds: string[], payerId: string, decimals = 0): Record<string, number> => {
  if (!memberIds.length) return {}
  const shares = splitTotal(
    amount,
    memberIds.map((id) => ({ name: id, me: id === payerId })),
    decimals,
  )
  return Object.fromEntries(shares.map((s) => [s.name, s.amount]))
}

/** Total gastado en el grupo (sin contar los pagos entre ellos) */
export const groupSpent = (group: Pick<Group, 'entries'>) =>
  group.entries.filter((e) => e.kind === 'expense').reduce((s, e) => s + e.amount, 0)

/** Cuánto me tocó a mí en los gastos */
export const myShareTotal = (group: Group) => {
  const me = group.members.find((m) => m.me)?.id
  if (!me) return 0
  return group.entries.filter((e) => e.kind === 'expense').reduce((s, e) => s + (e.shares[me] ?? 0), 0)
}

/** "Hola Jazmín! En el grupo 🎁 Regalo Felipe quedaste debiéndome $9.250. Aquí está el detalle: …" */
export const groupChargeText = (p: { name: string; amount: string; group: string; link: string }) =>
  `Hola ${p.name.trim().split(/\s+/)[0]}! En el grupo ${p.group} me quedaste debiendo ${p.amount}. Aquí está el detalle: ${p.link} 🙌`

/** Invitación por WhatsApp */
export const groupInviteText = (p: { group: string; link: string }) =>
  `Te invito al grupo ${p.group} en Mis Finanzas: anotamos los gastos y la app dice quién le debe a quién. ${p.link}`
