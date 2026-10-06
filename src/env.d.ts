/** Versión publicada: commit y fecha de compilación (definido en vite.config.ts) */
declare const __APP_BUILD__: { sha: string; time: string }

interface ImportMetaEnv {
  /** Proyecto de Supabase (Settings → API). Sin estas variables la app funciona sin cuenta. */
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** "1" para mostrar "Continuar con Google" (requiere activar Google en Supabase) */
  readonly VITE_SUPABASE_GOOGLE?: string
  readonly VITE_NO_SW?: string
}
