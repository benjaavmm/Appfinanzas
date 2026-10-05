import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react'
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { Link } from 'react-router'
import { ChevronRight, TrendingDown, TrendingUp } from 'lucide-react'
import { useMoney } from '../../lib/hooks'
import type { MoneyOptions } from '../../lib/format'

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ')

/* ───────────── Botones ───────────── */

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft'

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' | 'lg'; icon?: ReactNode; block?: boolean }
>(({ variant = 'primary', size = 'md', icon, block, className, children, ...props }, ref) => (
  <button
    ref={ref}
    className={cx(
      'inline-flex items-center justify-center gap-2 rounded-2xl font-semibold transition active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40',
      size === 'sm' && 'h-9 px-3.5 text-sm',
      size === 'md' && 'h-11 px-4 text-[15px]',
      size === 'lg' && 'h-14 px-6 text-base',
      variant === 'primary' && 'bg-brand text-brand-ink shadow-[0_6px_20px_-6px_var(--brand)] hover:brightness-110',
      variant === 'secondary' && 'bg-surface-2 text-ink hover:bg-surface-3',
      variant === 'soft' && 'bg-brand-soft text-brand hover:brightness-95',
      variant === 'ghost' && 'text-ink-2 hover:bg-surface-2',
      variant === 'danger' && 'bg-bad-soft text-bad hover:brightness-95',
      block && 'w-full',
      className,
    )}
    {...props}
  >
    {icon}
    {children}
  </button>
))
Button.displayName = 'Button'

export const IconButton = ({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) => (
  <button
    aria-label={label}
    title={label}
    className={cx(
      'inline-flex size-10 items-center justify-center rounded-full text-ink-2 transition hover:bg-surface-2 active:scale-95',
      className,
    )}
    {...props}
  >
    {children}
  </button>
)

/* ───────────── Superficies ───────────── */

export const Card = ({ className, children, onClick }: { className?: string; children: ReactNode; onClick?: () => void }) => (
  <div
    onClick={onClick}
    className={cx(
      'rounded-3xl border border-line bg-surface p-4 shadow-card sm:p-5',
      onClick && 'cursor-pointer active:scale-[0.99] transition',
      className,
    )}
  >
    {children}
  </div>
)

export const SectionHeader = ({
  title,
  to,
  action,
  subtitle,
}: {
  title: string
  to?: string
  action?: string
  subtitle?: string
}) => (
  <div className="mb-3 flex items-end justify-between gap-3">
    <div>
      <h2 className="text-[17px] font-bold tracking-tight">{title}</h2>
      {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
    </div>
    {to && (
      <Link to={to} className="flex shrink-0 items-center text-sm font-semibold text-brand">
        {action ?? 'Ver todo'}
        <ChevronRight className="size-4" />
      </Link>
    )}
  </div>
)

export const IconBadge = ({
  icon,
  color,
  size = 'md',
  className,
}: {
  icon: string
  color: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) => (
  <span
    className={cx(
      'inline-flex shrink-0 items-center justify-center',
      size === 'sm' && 'size-8 rounded-xl text-base',
      size === 'md' && 'size-11 rounded-2xl text-xl',
      size === 'lg' && 'size-14 rounded-[20px] text-2xl',
      className,
    )}
    style={{ background: `color-mix(in srgb, ${color} 18%, transparent)` }}
    aria-hidden
  >
    {icon}
  </span>
)

export const EmptyState = ({
  emoji,
  title,
  text,
  action,
}: {
  emoji: string
  title: string
  text?: string
  action?: ReactNode
}) => (
  <div className="flex flex-col items-center px-6 py-10 text-center">
    <motion.div
      initial={{ scale: 0.6 }}
      animate={{ scale: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 18 }}
      className="mb-3 flex size-20 items-center justify-center rounded-full bg-surface-2 text-4xl"
    >
      {emoji}
    </motion.div>
    <p className="font-bold">{title}</p>
    {text && <p className="mt-1 max-w-xs text-sm text-muted">{text}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
)

/* ───────────── Montos ───────────── */

export const Money = ({
  value,
  className,
  tone = 'auto',
  ...opts
}: { value: number; className?: string; tone?: 'auto' | 'income' | 'expense' | 'plain' } & MoneyOptions) => {
  const fmt = useMoney()
  const color = tone === 'income' ? 'text-good' : tone === 'auto' ? (value < 0 ? 'text-bad' : undefined) : undefined
  return <span className={cx('whitespace-nowrap', color, className)}>{fmt(value, opts)}</span>
}

/** Número que "cuenta" hasta su valor cuando cambia */
export const AnimatedMoney = ({ value, className, ...opts }: { value: number; className?: string } & MoneyOptions) => {
  const fmt = useMoney()
  const reduce = useReducedMotion()
  const mv = useMotionValue(value)
  const [shown, setShown] = useState(value)
  const first = useRef(true)
  useEffect(() => {
    if (reduce) {
      setShown(value)
      return
    }
    const from = first.current ? value * 0.85 : mv.get()
    first.current = false
    const ctrl = animate(from, value, {
      duration: 0.9,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        mv.set(v)
        setShown(v)
      },
    })
    return () => ctrl.stop()
  }, [value, reduce, mv])
  return <span className={className}>{fmt(Math.round(shown), opts)}</span>
}

export const DeltaPill = ({
  ratio,
  goodWhenUp = false,
  className,
}: {
  ratio: number
  goodWhenUp?: boolean
  className?: string
}) => {
  if (!isFinite(ratio)) return null
  const up = ratio > 0
  const good = up === goodWhenUp
  const flat = Math.abs(ratio) < 0.005
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold',
        flat ? 'bg-surface-2 text-ink-2' : good ? 'bg-good-soft text-good' : 'bg-bad-soft text-bad',
        className,
      )}
    >
      {!flat && (up ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />)}
      {flat ? '=' : `${up ? '+' : '−'}${Math.round(Math.abs(ratio) * 100)}%`}
    </span>
  )
}

