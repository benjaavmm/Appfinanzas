import { describe, expect, it } from 'vitest'
import { fillMarkers, firstName, NUDGE_MOMENTS, NUDGES, nudgePersonality, nudgeText } from '../nudges'
import type { PersonalityId } from '../../assistant/personality'

const PERSONALITIES = Object.keys(NUDGES) as PersonalityId[]

// Valores largos, para medir el peor caso
const SAMPLE = { name: ' Benjamín', cuando: 'ayer', dia: 'miércoles', dias: 12, mes: 'septiembre' }
const KNOWN_MARKERS = new Set(['name', 'cuando', 'dia', 'dias', 'mes', 'dato'])

describe('frases', () => {
  it('hay frases para las 4 personalidades y todos los momentos, con 4 a 6 variantes', () => {
    expect(PERSONALITIES.sort()).toEqual(['amigo', 'chistoso', 'coach', 'profesional'])
    for (const p of PERSONALITIES) {
      for (const m of NUDGE_MOMENTS) {
        const { title, body } = NUDGES[p][m]
        expect(title.length, `${p}.${m}.title`).toBeGreaterThanOrEqual(4)
        expect(title.length, `${p}.${m}.title`).toBeLessThanOrEqual(6)
        expect(body.length, `${p}.${m}.body`).toBeGreaterThanOrEqual(4)
        expect(body.length, `${p}.${m}.body`).toBeLessThanOrEqual(6)
      }
    }
  })

  it('solo usan marcadores conocidos, y los de números van en {dato}', () => {
    for (const p of PERSONALITIES) {
      for (const m of NUDGE_MOMENTS) {
        const { title, body } = NUDGES[p][m]
        for (const t of [...title, ...body]) {
          for (const [, key] of t.matchAll(/\{(\w+)\}/g)) expect(KNOWN_MARKERS.has(key), `${p}.${m}: ${t}`).toBe(true)
        }
        // El título nunca lleva montos
        for (const t of title) expect(t).not.toContain('{dato}')
        // Los momentos con números siempre los muestran; los otros no los necesitan
        const needsData = m !== 'notLogged' && m !== 'stale'
        for (const b of body) expect(b.includes('{dato}'), `${p}.${m}: ${b}`).toBe(needsData)
      }
    }
  })

  it('títulos cortos y cuerpos que caben en la notificación', () => {
    for (const p of PERSONALITIES) {
      for (const m of NUDGE_MOMENTS) {
        const { title, body } = NUDGES[p][m]
        for (const t of title) expect(fillMarkers(t, SAMPLE).length, `${p}.${m}: ${t}`).toBeLessThanOrEqual(45)
        for (const b of body) {
          // {dato} lo arma compute.ts (hasta unas 85 letras): la frase de alrededor debe ser corta
          const limit = b.includes('{dato}') ? 50 : 130
          expect(fillMarkers(b.replace('{dato}', ''), SAMPLE).length, `${p}.${m}: ${b}`).toBeLessThanOrEqual(limit)
        }
      }
    }
  })
})

describe('nudgeText', () => {
  it('pone el nombre (primera palabra) o lo omite sin dejar espacios raros', () => {
    const vars = { cuando: 'hoy' }
    expect(nudgeText('notLogged', { personality: 'amigo', userName: 'Benjamín Soto', seed: 0, vars }).title).toBe(
      '¿Cómo te fue hoy Benjamín?',
    )
    expect(nudgeText('notLogged', { personality: 'amigo', userName: '  ', seed: 0, vars }).title).toBe('¿Cómo te fue hoy?')
    expect(nudgeText('notLogged', { personality: 'amigo', seed: 0, vars }).body).toBe(
      'Anota lo que gastaste hoy antes de que se te olvide 📝',
    )
  })

  it('sin personalidad (o una desconocida) usa la de "amigo"', () => {
    expect(nudgePersonality()).toBe('amigo')
    expect(nudgePersonality('pirata')).toBe('amigo')
    expect(nudgePersonality('toString')).toBe('amigo')
    expect(nudgePersonality('coach')).toBe('coach')
    const a = nudgeText('weekGood', { seed: 3, vars: { dato: 'x' } })
    expect(a).toEqual(nudgeText('weekGood', { personality: 'amigo', seed: 3, vars: { dato: 'x' } }))
  })

  it('la personalidad cambia el texto', () => {
    const texts = PERSONALITIES.map((personality) => {
      const r = nudgeText('logged', { personality, seed: 1, vars: { dato: 'Hoy llevas 2 gastos' } })
      return `${r.title} | ${r.body}`
    })
    expect(new Set(texts).size).toBe(PERSONALITIES.length)
  })

  it('rota según la fecha, sin azar', () => {
    const at = (seed: number) => nudgeText('notLogged', { personality: 'amigo', seed, vars: { cuando: 'hoy', dia: 'lunes' } })
    expect(at(10)).toEqual(at(10))
    // Días seguidos: el título cambia siempre
    for (let s = 0; s < 20; s++) expect(at(s).title).not.toBe(at(s + 1).title)
    // Con el tiempo salen todas las variantes de título y de cuerpo
    const seen = Array.from({ length: 40 }, (_, s) => at(s))
    expect(new Set(seen.map((r) => r.title)).size).toBe(NUDGES.amigo.notLogged.title.length)
    expect(new Set(seen.map((r) => r.body)).size).toBe(NUDGES.amigo.notLogged.body.length)
  })

  it('reemplaza todos los marcadores: nunca queda una "{"', () => {
    for (const personality of PERSONALITIES) {
      for (const m of NUDGE_MOMENTS) {
        for (let seed = 0; seed < 36; seed++) {
          const vars = { cuando: 'hoy', dia: 'lunes', dias: 4, mes: 'octubre', dato: 'Hoy llevas $5.000 en 1 gasto' }
          const { title, body } = nudgeText(m, { personality, userName: 'Cami', seed, vars })
          expect(`${title} ${body}`).not.toMatch(/[{}]/)
          expect(title).not.toMatch(/ {2}|^ | $/)
          expect(body).not.toMatch(/ {2}|^ | $/)
        }
      }
    }
  })

  it('un marcador sin valor se quita limpio', () => {
    expect(fillMarkers('¡Wena{name}!', {})).toBe('¡Wena!')
    expect(fillMarkers('Hola {nada} mundo {x', {})).toBe('Hola mundo x')
    expect(fillMarkers('Llevas {dias} días', { dias: 3 })).toBe('Llevas 3 días')
  })

  it('primer nombre', () => {
    expect(firstName(' María José Pérez ')).toBe('María')
    expect(firstName('')).toBe('')
    expect(firstName(undefined)).toBe('')
  })
})
