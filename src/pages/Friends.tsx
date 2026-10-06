import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { Check, Copy, LoaderCircle, LogIn, Plus, Share2, UserPlus, X } from 'lucide-react'
import { appUrl, cloudConfigured } from '../lib/cloud/client'
import { useAuth } from '../lib/cloud/auth'
import {
  acceptFriend,
  addFriend,
  refreshSocial,
  removeFriend,
  transitionSharedLoan,
  useSocial,
  type Friend,
} from '../lib/cloud/social'
import { loanRemaining } from '../lib/finance'
import { useMoney, vibrate } from '../lib/hooks'
import { useStore } from '../lib/store'
import { ask, openSheet, toast } from '../lib/ui'
import { Button, Card, EmptyState, IconButton, Input, PageHeader, SectionHeader } from '../components/ui'
import { ProfileAvatar } from './Account'

const useFriendBalances = () => {
  const loans = useStore((s) => s.loans)
  return useMemo(() => {
    const m = new Map<string, number>()
    for (const l of loans) {
      if (!l.shared || l.shared.status === 'rejected' || l.shared.status === 'cancelled') continue
      const rem = loanRemaining(l)
      m.set(l.shared.friendId, (m.get(l.shared.friendId) ?? 0) + (l.direction === 'lent' ? rem : -rem))
    }
    return m
  }, [loans])
}

const run = async (fn: () => Promise<unknown>, ok?: string) => {
  try {
    await fn()
    vibrate(15)
    if (ok) toast({ message: ok, tone: 'good' })
  } catch (e) {
    toast({ message: (e as Error).message, tone: 'bad' })
  }
}

const FriendRow = ({ f, balance }: { f: Friend; balance: number }) => {
  const fmt = useMoney()
  const remove = async () => {
    const ok = await ask({
      title: `¿Quitar a ${f.profile.display_name}?`,
      message: 'Los préstamos que ya tienen se mantienen. Solo ya no podrán crear nuevos.',
      confirmLabel: 'Quitar',
      danger: true,
    })
    if (ok) void run(() => removeFriend(f.friendshipId), 'Amigo quitado')
  }
  return (
    <li className="flex items-center gap-3 py-2.5">
      <ProfileAvatar name={f.profile.display_name} avatar={f.profile.avatar} size={44} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{f.profile.display_name}</p>
        <p className="truncate text-xs text-muted">
          @{f.profile.username}
          {balance > 0 ? (
            <span className="font-semibold text-good"> · te debe {fmt(balance)}</span>
          ) : balance < 0 ? (
            <span className="font-semibold text-bad"> · le debes {fmt(-balance)}</span>
          ) : (
            ' · al día'
          )}
        </p>
      </div>
      <Button
        size="sm"
        variant="soft"
        icon={<Plus className="size-4" />}
        onClick={() => openSheet({ kind: 'loan', friendId: f.profile.id, person: f.profile.display_name })}
      >
        Préstamo
      </Button>
      <IconButton label="Quitar amigo" onClick={() => void remove()}>
        <X className="size-4" />
      </IconButton>
    </li>
  )
}

