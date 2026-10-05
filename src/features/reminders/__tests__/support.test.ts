import { describe, expect, it } from 'vitest'
import {
  BACKGROUND_TEXT,
  DENIED_STEPS,
  describeSupport,
  FOREGROUND_ONLY_TEXT,
  IOS_TEXT,
  UNSUPPORTED_TEXT,
  type ReminderCapabilities,
} from '../support'

const caps = (over: Partial<ReminderCapabilities> = {}): ReminderCapabilities => ({
  notifications: true,
  permission: 'granted',
  background: true,
  backgroundActive: false,
  standalone: true,
  ios: false,
  ...over,
})

describe('describeSupport', () => {
  it('con revisión en segundo plano activa', () => {
    expect(describeSupport(caps({ backgroundActive: true }), true)).toEqual({ tone: 'good', text: BACKGROUND_TEXT })
  })

  it('navegador sin segundo plano: solo al abrir la app', () => {
    expect(describeSupport(caps({ background: false }), true).text).toBe(FOREGROUND_ONLY_TEXT)
    expect(describeSupport(caps({ background: false, ios: true, standalone: true }), false).text).toBe(FOREGROUND_ONLY_TEXT)
  })

  it('iPhone sin instalar: primero agregarla a inicio', () => {
    const info = describeSupport(caps({ ios: true, standalone: false, notifications: false, permission: 'unsupported' }), false)
    expect(info).toEqual({ tone: 'warn', text: IOS_TEXT })
  })

  it('sin soporte de notificaciones', () => {
    expect(describeSupport(caps({ notifications: false, permission: 'unsupported' }), false)).toEqual({
      tone: 'bad',
      text: UNSUPPORTED_TEXT,
    })
  })

  it('bloqueadas: explica cómo permitirlas en Chrome', () => {
    const info = describeSupport(caps({ permission: 'denied' }), false)
    expect(info.tone).toBe('bad')
    expect(info.steps).toEqual(DENIED_STEPS)
    expect(info.steps?.join(' ')).toContain('Configuración de sitios')
  })

  it('Chrome con la función pero sin registrar: honesto según si está instalada', () => {
    expect(describeSupport(caps({ standalone: false }), true).text).toContain('Si la instalas')
    expect(describeSupport(caps({ standalone: true }), true).text).toContain('todavía no permite')
    expect(describeSupport(caps({ standalone: false }), false).text).toContain('Con la app instalada')
    expect(describeSupport(caps({ standalone: true }), false).tone).toBe('info')
  })
})
