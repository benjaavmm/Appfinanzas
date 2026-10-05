import { motion } from 'motion/react'
import { useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { COLORS, EMOJIS } from '../../lib/defaults'
import { fmtMonth } from '../../lib/dates'
import { formatAmountInput, sanitizeAmountInput } from '../../lib/format'
import { useBalances, useCurrency, useMoney } from '../../lib/hooks'
import type { Account, Category } from '../../lib/types'
import { cx, IconButton } from '.'

export const AmountInput = ({
  value,
  onChange,
  tone = 'plain',
  autoFocus,
  label = 'Monto',
}: {
  value: string
  onChange: (v: string) => void
  tone?: 'plain' | 'income' | 'expense'
  autoFocus?: boolean
  label?: string
}) => {
  const { locale, decimals, currency } = useCurrency()
  const symbol =
    new Intl.NumberFormat(locale, { style: 'currency', currency }).formatToParts(0).find((p) => p.type === 'currency')?.value ??
    '$'
  const display = formatAmountInput(value, locale, decimals)
  return (
    <label className="block rounded-3xl bg-surface-2 px-4 py-4 text-center transition focus-within:ring-4 focus-within:ring-brand-soft">
      <span className="block text-xs font-semibold tracking-wide text-muted uppercase">{label}</span>
      <span className="mt-1 flex items-center justify-center gap-1.5 overflow-hidden">
        <span className={cx('text-3xl font-bold', value ? 'text-ink-2' : 'text-muted')}>{symbol}</span>
        {/* El span invisible da el ancho exacto al input para que el número quede centrado junto al símbolo */}
        <span className="relative inline-grid min-w-0 text-[44px] leading-tight font-extrabold tracking-tight">
          <span className="invisible col-start-1 row-start-1 px-0.5 whitespace-pre">{display || '0'}</span>
          <input
            inputMode={decimals ? 'decimal' : 'numeric'}
            autoFocus={autoFocus}
            placeholder="0"
            size={1}
            value={display}
            onChange={(e) => onChange(sanitizeAmountInput(e.target.value, locale, decimals))}
            className={cx(
              'col-start-1 row-start-1 w-full min-w-0 bg-transparent text-center outline-none placeholder:text-muted focus-visible:outline-none',
              tone === 'income' && 'text-good',
              tone === 'expense' && 'text-ink',
            )}
            aria-label={label}
          />
        </span>
      </span>
    </label>
  )
}

export const EmojiPicker = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-12 w-full items-center gap-3 rounded-2xl border border-line bg-surface-2 px-4 text-left"
      >
        <span className="text-2xl">{value}</span>
        <span className="text-sm text-muted">{open ? 'Elegir ícono' : 'Cambiar ícono'}</span>
      </button>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-2 grid grid-cols-8 gap-1 rounded-2xl bg-surface-2 p-2"
        >
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                onChange(e)
                setOpen(false)
              }}
              className={cx(
                'flex aspect-square items-center justify-center rounded-xl text-xl transition hover:bg-surface-3',
                e === value && 'bg-brand-soft ring-2 ring-brand',
              )}
            >
              {e}
            </button>
          ))}
        </motion.div>
      )}
    </div>
  )
}

export const ColorPicker = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <div className="flex flex-wrap gap-2">
    {COLORS.map((c) => (
      <button
        key={c}
        type="button"
        aria-label={`Color ${c}`}
        onClick={() => onChange(c)}
        className={cx(
          'size-9 rounded-full transition active:scale-90',
          c === value && 'ring-2 ring-ink ring-offset-2 ring-offset-surface',
        )}
        style={{ background: c }}
      />
    ))}
  </div>
)

export const CategoryGrid = ({
  categories,
  value,
  onChange,
  onAdd,
}: {
  categories: Category[]
  value?: string
  onChange: (id: string) => void
  onAdd?: () => void
}) => (
  <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
    {categories.map((c) => {
      const active = c.id === value
      return (
        <button
          key={c.id}
          type="button"
          onClick={() => onChange(c.id)}
          className={cx(
            'flex flex-col items-center gap-1 rounded-2xl border px-0.5 py-2.5 transition active:scale-95',
            active ? 'border-transparent' : 'border-line hover:bg-surface-2',
          )}
          style={
            active
              ? { background: `color-mix(in srgb, ${c.color} 18%, transparent)`, boxShadow: `inset 0 0 0 2px ${c.color}` }
              : undefined
          }
        >
          <span className="text-2xl">{c.icon}</span>
          <span className="line-clamp-2 w-full text-center text-[10.5px] leading-tight font-semibold tracking-tight break-words hyphens-auto">
            {c.name}
          </span>
        </button>
      )
    })}
    {onAdd && (
      <button
        type="button"
        onClick={onAdd}
        className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-line px-1 py-2.5 text-muted hover:bg-surface-2"
      >
        <Plus className="size-6" />
        <span className="text-[11px] font-semibold">Nueva</span>
      </button>
    )}
  </div>
)

export const AccountChips = ({
  accounts,
  value,
  onChange,
  exclude,
}: {
  accounts: Account[]
  value?: string
  onChange: (id: string) => void
  exclude?: string
}) => {
  const balances = useBalances()
  const fmt = useMoney()
  return (
    <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
      {accounts
        .filter((a) => !a.archived && a.id !== exclude)
        .map((a) => {
          const active = a.id === value
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onChange(a.id)}
              className={cx(
                'flex shrink-0 items-center gap-2 rounded-2xl border py-2 pr-3.5 pl-2 text-left transition active:scale-95',
                active ? 'border-transparent' : 'border-line',
              )}
              style={
                active
                  ? { background: `color-mix(in srgb, ${a.color} 16%, transparent)`, boxShadow: `inset 0 0 0 2px ${a.color}` }
                  : undefined
              }
            >
              <span className="text-xl">{a.icon}</span>
              <span>
                <span className="block text-sm leading-tight font-semibold">{a.name}</span>
                <span className="block text-[11px] text-muted">{fmt(balances.get(a.id) ?? 0)}</span>
              </span>
            </button>
          )
        })}
    </div>
  )
}

export const MonthSwitcher = ({ month, onChange, right }: { month: Date; onChange: (d: Date) => void; right?: ReactNode }) => {
  const now = new Date()
  const isCurrent = month.getFullYear() === now.getFullYear() && month.getMonth() === now.getMonth()
  const shift = (n: number) => onChange(new Date(month.getFullYear(), month.getMonth() + n, 1))
  return (
    <div className="flex items-center gap-1 rounded-2xl bg-surface-2 p-1">
      <IconButton label="Mes anterior" onClick={() => shift(-1)} className="size-9">
        <ChevronLeft className="size-5" />
      </IconButton>
      <button
        type="button"
        onClick={() => onChange(new Date(now.getFullYear(), now.getMonth(), 1))}
        className="min-w-0 flex-1 truncate text-center text-sm font-bold"
        title="Volver al mes actual"
      >
        {fmtMonth(month)}
        {!isCurrent && <span className="ml-1.5 text-xs font-semibold text-brand">· Hoy</span>}
      </button>
      <IconButton label="Mes siguiente" onClick={() => shift(1)} className="size-9">
        <ChevronRight className="size-5" />
      </IconButton>
      {right}
    </div>
  )
}