export default function Friends() {
  const { status, profile } = useAuth()
  const social = useSocial()
  const me = useAuth((s) => s.userId)
  const fmt = useMoney()
  const balances = useFriendBalances()
  const { search } = useLocation()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    if (status === 'signedIn') void refreshSocial()
  }, [status])

  // Link compartido: #/amigos?agregar=usuario
  useEffect(() => {
    const u = new URLSearchParams(search).get('agregar')
    if (!u) return
    setUsername(u)
    navigate({ search: '' }, { replace: true })
  }, [search, navigate])

  const add = async () => {
    if (!username.trim()) return
    setAdding(true)
    try {
      const msg = await addFriend(username)
      toast({ message: msg, tone: 'good' })
      setUsername('')
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'bad' })
    } finally {
      setAdding(false)
    }
  }

  const shareLink = profile ? `${appUrl()}#/amigos?agregar=${profile.username}` : ''
  const share = async () => {
    const text = `Agrégame en Mis Finanzas para anotar lo que nos prestamos: @${profile?.username}`
    try {
      if (navigator.share) return await navigator.share({ text, url: shareLink })
    } catch {
      return
    }
    await navigator.clipboard?.writeText(`${text} ${shareLink}`).catch(() => undefined)
    toast({ message: 'Link copiado', tone: 'good' })
  }

  if (!cloudConfigured || status !== 'signedIn')
    return (
      <div>
        <PageHeader title="Amigos" />
        <Card>
          <EmptyState
            emoji="🤝"
            title="Préstamos entre amigos"
            text="Inicia sesión y agrega a tus amigos: cuando le prestes a alguien, le aparecerá en su app cuánto te debe, con recordatorio y un botón para avisar que ya te pagó."
            action={
              status === 'loading' ? (
                <LoaderCircle className="size-6 animate-spin text-muted" />
              ) : (
                <Link to="/cuenta">
                  <Button icon={<LogIn className="size-5" />}>Iniciar sesión</Button>
                </Link>
              )
            }
          />
        </Card>
      </div>
    )

  const incoming = social.friends.filter((f) => f.status === 'incoming')
  const outgoing = social.friends.filter((f) => f.status === 'outgoing')
  const accepted = social.friends.filter((f) => f.status === 'accepted')
  const toConfirm = social.rows.filter((r) => r.status === 'payment_reported' && r.lender === me)
  const name = (id: string) => social.profiles[id]?.display_name ?? 'Tu amigo'

  return (
    <div>
      <PageHeader title="Amigos" subtitle={profile ? `Tú eres @${profile.username}` : undefined} />
      <div className="grid grid-cols-1 gap-4">
        <Card>
          <p className="text-sm font-bold">Agregar amigo</p>
          <p className="text-xs text-muted">Pídele su usuario o mándale tu link.</p>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void add()
            }}
          >
            <Input
              placeholder="@usuario"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_.@]/g, ''))}
              autoCapitalize="none"
              className="min-w-0 flex-1"
            />
            <Button
              type="submit"
              disabled={adding || !username.trim()}
              icon={adding ? <LoaderCircle className="size-5 animate-spin" /> : <UserPlus className="size-5" />}
            >
              Agregar
            </Button>
          </form>
          {profile && (
            <div className="mt-3 flex gap-2">
              <Button variant="secondary" size="sm" icon={<Share2 className="size-4" />} onClick={() => void share()}>
                Compartir mi link
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={<Copy className="size-4" />}
                onClick={() =>
                  void navigator.clipboard
                    ?.writeText(`@${profile.username}`)
                    .then(() => toast({ message: 'Usuario copiado', tone: 'good' }))
                }
              >
                @{profile.username}
              </Button>
            </div>
          )}
        </Card>

        {toConfirm.length > 0 && (
          <Card>
            <SectionHeader title="Por confirmar" />
            <ul className="divide-y divide-line">
              {toConfirm.map((r) => (
                <li key={r.id} className="py-3">
                  <p className="text-sm">
                    <b>{name(r.borrower)}</b> dice que ya te pagó <b>{fmt(Number(r.amount))}</b>
                    {r.description ? ` (${r.description})` : ''}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void run(() => transitionSharedLoan(r.id, 'deny_paid'), 'Le avisamos que aún no te llega')}
                    >
                      Todavía no
                    </Button>
                    <Button
                      size="sm"
                      icon={<Check className="size-4" />}
                      onClick={() => void run(() => transitionSharedLoan(r.id, 'confirm_paid'), '✅ Préstamo pagado')}
                    >
                      Sí, me pagó
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {incoming.length > 0 && (
          <Card>
            <SectionHeader title="Solicitudes" />
            <ul className="divide-y divide-line">
              {incoming.map((f) => (
                <li key={f.friendshipId} className="flex items-center gap-3 py-2.5">
                  <ProfileAvatar name={f.profile.display_name} avatar={f.profile.avatar} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{f.profile.display_name}</p>
                    <p className="truncate text-xs text-muted">@{f.profile.username} quiere agregarte</p>
                  </div>
                  <IconButton label="Rechazar" onClick={() => void run(() => removeFriend(f.friendshipId))}>
                    <X className="size-4" />
                  </IconButton>
                  <Button
                    size="sm"
                    onClick={() => void run(() => acceptFriend(f.friendshipId), `🤝 ${f.profile.display_name} ahora es tu amigo`)}
                  >
                    Aceptar
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card>
          <SectionHeader title={`Mis amigos${accepted.length ? ` (${accepted.length})` : ''}`} />
          {!social.loaded && social.loading ? (
            <div className="flex justify-center py-6">
              <LoaderCircle className="size-6 animate-spin text-muted" />
            </div>
          ) : accepted.length === 0 ? (
            <p className="py-3 text-sm text-muted">Aún no tienes amigos agregados. ¡Invita a alguien con tu link!</p>
          ) : (
            <ul className="divide-y divide-line">
              {accepted.map((f) => (
                <FriendRow key={f.friendshipId} f={f} balance={balances.get(f.profile.id) ?? 0} />
              ))}
            </ul>
          )}
          {outgoing.length > 0 && (
            <div className="mt-3 border-t border-line pt-3">
              <p className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Esperando respuesta</p>
              {outgoing.map((f) => (
                <div key={f.friendshipId} className="flex items-center gap-3 py-1.5">
                  <ProfileAvatar name={f.profile.display_name} avatar={f.profile.avatar} size={32} />
                  <p className="min-w-0 flex-1 truncate text-sm">
                    {f.profile.display_name} <span className="text-muted">@{f.profile.username}</span>
                  </p>
                  <Button size="sm" variant="ghost" onClick={() => void run(() => removeFriend(f.friendshipId))}>
                    Cancelar
                  </Button>
                </div>
              ))}
            </div>
          )}
          {social.error && <p className="mt-2 text-xs text-bad">{social.error}</p>}
        </Card>
      </div>
    </div>
  )
}
