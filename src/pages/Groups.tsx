/** Grupos: gastos compartidos con el depto, la pareja, un viaje o un regalo */
import { motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ChevronRight, LoaderCircle, LogIn, Plus, UserPlus, X } from 'lucide-react'
import { Button, Card, Chip, cx, EmptyState, Field, Input, PageHeader } from '../components/ui'
import { Sheet } from '../components/ui/Sheet'
import { cloudConfigured } from '../lib/cloud/client'
import { useAuth } from '../lib/cloud/auth'
import { createGroup, loadGroups, useGroups } from '../lib/cloud/groups'
import { vibrate } from '../lib/hooks'
import { useStore } from '../lib/store'
import { toast } from '../lib/ui'
import { myStanding, type Group } from '../features/groups/balance'
import { StandingHero, useGroupMoney } from '../features/groups/GroupBits'

export const GROUP_EMOJIS = ['🏠', '✈️', '💑', '🎁', '🍻', '🏖️', '⚽', '🎓', '🛒', '🎉']

const IDEAS = [
  { emoji: '🏠', title: 'El depto', text: 'Arriendo, luz, internet y el súper' },
  { emoji: '💑', title: 'En pareja', text: 'Lo común a medias y lo tuyo aparte' },
  { emoji: '✈️', title: 'Un viaje', text: 'Cada uno paga algo y al final se cuadra' },
  { emoji: '🎁', title: 'Un regalo', text: 'La vaca para el cumple de alguien' },
]

const GroupCard = ({ g }: { g: Group }) => {
  const { fmt, decimals } = useGroupMoney(g.currency)
  const { balance } = myStanding(g, decimals)
  const others = g.members.filter((m) => !m.me).map((m) => m.name)
  return (
    <Link
      to={`/grupos/${g.id}`}
      className="flex items-center gap-3 rounded-3xl border border-line bg-surface p-4 shadow-card transition active:scale-[0.98]"
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-2xl" aria-hidden>
        {g.emoji}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold">{g.name}</span>
        <span className="block truncate text-xs text-muted">
          {others.length
            ? `Con ${others.slice(0, 3).join(', ')}${others.length > 3 ? ` y ${others.length - 3} más` : ''}`
            : 'Solo tú'}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <StandingHero balance={balance} fmt={fmt} compact />
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted" />
    </Link>
  )
}

/** Crear un grupo: nombre, emoji y quiénes están (con su nombre; después se unen con el link) */
export const NewGroupSheet = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const navigate = useNavigate()
  const currency = useStore((s) => s.settings.currency)
  const userName = useStore((s) => s.settings.userName)
  const profile = useAuth((s) => s.profile)
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState(GROUP_EMOJIS[0])
  const [people, setPeople] = useState<string[]>([])
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  const addPeople = (raw: string) => {
    const names = raw
      .split(/[,;\n]|\s+y\s+/i)
      .map((s) => s.trim().slice(0, 40))
      .filter(Boolean)
    const keys = new Set(people.map((p) => p.toLowerCase()))
    setPeople([...people, ...names.filter((n) => !keys.has(n.toLowerCase()))])
    setNewName('')
    vibrate(6)
  }

  const save = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const pending = newName.trim() ? [...people, newName.trim()] : people
      const id = await createGroup({
        name: name.trim(),
        emoji,
        currency,
        myName: profile?.display_name || userName || 'Yo',
        guests: pending,
      })
      vibrate(18)
      toast({ message: `${emoji} Grupo creado: invita a los demás con el link`, tone: 'good' })
      onClose()
      navigate(`/grupos/${id}`)
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'bad' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Nuevo grupo"
      footer={
        <Button block size="lg" onClick={() => void save()} disabled={!name.trim() || busy}>
          {busy ? 'Creando…' : 'Crear grupo'}
        </Button>
      }
    >
      <div className="space-y-5">
        <Field label="Nombre">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: Depto Ñuñoa, Viaje al sur, Regalo Felipe"
            maxLength={40}
            autoFocus
          />
        </Field>
        <div>
          <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">Ícono</p>
          <div className="flex flex-wrap gap-2">
            {GROUP_EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEmoji(e)}
                className={cx(
                  'flex size-11 items-center justify-center rounded-2xl text-xl transition',
                  e === emoji ? 'bg-brand-soft ring-2 ring-brand' : 'bg-surface-2',
                )}
                aria-label={`Ícono ${e}`}
                aria-pressed={e === emoji}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">¿Quiénes están?</p>
          <div className="space-y-3 rounded-2xl bg-surface-2 p-3">
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex h-9 items-center rounded-full bg-brand-soft px-3 text-sm font-semibold text-brand">
                Tú
              </span>
              {people.map((p) => (
                <motion.span key={p} initial={{ scale: 0.85 }} animate={{ scale: 1 }} className="inline-flex">
                  <Chip active onClick={() => setPeople(people.filter((x) => x !== p))} className="pr-2.5">
                    <span className="max-w-40 truncate">{p}</span>
                    <X className="size-3.5" aria-hidden />
                    <span className="sr-only">Quitar a {p}</span>
                  </Chip>
                </motion.span>
              ))}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                addPeople(newName)
              }}
            >
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={people.length ? 'Agregar otra persona' : 'Nombre (ej: Jazmín, Pedro)'}
                aria-label="Nombre de la persona"
                autoComplete="off"
                className="min-w-0 bg-surface"
              />
              <Button
                type="submit"
                variant="soft"
                className="h-12 shrink-0"
                disabled={!newName.trim()}
                icon={<UserPlus className="size-5" />}
                aria-label="Agregar persona"
              />
            </form>
            <p className="text-xs text-muted">No necesitan la app: después les mandas el link por WhatsApp.</p>
          </div>
        </div>
      </div>
    </Sheet>
  )
}

