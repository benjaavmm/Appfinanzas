import { useState } from 'react'
import { useUI, closeSheet, type SheetState } from '../../lib/ui'
import { TransactionForm } from './TransactionForm'
import { LoanDetail, LoanForm, LoanPaymentForm } from './LoanForms'
import { SubscriptionForm } from './SubscriptionForm'
import { AccountForm, BudgetForm, CategoryForm, ContributionForm, GoalForm } from './OtherForms'
import { ScanReceiptSheet } from '../../features/receipts/ScanReceiptSheet'
import { ReceiptViewer } from '../../features/receipts/ReceiptViewer'
import { ImportSheet } from '../../features/import/ImportSheet'
import { QuickAddSheet } from '../../features/quick/QuickAddSheet'
import { SplitSheet } from '../../features/split/SplitSheet'
import { CardSheet } from '../../features/cards/CardSheet'

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
    case 'scan':
      return <ScanReceiptSheet key={key} {...props} file={s.file} />
    case 'receipt':
      return <ReceiptViewer key={key} {...props} id={s.id} />
    case 'import':
      return <ImportSheet key={key} {...props} />
    case 'quick':
      return <QuickAddSheet key={key} {...props} text={s.text} voice={s.voice} />
    case 'split':
      return <SplitSheet key={key} {...props} />
    case 'card':
      return <CardSheet key={key} {...props} id={s.id} />
  }
}
