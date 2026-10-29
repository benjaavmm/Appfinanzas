/** Tipos compartidos del asistente */
import type { SheetState } from '../../lib/ui'
import type { AssistantAlias, Transaction } from '../../lib/types'
import type { Moment } from './personality'

export type Fmt = (n: number, opts?: { sign?: boolean }) => string

export interface ReplyRow {
  label: string
  value: string
  tone?: 'good' | 'bad' | 'muted'
  icon?: string
  /** Segunda línea más chica */
  sub?: string
}

export type ReplyAction = { label: string } & (
  | { kind: 'sheet'; sheet: SheetState }
  | { kind: 'nav'; to: string }
  /** Le pasa la pregunta a la IA (Gemini) */
  | { kind: 'askAi'; question: string }
)

/** Cómo viene la noticia: la personalidad reacciona distinto */
export type Mood = 'good' | 'bad' | 'neutral'

export interface Reply {
  /** Texto con **negritas** */
  text: string
  mood?: Mood
  /** Qué entendió (para pruebas y para recordar el tema) */
  kind?: string
  /** Reacción de la personalidad que va antes del texto (p. ej. veredicto de "¿me alcanza?") */
  react?: Moment
  /** Pasos numerados (guías de la app) */
  steps?: string[]
  /** Cómo se calculó, para responder "¿por qué?" */
  why?: string
  rows?: ReplyRow[]
  txs?: Transaction[]
  actions?: ReplyAction[]
  suggestions?: string[]
  /** Algo que el asistente aprendió y la app debe guardar */
  learn?: LearnEffect
  /** Respondió la IA (Gemini): cuántas preguntas le quedan hoy */
  ai?: { left?: number }
}

/** Lo que el asistente aprende de ti (la app lo guarda en tus ajustes) */
export type LearnEffect =
  | { kind: 'alias'; word: string; alias: AssistantAlias }
  | { kind: 'forget'; word: string }
  | { kind: 'payday'; day: number | null }
  | { kind: 'name'; name: string }