export default function Groups() {
  const status = useAuth((s) => s.status)
  const { groups, loaded, error } = useGroups()
  const [creating, setCreating] = useState(false)
  const currency = useStore((s) => s.settings.currency)
  const { fmt, decimals } = useGroupMoney(currency)

  useEffect(() => {
    if (status !== 'signedIn') return
    void loadGroups()
  }, [status])

  const totals = useMemo(() => {
    let owed = 0
    let owe = 0
    for (const g of groups.filter((x) => x.currency === currency)) {
      const s = myStanding(g, decimals)
      owed += s.owedToMe.reduce((a, t) => a + t.amount, 0)
      owe += s.iOwe.reduce((a, t) => a + t.amount, 0)
    }
    return { owed, owe }
  }, [groups, currency, decimals])

  const header = (
    <PageHeader
      title="Grupos"
      subtitle="Gastos compartidos sin enredos"
      actions={
        status === 'signedIn' ? (
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            Nuevo
          </Button>
        ) : undefined
      }
    />
  )

  const ideas = (
    <div className="grid grid-cols-2 gap-3">
      {IDEAS.map((i) => (
        <div key={i.title} className="rounded-3xl border border-line bg-surface p-4 shadow-card">
          <span className="text-2xl" aria-hidden>
            {i.emoji}
          </span>
          <p className="mt-2 font-bold">{i.title}</p>
          <p className="text-xs text-muted">{i.text}</p>
        </div>
      ))}
    </div>
  )

  if (!cloudConfigured)
    return (
      <div>
        {header}
        <EmptyState
          emoji="👥"
          title="Grupos"
          text="Necesitan la cuenta en la nube, que todavía no está activada en esta versión."
        />
      </div>
    )

  if (status !== 'signedIn')
    return (
      <div>
        {header}
        <div className="space-y-4">
          <Card>
            <p className="text-lg font-bold">Anoten juntos, la app saca las cuentas 🧮</p>
            <p className="mt-1 text-sm text-muted">
              Cada uno anota lo que pagó y Mis Finanzas dice quién le debe a quién, con la menor cantidad de transferencias. Tus
              amigos lo ven con un link, sin instalar nada.
            </p>
            {status === 'loading' ? (
              <div className="flex justify-center py-4">
                <LoaderCircle className="size-6 animate-spin text-muted" />
              </div>
            ) : (
              <Link to="/cuenta" className="mt-4 block">
                <Button block icon={<LogIn className="size-5" />}>
                  Inicia sesión para crear un grupo
                </Button>
              </Link>
            )}
          </Card>
          {ideas}
        </div>
      </div>
    )

  return (
    <div>
      {header}
      <div className="space-y-4">
        {error && <p className="rounded-2xl bg-bad-soft px-4 py-3 text-sm font-medium text-bad">{error}</p>}
        {(totals.owed > 0 || totals.owe > 0) && (
          <Card>
            <div className="grid grid-cols-2 divide-x divide-line text-center">
              <div>
                <p className="text-xs font-semibold text-muted">Te deben</p>
                <p className="text-xl font-extrabold text-good">{fmt(totals.owed)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted">Debes</p>
                <p className="text-xl font-extrabold text-bad">{fmt(totals.owe)}</p>
              </div>
            </div>
          </Card>
        )}
        {!loaded ? (
          <div className="flex justify-center py-10">
            <LoaderCircle className="size-6 animate-spin text-muted" />
          </div>
        ) : groups.length ? (
          <div className="space-y-3">
            {groups.map((g) => (
              <GroupCard key={g.id} g={g} />
            ))}
            <Button block variant="secondary" icon={<Plus className="size-5" />} onClick={() => setCreating(true)}>
              Nuevo grupo
            </Button>
          </div>
        ) : (
          <>
            <Card>
              <EmptyState
                emoji="👥"
                title="Tu primer grupo"
                text="Para el depto, la pareja, un viaje o un regalo. Cada uno anota lo que pagó y la app dice quién le debe a quién."
                action={
                  <Button icon={<Plus className="size-5" />} onClick={() => setCreating(true)}>
                    Crear grupo
                  </Button>
                }
              />
            </Card>
            {ideas}
          </>
        )}
      </div>
      <NewGroupSheet open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}
