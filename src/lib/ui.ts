import { create } from 'zustand'
import type { ID, LoanDirection, Transaction, TxType } from './types'

export interface Toast {
  id: number
  message: string
  tone?: 'good' | 'bad' | 'info'
  action?: { label: string; onClick: () => void }
}

export interface ConfirmRequest {
  title: string
  message?: string
  confirmLabel?: string
  danger?: boolean
  resolve: (ok: boolean) => void
}

export type SheetState =
  | { kind: 'tx'; id?: ID; type?: TxType; initial?: Partial<Transaction> }
  | { kind: 'loan'; id?: ID; direction?: LoanDirection; person?: string }
  | { kind: 'loanDetail'; id: ID }
  | { kind: 'loanPayment'; id: ID }
  | { kind: 'sub'; id?: ID }
  | { kind: 'goal'; id?: ID }
  | { kind: 'contribution'; id: ID }
  | { kind: 'account'; id?: ID }
  | { kind: 'category'; id?: ID; categoryKind?: 'expense' | 'income' }
  | { kind: 'budget'; id?: ID }
  /** Escanear boleta: con `file` parte procesando esa imagen (p. ej. compartida desde la galería) */
  | { kind: 'scan'; file?: Blob }
  /** Ver la foto de una boleta guardada */
  | { kind: 'receipt'; id: ID }
  /** Importar cartola del banco (CSV / Excel) */
  | { kind: 'import' }
  /** Registro rápido escribiendo o dictando: "5 lucas uber" */
  | { kind: 'quick'; text?: string; voice?: boolean }
  /** Dividir una cuenta entre varias personas */
  | { kind: 'split' }
  /** Detalle de una tarjeta de crédito */
  | { kind: 'card'; id: ID }

interface UIState {
  toasts: Toast[]
  confirm: ConfirmRequest | null
  sheet: SheetState | null
  /** Cambia en cada apertura para reiniciar el formulario */
  sheetKey: number
  toast: (t: Omit<Toast, 'id'>) => void
  dismissToast: (id: number) => void
  ask: (req: Omit<ConfirmRequest, 'resolve'>) => Promise<boolean>
  closeConfirm: (ok: boolean) => void
  open: (s: SheetState) => void
  close: () => void
}

let toastId = 0

export const useUI = create<UIState>()((set, get) => ({
  toasts: [],
  confirm: null,
  sheet: null,
  sheetKey: 0,
  toast: (t) => {
    const id = ++toastId
    set((s) => ({ toasts: [...s.toasts.slice(-2), { ...t, id }] }))
    window.setTimeout(() => get().dismissToast(id), t.action ? 5000 : 2800)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  ask: (req) =>
    new Promise<boolean>((resolve) => {
      set({ confirm: { ...req, resolve } })
    }),
  closeConfirm: (ok) => {
    get().confirm?.resolve(ok)
    set({ confirm: null })
  },
  open: (sheet) => set((s) => ({ sheet, sheetKey: s.sheetKey + 1 })),
  close: () => set({ sheet: null }),
}))

export const toast = (t: Omit<Toast, 'id'>) => useUI.getState().toast(t)
export const ask = (req: Omit<ConfirmRequest, 'resolve'>) => useUI.getState().ask(req)
export const openSheet = (s: SheetState) => useUI.getState().open(s)
export const closeSheet = () => useUI.getState().close()
