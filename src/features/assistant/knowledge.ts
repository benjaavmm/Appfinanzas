/** Lo que el asistente sabe de la app y de finanzas, más allá de tus números */
import type { ReplyAction } from './types'

export interface KnowledgeEntry {
  id: string
  kind: 'app' | 'concept'
  /**
   * Frases que la activan, en minúsculas y SIN tildes ("escanear boleta", "cae").
   * Las de varias palabras pesan más; una palabra suelta debe ser bien específica.
   */
  triggers: string[]
  /** Título corto ("Escanear una boleta") */
  title: string
  /** Respuesta corta con **negritas** (2 a 4 frases) */
  answer: string
  /** Pasos, si es un "cómo se hace" */
  steps?: string[]
  /** Botón para hacerlo al tiro */
  action?: ReplyAction
  /** 1 a 3 preguntas relacionadas para sugerir */
  related?: string[]
}

export { APP_KNOWLEDGE } from './knowledge-app'
export { FINANCE_KNOWLEDGE } from './knowledge-finance'
