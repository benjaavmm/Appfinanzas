/**
 * Recordatorios: qué avisar hoy (cobros próximos, préstamos que vencen, presupuestos al límite).
 * Función pura: la usan la app y el service worker (sin DOM).
 *
 * STUB DE LA BASE — lo implementa la tarea "reminders".
 */
import type { DateStr, FinanceData, ReminderSettings } from '../../lib/types'

export interface Reminder {
  /** Estable por ocurrencia (p. ej. `sub:<id>:<fecha>`), para no avisar dos veces lo mismo */
  id: string
  kind: 'subscription' | 'loan' | 'budget'
  title: string
  body: string
  /** Ruta de la app a abrir al tocar la notificación, p. ej. "#/suscripciones" */
  url: string
}

export const DEFAULT_REMINDERS: ReminderSettings = {
  enabled: false,
  subscriptions: true,
  loans: true,
  budgets: true,
  daysBefore: 1,
}

export const computeReminders = (data: FinanceData, today: DateStr): Reminder[] => {
  void data
  void today
  return []
}
