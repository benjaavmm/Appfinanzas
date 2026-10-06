import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { ArrowDown, Camera, Sparkles, Trash } from 'lucide-react'
import { addDaysStr, todayStr } from '../../lib/dates'
import { COLORS } from '../../lib/defaults'
import { installmentAmounts } from '../../lib/credit'
import { byCategory, inMonth } from '../../lib/finance'
import { currencyDecimals, normalizeText } from '../../lib/format'
import { useMoney, vibrate } from '../../lib/hooks'
import { learnPlace, placeSuggestions, quickPicks } from '../../lib/insights'
import { useStore } from '../../lib/store'
import { ask, openSheet, toast } from '../../lib/ui'
import type { SheetState } from '../../lib/ui'
import type { Transaction, TxType } from '../../lib/types'
import { Button, Chip, cx, Field, Input, Segmented, Textarea } from '../ui'
import { AccountChips, AmountInput, CategoryGrid, EmojiPicker } from '../ui/pickers'
import { Sheet } from '../ui/Sheet'
import { ReceiptAttachment } from '../../features/receipts/ReceiptAttachment'

type Props = { open: boolean; onClose: () => void; state: Extract<SheetState, { kind: 'tx' }> }

const TYPE_LABEL: Record<TxType, string> = { expense: 'Gasto', income: 'Ingreso', transfer: 'Transferencia' }

