/**
 * Sonda para revisar muchas preguntas de una vez (no corre en la suite normal):
 *   PROBE_FILE=/ruta/preguntas.json npx vitest run src/features/assistant/__tests__/probe.test.mjs
 * El JSON es una lista de preguntas (o de listas, para conversaciones con seguimiento).
 * Escribe <archivo>.out.jsonl con una línea JSON por pregunta: lo que entendió y lo que respondió.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, it } from 'vitest'
import { answer } from '../engine'
import { buildDemoData } from '../../../lib/demo'
import { todayStr } from '../../../lib/dates'

const file = process.env.PROBE_FILE

describe.skipIf(!file)('sonda del asistente', () => {
  it('responde las preguntas', () => {
    const data = buildDemoData('Benja')
    const today = todayStr()
    const fmt = (n, o) => `${o?.sign && n > 0 ? '+' : ''}${n < 0 ? '-' : ''}$${Math.round(Math.abs(n)).toLocaleString('es-CL')}`
    const items = JSON.parse(readFileSync(file, 'utf8'))
    const out = []
    for (const item of items) {
      const convo = Array.isArray(item) ? item : [item]
      let memory = {}
      convo.forEach((q, turn) => {
        const res = answer(q, data, today, fmt, memory, {
          personality: process.env.PROBE_PERSONALITY || undefined,
          turn,
        })
        memory = res.memory
        out.push(
          JSON.stringify({
            q,
            kind: res.reply.kind,
            text: res.reply.text.replace(/\n+/g, ' ').slice(0, 220),
            rows: res.reply.rows?.length ?? 0,
            rowsText: res.reply.rows?.map((r) => `${r.label}: ${r.value}`).join(' | '),
            steps: res.reply.steps?.length ?? 0,
            actions: res.reply.actions?.map((a) => a.label),
          }),
        )
      })
    }
    writeFileSync(`${file}.out.jsonl`, out.join('\n') + '\n')
  })
})
