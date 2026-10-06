/**
 * Decisiones puras de la sincronización (sin red, fáciles de probar):
 * - qué hacer al iniciar sesión con datos locales y en la nube
 * - cómo reflejar los préstamos compartidos de Supabase en los préstamos locales
 */
import { loanRemaining } from '../finance'
import type { DateStr, FinanceData, Loan, SharedLoanStatus } from '../types'

export interface SyncMeta {
  userId: string
  /** updated_at de la nube la última vez que quedamos sincronizados */
  syncedAt: string | null
  /** Hay cambios locales sin subir */
  dirty: boolean
}

export type SyncDecision = 'push' | 'pull' | 'ask' | 'nothing'

export const hasMeaningfulData = (d: Pick<FinanceData, 'settings' | 'accounts' | 'transactions'>) =>
  d.settings.onboarded && (d.accounts.length > 0 || d.transactions.length > 0)

export const decideSync = (
  local: Pick<FinanceData, 'settings' | 'accounts' | 'transactions'>,
  remote: { updated_at: string } | null,
  meta: SyncMeta | null,
  userId: string,
): SyncDecision => {
  const localHas = hasMeaningfulData(local)
  if (!remote) return localHas ? 'push' : 'nothing'
  if (!localHas) return 'pull'
  const sameUser = meta?.userId === userId
  if (sameUser && meta.syncedAt === remote.updated_at) return meta.dirty ? 'push' : 'nothing'
  if (sameUser && !meta.dirty) return 'pull'
  return 'ask'
}

export interface Profile {
  id: string
  username: string
  display_name: string
  avatar: string | null
}

export interface SharedLoanRow {
  id: string
  lender: string
  borrower: string
  created_by: string
  amount: number | string
  currency: string
  description: string | null
  loan_date: DateStr
  due_date: DateStr | null
  status: SharedLoanStatus
  paid_at: string | null
}

export interface ReconcilePlan {
  add: Omit<Loan, 'id' | 'createdAt'>[]
  update: { id: string; patch: Partial<Loan> }[]
  /** Pagos a registrar en préstamos locales que el amigo dio por pagados */
  settle: { id: string; amount: number; date: DateStr; accountId?: string }[]
  remove: string[]
}

const CLOSED: SharedLoanStatus[] = ['rejected', 'cancelled']

export const reconcileSharedLoans = (
  local: Loan[],
  rows: SharedLoanRow[],
  me: string,
  profiles: Record<string, Profile>,
): ReconcilePlan => {
  const plan: ReconcilePlan = { add: [], update: [], settle: [], remove: [] }
  const byShared = new Map(local.filter((l) => l.shared).map((l) => [l.shared!.id, l]))
  for (const r of rows) {
    const role = r.lender === me ? 'lender' : r.borrower === me ? 'borrower' : null
    if (!role) continue
    const friendId = role === 'lender' ? r.borrower : r.lender
    const friend = profiles[friendId]
    const link = {
      id: r.id,
      friendId,
      username: friend?.username ?? '',
      role,
      status: r.status,
      createdByMe: r.created_by === me,
    } as const
    const amount = Number(r.amount)
    const existing = byShared.get(r.id)
    if (!existing) {
      // Lo anulado/rechazado o ya pagado antes de verlo no se agrega
      if (CLOSED.includes(r.status) || r.status === 'paid') continue
      plan.add.push({
        direction: role === 'lender' ? 'lent' : 'borrowed',
        person: friend?.display_name ?? 'Amigo',
        amount,
        date: r.loan_date,
        dueDate: r.due_date ?? undefined,
        note: r.description ?? undefined,
        payments: [],
        shared: link,
      })
      continue
    }
    if (CLOSED.includes(r.status) && existing.payments.length === 0) {
      plan.remove.push(existing.id)
      continue
    }
    const s = existing.shared!
    const changed =
      s.status !== r.status ||
      s.username !== link.username ||
      existing.amount !== amount ||
      (existing.dueDate ?? null) !== r.due_date ||
      (friend && existing.person !== friend.display_name)
    if (changed)
      plan.update.push({
        id: existing.id,
        patch: {
          shared: link,
          amount,
          dueDate: r.due_date ?? undefined,
          ...(friend ? { person: friend.display_name } : {}),
        },
      })
    if (r.status === 'paid') {
      const rem = loanRemaining({ ...existing, amount })
      if (rem > 0)
        plan.settle.push({
          id: existing.id,
          amount: rem,
          date: (r.paid_at ?? new Date().toISOString()).slice(0, 10),
          accountId: existing.accountId,
        })
    }
  }
  return plan
}
