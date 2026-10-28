/**
 * Palabras tuyas que el asistente aprendió: "la micro" → Transporte, "el chino" → el almacén de
 * la esquina. Las usan el asistente y el registro rápido.
 */
import { normalizeText } from './format'
import type { AssistantAlias } from './types'

/** Clave de una palabra aprendida: minúsculas, sin tildes ni artículos al inicio */
export const aliasKey = (s: string) =>
  normalizeText(s)
    .replace(/ñ/g, 'n')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/^(el|la|los|las|un|una|mi|mis)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()

/** La palabra aprendida más larga que aparece en el texto */
export const matchAlias = (text: string, aliases?: Record<string, AssistantAlias>): AssistantAlias | undefined => {
  if (!aliases) return undefined
  const t = ` ${normalizeText(text)
    .replace(/ñ/g, 'n')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')} `
  let best: { k: string; a: AssistantAlias } | undefined
  for (const [k, a] of Object.entries(aliases)) {
    if (k && t.includes(` ${k} `) && (!best || k.length > best.k.length)) best = { k, a }
  }
  return best?.a
}
