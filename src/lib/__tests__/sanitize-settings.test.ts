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
