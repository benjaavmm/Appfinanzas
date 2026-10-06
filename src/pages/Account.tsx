import { useState } from 'react'
import { Link } from 'react-router'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  ChevronRight,
  CloudCheck,
  CloudOff,
  HandCoins,
  LoaderCircle,
  LogOut,
  MonitorSmartphone,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { cloudConfigured } from '../lib/cloud/client'
import { signOut, updateProfile, USERNAME_RE, useAuth } from '../lib/cloud/auth'
import { syncNow, useSync } from '../lib/cloud/sync'
import { ask, toast } from '../lib/ui'
import { AuthForm, NewPasswordForm } from '../features/account/AuthForm'
import { Avatar } from '../components/forms/LoanForms'
import { Button, Card, Field, Input, PageHeader } from '../components/ui'

const BENEFITS = [
  [ShieldCheck, 'Respaldo automático', 'Si pierdes o cambias el teléfono, tus datos siguen ahí.'],
  [MonitorSmartphone, 'En todos tus dispositivos', 'Usa la app en el celular y en el computador con lo mismo.'],
  [
    HandCoins,
    'Préstamos con amigos',
    'Lo que le prestas a un amigo le aparece en su app, con recordatorio y botón de “ya pagué”.',
  ],
] as const

export const ProfileAvatar = ({ name, avatar, size = 56 }: { name: string; avatar?: string | null; size?: number }) =>
  avatar ? (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-soft"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
      aria-hidden
    >
      {avatar}
    </span>
  ) : (
    <Avatar name={name} size={size} />
  )

const AVATARS = ['😎', '🦊', '🐼', '🐯', '🦁', '🐸', '🐙', '🦄', '🚀', '⚡', '🌵', '🍕']

const ProfileEditor = ({ onDone }: { onDone: () => void }) => {
  const profile = useAuth((s) => s.profile)!
  const [name, setName] = useState(profile.display_name)
  const [username, setUsername] = useState(profile.username)
  const [avatar, setAvatar] = useState(profile.avatar ?? '')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      await updateProfile({ display_name: name.trim(), username, avatar: avatar || null })
      toast({ message: 'Perfil actualizado', tone: 'good' })
      onDone()
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'bad' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-4 space-y-4 border-t border-line pt-4">
      <Field label="Foto">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setAvatar('')}
            className={`rounded-full p-0.5 ${!avatar ? 'ring-2 ring-brand' : ''}`}
            aria-label="Usar iniciales"
          >
            <Avatar name={name || '?'} size={40} />
          </button>
          {AVATARS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAvatar(a)}
              className={`flex size-11 items-center justify-center rounded-full bg-surface-2 text-xl ${avatar === a ? 'ring-2 ring-brand' : ''}`}
            >
              {a}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Nombre">
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
      </Field>
      <Field label="Usuario" hint="Así te encuentran tus amigos">
        <Input
          value={username}
          onChange={(e) =>
            setUsername(
              e.target.value
                .toLowerCase()
                .replace(/[^a-z0-9_.]/g, '')
                .slice(0, 20),
            )
          }
          autoCapitalize="none"
        />
      </Field>
      <div className="flex gap-2">
        <Button variant="secondary" block onClick={onDone}>
          Cancelar
        </Button>
        <Button block disabled={busy || !name.trim() || !USERNAME_RE.test(username)} onClick={() => void save()}>
          Guardar
        </Button>
      </div>
    </div>
  )
}

