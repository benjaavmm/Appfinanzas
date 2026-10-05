import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  format,
  getDaysInMonth,
  isValid,
  parseISO,
  startOfMonth,
} from 'date-fns'
import { es } from 'date-fns/locale'
import type { DateStr } from './types'

export const toDateStr = (d: Date): DateStr => format(d, 'yyyy-MM-dd')

export const todayStr = (): DateStr => toDateStr(new Date())

export const nowTime = (): string => format(new Date(), 'HH:mm')

export const parseDate = (s: DateStr): Date => {
  const d = parseISO(s)
  return isValid(d) ? d : new Date()
}

/** Clave de mes "YYYY-MM" */
export const monthKey = (s: DateStr | Date): string => (typeof s === 'string' ? s.slice(0, 7) : format(s, 'yyyy-MM'))

export const monthStart = (d: Date): DateStr => toDateStr(startOfMonth(d))
export const monthEnd = (d: Date): DateStr => toDateStr(endOfMonth(d))

export const shiftMonth = (d: Date, n: number): Date => addMonths(d, n)

export const daysInMonth = (d: Date): number => getDaysInMonth(d)

export const daysBetween = (from: DateStr, to: DateStr): number => differenceInCalendarDays(parseDate(to), parseDate(from))

export const addDaysStr = (s: DateStr, n: number): DateStr => toDateStr(addDays(parseDate(s), n))

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export const fmtMonth = (d: Date | DateStr, withYear = true): string =>
  cap(format(typeof d === 'string' ? parseDate(d) : d, withYear ? 'MMMM yyyy' : 'MMMM', { locale: es }))

export const fmtMonthShort = (d: Date | DateStr): string =>
  cap(format(typeof d === 'string' ? parseDate(d) : d, 'MMM', { locale: es }).replace('.', ''))

export const fmtDate = (s: DateStr, pattern = "d 'de' MMMM"): string => format(parseDate(s), pattern, { locale: es })

export const fmtDateShort = (s: DateStr): string => format(parseDate(s), 'd MMM', { locale: es }).replace('.', '')

export const fmtWeekday = (s: DateStr): string => cap(format(parseDate(s), 'EEEE', { locale: es }))

/** "Hoy", "Ayer", "Mañana" o "lunes 3 de marzo" */
export const fmtRelativeDay = (s: DateStr): string => {
  const diff = daysBetween(todayStr(), s)
  if (diff === 0) return 'Hoy'
  if (diff === -1) return 'Ayer'
  if (diff === 1) return 'Mañana'
  const sameYear = s.slice(0, 4) === todayStr().slice(0, 4)
  return cap(format(parseDate(s), sameYear ? "EEEE d 'de' MMMM" : "EEEE d 'de' MMMM yyyy", { locale: es }))
}

/** "en 3 días", "hace 2 días", "hoy" */
export const fmtInDays = (s: DateStr): string => {
  const diff = daysBetween(todayStr(), s)
  if (diff === 0) return 'hoy'
  if (diff === 1) return 'mañana'
  if (diff === -1) return 'ayer'
  if (diff > 0) return `en ${diff} días`
  return `hace ${-diff} días`
}

export const WEEKDAYS_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
export const WEEKDAYS_LONG = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados', 'domingos']

/** 0 = lunes … 6 = domingo */
export const weekdayIndex = (s: DateStr): number => (parseDate(s).getDay() + 6) % 7
