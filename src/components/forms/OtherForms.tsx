import { useMemo, useState } from 'react'
import { Trash } from 'lucide-react'
import { ACCOUNT_TYPES, COLORS } from '../../lib/defaults'
import { monthKey, todayStr } from '../../lib/dates'
import { goalSaved, inMonth, sumType } from '../../lib/finance'
import { useBalances, useMoney, vibrate } from '../../lib/hooks'
import { useStore } from '../../lib/store'
import { ask, toast, type SheetState } from '../../lib/ui'
import type { AccountType, CategoryKind } from '../../lib/types'
import { Button, Chip, Field, Input, Segmented, Select } from '../ui'
import { AmountInput, ColorPicker, EmojiPicker } from '../ui/pickers'
import { Sheet } from '../ui/Sheet'

type Base = { open: boolean; onClose: () => void }

/* ───────────── Cuenta ───────────── */

export const AccountForm = ({ open, onClose, state }: Base & { state: Extract<SheetState, { kind: 'account' }> }) => {
  const store = useStore()
  const balances = useBalances()
  const fmt = useMoney()
  const existing = state.id ? store.accounts.find((a) => a.id === state.id) : undefined
  const [name, setName] = useState(existing?.name ?? '')
  const [type, setType] = useState<AccountType>(existing?.type ?? 'debit')
  const [icon, setIcon] = useState(existing?.icon ?? '💳')
  const [color, setColor] = useState(existing?.color ?? COLORS[store.accounts.length % COLORS.length])
  const currentBalance = existing ? (balances.get(existing.id) ?? 0) : 0
  // Al editar se muestra el saldo ACTUAL; al guardar se ajusta el saldo inicial para que cuadre
  const [balance, setBalance] = useState(existing ? String(Math.abs(currentBalance)) : '')
  const [negative, setNegative] = useState(existing ? currentBalance < 0 : false)
  const isCredit = type === 'credit'
  const [limit, setLimit] = useState(existing?.creditLimit ? String(existing.creditLimit) : '')
  const [statementDay, setStatementDay] = useState(existing?.statementDay ? String(existing.statementDay) : '')
  const [paymentDay, setPaymentDay] = useState(existing?.paymentDay ? String(existing.paymentDay) : '')

  const save = () => {
    const credit = isCredit
      ? {
          creditLimit: Number(limit) > 0 ? Number(limit) : undefined,
          statementDay: statementDay ? Number(statementDay) : undefined,
          paymentDay: paymentDay ? Number(paymentDay) : undefined,
        }
      : { creditLimit: undefined, statementDay: undefined, paymentDay: undefined }
    // En tarjetas de crédito el monto ingresado es deuda: saldo negativo
    const signed = (Number(balance) || 0) * (isCredit || negative ? -1 : 1)
    vibrate(12)
    if (existing) {
      store.updateAccount(existing.id, {
        name: name.trim(),
        type,
        icon,
        color,
        initialBalance: existing.initialBalance + (signed - currentBalance),
        ...credit,
      })
      toast({ message: 'Cuenta actualizada' })
    } else {
      store.addAccount({ name: name.trim(), type, icon, color, initialBalance: signed, ...credit })
      toast({ message: `${icon} ${name.trim()} creada` })
    }
    onClose()
  }

  const remove = async () => {
    if (!existing) return
    const used = store.transactions.filter((t) => t.accountId === existing.id || t.toAccountId === existing.id).length
    if (used > 0) {
      const archive = await ask({
        title: `¿Archivar ${existing.name}?`,
        message: `Tiene ${used} movimientos. Al archivarla se oculta pero conservas tu historial. (Para borrarla con todo, primero elimina sus movimientos.)`,
        confirmLabel: 'Archivar',
      })
      if (archive) {
        store.updateAccount(existing.id, { archived: true })
        onClose()
        toast({ message: 'Cuenta archivada' })
      }
      return
    }
    if (!(await ask({ title: `¿Eliminar ${existing.name}?`, confirmLabel: 'Eliminar', danger: true }))) return
    store.deleteAccount(existing.id)
    onClose()
    toast({ message: 'Cuenta eliminada' })
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={existing ? 'Editar cuenta' : 'Nueva cuenta'}
      footer={
        <div className="flex gap-2">
          {existing && <Button variant="danger" onClick={remove} aria-label="Eliminar" icon={<Trash className="size-5" />} />}
          {existing?.archived && (
            <Button
              variant="secondary"
              onClick={() => {
                store.updateAccount(existing.id, { archived: false })
                onClose()
              }}
            >
              Desarchivar
            </Button>
          )}
          <Button block size="lg" disabled={!name.trim()} onClick={save}>
            {existing ? 'Guardar' : 'Crear cuenta'}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <Field label="Tipo">
          <div className="grid grid-cols-3 gap-2">
            {ACCOUNT_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => {
                  setType(t.value)
                  if (!existing) setIcon(t.icon)
                  if (!name.trim() || ACCOUNT_TYPES.some((x) => x.label === name)) setName(t.label)
                }}
                className="flex flex-col items-center gap-1 rounded-2xl border px-1 py-2.5 text-center transition active:scale-95"
                style={
                  type === t.value
                    ? { boxShadow: 'inset 0 0 0 2px var(--brand)', background: 'var(--brand-soft)', borderColor: 'transparent' }
                    : { borderColor: 'var(--line)' }
                }
              >
                <span className="text-xl">{t.icon}</span>
                <span className="text-[11px] leading-tight font-semibold">{t.label}</span>
              </button>
            ))}
          </div>
        </Field>
        <Field label="Nombre">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Cuenta RUT, Billetera…" />
        </Field>
        <div>
          <AmountInput
            value={balance}
            onChange={setBalance}
            label={isCredit ? 'Deuda actual de la tarjeta' : existing ? 'Saldo actual' : '¿Cuánto tienes hoy?'}
          />
          {isCredit ? (
            <p className="mt-2 text-center text-xs text-muted">Los gastos con tarjeta aumentan la deuda; los pagos la reducen.</p>
          ) : null}
          {!isCredit && (
            <div className="mt-2 flex justify-center">
              <Chip active={negative} onClick={() => setNegative((n) => !n)}>
                {negative ? 'Saldo negativo (sobregiro)' : '¿Saldo negativo?'}
              </Chip>
            </div>
          )}
          {isCredit && (
            <div className="mt-4 space-y-4">
              <AmountInput value={limit} onChange={setLimit} label="Cupo total de la tarjeta" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Día de facturación" hint="Cuándo cierra el estado de cuenta">
                  <Select value={statementDay} onChange={(e) => setStatementDay(e.target.value)}>
                    <option value="">Fin de mes</option>
                    {Array.from({ length: 31 }, (_, i) => (
                      <option key={i + 1} value={i + 1}>
                        Día {i + 1}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Día de pago" hint="Hasta cuándo puedes pagar">
                  <Select value={paymentDay} onChange={(e) => setPaymentDay(e.target.value)}>
                    <option value="">No sé</option>
                    {Array.from({ length: 31 }, (_, i) => (
                      <option key={i + 1} value={i + 1}>
                        Día {i + 1}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <p className="text-xs text-muted">Los encuentras en tu estado de cuenta o en la app de tu banco.</p>
            </div>
          )}
          {existing && (
            <p className="mt-2 text-center text-xs text-muted">
              Si cambias el saldo, se ajusta sin afectar tus movimientos. Actual: {fmt(currentBalance)}
            </p>
          )}
        </div>
        <Field label="Ícono">
          <EmojiPicker value={icon} onChange={setIcon} />
        </Field>
        <Field label="Color">
          <ColorPicker value={color} onChange={setColor} />
        </Field>
      </div>
    </Sheet>
  )
}

/* ───────────── Categoría ───────────── */

export const CategoryForm = ({ open, onClose, state }: Base & { state: Extract<SheetState, { kind: 'category' }> }) => {
  const store = useStore()
  const existing = state.id ? store.categories.find((c) => c.id === state.id) : undefined
  const [kind, setKind] = useState<CategoryKind>(existing?.kind ?? state.categoryKind ?? 'expense')
  const [name, setName] = useState(existing?.name ?? '')
  const [icon, setIcon] = useState(existing?.icon ?? '🏷️')
  const [color, setColor] = useState(existing?.color ?? COLORS[store.categories.length % COLORS.length])
  const [budget, setBudget] = useState(existing?.budget ? String(existing.budget) : '')

  const save = () => {
    const data = {
      kind,
      name: name.trim(),
      icon,
      color,
      budget: kind === 'expense' && Number(budget) > 0 ? Number(budget) : undefined,
    }
    if (existing) store.updateCategory(existing.id, data)
    else store.addCategory(data)
    toast({ message: existing ? 'Categoría actualizada' : 'Categoría creada' })
    onClose()
  }

  const remove = async () => {
    if (!existing) return
    const used = store.transactions.filter((t) => t.categoryId === existing.id).length
    const ok = await ask({
      title: `¿Eliminar ${existing.name}?`,
      message: used ? `${used} movimientos quedarán "Sin categoría".` : undefined,
      confirmLabel: 'Eliminar',
      danger: true,
    })
    if (!ok) return
    store.deleteCategory(existing.id)
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={existing ? 'Editar categoría' : 'Nueva categoría'}
      footer={
        <div className="flex gap-2">
          {existing && <Button variant="danger" onClick={remove} aria-label="Eliminar" icon={<Trash className="size-5" />} />}
          <Button block size="lg" disabled={!name.trim()} onClick={save}>
            Guardar
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {!existing && (
          <Segmented
            value={kind}
            onChange={setKind}
            options={[
              { value: 'expense', label: 'Gasto' },
              { value: 'income', label: 'Ingreso' },
            ]}
          />
        )}
        <div className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
          <span
            className="flex size-12 items-center justify-center rounded-2xl text-2xl"
            style={{ background: `color-mix(in srgb, ${color} 20%, transparent)` }}
          >
            {icon}
          </span>
          <span className="font-bold">{name || 'Vista previa'}</span>
        </div>
        <Field label="Nombre">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Universidad, Café…" />
        </Field>
        <Field label="Ícono">
          <EmojiPicker value={icon} onChange={setIcon} />
        </Field>
        <Field label="Color">
          <ColorPicker value={color} onChange={setColor} />
        </Field>
        {kind === 'expense' && <AmountInput value={budget} onChange={setBudget} label="Presupuesto mensual (opcional)" />}
      </div>
    </Sheet>
  )
}

/* ───────────── Presupuesto ───────────── */

export const BudgetForm = ({ open, onClose, state }: Base & { state: Extract<SheetState, { kind: 'budget' }> }) => {
  const store = useStore()
  const fmt = useMoney()
  const isGlobal = !state.id
  const cat = state.id ? store.categories.find((c) => c.id === state.id) : undefined
  const [amount, setAmount] = useState(String((isGlobal ? store.settings.monthlyBudget : cat?.budget) ?? ''))

  // Promedio de los últimos 3 meses como sugerencia
  const avg = useMemo(() => {
    const now = new Date()
    const months = [1, 2, 3]
      .map((n) => inMonth(store.transactions, monthKey(new Date(now.getFullYear(), now.getMonth() - n, 1))))
      .filter((m) => m.length)
    if (!months.length) return 0
    const total = months.reduce((s, m) => s + sumType(isGlobal ? m : m.filter((t) => t.categoryId === state.id), 'expense'), 0)
    return Math.round(total / months.length)
  }, [store.transactions, isGlobal, state.id])

  const save = () => {
    const v = Number(amount) || undefined
    if (isGlobal) store.updateSettings({ monthlyBudget: v })
    else if (cat) store.updateCategory(cat.id, { budget: v })
    toast({ message: v ? 'Presupuesto guardado' : 'Presupuesto quitado' })
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={isGlobal ? 'Presupuesto mensual total' : `Presupuesto · ${cat?.icon} ${cat?.name}`}
      footer={
        <div className="flex gap-2">
          {(isGlobal ? store.settings.monthlyBudget : cat?.budget) ? (
            <Button
              variant="danger"
              onClick={() => {
                setAmount('')
                if (isGlobal) store.updateSettings({ monthlyBudget: undefined })
                else if (cat) store.updateCategory(cat.id, { budget: undefined })
                onClose()
              }}
            >
              Quitar
            </Button>
          ) : null}
          <Button block size="lg" onClick={save} disabled={!Number(amount)}>
            Guardar
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <AmountInput value={amount} onChange={setAmount} autoFocus label="Límite por mes" />
        {avg > 0 && (
          <div className="rounded-2xl bg-brand-soft p-4 text-sm">
            <p className="font-semibold text-brand">✨ Sugerencia según tu historial</p>
            <p className="mt-1 text-ink-2">
              En promedio gastas <b>{fmt(avg)}</b> al mes{isGlobal ? '' : ' en esta categoría'}. Un buen desafío es apuntar un 10%
              más abajo.
            </p>
            <div className="mt-3 flex gap-2">
              <Chip onClick={() => setAmount(String(Math.round(avg * 0.9)))}>-10%: {fmt(Math.round(avg * 0.9))}</Chip>
              <Chip onClick={() => setAmount(String(avg))}>Igual: {fmt(avg)}</Chip>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  )
}

/* ───────────── Metas ───────────── */

export const GoalForm = ({ open, onClose, state }: Base & { state: Extract<SheetState, { kind: 'goal' }> }) => {
  const store = useStore()
  const existing = state.id ? store.goals.find((g) => g.id === state.id) : undefined
  const [name, setName] = useState(existing?.name ?? '')
  const [target, setTarget] = useState(existing ? String(existing.target) : '')
  const [deadline, setDeadline] = useState(existing?.deadline ?? '')
  const [icon, setIcon] = useState(existing?.icon ?? '🎯')
  const [color, setColor] = useState(existing?.color ?? COLORS[2])

  const save = () => {
    const data = { name: name.trim(), target: Number(target), deadline: deadline || undefined, icon, color }
    if (existing) store.updateGoal(existing.id, data)
    else store.addGoal(data)
    vibrate(12)
    toast({ message: existing ? 'Meta actualizada' : `${icon} Meta creada. ¡Tú puedes!` })
    onClose()
  }

  const remove = async () => {
    if (!existing) return
    if (!(await ask({ title: `¿Eliminar la meta "${existing.name}"?`, confirmLabel: 'Eliminar', danger: true }))) return
    store.deleteGoal(existing.id)
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={existing ? 'Editar meta' : 'Nueva meta de ahorro'}
      footer={
        <div className="flex gap-2">
          {existing && <Button variant="danger" onClick={remove} aria-label="Eliminar" icon={<Trash className="size-5" />} />}
          <Button block size="lg" disabled={!name.trim() || !(Number(target) > 0)} onClick={save}>
            Guardar meta
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <Field label="¿Para qué estás ahorrando?">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Viaje, notebook, fondo de emergencia…" />
        </Field>
        <AmountInput value={target} onChange={setTarget} label="¿Cuánto necesitas?" />
        <Field label="¿Para cuándo? (opcional)" hint="Te diremos cuánto apartar cada mes para llegar.">
          <Input type="date" value={deadline} min={todayStr()} onChange={(e) => setDeadline(e.target.value)} />
        </Field>
        <Field label="Ícono">
          <EmojiPicker value={icon} onChange={setIcon} />
        </Field>
        <Field label="Color">
          <ColorPicker value={color} onChange={setColor} />
        </Field>
      </div>
    </Sheet>
  )
}

export const ContributionForm = ({ open, onClose, id }: Base & { id: string }) => {
  const store = useStore()
  const fmt = useMoney()
  const goal = store.goals.find((g) => g.id === id)
  const [amount, setAmount] = useState('')
  const [withdraw, setWithdraw] = useState(false)
  const [date, setDate] = useState(todayStr())
  if (!goal) return null
  const saved = goalSaved(goal)
  const value = Number(amount) || 0

  const save = () => {
    const signed = withdraw ? -Math.min(value, saved) : value
    store.addContribution(goal.id, { amount: signed, date })
    vibrate(withdraw ? 10 : 25)
    const after = saved + signed
    if (!withdraw && after >= goal.target && saved < goal.target) toast({ message: `🎉 ¡Completaste la meta "${goal.name}"!` })
    else
      toast({ message: withdraw ? `Retiraste ${fmt(-signed)} de ${goal.name}` : `${goal.icon} +${fmt(value)} para ${goal.name}` })
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`${goal.icon} ${goal.name}`}
      footer={
        <Button block size="lg" disabled={value <= 0} onClick={save}>
          {withdraw ? 'Retirar' : 'Apartar dinero'}
        </Button>
      }
    >
      <div className="space-y-5">
        <Segmented
          value={withdraw ? 'out' : 'in'}
          onChange={(v) => setWithdraw(v === 'out')}
          options={[
            { value: 'in', label: 'Apartar' },
            { value: 'out', label: 'Retirar' },
          ]}
        />
        <AmountInput
          value={amount}
          onChange={setAmount}
          autoFocus
          label={withdraw ? `Retirar (tienes ${fmt(saved)})` : `Faltan ${fmt(Math.max(0, goal.target - saved))}`}
        />
        {!withdraw && (
          <div className="flex flex-wrap gap-2">
            {[10000, 20000, 50000].map((v) => (
              <Chip key={v} onClick={() => setAmount(String(v))}>
                +{fmt(v, { force: true })}
              </Chip>
            ))}
            {goal.target - saved > 0 && <Chip onClick={() => setAmount(String(goal.target - saved))}>Completar</Chip>}
          </div>
        )}
        <Field label="Fecha">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value || todayStr())} />
        </Field>
        <p className="text-xs text-muted">
          El dinero apartado es una "reserva": no se descuenta de tus cuentas, pero se muestra como apartado en el inicio para que
          no lo gastes.
        </p>
      </div>
    </Sheet>
  )
}
