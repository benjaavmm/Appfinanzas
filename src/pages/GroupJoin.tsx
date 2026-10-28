/** Lo que se abre con el link de un grupo: se ve sin cuenta y, con cuenta, te unes en un toque */
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { LoaderCircle, LogIn, UserPlus } from 'lucide-react'
import { Button, Card, Chip, EmptyState, PageHeader, ProgressBar } from '../components/ui'
import { cloudConfigured } from '../lib/cloud/client'
import { useAuth } from '../lib/cloud/auth'
import { fetchPublicGroup, groupError, joinGroup, PENDING_JOIN_KEY, type PublicGroup } from '../lib/cloud/groups'
import { vibrate } from '../lib/hooks'
import { toast } from '../lib/ui'
import { goalProgress, groupSpent, settleGroup } from '../features/groups/balance'
import { EntryItem, TransferRow, useGroupMoney } from '../features/groups/GroupBits'

/** `standalone`: la persona todavía no usa la app (se ve sin la bienvenida) */
export default function GroupJoin({ standalone = false }: { standalone?: boolean }) {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const status = useAuth((s) => s.status)
  const [group, setGroup] = useState<PublicGroup | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [error, setError] = useState('')
  const [who, setWho] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { fmt, decimals } = useGroupMoney(group?.currency ?? 'CLP')

  useEffect(() => {
    if (!cloudConfigured || status === 'loading') return
    let alive = true
    fetchPublicGroup(code)
      .then((g) => {
        if (!alive) return
        setGroup(g)
        setState(g ? 'ready' : 'missing')
      })
      .catch((e) => {
        if (!alive) return
        setError(groupError(e))
        setState('error')
      })
    return () => {
      alive = false
    }
  }, [code, status])

  const transfers = useMemo(() => (group ? settleGroup(group, decimals) : []), [group, decimals])

  if (!cloudConfigured)
    return (
      <div>
        <PageHeader title="Grupo" />
        <EmptyState emoji="👥" title="Esta versión no tiene grupos" />
      </div>
    )

  if (state === 'loading')
    return (
      <div className="flex justify-center py-24">
        <LoaderCircle className="size-7 animate-spin text-muted" />
      </div>
    )

  if (!group)
    return (
      <div>
        <PageHeader title="Grupo" />
        <EmptyState
          emoji="🔗"
          title={state === 'missing' ? 'Este link ya no funciona' : 'No pudimos abrir el grupo'}
          text={state === 'missing' ? 'Pídele a quien te lo mandó un link nuevo.' : error}
        />
      </div>
    )

  const guests = group.members.filter((m) => !m.joined)
  const join = async () => {
    setBusy(true)
    try {
      const id = await joinGroup(code, who && who !== 'nuevo' ? who : undefined)
      vibrate(18)
      toast({ message: `${group.emoji} ¡Listo! Ya estás en ${group.name}`, tone: 'good' })
      navigate(`/grupos/${id}`, { replace: true })
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'bad' })
    } finally {
      setBusy(false)
    }
  }
  const remember = () => {
    try {
      localStorage.setItem(PENDING_JOIN_KEY, code)
    } catch {
      /* sin almacenamiento */
    }
  }
  const spent = groupSpent(group)
  const goal = goalProgress(group)

  return (
    <div>
      <PageHeader title={`${group.emoji} ${group.name}`} subtitle={`${group.members.map((m) => m.name).join(', ')}`} />
      <div className="grid grid-cols-1 gap-4 pb-6">
        <Card>
          {group.isMember ? (
            <div className="text-center">
              <p className="font-semibold">Ya estás en este grupo</p>
              <Button className="mt-3" onClick={() => navigate(`/grupos/${group.id}`, { replace: true })}>
                Abrir grupo
              </Button>
            </div>
          ) : status === 'signedIn' ? (
            <div>
              <p className="font-bold">¿Quién eres?</p>
              <p className="text-sm text-muted">Así tus gastos y lo que debes quedan a tu nombre.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {guests.map((m) => (
                  <Chip key={m.id} active={who === m.id} onClick={() => setWho(m.id)}>
                    Soy {m.name}
                  </Chip>
                ))}
                <Chip active={who === 'nuevo'} onClick={() => setWho('nuevo')}>
                  Soy otra persona
                </Chip>
              </div>
              <Button
                block
                className="mt-4"
                icon={<UserPlus className="size-5" />}
                disabled={!who || busy}
                onClick={() => void join()}
              >
                {busy ? 'Uniéndote…' : 'Unirme al grupo'}
              </Button>
            </div>
          ) : (
            <div className="text-center">
              <p className="font-bold">Te invitaron a este grupo 👋</p>
              <p className="mt-1 text-sm text-muted">
                Aquí ves los gastos y quién le debe a quién. Para anotar gastos y marcar pagos, crea tu cuenta gratis.
              </p>
              {standalone ? (
                <Button
                  className="mt-4"
                  icon={<LogIn className="size-5" />}
                  onClick={() => {
                    remember()
                    // Bienvenida de la app; al iniciar sesión vuelve a este grupo
                    window.location.hash = '#/'
                  }}
                >
                  Empezar gratis
                </Button>
              ) : (
                <Link to="/cuenta" onClick={remember} className="mt-4 inline-block">
                  <Button icon={<LogIn className="size-5" />}>Crear cuenta o iniciar sesión</Button>
                </Link>
              )}
            </div>
          )}
        </Card>

        {group.goal && (
          <Card>
            <p className="text-xs font-semibold tracking-wide text-muted uppercase">Meta del grupo</p>
            <p className="font-bold">🎯 {group.goal.name}</p>
            <ProgressBar ratio={goal.ratio} className="mt-3" color="var(--brand)" />
            <p className="mt-2 text-sm">
              <b>{fmt(goal.saved)}</b> de {fmt(goal.target)} ({Math.round(goal.ratio * 100)}%)
            </p>
          </Card>
        )}

        <Card>
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">Para quedar a mano</p>
          {transfers.length ? (
            <ul className="divide-y divide-line">
              {transfers.map((t) => (
                <TransferRow key={`${t.from}-${t.to}`} group={group} t={t} fmt={fmt} />
              ))}
            </ul>
          ) : (
            <p className="py-4 text-center text-sm text-muted">
              {group.entries.length ? 'Todos a mano 🎉' : 'Todavía no hay gastos.'}
            </p>
          )}
        </Card>

        {group.entries.length > 0 && (
          <Card>
            <p className="text-xs font-semibold tracking-wide text-muted uppercase">Gastos · {fmt(spent)} en total</p>
            <ul className="-mx-1 mt-1">
              {group.entries.slice(0, 30).map((e) => (
                <EntryItem key={e.id} group={group} e={e} fmt={fmt} />
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  )
}
