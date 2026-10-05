/**
 * Texto honesto sobre qué puede hacer este navegador con los recordatorios.
 * Función pura (sin DOM) para poder probarla.
 */

export type NotifyPermission = 'default' | 'granted' | 'denied' | 'unsupported'

export interface ReminderCapabilities {
  /** El navegador tiene la API de notificaciones */
  notifications: boolean
  permission: NotifyPermission
  /** El service worker tiene Periodic Background Sync (avisos con la app cerrada) */
  background: boolean
  /** La revisión periódica 'recordatorios' quedó registrada */
  backgroundActive: boolean
  /** Abierta como app instalada (pantalla de inicio) */
  standalone: boolean
  ios: boolean
}

export type SupportTone = 'good' | 'info' | 'warn' | 'bad'

export interface SupportInfo {
  tone: SupportTone
  text: string
  /** Pasos para volver a permitir las notificaciones (si se bloquearon) */
  steps?: string[]
}

export const BACKGROUND_TEXT = 'Te avisamos aunque la app esté cerrada (Chrome elige la hora, más o menos 2 veces al día).'
export const FOREGROUND_ONLY_TEXT = 'Tu navegador solo permite avisos cuando abres la app.'
export const IOS_TEXT =
  'En iPhone, primero agrégala a la pantalla de inicio: en Safari toca Compartir y luego “Agregar a inicio”.'
export const UNSUPPORTED_TEXT = 'Este navegador no permite notificaciones.'
export const DENIED_TEXT = 'Bloqueaste las notificaciones de esta app. Para permitirlas en Chrome:'
export const DENIED_STEPS = [
  'Toca ⋮ (arriba a la derecha)',
  'Configuración → Configuración de sitios',
  'Notificaciones → permite este sitio',
]

export const describeSupport = (caps: ReminderCapabilities, enabled: boolean): SupportInfo => {
  if (caps.ios && !caps.standalone) return { tone: 'warn', text: IOS_TEXT }
  if (!caps.notifications || caps.permission === 'unsupported') return { tone: 'bad', text: UNSUPPORTED_TEXT }
  if (caps.permission === 'denied') return { tone: 'bad', text: DENIED_TEXT, steps: DENIED_STEPS }
  if (!caps.background) return { tone: 'info', text: FOREGROUND_ONLY_TEXT }
  if (caps.backgroundActive) return { tone: 'good', text: BACKGROUND_TEXT }
  // Chrome tiene la función, pero solo la da a apps instaladas (y según cuánto las uses)
  if (!enabled) {
    return {
      tone: 'info',
      text: caps.standalone
        ? 'Al activarlos, Chrome puede avisarte aunque la app esté cerrada (elige la hora, más o menos 2 veces al día).'
        : 'Con la app instalada, Chrome puede avisarte aunque esté cerrada. Si no, te avisamos al abrirla.',
    }
  }
  return {
    tone: 'info',
    text: caps.standalone
      ? 'Por ahora te avisamos cuando abres la app: Chrome todavía no permite avisos con la app cerrada.'
      : 'Por ahora te avisamos cuando abres la app. Si la instalas en tu teléfono, Chrome también puede avisarte con la app cerrada.',
  }
}
