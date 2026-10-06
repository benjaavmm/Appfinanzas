import { useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft, LoaderCircle, Lock, Mail, MailCheck } from 'lucide-react'
import { hashPin } from '../lib/backup'
import { useStore } from '../lib/store'
import { ask, toast } from '../lib/ui'
import { cloudConfigured } from '../lib/cloud/client'
import { sendMagicLink, signOut, useAuth, verifyPassword } from '../lib/cloud/auth'
import { syncedUserId } from '../lib/cloud/sync'
import { AuthForm } from '../features/account/AuthForm'
import { PinPad } from '../components/PinPad'
import { Button, Input } from '../components/ui'

/** Quita el PIN olvidado después de comprobar que eres el dueño de la cuenta */
const removePin = (onUnlock: () => void) => {
  useStore.getState().updateSettings({ pinHash: undefined })
  onUnlock()
  toast({ message: '🔓 PIN quitado. Puedes poner uno nuevo en Ajustes.', tone: 'good' })
}

const ForgotPin = ({ onBack, onUnlock }: { onBack: () => void; onUnlock: () => void }) => {
  const { status, email, userId, fromEmailLink } = useAuth()
  const resetAll = useStore((s) => s.resetAll)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [linkSent, setLinkSent] = useState(false)
  const owner = syncedUserId()
  // Solo la cuenta con la que se respalda este dispositivo puede quitar el PIN
  const sameAccount = !!userId && userId === owner

  const confirmPassword = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await verifyPassword(password)
      removePin(onUnlock)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const sendLink = async () => {
    if (!email) return
    setBusy(true)
    setError(null)
    try {
      await sendMagicLink(email)
      setLinkSent(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const eraseAll = async () => {
    const ok = await ask({
      title: '¿Borrar todo en este dispositivo?',
      message: owner
        ? 'Se borran los datos de este teléfono. Si después inicias sesión con tu cuenta, tu respaldo de la nube vuelve.'
        : 'Se borran todos los datos de la app en este dispositivo. Si tienes un respaldo en archivo, podrás restaurarlo después.',
      confirmLabel: 'Borrar y empezar de nuevo',
      danger: true,
    })
    if (!ok) return
    resetAll()
    onUnlock()
  }

  return (
    <div className="w-full max-w-sm">
      <button onClick={onBack} className="mb-4 flex items-center gap-1 text-sm font-semibold text-muted">
        <ArrowLeft className="size-4" /> Volver al PIN
      </button>
      <h1 className="text-2xl font-extrabold">¿Olvidaste tu PIN?</h1>

      {cloudConfigured && status === 'loading' && (
        <div className="flex justify-center py-10">
          <LoaderCircle className="size-7 animate-spin text-muted" />
        </div>
      )}

      {/* Volvió con el link del correo */}
      {sameAccount && fromEmailLink && (
        <div className="mt-4 rounded-2xl bg-good-soft p-4 text-good">
          <p className="text-sm font-semibold">Entraste con el link de tu correo ✅</p>
          <Button block className="mt-3" onClick={() => removePin(onUnlock)}>
            Quitar PIN y entrar
          </Button>
        </div>
      )}

      {/* Con sesión iniciada: confirmar la contraseña o pedir un link */}
      {sameAccount && !fromEmailLink && (
        <>
          <p className="mt-1 text-sm text-ink-2">
            Confirma que eres tú con la contraseña de tu cuenta <b>{email}</b> y quitamos el PIN. Tus datos no se borran.
          </p>
          <form onSubmit={(e) => void confirmPassword(e)} className="mt-4 space-y-3">
            <Input
              type="password"
              placeholder="Contraseña de tu cuenta"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
            />
            <Button type="submit" block size="lg" disabled={busy || !password} icon={<Lock className="size-5" />}>
              {busy ? <LoaderCircle className="size-5 animate-spin" /> : 'Quitar PIN'}
            </Button>
          </form>
          {linkSent ? (
            <p className="mt-3 flex gap-2 rounded-2xl bg-info-soft px-3 py-2.5 text-xs font-medium text-info">
              <MailCheck className="size-4 shrink-0" /> Te enviamos un link a {email}. Ábrelo en este teléfono y podrás quitar el
              PIN.
            </p>
          ) : (
            <Button
              variant="ghost"
              block
              className="mt-2"
              icon={<Mail className="size-5" />}
              disabled={busy}
              onClick={() => void sendLink()}
            >
              No recuerdo la contraseña: enviarme un link
            </Button>
          )}
        </>
      )}

      {/* Sesión cerrada, pero este dispositivo se respaldaba con una cuenta */}
      {cloudConfigured && status === 'signedOut' && owner && (
        <>
          <p className="mt-1 mb-4 text-sm text-ink-2">
            Inicia sesión con la cuenta con la que respaldas esta app y quitamos el PIN sin borrar nada.
          </p>
          <AuthForm
            onSignedIn={() => {
              const id = useAuth.getState().userId
              if (id && id !== owner) {
                void signOut()
                setError('Esa no es la cuenta de este dispositivo.')
              } else if (id) removePin(onUnlock)
            }}
          />
        </>
      )}

      {/* Con sesión, pero de otra cuenta (o sin respaldo): solo queda borrar */}
      {status === 'signedIn' && !sameAccount && (
        <p className="mt-2 text-sm text-ink-2">
          Este dispositivo no está respaldado con tu cuenta, así que no podemos comprobar que eres tú.
        </p>
      )}

      {error && <p className="mt-3 rounded-2xl bg-bad-soft px-3 py-2.5 text-sm font-medium text-bad">{error}</p>}

      <div className="mt-8 border-t border-line pt-4">
        <p className="text-xs text-muted">
          {owner ? 'Si nada de esto funciona:' : 'Como esta app no está respaldada con una cuenta, la única forma de entrar es:'}
        </p>
        <Button variant="danger" block className="mt-2" onClick={() => void eraseAll()}>
          Borrar los datos de este dispositivo
        </Button>
      </div>
    </div>
  )
}

export default function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const pinHash = useStore((s) => s.settings.pinHash)
  const name = useStore((s) => s.settings.userName)
  const fromEmailLink = useAuth((s) => s.fromEmailLink)
  const [forgot, setForgot] = useState(fromEmailLink)
  // Al volver con el link del correo se muestra directo la opción de quitar el PIN
  useEffect(() => {
    if (fromEmailLink) setForgot(true)
  }, [fromEmailLink])
  return (
    <div className="pt-safe pb-safe flex min-h-dvh flex-col items-center justify-center bg-bg px-6 py-8">
      {forgot ? (
        <ForgotPin onBack={() => setForgot(false)} onUnlock={onUnlock} />
      ) : (
        <>
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="mb-6 size-16 rounded-[22px]" />
          <PinPad
            title={name ? `Hola, ${name}` : 'Mis Finanzas'}
            subtitle="Ingresa tu PIN"
            onComplete={(p) => {
              if (hashPin(p) !== pinHash) return false
              onUnlock()
            }}
          />
          <button className="mt-8 text-sm font-semibold text-muted" onClick={() => setForgot(true)}>
            ¿Olvidaste tu PIN?
          </button>
        </>
      )}
    </div>
  )
}
