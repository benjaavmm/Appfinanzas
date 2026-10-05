/**
 * Guardar (y deshacer) una importación de cartola. Recibe las acciones del store como
 * parámetro para poder probarlo sin IndexedDB.
 */
import type { Store } from '../../lib/store'
import type { ID, Transaction } from '../../lib/types'
import { keepBalanceInitial } from './review'

type Api = Pick<Store, 'accounts' | 'addTransactions' | 'deleteTransaction' | 'updateAccount'>

export interface ImportResult {
  accountId: ID
  /** Ids de los movimientos creados (para deshacer exactamente esos) */
  ids: ID[]
  /** Cuánto se restó al saldo inicial de la cuenta para mantener el saldo actual (0 si no se ajustó) */
  adjustment: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Efecto neto en el saldo de la cuenta: ingresos − gastos */
export const netEffect = (txs: Pick<Transaction, 'type' | 'amount'>[]): number =>
  round2(txs.reduce((s, t) => s + (t.type === 'income' ? t.amount : t.type === 'expense' ? -t.amount : 0), 0))

/**
 * Agrega los movimientos de una vez y, si `keepBalance`, ajusta el saldo inicial de la cuenta
 * para que su saldo actual no cambie (los movimientos importados ya estaban reflejados en él).
 */
export const applyImport = (
  get: () => Api,
  txs: Omit<Transaction, 'id' | 'createdAt'>[],
  accountId: ID,
  keepBalance: boolean,
): ImportResult => {
  const created = get().addTransactions(txs)
  const net = netEffect(created)
  const account = get().accounts.find((a) => a.id === accountId)
  let adjustment = 0
  if (keepBalance && account && net !== 0) {
    get().updateAccount(accountId, { initialBalance: keepBalanceInitial(account.initialBalance, net) })
    adjustment = net
  }
  return { accountId, ids: created.map((t) => t.id), adjustment }
}

/**
 * Elimina exactamente los movimientos importados y devuelve el saldo inicial a como estaba.
 * `removeMany` permite borrarlos en una sola actualización: con cientos de filas, llamar a
 * deleteTransaction uno por uno guarda el estado completo en cada llamada y congela la pantalla.
 */
export const undoImport = (get: () => Api, result: ImportResult, removeMany?: (ids: ReadonlySet<ID>) => void): void => {
  if (removeMany) removeMany(new Set(result.ids))
  else for (const id of result.ids) get().deleteTransaction(id)
  if (!result.adjustment) return
  const account = get().accounts.find((a) => a.id === result.accountId)
  if (account) get().updateAccount(result.accountId, { initialBalance: round2(account.initialBalance + result.adjustment) })
}