const SyncCard = () => {
  const sync = useSync()
  const when = sync.lastSync ? formatDistanceToNow(new Date(sync.lastSync), { addSuffix: true, locale: es }) : null
  return (
    <Card>
      <div className="flex items-center gap-3">
        <span
          className={`flex size-11 shrink-0 items-center justify-center rounded-2xl ${sync.state === 'error' ? 'bg-bad-soft text-bad' : 'bg-good-soft text-good'}`}
        >
          {sync.state === 'syncing' ? (
            <LoaderCircle className="size-5 animate-spin" />
          ) : sync.state === 'error' ? (
            <CloudOff className="size-5" />
          ) : (
            <CloudCheck className="size-5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold">
            {sync.state === 'syncing'
              ? 'Sincronizando…'
              : sync.state === 'error'
                ? 'No se pudo sincronizar'
                : 'Respaldo en la nube'}
          </p>
          <p className="text-xs text-muted">
            {sync.state === 'error' ? sync.error : when ? `Última vez ${when}` : 'Se guarda solo cada vez que cambias algo'}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={<RefreshCw className="size-4" />}
          disabled={sync.state === 'syncing'}
          onClick={() => void syncNow()}
        >
          Ahora
        </Button>
      </div>
      <p className="mt-3 text-[11px] text-muted">Las fotos de boletas y el PIN quedan solo en este dispositivo.</p>
    </Card>
  )
}

export default function Account() {
  const { status, profile, email, recovering } = useAuth()
  const [editing, setEditing] = useState(false)

  const logout = async () => {
    const ok = await ask({
      title: '¿Cerrar sesión?',
      message: 'Tus datos se quedan en este dispositivo. Para seguir respaldando, vuelve a entrar cuando quieras.',
      confirmLabel: 'Cerrar sesión',
    })
    if (!ok) return
    await signOut()
    toast({ message: 'Sesión cerrada' })
  }

  return (
    <div>
      <PageHeader title="Mi cuenta" />
      {!cloudConfigured ? (
        <Card>
          <CloudOff className="size-8 text-muted" />
          <h2 className="mt-3 font-bold">La cuenta en la nube aún no está activada</h2>
          <p className="mt-1 text-sm text-ink-2">
            Esta versión de la app funciona solo en tu dispositivo. Cuando se conecte Supabase (ver README), aquí podrás crear tu
            cuenta, respaldar y agregar amigos.
          </p>
        </Card>
      ) : status === 'loading' ? (
        <div className="flex justify-center py-20">
          <LoaderCircle className="size-8 animate-spin text-muted" />
        </div>
      ) : status === 'signedOut' ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="relative overflow-hidden rounded-[28px] bg-[linear-gradient(135deg,#6655f5,#c2508f)] p-6 text-white">
            <div className="pointer-events-none absolute -top-16 -right-16 size-48 rounded-full bg-white/15" />
            <div className="pointer-events-none absolute -bottom-20 -left-10 size-40 rounded-full bg-white/10" />
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="relative size-14 rounded-2xl shadow-lg" />
            <h2 className="relative mt-4 text-2xl leading-tight font-extrabold">Tu cuenta de Mis Finanzas</h2>
            <ul className="relative mt-4 space-y-3">
              {BENEFITS.map(([Icon, t, d]) => (
                <li key={t} className="flex gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/20">
                    <Icon className="size-5" />
                  </span>
                  <span>
                    <span className="block text-sm font-bold">{t}</span>
                    <span className="block text-xs text-white/80">{d}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <Card>
            <AuthForm />
          </Card>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {recovering && (
            <Card>
              <NewPasswordForm />
            </Card>
          )}
          <Card>
            <div className="flex items-center gap-4">
              <ProfileAvatar name={profile?.display_name ?? email ?? '?'} avatar={profile?.avatar} size={64} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xl font-extrabold">{profile?.display_name ?? '…'}</p>
                {profile && <p className="truncate text-sm font-semibold text-brand">@{profile.username}</p>}
                <p className="truncate text-xs text-muted">{email}</p>
              </div>
              {profile && !editing && (
                <Button variant="secondary" size="sm" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                  Editar
                </Button>
              )}
            </div>
            {editing && profile && <ProfileEditor onDone={() => setEditing(false)} />}
          </Card>
          <SyncCard />
          <Link
            to="/amigos"
            className="flex items-center gap-3 rounded-3xl border border-line bg-surface p-4 shadow-card transition active:scale-[0.99]"
          >
            <span className="flex size-11 items-center justify-center rounded-2xl bg-brand-soft text-brand">
              <Users className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold">Amigos</span>
              <span className="block text-xs text-muted">Agrega amigos y compártanse préstamos</span>
            </span>
            <ChevronRight className="size-5 text-muted" />
          </Link>
          <Button variant="danger" block icon={<LogOut className="size-5" />} onClick={() => void logout()}>
            Cerrar sesión
          </Button>
        </div>
      )}
    </div>
  )
}