/* ───────────── Progreso ───────────── */

export const meterColor = (ratio: number) => (ratio >= 1 ? 'var(--bad)' : ratio >= 0.8 ? 'var(--warn)' : 'var(--good)')

export const ProgressBar = ({
  ratio,
  color,
  className,
  height = 8,
}: {
  ratio: number
  color?: string
  className?: string
  height?: number
}) => {
  const c = color ?? meterColor(ratio)
  return (
    <div
      className={cx('w-full overflow-hidden rounded-full', className)}
      style={{ height, background: `color-mix(in srgb, ${c} 16%, var(--surface-2))` }}
      role="progressbar"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <motion.div
        className="h-full rounded-full"
        style={{ background: c }}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      />
    </div>
  )
}

export const Ring = ({
  ratio,
  size = 64,
  stroke = 7,
  color = 'var(--brand)',
  children,
}: {
  ratio: number
  size?: number
  stroke?: number
  color?: string
  children?: ReactNode
}) => {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const p = Math.min(1, Math.max(0, ratio))
  return (
    <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          style={{ stroke: `color-mix(in srgb, ${color} 16%, var(--surface-2))` }}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          stroke={color}
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - p) }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  )
}

/* ───────────── Controles ───────────── */

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode }[]
  className?: string
  size?: 'sm' | 'md'
}) {
  const id = useId()
  return (
    <div className={cx('flex rounded-2xl bg-surface-2 p-1', className)} role="tablist">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cx(
              'relative flex-1 rounded-xl font-semibold transition-colors',
              size === 'md' ? 'h-9 text-sm' : 'h-8 text-xs',
              active ? 'text-ink' : 'text-muted hover:text-ink-2',
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-xl bg-surface shadow-card"
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export const Chip = ({
  active,
  onClick,
  children,
  className,
}: {
  active?: boolean
  onClick?: () => void
  children: ReactNode
  className?: string
}) => (
  <button
    type="button"
    onClick={onClick}
    className={cx(
      'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition active:scale-95',
      active ? 'border-transparent bg-ink text-bg' : 'border-line bg-surface text-ink-2 hover:bg-surface-2',
      className,
    )}
  >
    {children}
  </button>
)

export const Toggle = ({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={() => onChange(!checked)}
    className={cx('relative h-7 w-12 shrink-0 rounded-full transition-colors', checked ? 'bg-brand' : 'bg-surface-3')}
  >
    <motion.span
      className="absolute top-1 left-1 size-5 rounded-full bg-white shadow"
      animate={{ x: checked ? 20 : 0 }}
      transition={{ type: 'spring', stiffness: 600, damping: 35 }}
    />
  </button>
)

export const Field = ({
  label,
  children,
  hint,
  className,
}: {
  label: string
  children: ReactNode
  hint?: ReactNode
  className?: string
}) => (
  <label className={cx('block', className)}>
    <span className="mb-1.5 block text-xs font-semibold tracking-wide text-muted uppercase">{label}</span>
    {children}
    {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
  </label>
)

const inputCls =
  'w-full rounded-2xl border border-line bg-surface-2 px-4 text-[15px] text-ink placeholder:text-muted outline-none transition focus:border-brand focus:bg-surface focus:ring-4 focus:ring-brand-soft'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cx(inputCls, 'h-12', className)} {...props} />
))
Input.displayName = 'Input'

export const Textarea = ({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea className={cx(inputCls, 'min-h-20 py-3', className)} {...props} />
)

export const Select = ({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select
    className={cx(inputCls, 'h-12 appearance-none bg-[length:16px] bg-[right_14px_center] bg-no-repeat pr-10', className)}
    style={{
      backgroundImage:
        "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23858599' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
    }}
    {...props}
  >
    {children}
  </select>
)

export const ListRow = ({
  left,
  title,
  subtitle,
  right,
  onClick,
  className,
}: {
  left?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  right?: ReactNode
  onClick?: () => void
  className?: string
}) => {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cx(
        'flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition',
        onClick && 'hover:bg-surface-2 active:scale-[0.99]',
        className,
      )}
    >
      {left}
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{title}</div>
        {subtitle && <div className="truncate text-xs text-muted">{subtitle}</div>}
      </div>
      {right && <div className="shrink-0 text-right">{right}</div>}
    </Comp>
  )
}

export const PageHeader = ({
  title,
  subtitle,
  actions,
  back,
  children,
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  back?: ReactNode
  /** Controles que quedan fijos junto al título (p. ej. selector de mes) */
  children?: ReactNode
}) => (
  <header className="pt-safe sticky top-0 z-20 -mx-4 mb-2 bg-bg px-4 sm:-mx-6 sm:px-6">
    <div className="flex min-h-16 items-center gap-2 py-2">
      {back}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-2xl font-extrabold tracking-tight">{title}</h1>
        {subtitle && <div className="truncate text-sm text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
    {children && <div className="pb-3">{children}</div>}
  </header>
)

export const Stat = ({
  label,
  value,
  tone,
  sub,
}: {
  label: string
  value: ReactNode
  tone?: 'good' | 'bad'
  sub?: ReactNode
}) => (
  <div className="min-w-0 rounded-2xl bg-surface-2 p-3">
    <div className="text-xs font-semibold text-muted">{label}</div>
    <div
      className={cx(
        'mt-0.5 truncate text-[15px] font-bold sm:text-lg',
        tone === 'good' && 'text-good',
        tone === 'bad' && 'text-bad',
      )}
    >
      {value}
    </div>
    {sub && <div className="mt-0.5 truncate text-xs text-muted">{sub}</div>}
  </div>
)
