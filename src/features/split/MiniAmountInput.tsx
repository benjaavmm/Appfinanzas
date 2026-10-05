import { cx } from '../../components/ui'
import { formatAmountInput, sanitizeAmountInput } from '../../lib/format'
import { useCurrency } from '../../lib/hooks'

/** Monto compacto para una fila (p. ej. la parte de cada persona). `value` es el valor canónico: "1234.5" */
export const MiniAmountInput = ({
  value,
  onChange,
  placeholder,
  label,
  invalid,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  label: string
  invalid?: boolean
}) => {
  const { locale, decimals, currency } = useCurrency()
  const symbol =
    new Intl.NumberFormat(locale, { style: 'currency', currency }).formatToParts(0).find((p) => p.type === 'currency')?.value ??
    '$'
  return (
    <label
      className={cx(
        'flex h-11 w-34 shrink-0 items-center gap-1 rounded-xl border bg-surface px-3 transition focus-within:border-brand focus-within:ring-4 focus-within:ring-brand-soft',
        invalid ? 'border-bad' : 'border-line',
      )}
    >
      <span className="text-sm font-semibold text-muted">{symbol}</span>
      <input
        inputMode={decimals ? 'decimal' : 'numeric'}
        enterKeyHint="next"
        value={formatAmountInput(value, locale, decimals)}
        onChange={(e) => onChange(sanitizeAmountInput(e.target.value, locale, decimals))}
        placeholder={placeholder}
        aria-label={label}
        className="w-full min-w-0 bg-transparent text-right text-[15px] font-semibold text-ink placeholder:font-normal placeholder:text-muted"
        // El anillo de foco lo dibuja el contenedor; el :focus-visible global (sin capa) le gana a las clases de Tailwind
        style={{ outline: 'none' }}
      />
    </label>
  )
}
