/** Sesión de la cuenta en la nube (Supabase Auth): estado global + acciones */
import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { appUrl, cloudConfigured, cloudError, supabase } from './client'
import type { Profile } from './reconcile'

export type AuthStatus = 'off' | 'loading' | 'signedOut' | 'signedIn'

interface AuthState {
  status: AuthStatus
  userId: string | null
  email: string | null
  profile: Profile | null
  /** Volvió desde el correo de "recuperar contraseña": hay que pedir la nueva */
  recovering: boolean
  /** Entró recién con un link del correo (sirve para quitar el PIN olvidado) */
  fromEmailLink: boolean
}

export const useAuth = create<AuthState>()(() => ({
  status: cloudConfigured ? 'loading' : 'off',
  userId: null,
  email: null,
  profile: null,
  recovering: false,
  fromEmailLink: false,
}))

type Listener = (userId: string | null) => void
const listeners = new Set<Listener>()
/** Avisa cuando cambia el usuario (para sincronizar y cargar amigos) */
export const onUserChange = (fn: Listener) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const loadProfile = async (id: string) => {
  const sb = await supabase()
  const { data } = await sb.from('profiles').select('id, username, display_name, avatar').eq('id', id).maybeSingle()
  if (useAuth.getState().userId === id) useAuth.setState({ profile: (data as Profile | null) ?? null })
}

const applySession = (session: Session | null) => {
  const prev = useAuth.getState().userId
  const userId = session?.user.id ?? null
  useAuth.setState({
    status: userId ? 'signedIn' : 'signedOut',
    userId,
    email: session?.user.email ?? null,
    ...(userId ? {} : { profile: null, recovering: false }),
  })
  if (userId && userId !== prev) void loadProfile(userId)
  if (userId !== prev) listeners.forEach((fn) => fn(userId))
}

/** ¿Vale la pena cargar Supabase al abrir? Solo si hay sesión guardada o se vuelve de un link del correo */
const hasAuthHint = () => {
  try {
    const q = new URLSearchParams(window.location.search)
    if (q.has('code') || q.has('error_description')) return true
    return Object.keys(localStorage).some((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
  } catch {
    return true
  }
}

let started: Promise<void> | null = null

/** Conecta con Supabase (una sola vez). Si no hay sesión guardada, no descarga nada hasta que se use. */
export const initAuth = (force = false): Promise<void> => {
  if (!cloudConfigured) return Promise.resolve()
  if (!started && !force && !hasAuthHint()) {
    useAuth.setState({ status: 'signedOut' })
    return Promise.resolve()
  }
  started ??= (async () => {
    try {
      const sb = await supabase()
      sb.auth.onAuthStateChange((event, session) => {
        // Supabase pide no esperar otras llamadas dentro de este callback
        setTimeout(() => {
          applySession(session)
          if (event === 'PASSWORD_RECOVERY') {
            useAuth.setState({ recovering: true })
            if (!window.location.hash.startsWith('#/cuenta')) window.location.hash = '#/cuenta'
          }
        }, 0)
      })
      const cameFromLink = new URLSearchParams(window.location.search).has('code')
      const { data } = await sb.auth.getSession()
      applySession(data.session)
      if (cameFromLink && data.session) useAuth.setState({ fromEmailLink: true })
      const err = new URLSearchParams(window.location.search).get('error_description')
      if (err) {
        const url = new URL(window.location.href)
        ;['error', 'error_code', 'error_description'].forEach((k) => url.searchParams.delete(k))
        window.history.replaceState(window.history.state, '', url.toString())
        authNotice = /expired|invalid/i.test(err)
          ? 'El link del correo expiró o ya se usó. Pide uno nuevo o entra con tu contraseña.'
          : err
      }
    } catch {
      started = null
      useAuth.setState({ status: 'signedOut' })
    }
  })()
  return started
}

/** Mensaje pendiente de mostrar en la pantalla de cuenta (p. ej. link vencido) */
export let authNotice: string | null = null
export const takeAuthNotice = () => {
  const n = authNotice
  authNotice = null
  return n
}

const run = async <R extends { data: unknown; error: unknown }>(
  fn: (sb: Awaited<ReturnType<typeof supabase>>) => PromiseLike<R>,
): Promise<NonNullable<R['data']>> => {
  await initAuth(true)
  const sb = await supabase()
  const { data, error } = await fn(sb)
  if (error) throw new Error(cloudError(error))
  return data as NonNullable<R['data']>
}

export const signIn = (email: string, password: string) =>
  run((sb) => sb.auth.signInWithPassword({ email: email.trim(), password }))

/** Devuelve true si hay que confirmar el correo antes de entrar */
export const signUp = async (p: { email: string; password: string; username: string; displayName: string }) => {
  const data = await run((sb) =>
    sb.auth.signUp({
      email: p.email.trim(),
      password: p.password,
      options: {
        emailRedirectTo: appUrl(),
        data: { username: p.username.toLowerCase(), display_name: p.displayName.trim() },
      },
    }),
  )
  // Si el correo ya existe, Supabase responde sin error pero sin identidades
  if (data.user && data.user.identities?.length === 0) throw new Error('Ya existe una cuenta con ese correo. Inicia sesión.')
  return !data.session
}

/** Confirmar que eres tú con la contraseña de la cuenta (para quitar un PIN olvidado) */
export const verifyPassword = async (password: string) => {
  const email = useAuth.getState().email
  if (!email) throw new Error('No hay una cuenta iniciada en este dispositivo.')
  await signIn(email, password)
}

export const sendMagicLink = (email: string) =>
  run((sb) => sb.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: appUrl(), shouldCreateUser: false } }))

export const sendPasswordReset = (email: string) =>
  run((sb) => sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl() }))

export const updatePassword = async (password: string) => {
  await run((sb) => sb.auth.updateUser({ password }))
  useAuth.setState({ recovering: false })
}

export const signInWithGoogle = () =>
  run((sb) => sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: appUrl() } }))

export const signOut = async () => {
  const sb = await supabase()
  await sb.auth.signOut({ scope: 'local' })
  applySession(null)
}

export const usernameAvailable = async (u: string): Promise<boolean> => {
  const sb = await supabase()
  const { data, error } = await sb.rpc('username_available', { u })
  if (error) throw new Error(cloudError(error))
  return Boolean(data)
}

export const updateProfile = async (patch: Partial<Pick<Profile, 'username' | 'display_name' | 'avatar'>>) => {
  const { userId } = useAuth.getState()
  if (!userId) return
  const data = await run((sb) =>
    sb.from('profiles').update(patch).eq('id', userId).select('id, username, display_name, avatar').single(),
  ).catch((e: Error) => {
    throw new Error(/duplicate|unique/i.test(e.message) ? 'Ese nombre de usuario ya está ocupado.' : e.message)
  })
  useAuth.setState({ profile: data as Profile })
}

/** Espera a que la sesión quede activa (después de entrar) */
export const whenSignedIn = (ms = 8000) =>
  new Promise<boolean>((resolve) => {
    if (useAuth.getState().userId) return resolve(true)
    const t = window.setTimeout(() => {
      unsub()
      resolve(false)
    }, ms)
    const unsub = useAuth.subscribe((s) => {
      if (!s.userId) return
      window.clearTimeout(t)
      unsub()
      resolve(true)
    })
  })

export const USERNAME_RE = /^[a-z0-9_.]{3,20}$/
