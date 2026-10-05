import { describe, expect, it } from 'vitest'
import { formatAmountInput, formatMoney, normalizeText, sanitizeAmountInput } from '../format'

describe('formatMoney', () => {
  it('formatea pesos chilenos sin decimales', () => {
    expect(formatMoney(1234567, 'CLP', 'es-CL')).toBe('$1.234.567')
    expect(formatMoney(-500, 'CLP', 'es-CL')).toBe('−$500')
    expect(formatMoney(500, 'CLP', 'es-CL', { sign: true })).toBe('+$500')
  })
})

describe('input de montos', () => {
  it('CLP: agrupa miles y elimina lo que no es número', () => {
    expect(sanitizeAmountInput('12.345', 'es-CL', 0)).toBe('12345')
    expect(sanitizeAmountInput('$ 1.000a', 'es-CL', 0)).toBe('1000')
    expect(formatAmountInput('12345', 'es-CL', 0)).toBe('12.345')
  })
  it('EUR (es-ES): coma decimal', () => {
    expect(sanitizeAmountInput('1.234,5', 'es-ES', 2)).toBe('1234.5')
    expect(sanitizeAmountInput('1.234,567', 'es-ES', 2)).toBe('1234.56')
    expect(formatAmountInput('1234.5', 'es-ES', 2)).toBe('1234,5')
  })
  it('USD (en-US): punto decimal', () => {
    expect(sanitizeAmountInput('1,234.50', 'en-US', 2)).toBe('1234.50')
    expect(formatAmountInput('1234.', 'en-US', 2)).toBe('1,234.')
  })
})

it('normaliza texto para comparar lugares', () => {
  expect(normalizeText('  Líder   Express ')).toBe('lider express')
})
