/** Tipos compartidos del asistente */
import type { SheetState } from '../../lib/ui'
import type { Transaction } from '../../lib/types'

export type Fmt = (n: number, opts?: { sign?: boolean }) => string

export interface ReplyRow {
  label: string
  value: string
  tone?: 'good' | 'bad' | 'muted'
  icon?: string
  /** Segunda línea más chica */
  sub?: string
}

export type ReplyAction = { label: string } & ({ kind: 'sheet'; sheet: SheetState } | { kind: 'nav'; to: string })

/** Cómo viene la noticia: la personalidad reacciona distinto */
export type Mood = 'good' | 'bad' | 'neutral'

export interface Reply {
  /** Texto con **negritas** */
  text: string
  mood?: Mood
  /** Qué entendió (para pruebas y para recordar el tema) */
  kind?: string
  rows?: ReplyRow[]
  txs?: Transaction[]
  actions?: ReplyAction[]
  suggestions?: string[]
}

