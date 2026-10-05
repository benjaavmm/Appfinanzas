import { useState } from 'react'
import { useUI, closeSheet, type SheetState } from '../../lib/ui'
import { TransactionForm } from './TransactionForm'
import { LoanDetail, LoanForm, LoanPaymentForm } from './LoanForms'
import { SubscriptionForm } from './SubscriptionForm'
import { AccountForm, BudgetForm, CategoryForm, ContributionForm, GoalForm } from './OtherForms'

/** Renderiza la hoja activa y la mantiene montada durante la animación de cierre */
export const SheetHost = () => {
  const sheet = useUI((s) => s.sheet)
  const key = useUI((s) => s.sheetKey)
  const [last, setLast] = useState<{ sheet: SheetState; key: number } | null>(null)
  if (sheet && last?.key !== key) setLast({ sheet, key })
  const s = sheet ?? last?.sheet
  if (!s) return null
  const open = !!sheet
  const props = { open, onClose: closeSheet }
  switch (s.kind) {
    case 'tx':
      return <TransactionForm key={key} {...props} state={s} />
    case 'loan':
      return <LoanForm key={key} {...props} state={s} />
    case 'loanDetail':
      return <LoanDetail key={key} {...props} id={s.id} />
    case 'loanPayment':
      return <LoanPaymentForm key={key} {...props} id={s.id} />
    case 'sub':
      return <SubscriptionForm key={key} {...props} state={s} />
    case 'goal':
      return <GoalForm key={key} {...props} state={s} />
    case 'contribution':
      return <ContributionForm key={key} {...props} id={s.id} />
    case 'account':
      return <AccountForm key={key} {...props} state={s} />
    case 'category':
      return <CategoryForm key={key} {...props} state={s} />
    case 'budget':
      return <BudgetForm key={key} {...props} state={s} />
  }
}
