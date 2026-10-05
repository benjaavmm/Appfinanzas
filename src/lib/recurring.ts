import { addMonths, addWeeks, getDaysInMonth, setDate } from 'date-fns'
import { parseDate, toDateStr } from './dates'
import type { DateStr, Frequency, Subscription } from './types'

export const FREQUENCIES: { value: Frequency; label: string; short: string }[] = [
  { value: 'weekly', label: 'Semanal', short: '/sem' },
  { value: 'monthly', label: 'Mensual', short: '/mes' },
  { value: 'quarterly', label: 'Trimestral', short: '/trim' },
  { value: 'yearly', label: 'Anual', short: '/año' },
]

export const frequencyLabel = (f: Frequency) => FREQUENCIES.find((x) => x.value === f)?.label ?? f
export const frequencyShort = (f: Frequency) => FREQUENCIES.find((x) => x.value === f)?.short ?? ''

const MONTHS_PER: Record<Exclude<Frequency, 'weekly'>, number> = { monthly: 1, quarterly: 3, yearly: 12 }

/**
 * Avanza una fecha según la frecuencia. Para frecuencias mensuales respeta el día
 * original (`anchorDay`) aunque un mes más corto lo haya recortado: 31 ene → 28 feb → 31 mar.
 */
export const advanceDate = (date: DateStr, freq: Frequency, anchorDay?: number): DateStr => {
  const d = parseDate(date)
  if (freq === 'weekly') return toDateStr(addWeeks(d, 1))
  const next = addMonths(setDate(d, 1), MONTHS_PER[freq])
  const day = Math.min(anchorDay ?? d.getDate(), getDaysInMonth(next))
  return toDateStr(setDate(next, day))
}

/** Cuánto equivale el cobro a un mes promedio */
export const monthlyEquivalent = (s: Pick<Subscription, 'amount' | 'frequency'>): number => {
  switch (s.frequency) {
    case 'weekly':
      return (s.amount * 52) / 12
    case 'monthly':
      return s.amount
    case 'quarterly':
      return s.amount / 3
    case 'yearly':
      return s.amount / 12
  }
}

export const yearlyEquivalent = (s: Pick<Subscription, 'amount' | 'frequency'>): number => monthlyEquivalent(s) * 12

/** Fechas de cobro vencidas (<= hoy) a partir de nextDate, con tope de seguridad */
export const dueDates = (s: Pick<Subscription, 'nextDate' | 'frequency' | 'anchorDay'>, today: DateStr, max = 60): DateStr[] => {
  const out: DateStr[] = []
  let d = s.nextDate
  while (d <= today && out.length < max) {
    out.push(d)
    d = advanceDate(d, s.frequency, s.anchorDay)
  }
  return out
}

/** Cobros pendientes hasta `until` (incluye recurrencias y atrasados) */
export const upcomingCharges = (subs: Subscription[], until: DateStr): { sub: Subscription; date: DateStr }[] => {
  const out: { sub: Subscription; date: DateStr }[] = []
  for (const sub of subs) {
    if (!sub.active) continue
    let d = sub.nextDate
    let guard = 0
    // Incluye también los cobros atrasados: siguen pendientes de pago
    while (d <= until && guard++ < 60) {
      out.push({ sub, date: d })
      d = advanceDate(d, sub.frequency, sub.anchorDay)
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}
