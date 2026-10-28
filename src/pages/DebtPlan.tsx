/** Salir de deudas: en qué orden pagar, cuándo terminas y cuánto te ahorras en intereses */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowLeft, Check } from 'lucide-react'
import { Card, Chip, cx, EmptyState, IconButton, Input, PageHeader, Segmented } from '../components/ui'
import { buildDebtPlan, monthLabel, type Debt, type Strategy } from '../lib/debtPlan'
import { usualExpense, usualIncome } from '../lib/future'
import { formatAmountInput } from '../lib/format'
import { useCurrency, useData, useMoney, useToday, vibrate } from '../lib/hooks'
import { useStore } from '../lib/store'
import { MiniAmountInput } from '../features/split/MiniAmountInput'

/** Tasa editable de una deuda (se guarda en la tarjeta o en el préstamo) */
const RateInput = ({ debt }: { debt: Debt }) => {
  const updateAccount = useStore((s) => s.updateAccount)
  const updateLoan = useStore((s) => s.updateLoan)
  const [value, setValue] = useState(debt.rateKnown ? String(debt.rate).replace('.', ',') : '')
  const save = (raw: string) => {
    const n = raw.trim() ? Number(raw.replace(',', '.')) : undefined
    if (n !== undefined && (!Number.isFinite(n) || n < 0 || n > 30)) return
    const interestRate = n === undefined ? undefined : Math.round(n * 100) / 100
    if (debt.kind === 'card') updateAccount(debt.id, { interestRate })
    else updateLoan(debt.id, { interestRate })
  }
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, '').slice(0, 5))}
        onBlur={() => save(value)}
        inputMode="decimal"
        placeholder={debt.kind === 'loan' ? '0' : '¿?'}
        aria-label={`Tasa mensual de ${debt.name}`}
        className="h-9 w-16 px-2 text-center text-sm"
      />
      % al mes
    </label>
  )
}

