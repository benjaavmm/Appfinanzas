/** Un grupo: cómo quedo, quién le paga a quién, los gastos y anotar uno nuevo */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ArrowLeft, Check, HandCoins, LoaderCircle, MessageCircle, Plus, Settings2, Share2, UserPlus } from 'lucide-react'
import { Button, Card, Chip, cx, EmptyState, Field, IconButton, Input, PageHeader, Segmented, Toggle } from '../components/ui'
import { AccountChips, AmountInput, CategoryGrid } from '../components/ui/pickers'
import { Sheet } from '../components/ui/Sheet'
import { useAuth } from '../lib/cloud/auth'
import {
  addGroupEntry,
  addGroupMember,
  deleteGroupEntry,
  groupLink,
  leaveGroup,
  loadGroups,
  removeGroupMember,
  rotateGroupCode,
  updateGroup,
  useGroups,
} from '../lib/cloud/groups'
import { addDaysStr, todayStr } from '../lib/dates'
import { formatAmountInput } from '../lib/format'
import { useToday, vibrate } from '../lib/hooks'
import { learnPlace } from '../lib/insights'
import { useStore } from '../lib/store'
import { ask, toast } from '../lib/ui'
import type { DateStr } from '../lib/types'
import {
  equalShares,
  groupBalances,
  groupChargeText,
  groupInviteText,
  groupSpent,
  myShareTotal,
  myStanding,
  type Group,
  type GroupTransfer,
} from '../features/groups/balance'
import {
  EntryItem,
  MemberAvatar,
  memberName,
  paymentText,
  shareText,
  StandingHero,
  TransferRow,
  useGroupMoney,
} from '../features/groups/GroupBits'
import { MiniAmountInput } from '../features/split/MiniAmountInput'
import { trySplit } from '../features/split/split'
import { GROUP_EMOJIS } from './Groups'

const fail = (e: unknown) => toast({ message: (e as Error).message, tone: 'bad' })

const DateChips = ({ date, setDate }: { date: DateStr; setDate: (d: DateStr) => void }) => {
  const today = useToday()
  return (
    <div className="flex items-center gap-2">
      {(
        [
          ['Hoy', today],
          ['Ayer', addDaysStr(today, -1)],
        ] as const
      ).map(([label, d]) => (
        <Chip key={label} active={date === d} onClick={() => setDate(d)}>
          {label}
        </Chip>
      ))}
      <Input
        type="date"
        value={date}
        max={today}
        onChange={(e) => setDate(e.target.value || todayStr())}
        aria-label="Fecha"
        className="min-w-0 flex-1"
      />
    </div>
  )
}

/* ───────────── Agregar gasto ───────────── */

