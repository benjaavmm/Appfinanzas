/** "Tu yo del futuro": lo que ya está comprometido de tus próximos meses */
import { useMemo } from 'react'
import { Link } from 'react-router'
import { ChevronRight } from 'lucide-react'
import { Card, cx, SectionHeader } from '../../components/ui'
import { useCurrency, useData, useMoney, useToday } from '../../lib/hooks'
import { futureCommitments, type FutureMonth } from '../../lib/future'

const PARTS: { key: keyof Pick<FutureMonth, 'cuotas' | 'card' | 'subs' | 'debts'>; label: string; color: string }[] = [
  { key: 'cuotas', label: 'Cuotas', color: 'var(--brand)' },
  { key: 'card', label: 'Tarjeta', color: 'var(--series-current)' },
  { key: 'subs', label: 'Cobros fijos', color: 'var(--warn)' },
  { key: 'debts', label: 'Deudas', color: 'var(--bad)' },
]

const pctText = (share?: number) => (share === undefined ? '' : `${Math.round(share * 100)}%`)

/** `compact`: 3 meses y una línea, para el Inicio */
export const FutureCard = ({ compact = false }: { compact?: boolean }) => {
  const data = useData()
  const today = useToday()
  const fmt = useMoney()
  const { decimals } = useCurrency()
  const f = useMemo(() => futureCommitments(data, today, compact ? 3 : 6, decimals), [data, today, compact, decimals])
  const max = Math.max(...f.months.map((m) => m.total), 1)
  const next = f.months[1]
  const anything = f.months.some((m) => m.total > 0)

  if (compact && !anything) return null

  const headline = !anything
    ? 'No tienes cuotas ni cobros fijos en los próximos meses 🙌'
    : next && next.total > 0
      ? `${next.label} ya tiene ${fmt(next.total)} comprometidos${next.share !== undefined ? ` (${pctText(next.share)} de lo que te entra)` : ''}.`
      : `Este mes tienes ${fmt(f.months[0].total)} comprometidos.`

  return (
    <Card>
      <SectionHeader
        title="Tu yo del futuro"
        subtitle="Lo que ya está comprometido de tus próximos meses"
        to={compact ? '/analisis' : undefined}
        action={compact ? 'Ver' : undefined}
      />
      <p className="text-sm font-semibold text-ink-2">{headline}</p>
      {anything && (
        <>
          <ul className={cx('mt-4 grid gap-2', compact ? 'grid-cols-3' : 'grid-cols-3 sm:grid-cols-6')}>
            {f.months.map((m) => (
              <li key={m.key} className="flex flex-col items-center gap-1">
                <span className="text-[11px] font-bold">{m.total ? fmt(m.total, { compact: true }) : '—'}</span>
                <div className="flex h-24 w-full max-w-12 flex-col-reverse overflow-hidden rounded-xl bg-surface-2">
                  {PARTS.map((p) =>
                    m[p.key] > 0 ? (
                      <div key={p.key} style={{ height: `${(m[p.key] / max) * 100}%`, background: p.color }} title={p.label} />
                    ) : null,
                  )}
                </div>
                <span className="text-xs font-semibold text-muted">{m.short}</span>
                {m.share !== undefined && m.total > 0 && (
                  <span
                    className={cx(
                      'text-[10px] font-bold',
                      m.share >= 0.5 ? 'text-bad' : m.share >= 0.3 ? 'text-warn' : 'text-muted',
                    )}
                  >
                    {pctText(m.share)}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {!compact && (
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
              {PARTS.filter((p) => f.months.some((m) => m[p.key] > 0)).map((p) => (
                <span key={p.key} className="flex items-center gap-1.5 text-xs text-muted">
                  <span className="size-2.5 rounded-full" style={{ background: p.color }} aria-hidden />
                  {p.label}
                </span>
              ))}
              {f.income > 0 && <span className="text-xs text-muted">· % = de lo que te entra en un mes normal</span>}
            </div>
          )}
          {f.freeLabel && (
            <p className="mt-3 rounded-2xl bg-good-soft px-3 py-2 text-xs font-semibold text-good">
              🎉 Si no sumas cuotas nuevas, en {f.freeLabel.toLowerCase()} ya no pagas ninguna.
            </p>
          )}
          {!compact && f.plans.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <p className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Compras en cuotas</p>
              <ul className="divide-y divide-line">
                {f.plans.slice(0, 6).map((p) => (
                  <li key={p.tx.id} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{p.tx.place || p.tx.note || 'Compra'}</p>
                      <p className="truncate text-xs text-muted">
                        {p.accountName} · {p.paid} de {p.of} · termina en {p.lastLabel.toLowerCase()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold">{fmt(p.perInstallment)}/mes</p>
                      <p className="text-xs text-muted">faltan {fmt(p.remaining)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!compact && (
            <Link
              to="/deudas"
              className="mt-3 flex items-center justify-between rounded-2xl bg-surface-2 px-3 py-2.5 text-sm font-semibold"
            >
              <span>🧭 Arma tu plan para salir de deudas</span>
              <ChevronRight className="size-4 text-muted" />
            </Link>
          )}
        </>
      )}
    </Card>
  )
}