export default function DebtPlan() {
  const navigate = useNavigate()
  const data = useData()
  const today = useToday()
  const fmt = useMoney()
  const { decimals, locale } = useCurrency()
  const [strategy, setStrategy] = useState<Strategy>('avalanche')
  const surplus = useMemo(() => Math.max(0, usualIncome(data, today) - usualExpense(data, today)), [data, today])
  const presets = useMemo(() => {
    const round = (n: number) => Math.max(5000, Math.round(n / 5000) * 5000)
    const base = surplus > 0 ? [round(surplus * 0.25), round(surplus * 0.5)] : []
    return [...new Set([...base, 20000, 50000, 100000])].sort((a, b) => a - b).slice(0, 4)
  }, [surplus])
  const [extra, setExtra] = useState(() => String(presets[Math.min(1, presets.length - 1)] ?? 50000))
  const extraValue = Number(extra) || 0
  const result = useMemo(
    () => buildDebtPlan(data, today, extraValue, strategy, decimals),
    [data, today, extraValue, strategy, decimals],
  )
  const { debts, plan, baseline } = result
  const total = debts.reduce((s, d) => s + d.balance, 0)
  const missingRate = debts.some((d) => d.kind === 'card' && !d.rateKnown)

  const back = (
    <IconButton label="Volver" onClick={() => navigate(-1)}>
      <ArrowLeft className="size-5" />
    </IconButton>
  )

  if (!debts.length)
    return (
      <div>
        <PageHeader title="Salir de deudas" back={back} />
        <Card>
          <EmptyState
            emoji="🎉"
            title="No tienes deudas"
            text="Tus tarjetas están en cero y no debes préstamos. Si te endeudas, aquí te armo el plan para salir."
          />
        </Card>
      </div>
    )

  return (
    <div>
      <PageHeader title="Salir de deudas" subtitle={`Debes ${fmt(total)} en total`} back={back} />
      <div className="grid grid-cols-1 gap-4 pb-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          {plan.feasible ? (
            <div className="text-center">
              <p className="text-sm font-semibold text-muted">Quedas libre de deudas en</p>
              <p className="text-3xl font-extrabold tracking-tight text-good">{result.freeLabel}</p>
              <p className="mt-1 text-sm text-ink-2">
                {plan.months} {plan.months === 1 ? 'mes' : 'meses'} pagando {fmt(plan.monthly)} al mes
                {plan.totalInterest > 0 ? ` · ${fmt(plan.totalInterest)} en intereses` : ''}
              </p>
              {result.saved > 0 || (result.monthsSaved ?? 0) > 0 ? (
                <p className="mx-auto mt-3 max-w-sm rounded-2xl bg-good-soft px-3 py-2 text-sm font-semibold text-good">
                  Comparado con pagar solo lo mínimo
                  {result.monthsSaved
                    ? `, terminas ${result.monthsSaved} ${result.monthsSaved === 1 ? 'mes' : 'meses'} antes`
                    : ''}
                  {result.saved > 0 ? ` y te ahorras ${fmt(result.saved)} en intereses` : ''} 💪
                </p>
              ) : !baseline.feasible ? (
                <p className="mx-auto mt-3 max-w-sm rounded-2xl bg-good-soft px-3 py-2 text-sm font-semibold text-good">
                  Pagando solo lo mínimo no terminarías nunca: este extra es lo que te saca 💪
                </p>
              ) : null}
            </div>
          ) : (
            <div className="text-center">
              <p className="text-lg font-bold text-bad">Con este monto las deudas no bajan</p>
              <p className="mt-1 text-sm text-muted">Los intereses son más que lo que pagas. Sube el monto extra de abajo.</p>
            </div>
          )}
        </Card>

        <Card>
          <p className="text-sm font-bold">¿Cuánto extra puedes poner al mes?</p>
          <p className="text-xs text-muted">
            Además de las cuotas que ya pagas.
            {surplus > 0 ? ` En un mes normal te sobran unos ${fmt(surplus)}.` : ''}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {presets.map((p) => (
              <Chip
                key={p}
                active={extraValue === p}
                onClick={() => {
                  setExtra(String(p))
                  vibrate(6)
                }}
              >
                {fmt(p)}
              </Chip>
            ))}
            <MiniAmountInput
              value={extra}
              onChange={setExtra}
              label="Monto extra al mes"
              placeholder={formatAmountInput('0', locale, decimals)}
            />
          </div>
          <p className="mt-4 text-sm font-bold">¿Cómo lo hacemos?</p>
          <Segmented
            className="mt-2"
            value={strategy}
            onChange={setStrategy}
            options={[
              { value: 'avalanche', label: 'Avalancha' },
              { value: 'snowball', label: 'Bola de nieve' },
            ]}
          />
          <p className="mt-2 text-xs text-muted">
            {strategy === 'avalanche'
              ? 'Primero la deuda con la tasa más alta: es la que más plata te ahorra.'
              : 'Primero la deuda más chica: terminas una rápido y eso motiva a seguir.'}
          </p>
        </Card>

        <Card>
          <p className="text-sm font-bold">El orden</p>
          <ol className="mt-2 space-y-3">
            {plan.priority.map((id, i) => {
              const d = debts.find((x) => x.id === id)!
              const month = plan.payoffs.find((x) => x.id === id)?.month ?? Infinity
              return (
                <li key={id} className="flex gap-3">
                  <span
                    className={cx(
                      'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                      i === 0 ? 'bg-brand text-brand-ink' : 'bg-surface-2',
                    )}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {d.kind === 'card' ? '💳' : '🤝'} {d.name}
                    </p>
                    <p className="text-xs text-muted">
                      Debes {fmt(d.balance)}
                      {d.minimum > 0 ? ` · pagas ${fmt(d.minimum)}/mes` : ''}
                      {Number.isFinite(month) ? ` · la terminas en ${monthLabel(today, month).toLowerCase()}` : ''}
                    </p>
                    <div className="mt-1">
                      <RateInput debt={d} />
                    </div>
                  </div>
                  {Number.isFinite(month) && <Check className="mt-1 size-4 shrink-0 text-good" aria-hidden />}
                </li>
              )
            })}
          </ol>
          {missingRate && (
            <p className="mt-3 rounded-2xl bg-warn-soft px-3 py-2 text-xs font-medium text-warn">
              Sin la tasa de tu tarjeta calculo sin intereses y el plan sale más corto de lo real. La encuentras en tu estado de
              cuenta como "tasa de interés mensual".
            </p>
          )}
        </Card>
      </div>
    </div>
  )
}
