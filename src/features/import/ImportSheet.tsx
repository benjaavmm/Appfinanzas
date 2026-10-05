import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowDownUp,
  ArrowLeft,
  CircleAlert,
  CircleCheck,
  Copy,
  FileSpreadsheet,
  LoaderCircle,
  Lock,
  Scale,
  Upload,
} from 'lucide-react'
import { Button, Chip, cx, Field, Segmented, Toggle } from '../../components/ui'
import { AccountChips } from '../../components/ui/pickers'
import { Sheet } from '../../components/ui/Sheet'
import { fmtDateShort } from '../../lib/dates'
import { plural } from '../../lib/format'
import { useBalances, useMoney, vibrate, type MoneyFmt } from '../../lib/hooks'
import { useStore } from '../../lib/store'
import { openSheet, toast } from '../../lib/ui'
import type { Category, ID } from '../../lib/types'
import { applyImport, undoImport } from './apply'
import {
  detectColumns,
  extractRows,
  readStatementFile,
  type ColumnMapping,
  type Sheet as DataSheet,
  type StatementRow,
} from './parse'
import {
  amountMode,
  buildReview,
  columnOptions,
  defaultSelection,
  fileProblem,
  guessHeaderRow,
  importTotals,
  invertTypes,
  mappingProblem,
  switchAmountMode,
  toTransactions,
  type AmountMode,
  type ColumnOption,
  type ReviewItem,
} from './review'

type Step = 'file' | 'setup' | 'review'

interface Loaded {
  fileName: string
  sheets: { name: string; rows: DataSheet }[]
}

const ACCEPT = [
  '.csv',
  '.txt',
  '.xls',
  '.xlsx',
  // Algunos selectores de Android solo filtran bien por tipo
  'text/csv',
  'text/comma-separated-values',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
].join(',')

/** Filas que se dibujan de una vez en la revisión; el resto se agrega al acercarse al final */
const PAGE = 120

const EMPTY_MAPPING: ColumnMapping = { headerRow: -1, date: -1, description: -1 }

const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23858599' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")"

const selectCls =
  'w-full min-w-0 appearance-none truncate rounded-2xl border border-line bg-surface-2 bg-[length:16px] bg-[right_12px_center] bg-no-repeat text-ink outline-none transition focus:border-brand focus:ring-4 focus:ring-brand-soft'

const thisYear = new Date().getFullYear()
const dateLabel = (d: string) => (Number(d.slice(0, 4)) === thisYear ? fmtDateShort(d) : `${fmtDateShort(d)} ${d.slice(0, 4)}`)

const signed = (fmt: MoneyFmt, type: 'expense' | 'income', amount: number) =>
  type === 'expense' ? fmt(-amount, { force: true }) : fmt(amount, { sign: true, force: true })

/** Selector de columna: "-1" = ninguna */
const ColumnSelect = ({
  label,
  value,
  options,
  onChange,
  allowNone,
}: {
  label: string
  value: number | undefined
  options: ColumnOption[]
  onChange: (col: number | undefined) => void
  allowNone?: boolean
}) => (
  <Field label={label}>
    <select
      className={cx(selectCls, 'h-11 pr-9 pl-3.5 text-sm')}
      style={{ backgroundImage: CHEVRON }}
      value={value === undefined || value < 0 ? '-1' : String(value)}
      onChange={(e) => {
        const v = Number(e.target.value)
        onChange(v < 0 ? undefined : v)
      }}
    >
      {(allowNone || value === undefined || value < 0) && (
        <option value="-1">{allowNone ? 'Ninguna' : 'Elige una columna'}</option>
      )}
      {options.map((o) => (
        <option key={o.index} value={o.index}>
          {o.label}
        </option>
      ))}
    </select>
  </Field>
)

/** Título de un grupo de botones (sin <label>, para que tocar el título no elija el primer botón) */
const Group = ({ label, children }: { label: string; children: ReactNode }) => {
  const id = useId()
  return (
    <div role="group" aria-labelledby={id}>
      <span id={id} className="mb-1.5 block text-xs font-semibold tracking-wide text-muted uppercase">
        {label}
      </span>
      {children}
    </div>
  )
}

