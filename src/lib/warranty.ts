/**
 * Garantías de tus compras (funciones puras). En Chile la garantía legal de un producto nuevo es
 * de 6 meses (Ley 21.398, desde marzo de 2022): si falla, puedes pedir cambio, reparación o
 * devolución del dinero. Algunas tiendas o marcas dan más (garantía voluntaria).
 */
import { addMonths } from 'date-fns'
import { daysBetween, parseDate, toDateStr } from './dates'
import type { DateStr, Transaction } from './types'

export const LEGAL_WARRANTY_MONTHS = 6

/** Opciones para elegir al anotar una compra */
export const WARRANTY_OPTIONS: { months: number; label: string }[] = [
  { months: 0, label: 'Sin garantía' },
  { months: 6, label: 'Legal · 6 meses' },
  { months: 12, label: '1 año' },
  { months: 24, label: '2 años' },
  { months: 36, label: '3 años' },
]

export const warrantyEnd = (t: Pick<Transaction, 'date' | 'warrantyMonths'>): DateStr | undefined =>
  t.warrantyMonths ? toDateStr(addMonths(parseDate(t.date), t.warrantyMonths)) : undefined

export interface Warranty {
  tx: Transaction
  end: DateStr
  /** Días que quedan (negativo si ya venció) */
  daysLeft: number
  /** Cuánto del plazo ya pasó (0–1) */
  elapsed: number
}

export const warranties = (txs: Transaction[], today: DateStr): { active: Warranty[]; expired: Warranty[] } => {
  const all = txs
    .filter((t) => t.type === 'expense' && t.warrantyMonths)
    .map((tx) => {
      const end = warrantyEnd(tx)!
      const total = Math.max(1, daysBetween(tx.date, end))
      return {
        tx,
        end,
        daysLeft: daysBetween(today, end),
        elapsed: Math.min(1, Math.max(0, daysBetween(tx.date, today) / total)),
      }
    })
  return {
    active: all.filter((w) => w.daysLeft >= 0).sort((a, b) => a.daysLeft - b.daysLeft),
    // Las vencidas en los últimos 3 meses, por si acaso
    expired: all.filter((w) => w.daysLeft < 0 && w.daysLeft >= -90).sort((a, b) => b.daysLeft - a.daysLeft),
  }
}

/** "vence hoy", "vence mañana", "vence en 12 días", "venció hace 3 días" */
export const warrantyLeftText = (daysLeft: number) =>
  daysLeft === 0
    ? 'vence hoy'
    : daysLeft === 1
      ? 'vence mañana'
      : daysLeft > 1
        ? daysLeft > 60
          ? `vence en ${Math.round(daysLeft / 30.44)} meses`
          : `vence en ${daysLeft} días`
        : `venció hace ${-daysLeft} ${daysLeft === -1 ? 'día' : 'días'}`
