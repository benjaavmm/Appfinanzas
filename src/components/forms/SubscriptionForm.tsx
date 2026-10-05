import { useState } from 'react'
import { Trash } from 'lucide-react'
import { addDaysStr, todayStr } from '../../lib/dates'
import { SUBSCRIPTION_PRESETS, COLORS } from '../../lib/defaults'
import { useMoney, vibrate } from '../../lib/hooks'
import { FREQUENCIES, monthlyEquivalent } from '../../lib/recurring'
import { useStore } from '../../lib/store'
import { ask, toast, type SheetState } from '../../lib/ui'
import type { Frequency } from '../../lib/types'
import { Button, Field, Input, Segmented, Textarea, Toggle } from '../ui'
import { AccountChips, AmountInput, ColorPicker, EmojiPicker } from '../ui/pickers'
import { Sheet } from '../ui/Sheet'

export const SubscriptionForm = ({
  open,
  onClose,
  state,
}: {
  open: boolean
  onClose: () => void
  state: Extract<SheetState, { kind: 'sub' }>
}) => {
  const store = useStore()
  const fmt = useMoney()
  const existing = state.id ? store.subscriptions.find((s) => s.id === state.id) : undefined
  const subsCat = store.categories.find((c) => c.id === 'c-subs')?.id ?? store.categories.find((c) => c.kind === 'expense')?.id
  const [name, setName] = useState(existing?.name ?? '')
  const [icon, setIcon] = useState(existing?.icon ?? '🔁')
  const [color, setColor] = useState(existing?.color ?? COLORS[6])
  const [amount, setAmount] = useState(existing ? String(existing.amount) : '')
  const [frequency, setFrequency] = useState<Frequency>(existing?.frequency ?? 'monthly')
  const [nextDate, setNextDate] = useState(existing?.nextDate ?? addDaysStr(todayStr(), 1))
  const [accountId, setAccountId] = useState(
    existing?.accountId ?? store.settings.defaultAccountId ?? store.accounts[0]?.id ?? '',
  )
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? subsCat)
  const [autoRegister, setAutoRegister] = useState(existing?.autoRegister ?? true)
  const [active, setActive] = useState(existing?.active ?? true)
  const [note, setNote] = useState(existing?.note ?? '')

  const value = Number(amount) || 0
  const canSave = value > 0 && name.trim() && accountId

  const save = () => {
    if (!canSave) return
    const data = {
      name: name.trim(),
      icon,
      color,
      amount: value,
      frequency,
      nextDate,
      accountId,
      categoryId,
      autoRegister,
      active,
      note: note.trim() || undefined,
    }
    vibrate(12)
    if (existing) {
      store.updateSubscription(existing.id, data)
      toast({ message: 'Suscripción actualizada' })
    } else {
      store.addSubscription(data)
      toast({ message: `${icon} ${name.trim()} agregada` })
    }
    onClose()
  }

  const remove = async () => {
    if (!existing) return
    if (
      !(await ask({
        title: `¿Eliminar ${existing.name}?`,
        message: 'Los pagos ya registrados se mantienen en tus movimientos.',
        confirmLabel: 'Eliminar',
        danger: true,
      }))
    )
      return
    store.deleteSubscription(existing.id)
    onClose()
    toast({ message: 'Suscripción eliminada' })
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={existing ? 'Editar suscripción' : 'Nueva suscripción'}
      footer={
        <div className="flex gap-2">
          {existing && <Button variant="danger" onClick={remove} aria-label="Eliminar" icon={<Trash className="size-5" />} />}
          <Button block size="lg" disabled={!canSave} onClick={save}>
            {existing ? 'Guardar cambios' : 'Agregar suscripción'}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {!existing && (
          <div>
            <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Populares</p>
            <div className="grid grid-cols-4 gap-2">
              {SUBSCRIPTION_PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => {
                    setName(p.name)
                    setIcon(p.icon)
                    setColor(p.color)
                  }}
                  className="flex flex-col items-center gap-1 rounded-2xl border border-line px-1 py-2 transition hover:bg-surface-2 active:scale-95"
                  style={name === p.name ? { boxShadow: `inset 0 0 0 2px ${p.color}` } : undefined}
                >
                  <span className="text-xl">{p.icon}</span>
                  <span className="line-clamp-1 text-[10px] font-semibold">{p.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <Field label="Nombre">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Netflix, gimnasio, arriendo…" />
        </Field>
        <AmountInput value={amount} onChange={setAmount} label="Monto de cada cobro" />
        <Field
          label="Frecuencia"
          hint={
            value > 0 && frequency !== 'monthly'
              ? `Equivale a ${fmt(monthlyEquivalent({ amount: value, frequency }))} al mes`
              : undefined
          }
        >
          <Segmented
            value={frequency}
            onChange={setFrequency}
            options={FREQUENCIES.map((f) => ({ value: f.value, label: f.label }))}
            size="sm"
          />
        </Field>
        <Field label="Próximo cobro">
          <Input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value || todayStr())} />
        </Field>
        <Field label="Se paga con">
          <AccountChips accounts={store.accounts} value={accountId} onChange={setAccountId} />
        </Field>
        <Field label="Categoría">
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="h-12 w-full rounded-2xl border border-line bg-surface-2 px-4 text-[15px] outline-none focus:border-brand"
          >
            {store.categories
              .filter((c) => c.kind === 'expense')
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
          </select>
        </Field>
        <div className="space-y-3 rounded-2xl bg-surface-2 p-4">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <p className="text-sm font-semibold">Registrar el gasto automáticamente</p>
              <p className="text-xs text-muted">
                Cuando llegue la fecha se anota solo. Si lo apagas, te avisamos para que lo marques como pagado.
              </p>
            </div>
            <Toggle checked={autoRegister} onChange={setAutoRegister} label="Registro automático" />
          </div>
          {existing && (
            <div className="flex items-center gap-3 border-t border-line pt-3">
              <div className="flex-1">
                <p className="text-sm font-semibold">Activa</p>
                <p className="text-xs text-muted">Pausa la suscripción si la cancelaste.</p>
              </div>
              <Toggle checked={active} onChange={setActive} label="Activa" />
            </div>
          )}
        </div>
        <Field label="Ícono">
          <EmojiPicker value={icon} onChange={setIcon} />
        </Field>
        <Field label="Color">
          <ColorPicker value={color} onChange={setColor} />
        </Field>
        <Field label="Nota (opcional)">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ej: plan familiar, compartida con…"
            rows={2}
          />
        </Field>
      </div>
    </Sheet>
  )
}
