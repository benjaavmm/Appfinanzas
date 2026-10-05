import { ArrowLeftRight, ReceiptText } from 'lucide-react'
import { useStore } from '../lib/store'
import { useMoney } from '../lib/hooks'
import { openSheet } from '../lib/ui'
import type { Transaction } from '../lib/types'
import { cx } from './ui'

export const TxItem = ({ tx, showDate }: { tx: Transaction; showDate?: boolean }) => {
  const fmt = useMoney()
  const cat = useStore((s) => s.categories.find((c) => c.id === tx.categoryId))
  const acc = useStore((s) => s.accounts.find((a) => a.id === tx.accountId))
  const to = useStore((s) => (tx.toAccountId ? s.accounts.find((a) => a.id === tx.toAccountId) : undefined))
  const isTransfer = tx.type === 'transfer'
  const title = isTransfer ? `${acc?.name ?? '?'} → ${to?.name ?? '?'}` : tx.place || cat?.name || 'Sin categoría'
  const subtitle = [
    isTransfer ? 'Transferencia' : tx.place ? cat?.name : undefined,
    !isTransfer ? acc?.name : undefined,
    showDate ? tx.date.split('-').reverse().slice(0, 2).join('/') : tx.time,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <button
      type="button"
      onClick={() => openSheet({ kind: 'tx', id: tx.id })}
      className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition hover:bg-surface-2 active:scale-[0.99]"
    >
      {isTransfer ? (
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-ink-2">
          <ArrowLeftRight className="size-5" />
        </span>
      ) : (
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-2xl text-xl"
          style={{ background: `color-mix(in srgb, ${cat?.color ?? '#8a8f98'} 18%, transparent)` }}
        >
          {cat?.icon ?? '❔'}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-semibold">{title}</span>
          {tx.receiptId && (
            <ReceiptText className="size-3.5 shrink-0 text-muted" role="img" aria-label="Con foto de boleta">
              <title>Con foto de boleta</title>
            </ReceiptText>
          )}
        </span>
        <span className="block truncate text-xs text-muted">
          {subtitle}
          {tx.note ? ` · ${tx.note}` : ''}
        </span>
      </span>
      <span
        className={cx(
          'shrink-0 text-right font-bold whitespace-nowrap',
          tx.type === 'income' && 'text-good',
          isTransfer && 'text-ink-2',
        )}
      >
        {tx.type === 'expense' ? fmt(-tx.amount) : tx.type === 'income' ? fmt(tx.amount, { sign: true }) : fmt(tx.amount)}
      </span>
    </button>
  )
}