const Notice = ({ tone, icon, children }: { tone: 'good' | 'bad' | 'warn' | 'info'; icon: ReactNode; children: ReactNode }) => (
  <div
    className={cx(
      'flex items-start gap-2 rounded-2xl px-3.5 py-3 text-sm font-medium',
      tone === 'good' && 'bg-good-soft text-good',
      tone === 'bad' && 'bg-bad-soft text-bad',
      tone === 'warn' && 'bg-warn-soft text-warn',
      tone === 'info' && 'bg-info-soft text-info',
    )}
    role={tone === 'bad' ? 'alert' : undefined}
  >
    <span className="mt-0.5 shrink-0">{icon}</span>
    <span className="min-w-0">{children}</span>
  </div>
)

/* ─────────────────────────── Fila de la revisión ─────────────────────────── */

const ReviewRow = memo(
  ({
    item,
    checked,
    categoryId,
    categories,
    fmt,
    onToggle,
    onCategory,
  }: {
    item: ReviewItem
    checked: boolean
    categoryId?: ID
    categories: Category[]
    fmt: MoneyFmt
    onToggle: (key: number) => void
    onCategory: (key: number, id: ID) => void
  }) => {
    const id = `imp-${item.key}`
    const showGlosa = item.description && item.place && item.description.trim().toLowerCase() !== item.place.toLowerCase()
    return (
      <li
        className="flex gap-3 border-b border-line py-2.5 last:border-b-0"
        style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 88px' }}
      >
        {/* El área táctil de la casilla es más grande que la casilla */}
        <label className="-my-1.5 -ml-1.5 shrink-0 cursor-pointer self-start p-1.5">
          <input
            id={id}
            type="checkbox"
            checked={checked}
            onChange={() => onToggle(item.key)}
            className="mt-0.5 block size-5 accent-[var(--brand)]"
          />
        </label>
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className={cx('block cursor-pointer transition-opacity', !checked && 'opacity-50')}>
            <span className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate font-semibold">{item.place || 'Sin descripción'}</span>
              <span className={cx('shrink-0 font-bold whitespace-nowrap', item.type === 'income' ? 'text-good' : 'text-bad')}>
                {signed(fmt, item.type, item.amount)}
              </span>
            </span>
            <span className="block truncate text-xs text-muted">
              {dateLabel(item.date)}
              {showGlosa ? ` · ${item.description}` : ''}
            </span>
          </label>
          <div className="mt-1.5 flex min-w-0 items-center gap-2">
            <select
              aria-label={`Categoría de ${item.place || 'este movimiento'}`}
              className={cx(
                selectCls,
                'h-8 w-auto max-w-[70%] rounded-xl pr-7 pl-2.5 text-xs font-semibold transition-opacity',
                !checked && 'opacity-50',
              )}
              style={{ backgroundImage: CHEVRON, backgroundPosition: 'right 8px center', backgroundSize: '14px' }}
              value={categoryId ?? ''}
              onChange={(e) => onCategory(item.key, e.target.value)}
            >
              {!categoryId && <option value="">Sin categoría</option>}
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
            </select>
            {item.duplicate && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warn-soft px-2 py-1 text-[11px] font-bold text-warn">
                <Copy className="size-3" /> Ya registrado
              </span>
            )}
          </div>
        </div>
      </li>
    )
  },
)
ReviewRow.displayName = 'ReviewRow'

const scrollParent = (el: HTMLElement | null): HTMLElement | null => {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if (o === 'auto' || o === 'scroll') return p
  }
  return null
}

/* ─────────────────────────────── Hoja ─────────────────────────────── */

