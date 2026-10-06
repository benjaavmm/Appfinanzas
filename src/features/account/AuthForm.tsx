/** Formulario de inicio de sesión / registro (sirve en el onboarding y en Mi cuenta) */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { AtSign, CircleAlert, CircleCheck, Eye, EyeOff, LoaderCircle, Lock, Mail, MailCheck, User } from 'lucide-react'
import { googleEnabled } from '../../lib/cloud/client'
import {
  sendMagicLink,
  sendPasswordReset,
  signIn,
  signInWithGoogle,
  signUp,
  takeAuthNotice,
  updatePassword,
  USERNAME_RE,
  usernameAvailable,
} from '../../lib/cloud/auth'
import { vibrate } from '../../lib/hooks'
import { toast } from '../../lib/ui'
import { Button, cx, Segmented } from '../../components/ui'

type Mode = 'login' | 'signup' | 'forgot' | 'magic' | 'sent'

const IconInput = ({
  icon,
  right,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { icon: ReactNode; right?: ReactNode }) => (
  <div className={cx('relative', className)}>
    <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted [&>svg]:size-5">{icon}</span>
    <input
      className="h-13 w-full rounded-2xl border border-line bg-surface-2 pr-12 pl-12 text-[15px] text-ink outline-none transition placeholder:text-muted focus:border-brand focus:bg-surface focus:ring-4 focus:ring-brand-soft"
      {...props}
    />
    {right && <span className="absolute top-1/2 right-2 -translate-y-1/2">{right}</span>}
  </div>
)

const PasswordInput = (props: React.InputHTMLAttributes<HTMLInputElement>) => {
  const [show, setShow] = useState(false)
  return (
    <IconInput
      icon={<Lock />}
      type={show ? 'text' : 'password'}
      right={
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="flex size-9 items-center justify-center rounded-xl text-muted hover:bg-surface-3"
          aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        >
          {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
        </button>
      }
      {...props}
    />
  )
}

const strength = (p: string) => {
  let s = 0
  if (p.length >= 8) s++
  if (p.length >= 12) s++
  if (/\d/.test(p) && /[a-zA-Z]/.test(p)) s++
  if (/[^a-zA-Z0-9]/.test(p) || /[A-Z]/.test(p)) s++
  return s
}
const STRENGTH = ['Muy débil', 'Débil', 'Aceptable', 'Buena', 'Excelente']
const STRENGTH_CLS = ['bg-bad', 'bg-bad', 'bg-warn', 'bg-good', 'bg-good']

const GoogleIcon = () => (
  <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
    <path
      fill="#FFC107"
      d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
    />
    <path
      fill="#FF3D00"
      d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
    />
    <path
      fill="#4CAF50"
      d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"
    />
    <path
      fill="#1976D2"
      d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
    />
  </svg>
)

export const AuthForm = ({
  initialMode = 'login',
  onSignedIn,
}: {
  initialMode?: 'login' | 'signup'
  onSignedIn?: () => void
}) => {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [userState, setUserState] = useState<'idle' | 'checking' | 'free' | 'taken' | 'invalid'>('idle')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(() => takeAuthNotice())
  const [sentText, setSentText] = useState('')

  useEffect(() => setError(null), [mode])

  // Disponibilidad del nombre de usuario mientras se escribe
  useEffect(() => {
    if (mode !== 'signup' || !username) return setUserState('idle')
    if (!USERNAME_RE.test(username)) return setUserState('invalid')
    setUserState('checking')
    let alive = true
    const t = window.setTimeout(() => {
      usernameAvailable(username)
        .then((ok) => alive && setUserState(ok ? 'free' : 'taken'))
        .catch(() => alive && setUserState('idle'))
    }, 450)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [username, mode])

  const emailOk = /^\S+@\S+\.\S+$/.test(email.trim())
  const pwScore = strength(password)
  const canSubmit =
    !busy &&
    (mode === 'login'
      ? emailOk && password.length > 0
      : mode === 'signup'
        ? emailOk && password.length >= 8 && name.trim().length > 0 && USERNAME_RE.test(username) && userState !== 'taken'
        : emailOk)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      if (mode === 'login') {
        await signIn(email, password)
        vibrate(20)
        toast({ message: '¡Hola de nuevo! 👋', tone: 'good' })
        onSignedIn?.()
      } else if (mode === 'signup') {
        const needsConfirm = await signUp({ email, password, username, displayName: name })
        vibrate(20)
        if (needsConfirm) {
          setSentText(`Te enviamos un link a ${email.trim()} para confirmar tu cuenta. Ábrelo en este mismo teléfono.`)
          setMode('sent')
        } else {
          toast({ message: '🎉 Cuenta creada', tone: 'good' })
          onSignedIn?.()
        }
      } else if (mode === 'forgot') {
        await sendPasswordReset(email)
        setSentText(`Si ${email.trim()} tiene una cuenta, te llegará un link para crear una contraseña nueva.`)
        setMode('sent')
      } else if (mode === 'magic') {
        await sendMagicLink(email)
        setSentText(`Te enviamos un link a ${email.trim()}. Ábrelo en este teléfono y entrarás sin contraseña.`)
        setMode('sent')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (mode === 'sent')
    return (
      <div className="py-4 text-center">
        <span className="mx-auto flex size-16 items-center justify-center rounded-3xl bg-good-soft text-good">
          <MailCheck className="size-8" />
        </span>
        <h2 className="mt-4 text-xl font-extrabold">Revisa tu correo</h2>
        <p className="mx-auto mt-2 max-w-xs text-sm text-ink-2">{sentText}</p>
        <p className="mt-2 text-xs text-muted">¿No llega? Mira en spam o promociones.</p>
        <Button variant="secondary" className="mt-6" onClick={() => setMode('login')}>
          Volver a iniciar sesión
        </Button>
      </div>
    )

  const title = {
    login: 'Inicia sesión',
    signup: 'Crea tu cuenta',
    forgot: 'Recupera tu contraseña',
    magic: 'Entra sin contraseña',
  }[mode]

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3" noValidate>
      {(mode === 'login' || mode === 'signup') && (
        <Segmented
          value={mode}
          onChange={(m) => setMode(m)}
          options={[
            { value: 'login', label: 'Iniciar sesión' },
            { value: 'signup', label: 'Crear cuenta' },
          ]}
        />
      )}
      {(mode === 'forgot' || mode === 'magic') && (
        <div className="pb-1">
          <h2 className="text-xl font-extrabold">{title}</h2>
          <p className="text-sm text-ink-2">
            {mode === 'forgot'
              ? 'Escribe tu correo y te enviaremos un link para crear una nueva.'
              : 'Te enviamos un link a tu correo para entrar al tiro.'}
          </p>
        </div>
      )}

      {mode === 'signup' && (
        <>
          <IconInput
            icon={<User />}
            placeholder="Tu nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            maxLength={40}
          />
          <div>
            <IconInput
              icon={<AtSign />}
              placeholder="usuario (para que tus amigos te encuentren)"
              value={username}
              onChange={(e) =>
                setUsername(
                  e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9_.]/g, '')
                    .slice(0, 20),
                )
              }
              autoComplete="username"
              autoCapitalize="none"
              right={
                userState === 'checking' ? (
                  <LoaderCircle className="mr-2 size-5 animate-spin text-muted" />
                ) : userState === 'free' ? (
                  <CircleCheck className="mr-2 size-5 text-good" />
                ) : userState === 'taken' || userState === 'invalid' ? (
                  <CircleAlert className="mr-2 size-5 text-bad" />
                ) : undefined
              }
            />
            {userState !== 'idle' && userState !== 'checking' && (
              <p className={cx('mt-1 pl-2 text-xs', userState === 'free' ? 'text-good' : 'text-bad')}>
                {userState === 'free'
                  ? `@${username} está disponible`
                  : userState === 'taken'
                    ? `@${username} ya está ocupado`
                    : 'De 3 a 20 letras, números, punto o guion bajo'}
              </p>
            )}
          </div>
        </>
      )}

      <IconInput
        icon={<Mail />}
        type="email"
        inputMode="email"
        placeholder="tu@correo.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
        autoCapitalize="none"
      />

      {(mode === 'login' || mode === 'signup') && (
        <div>
          <PasswordInput
            placeholder={mode === 'signup' ? 'Contraseña (mínimo 8)' : 'Contraseña'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          />
          {mode === 'signup' && password && (
            <div className="mt-2 flex items-center gap-2 px-1">
              <div className="flex flex-1 gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={cx('h-1.5 flex-1 rounded-full', i < pwScore ? STRENGTH_CLS[pwScore] : 'bg-surface-3')}
                  />
                ))}
              </div>
              <span className="w-20 text-right text-[11px] font-semibold text-muted">{STRENGTH[pwScore]}</span>
            </div>
          )}
          {mode === 'login' && (
            <div className="mt-1 text-right">
              <button type="button" className="px-1 py-1 text-xs font-semibold text-brand" onClick={() => setMode('forgot')}>
                ¿Olvidaste tu contraseña?
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="flex gap-2 rounded-2xl bg-bad-soft px-3 py-2.5 text-sm font-medium text-bad">
          <CircleAlert className="mt-0.5 size-4 shrink-0" /> {error}
        </p>
      )}

      <Button type="submit" block size="lg" disabled={!canSubmit}>
        {busy ? (
          <LoaderCircle className="size-5 animate-spin" />
        ) : mode === 'login' ? (
          'Entrar'
        ) : mode === 'signup' ? (
          'Crear cuenta'
        ) : (
          'Enviar link'
        )}
      </Button>

      {(mode === 'login' || mode === 'signup') && (
        <>
          <div className="flex items-center gap-3 py-1 text-xs text-muted">
            <span className="h-px flex-1 bg-line" /> o <span className="h-px flex-1 bg-line" />
          </div>
          {googleEnabled && (
            <Button
              type="button"
              variant="secondary"
              block
              icon={<GoogleIcon />}
              onClick={() => void signInWithGoogle().catch((e: Error) => setError(e.message))}
            >
              Continuar con Google
            </Button>
          )}
          <Button type="button" variant="ghost" block icon={<Mail className="size-5" />} onClick={() => setMode('magic')}>
            Entrar con un link al correo
          </Button>
        </>
      )}
      {(mode === 'forgot' || mode === 'magic') && (
        <Button type="button" variant="ghost" block onClick={() => setMode('login')}>
          Volver
        </Button>
      )}
    </form>
  )
}

/** Pedir la contraseña nueva al volver del correo de recuperación */
export const NewPasswordForm = () => {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (password.length < 8) return setError('La contraseña debe tener al menos 8 caracteres.')
    setBusy(true)
    try {
      await updatePassword(password)
      toast({ message: '🔐 Contraseña actualizada', tone: 'good' })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3">
      <h2 className="text-xl font-extrabold">Crea tu nueva contraseña</h2>
      <PasswordInput
        placeholder="Nueva contraseña (mínimo 8)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
        autoFocus
      />
      {error && <p className="rounded-2xl bg-bad-soft px-3 py-2.5 text-sm font-medium text-bad">{error}</p>}
      <Button type="submit" block size="lg" disabled={busy}>
        {busy ? <LoaderCircle className="size-5 animate-spin" /> : 'Guardar contraseña'}
      </Button>
    </form>
  )
}