const ExpenseSheet = ({ group, open, onClose }: { group: Group; open: boolean; onClose: () => void }) => {
  const store = useStore()
  const { fmt, decimals } = useGroupMoney(group.currency)
  const { locale } = store.settings
  const me = group.members.find((m) => m.me)
  const expenseCats = store.categories.filter((c) => c.kind === 'expense')
  const [amount, setAmount] = useState('')
  const [what, setWhat] = useState('')
  const [date, setDate] = useState<DateStr>(todayStr)
  const [paidBy, setPaidBy] = useState(me?.id ?? group.members[0]?.id ?? '')
  const [included, setIncluded] = useState<string[]>(() => group.members.map((m) => m.id))
  const [mode, setMode] = useState<'equal' | 'custom'>('equal')
  const [custom, setCustom] = useState<Record<string, string>>({})
  const [recordMine, setRecordMine] = useState(true)
  const [accountId, setAccountId] = useState(
    () =>
      store.accounts.find((a) => a.id === store.settings.defaultAccountId && !a.archived)?.id ??
      store.accounts.find((a) => !a.archived)?.id ??
      '',
  )
  const [categoryId, setCategoryId] = useState<string | undefined>(
    () => expenseCats.find((c) => c.id === 'c-otros')?.id ?? expenseCats[0]?.id,
  )
  const [busy, setBusy] = useState(false)

  const total = Number(amount) || 0
  const list = group.members.filter((m) => included.includes(m.id))
  const result =
    total <= 0 || !list.length
      ? null
      : mode === 'equal'
        ? ({
            ok: true,
            shares: equalShares(
              total,
              list.map((m) => m.id),
              paidBy,
              decimals,
            ),
          } as const)
        : (() => {
            const r = trySplit(
              total,
              list.map((m) => ({
                name: m.id,
                me: m.id === paidBy,
                amount: custom[m.id] === undefined || custom[m.id] === '' ? undefined : Number(custom[m.id]),
              })),
              decimals,
            )
            return r.ok
              ? ({ ok: true, shares: Object.fromEntries(r.shares.map((s) => [s.name, s.amount])) } as const)
              : ({
                  ok: false,
                  text: r.error.code === 'over' ? 'Las partes suman más que el total' : 'Las partes no suman el total',
                } as const)
          })()
  const shares = result?.ok ? result.shares : null
  const myShare = me && shares ? (shares[me.id] ?? 0) : 0
  const canRecord = myShare > 0 && group.currency === store.settings.currency && !!accountId
  const problem =
    total <= 0
      ? 'Ingresa el monto'
      : !list.length
        ? 'Elige entre quiénes se divide'
        : result && !result.ok
          ? result.text
          : shares && Object.values(shares).every((v) => v <= 0)
            ? 'El monto es muy chico'
            : null

  const toggle = (id: string) => setIncluded((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]))

  const save = async () => {
    if (problem || !shares || busy) return
    setBusy(true)
    try {
      const clean = Object.fromEntries(Object.entries(shares).filter(([, v]) => v > 0))
      await addGroupEntry(group.id, { kind: 'expense', description: what.trim(), amount: total, date, paidBy, shares: clean })
      if (recordMine && canRecord)
        store.addTransaction({
          type: 'expense',
          amount: myShare,
          accountId,
          categoryId,
          date,
          place: what.trim() || group.name,
          note: `Grupo ${group.emoji} ${group.name}`,
        })
      vibrate(18)
      toast({
        message:
          recordMine && canRecord
            ? `Listo: anotado en el grupo y tu parte (${fmt(myShare)}) en tus gastos`
            : 'Listo: gasto anotado',
        tone: 'good',
      })
      onClose()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Nuevo gasto del grupo"
      footer={
        <div className="space-y-2">
          <p className={cx('text-center text-xs font-semibold', problem ? 'text-muted' : 'text-ink-2')} role="status">
            {problem ?? (me && myShare > 0 ? `Tu parte ${fmt(myShare)}` : 'No te toca nada de este gasto')}
          </p>
          <Button block size="lg" onClick={() => void save()} disabled={!!problem || busy}>
            {busy ? 'Guardando…' : 'Guardar gasto'}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <AmountInput value={amount} onChange={setAmount} autoFocus label="Monto" />
        <Field label="¿Qué fue?">
          <Input
            value={what}
            onChange={(e) => setWhat(e.target.value)}
            onBlur={() => {
              const s = what.trim() && learnPlace(store.transactions, what)
              if (s && s.categoryId) setCategoryId(s.categoryId)
            }}
            placeholder="Ej: Súper, arriendo, bencina…"
            maxLength={80}
          />
        </Field>

        <div>
          <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">¿Quién pagó?</p>
          <div className="flex flex-wrap gap-2">
            {group.members.map((m) => (
              <Chip key={m.id} active={paidBy === m.id} onClick={() => setPaidBy(m.id)}>
                {m.me ? 'Yo' : m.name}
              </Chip>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">¿Entre quiénes?</p>
          <div className="flex flex-wrap gap-2">
            {group.members.map((m) => (
              <Chip key={m.id} active={included.includes(m.id)} onClick={() => toggle(m.id)}>
                {included.includes(m.id) && <Check className="size-3.5" aria-hidden />}
                {m.me ? 'Yo' : m.name}
              </Chip>
            ))}
          </div>
          <Segmented
            className="mt-3"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'equal', label: 'Partes iguales' },
              { value: 'custom', label: 'Montos distintos' },
            ]}
          />
          {mode === 'custom' && list.length > 0 && (
            <ul className="mt-3 space-y-2 rounded-2xl bg-surface-2 p-3">
              {list.map((m) => (
                <li key={m.id} className="flex items-center gap-3">
                  <MemberAvatar member={m} size={32} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{m.me ? 'Tú' : m.name}</span>
                  <MiniAmountInput
                    value={custom[m.id] ?? ''}
                    onChange={(v) => setCustom((c) => ({ ...c, [m.id]: v }))}
                    placeholder={
                      shares && custom[m.id] === undefined ? formatAmountInput(String(shares[m.id] ?? 0), locale, decimals) : '0'
                    }
                    label={`Parte de ${m.me ? 'ti' : m.name}`}
                  />
                </li>
              ))}
              <li className="text-xs text-muted">Deja en blanco a quien se lleva lo que falte.</li>
            </ul>
          )}
        </div>

        <Field label="Fecha">
          <DateChips date={date} setDate={setDate} />
        </Field>

        {myShare > 0 && group.currency === store.settings.currency && (
          <div className="rounded-2xl bg-surface-2 p-3">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Anotar mi parte en mis gastos</p>
                <p className="text-xs text-muted">
                  Se anota {fmt(myShare)}, aunque hayas pagado otro monto: lo demás se cuadra en el grupo.
                </p>
              </div>
              <Toggle checked={recordMine} onChange={setRecordMine} label="Anotar mi parte en mis gastos" />
            </div>
            {recordMine && (
              <div className="mt-3 space-y-3">
                <AccountChips accounts={store.accounts} value={accountId} onChange={setAccountId} />
                <CategoryGrid categories={expenseCats} value={categoryId} onChange={setCategoryId} />
              </div>
            )}
          </div>
        )}
      </div>
    </Sheet>
  )
}

/* ───────────── Registrar un pago ───────────── */

const PaymentSheet = ({ group, transfer, onClose }: { group: Group; transfer: GroupTransfer | null; onClose: () => void }) => {
  const { fmt } = useGroupMoney(group.currency)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState<DateStr>(todayStr)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (transfer) {
      setAmount(String(transfer.amount))
      setDate(todayStr())
    }
  }, [transfer])
  if (!transfer) return null
  const text = paymentText(group, transfer.from, transfer.to)
  const value = Number(amount) || 0
  const save = async () => {
    if (value <= 0 || busy) return
    setBusy(true)
    try {
      await addGroupEntry(group.id, {
        kind: 'payment',
        amount: value,
        date,
        paidBy: transfer.from,
        shares: { [transfer.to]: value },
      })
      vibrate(18)
      toast({ message: `Listo: ${text} ${fmt(value)}`, tone: 'good' })
      onClose()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet
      open
      onClose={onClose}
      title="Registrar pago"
      footer={
        <Button block size="lg" onClick={() => void save()} disabled={value <= 0 || busy} icon={<HandCoins className="size-5" />}>
          {busy ? 'Guardando…' : 'Registrar pago'}
        </Button>
      }
    >
      <div className="space-y-5">
        <p className="text-center text-sm font-semibold text-ink-2">{text}</p>
        <AmountInput value={amount} onChange={setAmount} label="Monto" />
        {value > 0 && value !== transfer.amount && (
          <p className="text-center text-xs text-muted">
            {value < transfer.amount
              ? `Quedan ${fmt(transfer.amount - value)} por pagar`
              : `Es ${fmt(value - transfer.amount)} más de lo que debía: el grupo lo cuadra solo`}
          </p>
        )}
        <Field label="Fecha">
          <DateChips date={date} setDate={setDate} />
        </Field>
      </div>
    </Sheet>
  )
}

