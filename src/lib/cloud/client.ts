/**
 * Conexión a Supabase (opcional). Sin VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY la app
 * funciona igual que siempre, solo en el dispositivo. La librería se carga recién cuando
 * se usa, para no hacer más pesada la app.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const cloudConfigured = Boolean(url && key)
export const googleEnabled = cloudConfigured && import.meta.env.VITE_SUPABASE_GOOGLE === '1'

/** Adonde vuelven los links de confirmación y de recuperar contraseña */
export const appUrl = () => `${window.location.origin}${import.meta.env.BASE_URL}`

let client: Promise<SupabaseClient> | null = null

export const supabase = (): Promise<SupabaseClient> => {
  if (!cloudConfigured) return Promise.reject(new Error('La cuenta en la nube no está configurada'))
  client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url!, key!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    }),
  )
  return client
}

/** Traduce los errores más comunes de Supabase a mensajes claros */
export const cloudError = (e: unknown): string => {
  const msg = (e as { message?: string })?.message ?? String(e)
  const m = msg.toLowerCase()
  if (m.includes('invalid login credentials')) return 'Correo o contraseña incorrectos.'
  if (m.includes('email not confirmed')) return 'Primero confirma tu correo: te enviamos un link.'
  if (m.includes('already registered') || m.includes('already been registered'))
    return 'Ya existe una cuenta con ese correo. Inicia sesión.'
  if (m.includes('password should be') || m.includes('weak password')) return 'La contraseña debe tener al menos 8 caracteres.'
  if (m.includes('rate limit') || m.includes('too many')) return 'Demasiados intentos. Espera un minuto y vuelve a intentar.'
  if (m.includes('invalid email') || m.includes('unable to validate email')) return 'Ese correo no parece válido.'
  if (m.includes('failed to fetch') || m.includes('network')) return 'Sin conexión. Revisa tu internet.'
  if (m.includes('not_found')) return 'No encontramos a esa persona.'
  if (m.includes('invalid_transition')) return 'Ese cambio ya no es posible (puede que el otro ya lo haya actualizado).'
  if (m.includes('row-level security')) return 'Solo puedes registrar préstamos con amigos que te aceptaron.'
  if (m.includes('self_request')) return 'No puedes agregarte a ti mismo 🙂'
  return msg
}
