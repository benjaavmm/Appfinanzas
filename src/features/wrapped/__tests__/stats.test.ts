import { describe, expect, it } from 'vitest'
import { buildWrapped, wrappedPeriods } from '../stats'
import { buildDemoData } from '../../../lib/demo'
import { formatMoney } from '../../../lib/format'
import { todayStr } from '../../../lib/dates'

const fmt = (n: number) => formatMoney(n, 'CLP', 'es-CL')

describe('tu mes en lucas', () => {
  const data = buildDemoData('Benja')
  const today = todayStr()

  it('ofrece los períodos que tienen gastos', () => {
    const ids = wrappedPeriods(data, today).map((p) => p.id)
    expect(ids).toContain('mes-pasado')
    expect(ids).toContain('ano')
  })

  it('arma tarjetas coherentes, sin textos rotos, y la imagen para compartir', () => {
    for (const p of wrappedPeriods(data, today)) {
      const w = buildWrapped(data, p, fmt)!
      expect(w).not.toBeNull()
      expect(w.slides[0].id).toBe('total')
      expect(w.slides.at(-1)!.id).toBe('persona')
      for (const s of w.slides) {
        const all = `${s.kicker} ${s.big} ${s.text}`
        expect(all).not.toMatch(/undefined|NaN|null|Infinity/)
        expect(s.big.length).toBeGreaterThan(0)
      }
      expect(w.share.lines.length).toBeGreaterThanOrEqual(2)
      expect(w.share.big).toBe(fmt(w.spent))
    }
  })

  it('sin gastos en el período no hay resumen', () => {
    const p = wrappedPeriods(data, today)[0]
    expect(buildWrapped({ ...data, transactions: [] }, p, fmt)).toBeNull()
  })
})