/* ───────────── Ajustes del grupo ───────────── */

const SettingsSheet = ({ group, open, onClose }: { group: Group; open: boolean; onClose: () => void }) => {
  const navigate = useNavigate()
  const [name, setName] = useState(group.name)
  const [emoji, setEmoji] = useState(group.emoji)
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      toast({ message: ok, tone: 'good' })
      return true
    } catch (e) {
      fail(e)
      return false
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Ajustes del grupo"
      footer={
        <Button
          block
          size="lg"
          disabled={busy || !name.trim()}
          onClick={async () => {
            if (await run(() => updateGroup(group.id, name, emoji), 'Grupo actualizado')) onClose()
          }}
        >
          Guardar
        </Button>
      }
    >
      <div className="space-y-5">
        <Field label="Nombre">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </Field>
        <div className="flex flex-wrap gap-2">
          {GROUP_EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setEmoji(e)}
              className={cx(
                'flex size-11 items-center justify-center rounded-2xl text-xl',
                e === emoji ? 'bg-brand-soft ring-2 ring-brand' : 'bg-surface-2',
              )}
              aria-label={`Ícono ${e}`}
              aria-pressed={e === emoji}
            >
              {e}
            </button>
          ))}
        </div>
        <div className="space-y-2 border-t border-line pt-4">
          <Button
            block
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              if (
                await ask({
                  title: '¿Cambiar el link del grupo?',
                  message: 'El link anterior deja de funcionar. Los que ya se unieron siguen en el grupo.',
                  confirmLabel: 'Cambiar link',
                })
              )
                void run(() => rotateGroupCode(group.id), 'Link nuevo listo')
            }}
          >
            Cambiar el link de invitación
          </Button>
          <Button
            block
            variant="secondary"
            className="text-bad"
            disabled={busy}
            onClick={async () => {
              if (
                await ask({
                  title: '¿Salir del grupo?',
                  message: 'Tus gastos quedan en el grupo con tu nombre. Si eres el último con cuenta, el grupo se borra.',
                  confirmLabel: 'Salir',
                  danger: true,
                })
              )
                if (await run(() => leaveGroup(group.id), 'Saliste del grupo')) {
                  onClose()
                  navigate('/grupos')
                }
            }}
          >
            Salir del grupo
          </Button>
        </div>
      </div>
    </Sheet>
  )
}