export const TransactionForm = ({ open, onClose, state }: Props) => {
  const store = useStore()
  const fmt = useMoney()
  const existing = state.id ? store.transactions.find((t) => t.id === state.id) : undefined
  const init: Partial<Transaction> = existing ?? state.initial ?? {}

  const [type, setType] = useState<TxType>(init.type ?? state.type ?? 'expense')
  const [amount, setAmount] = useState(init.amount ? String(init.amount) : '')
  const [categoryId, setCategoryId] = useState<string | undefined>(init.categoryId)
  const [accountId, setAccountId] = useState<string>(
    init.accountId ?? store.settings.defaultAccountId ?? store.accounts.find((a) => !a.archived)?.id ?? '',
  )
  const [toAccountId, setToAccountId] = useState<string | undefined>(init.toAccountId)
  const [date, setDate] = useState(init.date ?? todayStr())
  const [time, setTime] = useState(init.time ?? '')
  const [place, setPlace] = useState(init.place ?? '')
  const [note, setNote] = useState(init.note ?? '')
  const [installments, setInstallments] = useState(init.installments && init.installments > 1 ? init.installments : 1)
  const [placeFocus, setPlaceFocus] = useState(false)
  const [touchedCategory, setTouchedCategory] = useState(!!init.categoryId)
  const [learned, setLearned] = useState<string | null>(null)
  const [creatingCat, setCreatingCat] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [newCatIcon, setNewCatIcon] = useState('🏷️')
  // Foto de la boleta: la del movimiento, la que viene del escaneo, o la que se adjunte aquí
  const [receiptId, setReceiptId] = useState<string | undefined>(existing?.receiptId ?? state.initial?.receiptId)

  const cats = store.categories.filter((c) => c.kind === (type === 'income' ? 'income' : 'expense'))
  const picks = useMemo(
    () => (existing || type !== 'expense' ? [] : quickPicks(store.transactions, todayStr(), 6)),
    [store.transactions, existing, type],
  )
  const suggestions = useMemo(
    () =>
      placeFocus
        ? placeSuggestions(
            store.transactions.filter((t) => t.type === type),
            place,
            5,
          )
        : [],
    [placeFocus, place, store.transactions, type],
  )

  const applyLearning = (p: string) => {
    if (type === 'transfer') return
    const s = learnPlace(store.transactions, p)
    if (!s) return
    const cat = store.categories.find((c) => c.id === s.categoryId)
    if (!touchedCategory && cat && cat.kind === type) setCategoryId(cat.id)
    if (!existing && s.accountId && store.accounts.some((a) => a.id === s.accountId && !a.archived)) setAccountId(s.accountId)
    if (!amount && s.amount) setAmount(String(s.amount))
    if (cat)
      setLearned(
        `Sueles registrar ${s.place} en ${cat.icon} ${cat.name}${s.amount ? ` · normalmente ${fmt(s.amount, { force: true })}` : ''}`,
      )
  }

  const value = Number(amount) || 0
  const canSave = value > 0 && !!accountId && (type !== 'transfer' || (!!toAccountId && toAccountId !== accountId))

  const isCreditPurchase = type === 'expense' && store.accounts.find((a) => a.id === accountId)?.type === 'credit'

  const save = () => {
    if (!canSave) return
    const fallbackCat = store.categories.find((c) => c.id === (type === 'income' ? 'i-otros' : 'c-otros'))?.id
    const data: Omit<Transaction, 'id' | 'createdAt'> = {
      type,
      amount: value,
      accountId,
      toAccountId: type === 'transfer' ? toAccountId : undefined,
      categoryId: type === 'transfer' ? undefined : (categoryId ?? fallbackCat),
      date,
      time: time || undefined,
      place: place.trim() || undefined,
      note: note.trim() || undefined,
      subscriptionId: existing?.subscriptionId,
      receiptId,
      installments: isCreditPurchase && installments > 1 ? installments : undefined,
    }
    vibrate(12)
    if (existing) {
      store.updateTransaction(existing.id, data)
      toast({ message: 'Movimiento actualizado' })
    } else {
      store.addTransaction(data)
      // Aviso inmediato si con este gasto se acerca o pasa el presupuesto
      const cat = store.categories.find((c) => c.id === data.categoryId)
      if (type === 'expense' && cat?.budget) {
        const spent =
          (byCategory(inMonth(store.transactions, date.slice(0, 7)), store.categories).find((c) => c.category.id === cat.id)
            ?.total ?? 0) + value
        const r = spent / cat.budget
        if (r >= 1)
          toast({
            message: `${cat.icon} Pasaste el presupuesto de ${cat.name} (${fmt(spent)} de ${fmt(cat.budget)})`,
            tone: 'bad',
          })
        else if (r >= 0.8)
          toast({ message: `${cat.icon} Llevas el ${Math.round(r * 100)}% del presupuesto de ${cat.name}`, tone: 'info' })
        else toast({ message: `${TYPE_LABEL[type]} registrado` })
      } else toast({ message: `${TYPE_LABEL[type]} registrado` })
    }
    onClose()
  }

  const remove = async () => {
    if (!existing) return
    const ok = await ask({ title: '¿Eliminar este movimiento?', confirmLabel: 'Eliminar', danger: true })
    if (!ok) return
    const removed = store.deleteTransaction(existing.id)
    onClose()
    if (removed)
      toast({
        message: 'Movimiento eliminado',
        action: { label: 'Deshacer', onClick: () => useStore.getState().restoreTransaction(removed) },
      })
  }

  const noAccounts = store.accounts.filter((a) => !a.archived).length === 0

  const scanInstead = async () => {
    // Escanear abre otra hoja: si ya escribiste algo, se confirma antes de descartarlo
    const typed = !!(amount || place.trim() || note.trim())
    if (typed) {
      const ok = await ask({
        title: '¿Escanear una boleta?',
        message: 'Se descartará lo que escribiste en este gasto.',
        confirmLabel: 'Escanear',
      })
      if (!ok) return
    }
    openSheet({ kind: 'scan' })
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={existing ? `Editar ${TYPE_LABEL[type].toLowerCase()}` : 'Nuevo movimiento'}
      footer={
        <div className="flex gap-2">
          {existing && <Button variant="danger" onClick={remove} aria-label="Eliminar" icon={<Trash className="size-5" />} />}
          <Button block size="lg" onClick={save} disabled={!canSave}>
            {existing ? 'Guardar cambios' : `Guardar ${TYPE_LABEL[type].toLowerCase()}`}
          </Button>
        </div>
      }
    >
      {noAccounts ? (
        <div className="py-6 text-center">
          <p className="font-semibold">Primero crea una cuenta</p>
          <p className="mt-1 text-sm text-muted">Por ejemplo "Efectivo" o "Cuenta RUT".</p>
          <Button className="mt-4" onClick={() => openSheet({ kind: 'account' })}>
            Crear cuenta
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          <Segmented
            value={type}
            onChange={(t) => {
              setType(t)
              setCategoryId(undefined)
              setTouchedCategory(false)
              setLearned(null)
            }}
            options={[
              { value: 'expense', label: 'Gasto' },
              { value: 'income', label: 'Ingreso' },
              { value: 'transfer', label: 'Transferir' },
            ]}
          />

          {!existing && type === 'expense' && !receiptId && (
            <button
              type="button"
              onClick={() => void scanInstead()}
              className="mx-auto -mt-2 mb-3 flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-brand transition hover:bg-brand-soft active:scale-95"
            >
              <Camera className="size-4" /> Escanear boleta
            </button>
          )}

          <AmountInput
            value={amount}
            onChange={setAmount}
            autoFocus={!existing && !state.initial?.amount}
            tone={type === 'income' ? 'income' : 'plain'}
          />

          {picks.length > 0 && !amount && (
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
                <Sparkles className="size-3.5 text-brand" /> Tus gastos frecuentes
              </div>
              <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5">
                {picks.map((p) => {
                  const c = store.categories.find((x) => x.id === p.categoryId)
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => {
                        setAmount(String(p.amount))
                        setPlace(p.place ?? '')
                        if (p.categoryId) {
                          setCategoryId(p.categoryId)
                          setTouchedCategory(true)
                        }
                        if (p.accountId && store.accounts.some((a) => a.id === p.accountId && !a.archived))
                          setAccountId(p.accountId)
                        vibrate(8)
                      }}
                      className="flex shrink-0 items-center gap-2 rounded-2xl border border-line bg-surface py-2 pr-3 pl-2 text-left transition hover:bg-surface-2 active:scale-95"
                    >
                      <span className="text-lg">{c?.icon ?? '💸'}</span>
                      <span>
                        <span className="block max-w-28 truncate text-sm leading-tight font-semibold">{p.place ?? c?.name}</span>
                        <span className="block text-[11px] text-muted">{fmt(p.amount, { force: true })}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {type === 'transfer' ? (
            <div className="space-y-3">
              <Field label="Desde">
                <AccountChips accounts={store.accounts} value={accountId} onChange={setAccountId} />
              </Field>
              <div className="flex justify-center text-muted">
                <ArrowDown className="size-5" />
              </div>
              <Field label="Hacia">
                <AccountChips accounts={store.accounts} value={toAccountId} onChange={setToAccountId} exclude={accountId} />
              </Field>
            </div>
          ) : (
            <>
              <div className="relative">
                <Field label={type === 'income' ? '¿De dónde viene?' : '¿Dónde?'}>
                  <Input
                    value={place}
                    placeholder={type === 'income' ? 'Ej: Empresa, cliente, venta…' : 'Ej: Líder, Uber, almuerzo…'}
                    onChange={(e) => {
                      setPlace(e.target.value)
                      setLearned(null)
                    }}
                    onFocus={() => setPlaceFocus(true)}
                    onBlur={() => {
                      window.setTimeout(() => setPlaceFocus(false), 150)
                      if (place.trim()) applyLearning(place)
                    }}
                    autoComplete="off"
                    enterKeyHint="next"
                  />
                </Field>
                {suggestions.length > 0 && (
                  <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto">
                    {suggestions.map((s) => (
                      <Chip
                        key={s}
                        onClick={() => {
                          setPlace(s)
                          applyLearning(s)
                          setPlaceFocus(false)
                        }}
                      >
                        {s}
                      </Chip>
                    ))}
                  </div>
                )}
                <AnimatePresence>
                  {learned && normalizeText(place) && (
                    <motion.p
                      initial={{ height: 0 }}
                      animate={{ height: 'auto' }}
                      exit={{ height: 0 }}
                      className="mt-2 flex items-start gap-1.5 text-xs font-medium text-brand"
                    >
                      <Sparkles className="mt-px size-3.5 shrink-0" /> {learned}
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>

              <Field label="Categoría">
                <CategoryGrid
                  categories={cats}
                  value={categoryId}
                  onChange={(id) => {
                    setCategoryId(id)
                    setTouchedCategory(true)
                    vibrate(6)
                  }}
                  onAdd={() => setCreatingCat(true)}
                />
                <AnimatePresence>
                  {creatingCat && (
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: 'auto' }}
                      exit={{ height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-3 space-y-2 rounded-2xl bg-surface-2 p-3">
                        <EmojiPicker value={newCatIcon} onChange={setNewCatIcon} />
                        <div className="flex gap-2">
                          <Input
                            value={newCatName}
                            onChange={(e) => setNewCatName(e.target.value)}
                            placeholder="Nombre de la categoría"
                            className="bg-surface"
                          />
                          <Button
                            disabled={!newCatName.trim()}
                            onClick={() => {
                              const c = store.addCategory({
                                name: newCatName.trim(),
                                icon: newCatIcon,
                                color: COLORS[store.categories.length % COLORS.length],
                                kind: type === 'income' ? 'income' : 'expense',
                              })
                              setCategoryId(c.id)
                              setTouchedCategory(true)
                              setCreatingCat(false)
                              setNewCatName('')
                            }}
                          >
                            Crear
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Field>

              <Field label={type === 'income' ? 'Entra a' : 'Pagaste con'}>
                <AccountChips accounts={store.accounts} value={accountId} onChange={setAccountId} />
              </Field>

              {isCreditPurchase && (
                <Field
                  label="Cuotas"
                  hint={
                    installments > 1 && value > 0
                      ? `${installments} cuotas de ${fmt(installmentAmounts(value, installments, currencyDecimals(store.settings.currency))[0], { force: true })} · se cobran en tus próximos ${installments} estados de cuenta`
                      : 'Sin cuotas: se cobra completo en el próximo estado de cuenta'
                  }
                >
                  <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5">
                    {[1, 2, 3, 6, 10, 12, 18, 24, 36].map((n) => (
                      <Chip key={n} active={installments === n} onClick={() => setInstallments(n)}>
                        {n === 1 ? 'Sin cuotas' : `${n} cuotas`}
                      </Chip>
                    ))}
                  </div>
                </Field>
              )}
            </>
          )}

          <div>
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <Field label="Fecha">
                <Input
                  type="date"
                  value={date}
                  max={addDaysStr(todayStr(), 366)}
                  onChange={(e) => setDate(e.target.value || todayStr())}
                />
              </Field>
              <Field label="Hora">
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-32" />
              </Field>
            </div>
            <div className="mt-2 flex gap-2">
              {[
                ['Hoy', todayStr()],
                ['Ayer', addDaysStr(todayStr(), -1)],
                ['Anteayer', addDaysStr(todayStr(), -2)],
              ].map(([label, d]) => (
                <Chip key={label} active={date === d} onClick={() => setDate(d)}>
                  {label}
                </Chip>
              ))}
            </div>
          </div>

          <Field label="Nota (opcional)">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Algo que quieras recordar…" rows={2} />
          </Field>

          <ReceiptAttachment receiptId={receiptId} onChange={setReceiptId} canAttach={type === 'expense'} />

          {existing?.subscriptionId && (
            <p className={cx('rounded-2xl bg-info-soft px-4 py-3 text-xs font-medium text-info')}>
              Este movimiento viene de una suscripción.
            </p>
          )}
        </div>
      )}
    </Sheet>
  )
}
