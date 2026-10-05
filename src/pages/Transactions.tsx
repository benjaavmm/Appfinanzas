import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Download, Search, X } from 'lucide-react'
import { fmtRelativeDay, monthKey } from '../lib/dates'
import { groupByDay, sumType } from '../lib/finance'
import { normalizeText } from '../lib/format'
import { useData, useMoney } from '../lib/hooks'
import { exportCSV } from '../lib/backup'
import { openSheet } from '../lib/ui'
import type { TxType } from '../lib/types'
import { TxItem } from '../components/TxItem'
import { Button, Chip, EmptyState, IconButton, Input, PageHeader, Select, Stat } from '../components/ui'
import { MonthSwitcher } from '../components/ui/pickers'

export default function Transactions() {
  const data = useData()
  const fmt = useMoney()
  const [params, setParams] = useSearchParams()
  const [month, setMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [type, setType] = useState<'all' | TxType>('all')
  const cat = params.get('cat') ?? ''
  const acc = params.get('acc') ?? ''

  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params)
    if (v) p.set(k, v)
    else p.delete(k)
    setParams(p, { replace: true })
  }

  const filtered = useMemo(() => {
    const q = normalizeText(query)
    const key = monthKey(month)
    const catNames = new Map(data.categories.map((c) => [c.id, normalizeText(c.name)]))
    return data.transactions.filter((t) => {
      if (!q && !t.date.startsWith(key)) return false
      if (type !== 'all' && t.type !== type) return false
      if (cat && t.categoryId !== cat) return false
      if (acc && t.accountId !== acc && t.toAccountId !== acc) return false
      if (q) {
        const hay = `${normalizeText(t.place ?? '')} ${normalizeText(t.note ?? '')} ${catNames.get(t.categoryId ?? '') ?? ''} ${t.amount}`
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [data.transactions, data.categories, month, type, cat, acc, query])

  const groups = useMemo(() => groupByDay(filtered), [filtered])
  const income = sumType(filtered, 'income')
  const expense = sumType(filtered, 'expense')
  const catObj = data.categories.find((c) => c.id === cat)
  const accObj = data.accounts.find((a) => a.id === acc)

  return (
    <div>
      <PageHeader
        title="Movimientos"
        actions={
          <>
            <IconButton label="Buscar" onClick={() => setSearching((s) => !s)}>
              {searching ? <X className="size-5" /> : <Search className="size-5" />}
            </IconButton>
            <IconButton label="Exportar a Excel (CSV)" onClick={() => exportCSV(data)}>
              <Download className="size-5" />
            </IconButton>
          </>
        }
      />

      <div className="space-y-3">
        <AnimatePresence initial={false}>
          {searching && (
            <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar lugar, nota, categoría o monto…"
                type="search"
              />
            </motion.div>
          )}
        </AnimatePresence>

        {query ? (
          <p className="text-sm text-muted">Buscando en todo tu historial</p>
        ) : (
          <MonthSwitcher month={month} onChange={setMonth} />
        )}

        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          {(
            [
              ['all', 'Todos'],
              ['expense', 'Gastos'],
              ['income', 'Ingresos'],
              ['transfer', 'Transferencias'],
            ] as const
          ).map(([v, l]) => (
            <Chip key={v} active={type === v} onClick={() => setType(v)}>
              {l}
            </Chip>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Select
            value={cat}
            onChange={(e) => setParam('cat', e.target.value)}
            aria-label="Filtrar por categoría"
            className="h-10 text-sm"
          >
            <option value="">Categorías</option>
            {data.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </Select>
          <Select
            value={acc}
            onChange={(e) => setParam('acc', e.target.value)}
            aria-label="Filtrar por cuenta"
            className="h-10 text-sm"
          >
            <option value="">Cuentas</option>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.icon} {a.name}
              </option>
            ))}
          </Select>
        </div>

        {(catObj || accObj) && (
          <div className="flex flex-wrap gap-2">
            {catObj && (
              <Chip active onClick={() => setParam('cat', '')}>
                {catObj.icon} {catObj.name} <X className="size-3.5" />
              </Chip>
            )}
            {accObj && (
              <Chip active onClick={() => setParam('acc', '')}>
                {accObj.icon} {accObj.name} <X className="size-3.5" />
              </Chip>
            )}
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          <Stat label="Ingresos" value={fmt(income)} tone={income > 0 ? 'good' : undefined} />
          <Stat label="Gastos" value={fmt(expense)} />
          <Stat
            label="Balance"
            value={fmt(income - expense, { sign: true })}
            tone={income - expense < 0 ? 'bad' : income - expense > 0 ? 'good' : undefined}
          />
        </div>
      </div>

      <div className="mt-5 space-y-4">
        {groups.length === 0 ? (
          <EmptyState
            emoji={query ? '🔍' : '🗓️'}
            title={query ? 'Sin resultados' : 'Nada por aquí'}
            text={query ? 'Prueba con otra palabra.' : 'No hay movimientos con estos filtros en este mes.'}
            action={!query && <Button onClick={() => openSheet({ kind: 'tx' })}>Registrar movimiento</Button>}
          />
        ) : (
          groups.map((g) => (
            <section key={g.date}>
              <div className="sticky top-[calc(env(safe-area-inset-top)+64px)] z-10 -mx-1 mb-1 flex items-baseline justify-between bg-bg px-1 py-1.5">
                <h3 className="text-sm font-bold">{fmtRelativeDay(g.date)}</h3>
                <span className="text-xs font-semibold text-muted">
                  {g.expense > 0 && fmt(-g.expense)}
                  {g.expense > 0 && g.income > 0 && ' · '}
                  {g.income > 0 && <span className="text-good">{fmt(g.income, { sign: true })}</span>}
                </span>
              </div>
              <div className="-mx-2 rounded-3xl border border-line bg-surface p-1 shadow-card">
                {g.items.map((t) => (
                  <TxItem key={t.id} tx={t} showDate={!!query} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  )
}