export const ImportSheet = ({ open, onClose }: { open: boolean; onClose: () => void; [k: string]: unknown }) => {
  const accounts = useStore((s) => s.accounts)
  const categories = useStore((s) => s.categories)
  const balances = useBalances()
  const fmt = useMoney()

  const activeAccounts = accounts.filter((a) => !a.archived)
  const [step, setStep] = useState<Step>('file')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [sheetIdx, setSheetIdx] = useState(0)
  const [detected, setDetected] = useState<ColumnMapping | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping>(EMPTY_MAPPING)
  const [mode, setModeState] = useState<AmountMode>('single')
  const [invert, setInvert] = useState(false)
  const [accountId, setAccountId] = useState<ID>(() => (activeAccounts.length === 1 ? activeAccounts[0].id : ''))

  const [items, setItems] = useState<ReviewItem[]>([])
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [overrides, setOverrides] = useState<Map<number, ID>>(() => new Map())
  const [hideDups, setHideDups] = useState(false)
  const [keepBalance, setKeepBalance] = useState(true)
  const [limit, setLimit] = useState(PAGE)

  const [accountMissing, setAccountMissing] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const accountRef = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const topRef = useRef<HTMLDivElement>(null)

  // Cada paso parte desde arriba (la hoja reutiliza el mismo contenedor con scroll)
  useEffect(() => {
    const box = scrollParent(topRef.current)
    if (box) box.scrollTop = 0
  }, [step, sheetIdx])

  const rows = loaded?.sheets[sheetIdx]?.rows
  const problem = mappingProblem(mapping, mode)
  const options = useMemo(() => (rows ? columnOptions(rows, mapping.headerRow) : []), [rows, mapping.headerRow])
  const parsed = useMemo<StatementRow[]>(() => {
    if (!rows || problem) return []
    const r = extractRows(rows, mapping)
    return invert ? invertTypes(r) : r
  }, [rows, mapping, problem, invert])
  const parsedTotals = useMemo(() => {
    let expense = 0
    let income = 0
    for (const r of parsed)
      if (r.type === 'expense') expense++
      else income++
    return { expense, income }
  }, [parsed])

  const account = accounts.find((a) => a.id === accountId)

  /* ── Paso 1: archivo ── */

  const chooseSheet = (sheets: Loaded['sheets'], idx: number) => {
    const det = detectColumns(sheets[idx].rows)
    setSheetIdx(idx)
    setDetected(det)
    setMapping(det ?? EMPTY_MAPPING)
    setModeState(det ? amountMode(det) : 'single')
    setInvert(false)
  }

  const onFile = async (file: File) => {
    setError(null)
    const issue = fileProblem(file)
    if (issue) {
      setError(issue)
      return
    }
    setLoading(true)
    try {
      const sheets = await readStatementFile(file)
      if (!sheets.length) {
        setError('El archivo no tiene datos. Revisa que sea la cartola con tus movimientos.')
        return
      }
      // La primera hoja en que se reconocen movimientos (las cartolas a veces traen una hoja de resumen)
      let idx = sheets.findIndex((s) => {
        const m = detectColumns(s.rows)
        return !!m && extractRows(s.rows, m).length > 0
      })
      if (idx < 0) idx = 0
      setLoaded({ fileName: file.name, sheets })
      chooseSheet(sheets, idx)
      setStep('setup')
    } catch (e) {
      setError(
        e instanceof Error && e.message ? e.message : 'No pudimos leer el archivo. Revisa que sea una cartola en Excel o CSV.',
      )
    } finally {
      setLoading(false)
    }
  }

  /* ── Paso 2: columnas ── */

  const setDate = (col: number | undefined) =>
    setMapping((m) => ({
      ...m,
      date: col ?? -1,
      // Sin encabezados reconocidos, los datos parten donde aparece la primera fecha
      headerRow: detected || col === undefined || !rows ? m.headerRow : guessHeaderRow(rows, col),
    }))

  const setMode = (next: AmountMode) => {
    setModeState(next)
    setMapping((m) => switchAmountMode(m, next, detected))
  }

  /* ── Paso 3: revisión ── */

  const goReview = () => {
    if (!parsed.length) return
    if (!accountId) {
      setAccountMissing(true)
      accountRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      vibrate(20)
      return
    }
    const { transactions } = useStore.getState()
    const next = buildReview(parsed, { transactions, categories }, accountId)
    setItems(next)
    setSelected(defaultSelection(next))
    setOverrides(new Map())
    setHideDups(false)
    setLimit(PAGE)
    setStep('review')
  }

  const visible = useMemo(() => (hideDups ? items.filter((it) => !it.duplicate) : items), [items, hideDups])
  const dupCount = useMemo(() => items.filter((it) => it.duplicate).length, [items])
  const totals = useMemo(() => importTotals(items, selected), [items, selected])
  const allVisibleSelected = visible.length > 0 && visible.every((it) => selected.has(it.key))
  const someVisibleSelected = visible.some((it) => selected.has(it.key))

  const expenseCats = useMemo(() => categories.filter((c) => c.kind === 'expense'), [categories])
  const incomeCats = useMemo(() => categories.filter((c) => c.kind === 'income'), [categories])

  const onToggle = useCallback((key: number) => {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  }, [])

  const onCategory = useCallback((key: number, id: ID) => {
    setOverrides((prev) => new Map(prev).set(key, id))
  }, [])

  const toggleAll = () => {
    setSelected((prev) => {
      const n = new Set(prev)
      if (allVisibleSelected) for (const it of visible) n.delete(it.key)
      else for (const it of visible) n.add(it.key)
      return n
    })
    vibrate(6)
  }

  const selectAllRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someVisibleSelected && !allVisibleSelected
  }, [someVisibleSelected, allVisibleSelected, step])

  // Dibuja más filas al acercarse al final de la lista
  useEffect(() => {
    const el = sentinel.current
    if (step !== 'review' || !el || visible.length <= limit || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setLimit((l) => l + PAGE)
      },
      { root: scrollParent(el), rootMargin: '0px 0px 800px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [step, limit, visible.length])

  const doImport = () => {
    if (!account || !totals.count) return
    const txs = toTransactions(items, selected, overrides, account.id)
    const result = applyImport(useStore.getState, txs, account.id, keepBalance)
    vibrate(14)
    toast({
      message: `Importaste ${plural(result.ids.length, 'movimiento', 'movimientos')}`,
      tone: 'good',
      action: {
        label: 'Deshacer',
        onClick: () => {
          undoImport(useStore.getState, result, (ids) =>
            useStore.setState((st) => ({ transactions: st.transactions.filter((t) => !ids.has(t.id)) })),
          )
          toast({ message: 'Importación deshecha', tone: 'info' })
        },
      },
    })
    onClose()
  }

  const balanceNow = account ? (balances.get(account.id) ?? account.initialBalance) : 0

  /* ─────────────────────────────── Vistas ─────────────────────────────── */

  const noAccounts = activeAccounts.length === 0

  const fileStep = (
    <div className="space-y-5 pb-2">
      <div className="flex flex-col items-center pt-2 text-center">
        <span className="flex size-16 items-center justify-center rounded-[22px] bg-brand-soft text-brand">
          <FileSpreadsheet className="size-8" />
        </span>
        <p className="mt-3 text-lg font-bold">Trae tus movimientos del banco</p>
        <p className="mt-1 max-w-sm text-sm text-ink-2">
          Descarga la cartola o los últimos movimientos desde la app o web de tu banco en Excel o CSV, y súbela aquí.
        </p>
      </div>

      <ol className="space-y-2.5 rounded-2xl bg-surface-2 p-4 text-sm">
        {['Elige el archivo de la cartola.', 'Revisa las columnas y la cuenta.', 'Marca qué movimientos importar y listo.'].map(
          (t, i) => (
            <li key={t} className="flex items-center gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface text-xs font-bold text-brand">
                {i + 1}
              </span>
              <span className="text-ink-2">{t}</span>
            </li>
          ),
        )}
      </ol>

      <p className="flex items-start gap-2 text-xs text-muted">
        <Lock className="mt-px size-3.5 shrink-0" />
        Todo se procesa en tu teléfono: el archivo no se sube a ningún lado.
      </p>

      {error && (
        <Notice tone="bad" icon={<CircleAlert className="size-4" />}>
          {error}
        </Notice>
      )}

      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        aria-label="Archivo de la cartola"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void onFile(f)
        }}
      />
      <Button
        block
        size="lg"
        disabled={loading}
        onClick={() => fileRef.current?.click()}
        icon={loading ? <LoaderCircle className="size-5 animate-spin" /> : <Upload className="size-5" />}
      >
        {loading ? 'Leyendo archivo…' : 'Elegir archivo'}
      </Button>
      <p className="-mt-2 text-center text-xs text-muted">Excel (.xls, .xlsx) o CSV</p>
    </div>
  )

  const setupStep = loaded && rows && (
    <div className="space-y-5">
      <p className="truncate text-xs text-muted">
        <FileSpreadsheet className="mr-1 inline size-3.5 align-[-2px]" />
        {loaded.fileName}
      </p>

      {loaded.sheets.length > 1 && (
        <Group label="Hoja del archivo">
          <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5">
            {loaded.sheets.map((s, i) => (
              <Chip key={`${s.name}-${i}`} active={i === sheetIdx} onClick={() => chooseSheet(loaded.sheets, i)}>
                {s.name}
              </Chip>
            ))}
          </div>
        </Group>
      )}

      {detected ? (
        <Notice tone="good" icon={<CircleCheck className="size-4" />}>
          Reconocimos las columnas. Revísalas si algo no calza.
        </Notice>
      ) : (
        <Notice tone="warn" icon={<CircleAlert className="size-4" />}>
          No reconocimos las columnas. Elige cuál es la fecha, la descripción y el monto.
        </Notice>
      )}

      <section className="space-y-3">
        <ColumnSelect label="Fecha" value={mapping.date} options={options} onChange={setDate} />
        <ColumnSelect
          label="Descripción"
          value={mapping.description}
          options={options}
          allowNone
          onChange={(col) => setMapping((m) => ({ ...m, description: col ?? -1 }))}
        />
        <Group label="Montos">
          <Segmented
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'single', label: 'Una columna con signo' },
              { value: 'split', label: 'Cargos y abonos' },
            ]}
          />
        </Group>
        {mode === 'single' ? (
          <ColumnSelect
            label="Monto (negativo = gasto)"
            value={mapping.amount}
            options={options}
            onChange={(col) => setMapping((m) => ({ ...m, amount: col }))}
          />
        ) : (
          <div className="space-y-3">
            <ColumnSelect
              label="Cargos (gastos)"
              value={mapping.debit}
              options={options}
              allowNone
              onChange={(col) => setMapping((m) => ({ ...m, debit: col }))}
            />
            <ColumnSelect
              label="Abonos (ingresos)"
              value={mapping.credit}
              options={options}
              allowNone
              onChange={(col) => setMapping((m) => ({ ...m, credit: col }))}
            />
          </div>
        )}
        <div className="flex items-center gap-3 rounded-2xl bg-surface-2 px-3.5 py-3">
          <ArrowDownUp className="size-4 shrink-0 text-muted" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Invertir gastos e ingresos</p>
            <p className="text-xs text-muted">Útil en cartolas de tarjeta de crédito, donde las compras vienen en positivo.</p>
          </div>
          <Toggle checked={invert} onChange={setInvert} label="Invertir gastos e ingresos" />
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Vista previa</h3>
          {parsed.length > 0 && (
            <span className="text-xs text-muted">
              {plural(parsed.length, 'movimiento', 'movimientos')} · {plural(parsedTotals.expense, 'gasto', 'gastos')} ·{' '}
              {plural(parsedTotals.income, 'ingreso', 'ingresos')}
            </span>
          )}
        </div>
        {problem ? (
          <Notice tone="info" icon={<CircleAlert className="size-4" />}>
            {problem}
          </Notice>
        ) : parsed.length === 0 ? (
          <Notice tone="bad" icon={<CircleAlert className="size-4" />}>
            No encontramos movimientos con fecha y monto en estas columnas. Prueba con otras.
          </Notice>
        ) : (
          <ul className="divide-y divide-line rounded-2xl border border-line px-3.5">
            {parsed.slice(0, 5).map((r) => (
              <li key={r.row} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="w-14 shrink-0 text-xs text-muted">{dateLabel(r.date)}</span>
                <span className="min-w-0 flex-1 truncate">{r.description}</span>
                <span className={cx('shrink-0 font-semibold whitespace-nowrap', r.type === 'income' ? 'text-good' : 'text-bad')}>
                  {signed(fmt, r.type, r.amount)}
                </span>
              </li>
            ))}
            {parsed.length > 5 && <li className="py-2 text-center text-xs text-muted">y {parsed.length - 5} más…</li>}
          </ul>
        )}
      </section>

      <div ref={accountRef} className="scroll-mt-4">
        <Group label="¿De qué cuenta es esta cartola?">
          <AccountChips
            accounts={accounts}
            value={accountId}
            onChange={(id) => {
              setAccountId(id)
              setAccountMissing(false)
            }}
          />
        </Group>
        {!accountId && (
          <p className={cx('mt-1.5 text-xs', accountMissing ? 'font-semibold text-bad' : 'text-muted')}>
            Elige la cuenta para seguir. Así detectamos los movimientos que ya tenías registrados.
          </p>
        )}
      </div>
    </div>
  )

  const reviewStep = account && (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-2xl border border-line px-3.5 py-2.5">
        <span className="text-xl">{account.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{account.name}</p>
          <p className="text-xs text-muted">Saldo actual {fmt(balanceNow, { force: true })}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setStep('setup')}>
          Cambiar
        </Button>
      </div>

      <div className="rounded-2xl bg-surface-2 p-3.5">
        <div className="flex items-center gap-3">
          <Scale className="size-4 shrink-0 text-muted" />
          <p className="min-w-0 flex-1 text-sm font-semibold">Mantener mi saldo actual</p>
          <Toggle checked={keepBalance} onChange={setKeepBalance} label="Mantener mi saldo actual" />
        </div>
        <p className="mt-1.5 text-xs text-muted">
          Si ya ingresaste el saldo de hoy de esta cuenta, importar movimientos pasados lo descuadraría. Con esta opción ajustamos
          el saldo inicial de la cuenta para que el saldo actual no cambie.
        </p>
        {totals.count > 0 && totals.net !== 0 && (
          <p className="mt-2 text-xs font-semibold text-ink-2">
            {keepBalance
              ? `El saldo de ${account.name} seguirá en ${fmt(balanceNow, { force: true })}.`
              : `El saldo de ${account.name} pasará de ${fmt(balanceNow, { force: true })} a ${fmt(balanceNow + totals.net, { force: true })}.`}
          </p>
        )}
      </div>

      {dupCount > 0 && (
        <Notice tone="warn" icon={<Copy className="size-4" />}>
          {dupCount === 1
            ? '1 movimiento ya estaba registrado en esta cuenta (mismo monto y fecha). Quedó sin marcar.'
            : `${dupCount} movimientos ya estaban registrados en esta cuenta (mismo monto y fecha). Quedaron sin marcar.`}
        </Notice>
      )}

      <div>
        <div className="sticky -top-2 z-10 -mx-5 flex items-center gap-2 border-b border-line bg-surface px-5 py-2">
          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-1 text-sm font-semibold">
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleAll}
              disabled={!visible.length}
              className="size-5 shrink-0 accent-[var(--brand)]"
            />
            <span className="truncate">{allVisibleSelected ? 'Desmarcar todo' : 'Marcar todo'}</span>
          </label>
          {dupCount > 0 && (
            <Chip active={hideDups} onClick={() => setHideDups((h) => !h)} className="h-8 px-3 text-xs">
              Ocultar duplicados ({dupCount})
            </Chip>
          )}
        </div>
        {visible.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">No quedan movimientos para mostrar.</p>
        ) : (
          <ul>
            {visible.slice(0, limit).map((it) => (
              <ReviewRow
                key={it.key}
                item={it}
                checked={selected.has(it.key)}
                categoryId={overrides.get(it.key) ?? it.categoryId}
                categories={it.type === 'income' ? incomeCats : expenseCats}
                fmt={fmt}
                onToggle={onToggle}
                onCategory={onCategory}
              />
            ))}
          </ul>
        )}
        {visible.length > limit && (
          <div ref={sentinel} className="pt-3 text-center">
            <Button size="sm" variant="secondary" onClick={() => setLimit((l) => l + PAGE)}>
              Mostrar {Math.min(PAGE, visible.length - limit)} más
            </Button>
          </div>
        )}
      </div>
    </div>
  )

  const back = (to: Step) => (
    <Button
      variant="secondary"
      size="lg"
      aria-label="Atrás"
      onClick={() => setStep(to)}
      icon={<ArrowLeft className="size-5" />}
    />
  )

  let footer: ReactNode = undefined
  if (!noAccounts && step === 'setup')
    footer = (
      <div className="flex gap-2">
        {back('file')}
        <Button block size="lg" disabled={!parsed.length} onClick={goReview}>
          {parsed.length ? `Revisar ${plural(parsed.length, 'movimiento', 'movimientos')}` : 'Revisar movimientos'}
        </Button>
      </div>
    )
  else if (!noAccounts && step === 'review')
    footer = (
      <div className="space-y-2">
        <p className="text-center text-xs text-muted" aria-live="polite">
          <span className="font-semibold text-ink">{plural(totals.count, 'seleccionado', 'seleccionados')}</span> · gastos{' '}
          <span className="font-semibold text-bad">{fmt(totals.expense, { force: true })}</span> · ingresos{' '}
          <span className="font-semibold text-good">{fmt(totals.income, { force: true })}</span>
        </p>
        <div className="flex gap-2">
          {back('setup')}
          <Button block size="lg" disabled={!totals.count} onClick={doImport}>
            {totals.count ? `Importar ${plural(totals.count, 'movimiento', 'movimientos')}` : 'Marca qué importar'}
          </Button>
        </div>
      </div>
    )

  return (
    <Sheet open={open} onClose={onClose} title="Importar cartola" footer={footer}>
      <div ref={topRef} />
      {noAccounts ? (
        <div className="py-6 text-center">
          <p className="font-semibold">Primero crea una cuenta</p>
          <p className="mt-1 text-sm text-muted">Los movimientos de la cartola se guardan en una de tus cuentas.</p>
          <Button className="mt-4" onClick={() => openSheet({ kind: 'account' })}>
            Crear cuenta
          </Button>
        </div>
      ) : step === 'file' ? (
        fileStep
      ) : step === 'setup' ? (
        setupStep
      ) : (
        reviewStep
      )}
    </Sheet>
  )
}
