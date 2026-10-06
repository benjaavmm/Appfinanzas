import { useMemo, useState } from 'react'
import { Plus, Split } from 'lucide-react'
import { fmtDate, fmtInDays } from '../lib/dates'
import { debtTotals, loanRemaining, loanStatus, peopleSummary } from '../lib/finance'
import { useData, useMoney, useToday } from '../lib/hooks'
import { openSheet } from '../lib/ui'
import type { Loan } from '../lib/types'
import { Avatar } from '../components/forms/LoanForms'
import { Button, Card, cx, EmptyState, PageHeader, ProgressBar, Segmented } from '../components/ui'

const LoanRow = ({ loan, today }: { loan: Loan; today: string }) => {
  const fmt = useMoney()
  const rem = loanRemaining(loan)
  const status = loanStatus(loan, today)
  return (
    <button
      onClick={() => openSheet({ kind: 'loanDetail', id: loan.id })}
      className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition hover:bg-surface-2"
    >
      <span
        className={cx(
          'flex size-9 shrink-0 items-center justify-center rounded-xl text-base',
          loan.direction === 'lent' ? 'bg-good-soft' : 'bg-bad-soft',
        )}
      >
        {loan.direction === 'lent' ? '🤝' : '🙏'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">
          {loan.note || (loan.direction === 'lent' ? 'Le prestaste' : 'Te prestó')}
        </span>
        <span className={cx('block truncate text-xs', status === 'overdue' ? 'font-semibold text-bad' : 'text-muted')}>
          {fmtDate(loan.date, 'd MMM')}
          {status === 'paid'
            ? ' · saldado ✓'
            : loan.dueDate
              ? ` · ${status === 'overdue' ? 'venció' : 'vence'} ${fmtInDays(loan.dueDate)}`
              : ''}
          {loan.shared?.status === 'payment_reported'
            ? loan.direction === 'lent'
              ? ' · dice que te pagó'
              : ' · esperando confirmación'
            : loan.shared
              ? ' · 🔗 en su app'
              : ''}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span
          className={cx(
            'block text-sm font-bold',
            status === 'paid' ? 'text-muted line-through' : loan.direction === 'lent' ? 'text-good' : 'text-bad',
          )}
        >
          {fmt(status === 'paid' ? loan.amount : rem)}
        </span>
        {status !== 'paid' && rem < loan.amount && <span className="block text-[11px] text-muted">de {fmt(loan.amount)}</span>}
      </span>
    </button>
  )
}

export default function Loans() {
  const { loans } = useData()
  const fmt = useMoney()
  const today = useToday()
  const [view, setView] = useState<'people' | 'all'>('people')
  const [showPaid, setShowPaid] = useState(false)
  const { owedToMe, iOwe } = debtTotals(loans)
  const people = useMemo(() => peopleSummary(loans, today), [loans, today])
  const activePeople = people.filter((p) => p.net !== 0 || p.owedToMe || p.iOwe)
  const settledPeople = people.filter((p) => !p.owedToMe && !p.iOwe)
  const sorted = [...loans].sort((a, b) => b.date.localeCompare(a.date))
  const visibleLoans = showPaid ? sorted : sorted.filter((l) => loanRemaining(l) > 0)

  return (
    <div>
      <PageHeader
        title="Préstamos"
        subtitle="Quién te debe y a quién le debes"
        actions={
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => openSheet({ kind: 'split' })}
              icon={<Split className="size-4" />}
            >
              Dividir
            </Button>
            <Button size="sm" onClick={() => openSheet({ kind: 'loan' })} icon={<Plus className="size-4" />}>
              Nuevo
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-3xl bg-good-soft p-4">
          <p className="text-xs font-bold text-good">🤝 TE DEBEN</p>
          <p className="mt-1 truncate text-2xl font-extrabold text-good">{fmt(owedToMe)}</p>
          <button
            onClick={() => openSheet({ kind: 'loan', direction: 'lent' })}
            className="mt-2 text-xs font-semibold text-good underline-offset-2 hover:underline"
          >
            + Le presté a alguien
          </button>
        </div>
        <div className="rounded-3xl bg-bad-soft p-4">
          <p className="text-xs font-bold text-bad">🙏 DEBES</p>
          <p className="mt-1 truncate text-2xl font-extrabold text-bad">{fmt(iOwe)}</p>
          <button
            onClick={() => openSheet({ kind: 'loan', direction: 'borrowed' })}
            className="mt-2 text-xs font-semibold text-bad underline-offset-2 hover:underline"
          >
            + Alguien me prestó
          </button>
        </div>
      </div>

      {loans.length === 0 ? (
        <EmptyState
          emoji="🤝"
          title="Sin préstamos anotados"
          text="¿Le prestaste plata a tu hermano o a un amigo? Anótalo aquí y no se te olvida. También puedes registrar lo que tú debes."
          action={<Button onClick={() => openSheet({ kind: 'loan' })}>Anotar préstamo</Button>}
        />
      ) : (
        <>
          <Segmented
            className="mt-5"
            value={view}
            onChange={setView}
            options={[
              { value: 'people', label: 'Por persona' },
              { value: 'all', label: 'Todos los préstamos' },
            ]}
          />

          {view === 'people' ? (
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              {activePeople.map((p) => {
                const total = p.loans.reduce((s, l) => s + l.amount, 0)
                const pending = p.owedToMe + p.iOwe
                return (
                  <div key={p.key}>
                    <Card>
                      <div className="flex items-center gap-3">
                        <Avatar name={p.name} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-bold">{p.name}</p>
                          <p className={cx('text-xs', p.hasOverdue ? 'font-semibold text-bad' : 'text-muted')}>
                            {p.net > 0 ? 'Te debe' : p.net < 0 ? 'Le debes' : 'Están a mano'}
                            {p.hasOverdue && ' · tiene pagos atrasados'}
                          </p>
                        </div>
                        <p
                          className={cx(
                            'text-xl font-extrabold',
                            p.net > 0 ? 'text-good' : p.net < 0 ? 'text-bad' : 'text-muted',
                          )}
                        >
                          {fmt(Math.abs(p.net))}
                        </p>
                      </div>
                      {total > 0 && <ProgressBar className="mt-3" ratio={1 - pending / total} color="var(--good)" height={6} />}
                      <div className="-mx-2 mt-2">
                        {p.loans
                          .filter((l) => loanRemaining(l) > 0)
                          .sort((a, b) => b.date.localeCompare(a.date))
                          .map((l) => (
                            <LoanRow key={l.id} loan={l} today={today} />
                          ))}
                      </div>
                      <div className="mt-2 flex gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          block
                          onClick={() => openSheet({ kind: 'loan', direction: 'lent', person: p.name })}
                        >
                          + Prestarle
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          block
                          onClick={() => openSheet({ kind: 'loan', direction: 'borrowed', person: p.name })}
                        >
                          + Me prestó
                        </Button>
                      </div>
                    </Card>
                  </div>
                )
              })}
              {settledPeople.length > 0 && (
                <Card className="md:col-span-2">
                  <p className="mb-2 text-sm font-bold">A mano ✓</p>
                  <div className="flex flex-wrap gap-3">
                    {settledPeople.map((p) => (
                      <span
                        key={p.key}
                        className="flex items-center gap-2 rounded-full bg-surface-2 py-1 pr-3 pl-1 text-sm font-semibold"
                      >
                        <Avatar name={p.name} size={28} /> {p.name}
                      </span>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          ) : (
            <Card className="mt-4">
              <div className="-mx-2">
                {visibleLoans.map((l) => (
                  <div key={l.id} className="flex items-center">
                    <div className="w-full">
                      <p className="px-2 pt-1 text-[11px] font-bold text-muted uppercase">{l.person}</p>
                      <LoanRow loan={l} today={today} />
                    </div>
                  </div>
                ))}
                {visibleLoans.length === 0 && <p className="p-3 text-sm text-muted">No hay préstamos pendientes. 🙌</p>}
              </div>
              <button className="mt-2 text-sm font-semibold text-brand" onClick={() => setShowPaid((s) => !s)}>
                {showPaid ? 'Ocultar saldados' : 'Mostrar también los saldados'}
              </button>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
