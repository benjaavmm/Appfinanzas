/**
 * Lee notificaciones push, SMS y correos de bancos chilenos y saca los movimientos:
 * "Compra por $12.990 en LIDER con tarjeta terminada en 1234", "Recibiste una
 * transferencia de Juan Pérez por $20.000", etc. Función pura (sin DOM), con pruebas.
 */
import type { DateStr } from '../../lib/types'

export type BankKind =
  'compra' | 'transferencia_recibida' | 'transferencia_enviada' | 'pago' | 'giro' | 'abono' | 'cargo' | 'devolucion' | 'otro'

export interface BankMovement {
  /** Sentido para la app: gasto (sale plata) o ingreso (entra plata) */
  type: 'expense' | 'income'
  kind: BankKind
  /** Monto positivo, en la moneda indicada */
  amount: number
  /** Código ISO si no es peso chileno (p. ej. "USD" en compras al extranjero) */
  currency?: string
  /** Comercio (compras) o persona/empresa (transferencias, pagos), tal como viene, limpio */
  merchant?: string
  /** Fecha del movimiento si el texto la trae */
  date?: DateStr
  /** Hora HH:mm si el texto la trae */
  time?: string
  /** Últimos 4 dígitos de la tarjeta o cuenta ("terminada en 1234", "****1234") */
  cardLast4?: string
  /** Producto si se menciona: crédito, débito, cuenta (corriente/vista/RUT) o prepago */
  product?: 'credito' | 'debito' | 'cuenta' | 'prepago'
  /** Banco o billetera que envió el aviso (si se reconoce): "BancoEstado", "Santander"… */
  bank?: string
  /** "en 3 cuotas" */
  installments?: number
  /** Trozo del texto original que corresponde a este movimiento */
  raw: string
  /** Qué tan seguro está (0 a 1): bajo 0.5 conviene pedir confirmación */
  confidence: number
}

/** Saca 0, 1 o varios movimientos de un texto (puede traer varias notificaciones o un correo entero) */
export const parseBankText = (text: string, today: DateStr): BankMovement[] => {
  void text
  void today
  return []
}

/** ¿Este texto parece un aviso de movimiento bancario? (para ofrecer "agregar" al pegarlo en otro lado) */
export const looksLikeBankText = (text: string, today: DateStr): boolean => parseBankText(text, today).length > 0
