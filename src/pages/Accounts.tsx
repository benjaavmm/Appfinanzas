import { ArrowLeftRight, Plus } from 'lucide-react'
import { ACCOUNT_TYPES } from '../lib/defaults'
import { debtTotals } from '../lib/finance'
import { useBalances, useData, useMoney, useToday } from '../lib/hooks'
import { cardSummary } from '../lib/credit'
import { fmtDate } from '../lib/dates'
import { currencyDecimals } from '../lib/format'
import type { Account } from '../lib/types'
import { openSheet } from '../lib/ui'
import { Button, Card, cx, IconBadge, meterColor, PageHeader, ProgressBar, Stat } from '../components/ui'
import { useNavigate } from 'react-router'

const CardMini = ({ account, balance }: { account: Account; balance: number }) => {
  const { transactions, settings } = useData()
  const fmt = useMoney()
  const today = useToday()
  const s = cardSummary(account, transactions, balance, today, currencyDecimals(settings.currency))
  const ratio = s.limit ? s.used / s.limit : 0
  return (
    <div className="mt-3 space-y-1.5">
      {s.limit ? (
        <>
          <ProgressBar ratio={ratio} color={meterColor(ratio)} height={6} />
          <p className="text-xs text-muted">
            Cupo disponible <b className="text-ink">{fmt(s.available ?? 0)}</b> de {fmt(s.limit)}
          </p>
        </>
      ) : null}
      {s.toPay > 0 && (
        <p className={cx('text-xs font-semibold', s.dueDate < today ? 'text-bad' : 'text-brand')}>
          A pagar {fmt(s.toPay)} · vence el {fmtDate(s.dueDate, 'd MMM')}
        </p>
      )}
    </div>
  )
}

export default function Accounts() {
  const { accounts, loans } = useData()
  const balances = useBalances()
  const fmt = useMoney()
  const nav = useNavigate()
  const active = accounts.filter((a) => !a.archived)
  const archived = accounts.filter((a) => a.archived)
  const assets = active.filter((a) => (balances.get(a.id) ?? 0) > 0).reduce((s, a) => s + (balances.get(a.id) ?? 0), 0)
  const liabilities = active.filter((a) => (balances.get(a.id) ?? 0) < 0).reduce((s, a) => s + (balances.get(a.id) ?? 0), 0)
  const { owedToMe, iOwe } = debtTotals(loans)
  const net = assets + liabilities + owedToMe - iOwe

  return (
    <div>
      <PageHeader
        title="Cuentas"
        subtitle="Dónde está tu dinero"
        actions={
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => openSheet({ kind: 'tx', type: 'transfer' })}
              icon={<ArrowLeftRight className="size-4" />}
            >
              Transferir
            </Button>
            <Button size="sm" onClick={() => openSheet({ kind: 'account' })} icon={<Plus className="size-4" />}>
              Nueva
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Tienes" value={fmt(assets)} tone="good" />
        <Stat label="Deudas en tarjetas" value={fmt(liabilities)} tone={liabilities < 0 ? 'bad' : undefined} />
        <Stat label="Préstamos (neto)" value={fmt(owedToMe - iOwe, { sign: true })} />
        <Stat label="Patrimonio neto" value={fmt(net)} sub="todo sumado" />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {active.map((a) => {
          const b = balances.get(a.id) ?? 0
          const type = ACCOUNT_TYPES.find((t) => t.value === a.type)
          return (
            <div key={a.id}>
              <Card
                onClick={() => openSheet(a.type === 'credit' ? { kind: 'card', id: a.id } : { kind: 'account', id: a.id })}
                className="relative overflow-hidden"
              >
                <div className="absolute top-0 right-0 h-full w-1.5" style={{ background: a.color }} />
                <div className="flex items-center gap-3">
                  <IconBadge icon={a.icon} color={a.color} size="lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{a.name}</p>
                    <p className="text-xs text-muted">{type?.label}</p>
                  </div>
                  <p className={cx('text-xl font-extrabold', b < 0 && 'text-bad')}>{fmt(b)}</p>
                </div>
                {a.type === 'credit' && <CardMini account={a} balance={b} />}
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    block
                    onClick={(e) => {
                      e.stopPropagation()
                      nav(`/movimientos?acc=${a.id}`)
                    }}
                  >
                    Ver movimientos
                  </Button>
                </div>
              </Card>
            </div>
          )
        })}
      </div>
      {archived.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-xs font-bold tracking-wide text-muted uppercase">Archivadas</p>
          <div className="flex flex-wrap gap-2">
            {archived.map((a) => (
              <button
                key={a.id}
                onClick={() => openSheet({ kind: 'account', id: a.id })}
                className="rounded-full border border-line px-3 py-1.5 text-sm text-muted"
              >
                {a.icon} {a.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
