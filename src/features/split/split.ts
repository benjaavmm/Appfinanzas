/**
 * Dividir una cuenta: reparte un total entre participantes (función pura).
 *
 * STUB DE LA BASE — lo implementa la tarea "split".
 */
export interface SplitParticipant {
  /** "Yo" se representa con `me: true` */
  name: string
  me?: boolean
  /** Monto fijo opcional; si falta, se reparte lo que quede en partes iguales */
  amount?: number
}

export interface SplitShare {
  name: string
  me: boolean
  amount: number
}

/**
 * Reparte `total` (entero, en la unidad mínima de la moneda) entre los participantes.
 * La suma de las partes es exactamente `total`; el redondeo lo absorbe quien pagó (yo).
 */
export const splitTotal = (total: number, participants: SplitParticipant[], decimals = 0): SplitShare[] => {
  void total
  void decimals
  return participants.map((p) => ({ name: p.name, me: !!p.me, amount: 0 }))
}
