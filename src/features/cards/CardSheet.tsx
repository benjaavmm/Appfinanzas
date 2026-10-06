import { CalendarClock, CreditCard, Pencil } from 'lucide-react'
import { cardSummary } from '../../lib/credit'
import { fmtDate, fmtInDays, fmtMonth } from '../../lib/dates'
import { currencyDecimals } from '../../lib/format'
import { useBalances, useData, useMoney, useToday } from '../../lib/hooks'
import { openSheet } from '../../lib/ui'
import { Button, cx, ProgressBar, meterColor } from '../../components/ui'
import { Sheet } from '../../components/ui/Sheet'

/** Detalle de una tarjeta de crédito: cupo, estado de cuenta, cuotas y próximos cobros */
export const CardSheet = ({ open, onClose, id }: { open: boolean; onClose: () => void; id: string }) => {
  const { accounts, transactions, settings } = useData()
  const balances = useBalances()
  const fmt = useMoney()
  const today = useToday()
  const card = accounts.find((a) => a.id === id)
  if (!card) return null
  const s = cardSummary(card, transactions, balances.get(card.id) ?? 0, today, currencyDecimals(settings.currency))
  const usedRatio = s.limit ? s.used / s.limit : 0
  const overdue = s.toPay > 0 && s.dueDate < today

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`${card.icon} ${card.name}`}
      footer={
        <div className="flex gap-2">
          <Button
            variant="secondary"
            icon={<Pencil className="size-4" />}
            onClick={() => openSheet({ kind: 'account', id: card.id })}
          >
            Editar
          </Button>
          <Button
            block
            size="lg"
            disabled={s.used <= 0}
            onClick={() =>
              openSheet({
                kind: 'tx',
                type: 'transfer',
                initial: { type: 'transfer', toAccountId: card.id, amount: s.toPay || s.used, note: 'Pago tarjeta de crédito' },
              })
            }
          >
            Pagar tarjeta
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-3xl bg-surface-2 p-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-muted">Cupo disponible</p>
              <p className="text-3xl font-extrabold tracking-tight">{s.available !== undefined ? fmt(s.available) : '—'}</p>
            </div>
            {s.limit !== undefined && <p className="text-right text-xs text-muted">de {fmt(s.limit)}</p>}
          </div>
          {s.limit ? (
            <ProgressBar className="mt-3" ratio={usedRatio} color={meterColor(usedRatio)} height={10} />
          ) : (
            <p className="mt-2 text-xs text-muted">Agrega el cupo total en "Editar" para ver cuánto te queda.</p>
          )}
          <p className="mt-2 text-xs text-muted">Usado (deuda total): {fmt(s.used)}</p>
        </div>

        <div className={cx('rounded-3xl p-4', overdue ? 'bg-bad-soft' : 'bg-brand-soft')}>
          <p className={cx('flex items-center gap-1.5 text-xs font-bold', overdue ? 'text-bad' : 'text-brand')}>
            <CalendarClock className="size-4" /> {overdue ? 'PAGO ATRASADO' : 'PRÓXIMO PAGO'}
          </p>
          <p className="mt-1 text-3xl font-extrabold tracking-tight">{fmt(s.toPay)}</p>
          <p className="text-sm text-ink-2">
            {s.toPay > 0
              ? `Vence el ${fmtDate(s.dueDate)} (${fmtInDays(s.dueDate)}). Págalo en la app de tu banco y regístralo con "Pagar tarjeta".`
              : s.billed > 0
                ? 'Ya pagaste el último estado de cuenta. 🎉'
                : 'No tienes nada facturado por pagar.'}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-2xl bg-surface p-2.5">
              <p className="text-muted">Facturado el {fmtDate(s.lastClosing, 'd MMM')}</p>
              <p className="font-bold">{fmt(s.billed)}</p>
            </div>
            <div className="rounded-2xl bg-surface p-2.5">
              <p className="text-muted">Pagado desde entonces</p>
              <p className="font-bold">{fmt(s.paidSinceClosing)}</p>
            </div>
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-bold">Próximos estados de cuenta</h3>
          <ul className="divide-y divide-line rounded-3xl border border-line bg-surface px-4">
            <li className="flex justify-between py-2.5 text-sm">
              <span>
                {fmtMonth(s.nextClosing)}{' '}
                <span className="text-xs text-muted">· cierra el {fmtDate(s.nextClosing, 'd MMM')}</span>
              </span>
              <span className="font-bold">{fmt(s.unbilled)}</span>
            </li>
            {s.upcoming
              .filter((u) => u.amount > 0)
              .map((u) => (
                <li key={u.closing} className="flex justify-between py-2.5 text-sm">
                  <span>{fmtMonth(u.closing)}</span>
                  <span className="font-semibold text-ink-2">{fmt(u.amount)}</span>
                </li>
              ))}
          </ul>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-bold">Compras en cuotas</h3>
          {s.activePlans.length === 0 ? (
            <p className="text-sm text-muted">
              No tienes compras en cuotas pendientes. Al registrar un gasto con esta tarjeta puedes elegir en cuántas cuotas.
            </p>
          ) : (
            <ul className="space-y-2">
              {s.activePlans.map((p) => (
                <li key={p.tx.id}>
                  <button
                    onClick={() => openSheet({ kind: 'tx', id: p.tx.id })}
                    className="w-full rounded-2xl border border-line bg-surface p-3 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <CreditCard className="size-4 text-muted" />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{p.tx.place || p.tx.note || 'Compra'}</span>
                      <span className="text-sm font-bold">{fmt(p.perInstallment)}/mes</span>
                    </div>
                    <ProgressBar className="mt-2" ratio={p.paid / p.of} color="var(--brand)" height={6} />
                    <p className="mt-1 text-xs text-muted">
                      {p.paid} de {p.of} cuotas facturadas · faltan {fmt(p.remaining)} · total {fmt(p.tx.amount)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Sheet>
  )
}