/* ───────────── Página ───────────── */

export default function GroupDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const status = useAuth((s) => s.status)
  const { groups, loaded, error } = useGroups()
  const group = groups.find((g) => g.id === id)
  const [adding, setAdding] = useState(false)
  const [paying, setPaying] = useState<GroupTransfer | null>(null)
  const [settings, setSettings] = useState(false)
  const [newMember, setNewMember] = useState('')
  const { fmt, decimals } = useGroupMoney(group?.currency ?? 'CLP')

  useEffect(() => {
    if (status === 'signedIn') void loadGroups()
  }, [status, id])

  const standing = useMemo(() => (group ? myStanding(group, decimals) : null), [group, decimals])
  const balances = useMemo(() => (group ? groupBalances(group, decimals) : {}), [group, decimals])

  const back = (
    <IconButton label="Volver" onClick={() => navigate('/grupos')}>
      <ArrowLeft className="size-5" />
    </IconButton>
  )

  if (!group || !standing)
    return (
      <div>
        <PageHeader title="Grupo" back={back} />
        {!loaded || status === 'loading' ? (
          <div className="flex justify-center py-10">
            <LoaderCircle className="size-6 animate-spin text-muted" />
          </div>
        ) : (
          <EmptyState
            emoji="🤷"
            title="No encontramos este grupo"
            text={error ?? 'Puede que hayas salido o que lo hayan borrado.'}
          />
        )}
      </div>
    )

  const link = group.inviteCode ? groupLink(group.inviteCode) : ''
  const label = `${group.emoji} ${group.name}`
  const invite = () => void shareText(groupInviteText({ group: label, link }))
  const charge = (t: GroupTransfer) =>
    void shareText(groupChargeText({ name: memberName(group, t.from), amount: fmt(t.amount), group: label, link }))
  const spent = groupSpent(group)
  const mine = myShareTotal(group)
  const guests = group.members.filter((m) => !m.joined)

  const addMember = async () => {
    const n = newMember.trim()
    if (!n) return
    try {
      await addGroupMember(group.id, n)
      setNewMember('')
      vibrate(10)
    } catch (e) {
      fail(e)
    }
  }

  return (
    <div>
      <PageHeader
        title={label}
        subtitle={`${group.members.length} ${group.members.length === 1 ? 'persona' : 'personas'}`}
        back={back}
        actions={
          <>
            <IconButton label="Invitar" onClick={invite}>
              <Share2 className="size-5" />
            </IconButton>
            <IconButton label="Ajustes del grupo" onClick={() => setSettings(true)}>
              <Settings2 className="size-5" />
            </IconButton>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 pb-6 lg:grid-cols-2">
        <Card>
          <StandingHero balance={standing.balance} fmt={fmt} />
          {spent > 0 && (
            <p className="mt-1 text-center text-xs text-muted">
              Gastaron {fmt(spent)} en total{mine > 0 ? ` · tu parte ${fmt(mine)}` : ''}
            </p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button icon={<Plus className="size-5" />} onClick={() => setAdding(true)}>
              Gasto
            </Button>
            <Button variant="secondary" icon={<Share2 className="size-5" />} onClick={invite}>
              Invitar
            </Button>
          </div>
          {guests.length > 0 && group.entries.length === 0 && (
            <p className="mt-3 rounded-2xl bg-info-soft px-3 py-2 text-xs font-medium text-info">
              Manda el link a {guests.map((g) => g.name).join(', ')}: lo ven sin instalar nada y, si quieren, se unen.
            </p>
          )}
        </Card>

        <Card>
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">Para quedar a mano</p>
          {standing.transfers.length ? (
            <ul className="divide-y divide-line">
              {standing.transfers.map((t) => {
                const toMe = t.to === standing.meId
                const fromMe = t.from === standing.meId
                return (
                  <TransferRow
                    key={`${t.from}-${t.to}`}
                    group={group}
                    t={t}
                    fmt={fmt}
                    actions={
                      toMe ? (
                        <>
                          <Button size="sm" variant="soft" icon={<MessageCircle className="size-4" />} onClick={() => charge(t)}>
                            Cobrar
                          </Button>
                          <Button size="sm" variant="secondary" icon={<Check className="size-4" />} onClick={() => setPaying(t)}>
                            Me pagó
                          </Button>
                        </>
                      ) : fromMe ? (
                        <Button size="sm" variant="soft" icon={<HandCoins className="size-4" />} onClick={() => setPaying(t)}>
                          Ya le pagué
                        </Button>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={() => setPaying(t)}>
                          Registrar pago
                        </Button>
                      )
                    }
                  />
                )
              })}
            </ul>
          ) : (
            <p className="py-4 text-center text-sm text-muted">
              {group.entries.length ? 'Todos a mano 🎉' : 'Cuando anoten gastos, aquí verán quién le paga a quién.'}
            </p>
          )}
        </Card>

        <Card>
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">Integrantes</p>
          <ul className="mt-1 divide-y divide-line">
            {group.members.map((m) => {
              const b = balances[m.id] ?? 0
              return (
                <li key={m.id} className="flex items-center gap-3 py-2.5">
                  <MemberAvatar member={m} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{m.me ? 'Tú' : m.name}</span>
                    <span className="block text-xs text-muted">{m.joined ? 'En la app' : 'Invitado'}</span>
                  </span>
                  <span className={cx('text-sm font-bold', b > 0 ? 'text-good' : b < 0 ? 'text-bad' : 'text-muted')}>
                    {b === 0 ? 'a mano' : `${b > 0 ? '+' : '−'}${fmt(Math.abs(b))}`}
                  </span>
                  {!m.joined && (
                    <button
                      type="button"
                      className="text-xs font-semibold text-muted underline"
                      onClick={async () => {
                        if (await ask({ title: `¿Quitar a ${m.name}?`, confirmLabel: 'Quitar', danger: true }))
                          removeGroupMember(m.id).catch(fail)
                      }}
                    >
                      Quitar
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void addMember()
            }}
          >
            <Input
              value={newMember}
              onChange={(e) => setNewMember(e.target.value)}
              placeholder="Agregar a alguien"
              aria-label="Nombre de la persona"
              className="min-w-0"
            />
            <Button
              type="submit"
              variant="soft"
              className="h-12 shrink-0"
              disabled={!newMember.trim()}
              icon={<UserPlus className="size-5" />}
              aria-label="Agregar persona"
            />
          </form>
        </Card>

        <Card>
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">Gastos y pagos</p>
          {group.entries.length ? (
            <ul className="-mx-1 mt-1">
              {group.entries.map((e) => (
                <EntryItem
                  key={e.id}
                  group={group}
                  e={e}
                  fmt={fmt}
                  onClick={async () => {
                    if (
                      await ask({
                        title: e.kind === 'payment' ? '¿Borrar este pago?' : `¿Borrar "${e.description || 'Gasto'}"?`,
                        message: 'Se borra para todo el grupo. Si lo anotaste en tus gastos, allá queda.',
                        confirmLabel: 'Borrar',
                        danger: true,
                      })
                    )
                      deleteGroupEntry(e.id)
                        .then(() => toast({ message: 'Borrado' }))
                        .catch(fail)
                  }}
                />
              ))}
            </ul>
          ) : (
            <EmptyState
              emoji="🧾"
              title="Sin gastos todavía"
              text="Anota el primero: quién pagó y entre quiénes se divide."
              action={
                <Button icon={<Plus className="size-5" />} onClick={() => setAdding(true)}>
                  Agregar gasto
                </Button>
              }
            />
          )}
        </Card>
      </div>

      {adding && <ExpenseSheet group={group} open={adding} onClose={() => setAdding(false)} />}
      <PaymentSheet group={group} transfer={paying} onClose={() => setPaying(null)} />
      {settings && <SettingsSheet group={group} open={settings} onClose={() => setSettings(false)} />}
    </div>
  )
}
