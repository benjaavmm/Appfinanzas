import { describe, expect, it } from 'vitest'
import { sanitizeData } from '../sanitize'
import { DATA_VERSION } from '../defaults'

describe('sanitizeData conserva los ajustes nuevos', () => {
  it('recordatorio diario, resumen semanal y cuentas de cada tarjeta', () => {
    const { data } = sanitizeData(
      {
        settings: {
          onboarded: true,
          reminders: { enabled: true, daily: true, dailyHour: 22, weekly: false, daysBefore: 1 },
          bankLinks: { 'card:1234': 'acc-1', 'bank:santander:credito': 'acc-2', malo: 5 },
        },
      },
      DATA_VERSION,
    )
    expect(data.settings.reminders).toMatchObject({ daily: true, dailyHour: 22, weekly: false })
    expect(data.settings.bankLinks).toEqual({ 'card:1234': 'acc-1', 'bank:santander:credito': 'acc-2' })
  })
  it('descarta horas inválidas', () => {
    const { data } = sanitizeData({ settings: { reminders: { enabled: true, dailyHour: 99 } } }, DATA_VERSION)
    expect(data.settings.reminders?.dailyHour).toBeUndefined()
  })
})

describe('constancia de lo que se aceptó', () => {
  it('guarda versión y fecha de Términos y del aviso de la IA, y descarta lo inválido', () => {
    const at = '2026-11-23T10:00:00.000Z'
    const { data } = sanitizeData(
      {
        settings: {
          onboarded: true,
          legalConsent: { version: '1.0', at },
          assistant: { ai: true, aiConsent: { version: '1', at } },
        },
      },
      DATA_VERSION,
    )
    expect(data.settings.legalConsent).toEqual({ version: '1.0', at })
    expect(data.settings.assistant?.aiConsent).toEqual({ version: '1', at })
    const bad = sanitizeData({ settings: { onboarded: true, legalConsent: { version: 5 } } }, DATA_VERSION)
    expect(bad.data.settings.legalConsent).toBeUndefined()
  })
})
