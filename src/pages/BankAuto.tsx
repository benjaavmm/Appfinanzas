import { useState } from 'react'
import { Link } from 'react-router'
import { ArrowDown, ClipboardPaste, Copy, ExternalLink, LoaderCircle, LogIn, Lock, Mail } from 'lucide-react'
import { cloudConfigured } from '../lib/cloud/client'
import { useAuth } from '../lib/cloud/auth'
import { getInboxKey, inboxEndpoint, rotateInboxKey } from '../lib/cloud/inbox'
import { gmailScript } from '../features/bank/gmailScript'
import { ask, openSheet, toast } from '../lib/ui'
import { Button, Card, PageHeader } from '../components/ui'

const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Automático con Gmail: copiar el programa y pegarlo en script.google.com */
const GmailSetup = () => {
  const status = useAuth((s) => s.status)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  if (!cloudConfigured) return null
  if (status === 'loading')
    return (
      <div className="flex justify-center py-6">
        <LoaderCircle className="size-6 animate-spin text-muted" />
      </div>
    )
  if (status !== 'signedIn')
    return (
      <div className="mt-3 rounded-2xl bg-surface-2 p-4 text-center">
        <p className="text-sm text-ink-2">Inicia sesión para activarlo: así los avisos llegan a tu cuenta.</p>
        <Link to="/cuenta" className="mt-3 inline-block">
          <Button icon={<LogIn className="size-5" />}>Iniciar sesión</Button>
        </Link>
      </div>
    )

  const copyProgram = async (fresh = false) => {
    setBusy(true)
    try {
      const key = fresh ? await rotateInboxKey() : await getInboxKey()
      const { url, anonKey } = inboxEndpoint()
      if (await copyText(gmailScript({ url, apikey: anonKey, key }))) {
        setCopied(true)
        toast({ message: fresh ? 'Clave nueva: vuelve a pegar el programa' : 'Programa copiado', tone: 'good' })
      } else toast({ message: 'No se pudo copiar. Intenta desde el computador.', tone: 'bad' })
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'bad' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 space-y-3">
      <ol className="space-y-2.5 text-sm text-ink-2">
        <li className="flex gap-2.5">
          <b className="text-brand">1.</b>
          <span>
            Toca <b>Copiar mi programa</b> (mejor desde el computador).
          </span>
        </li>
        <li className="flex gap-2.5">
          <b className="text-brand">2.</b>
          <span>
            Abre <b>script.google.com</b> con tu cuenta de Gmail, borra lo que aparece y pega el programa.
          </span>
        </li>
        <li className="flex gap-2.5">
          <b className="text-brand">3.</b>
          <span>
            Guarda (ícono 💾), deja elegido <b>activar</b> arriba y toca <b>Ejecutar</b>.
          </span>
        </li>
        <li className="flex gap-2.5">
          <b className="text-brand">4.</b>
          <span>
            Acepta los permisos. Si Google dice “no verificada”, toca <b>Configuración avanzada → Ir a…</b>: es tu propio programa
            y solo tú lo ves.
          </span>
        </li>
      </ol>
      <div className="grid grid-cols-2 gap-2">
        <Button
          icon={busy ? <LoaderCircle className="size-5 animate-spin" /> : <Copy className="size-5" />}
          onClick={() => void copyProgram()}
          disabled={busy}
        >
          {copied ? 'Copiado ✓' : 'Copiar mi programa'}
        </Button>
        <a href="https://script.google.com/home/projects/create" target="_blank" rel="noopener noreferrer">
          <Button block variant="secondary" icon={<ExternalLink className="size-5" />}>
            Abrir Google
          </Button>
        </a>
      </div>
      <p className="text-xs text-muted">
        Listo: cada 10 minutos revisa tus correos del banco y, al abrir la app, te pregunta si los agregas.{' '}
        <button
          type="button"
          className="font-semibold underline"
          onClick={async () => {
            if (
              await ask({
                title: '¿Generar una clave nueva?',
                message: 'El programa anterior deja de funcionar y tienes que pegar el nuevo.',
                confirmLabel: 'Generar',
              })
            )
              void copyProgram(true)
          }}
        >
          Clave nueva
        </button>
      </p>
    </div>
  )
}

/** Avisos del banco: pegar o compartir una notificación, SMS o correo y agregarlo como movimiento */
export default function BankAuto() {
  return (
    <div>
      <PageHeader title="Avisos del banco" />
      <div className="grid grid-cols-1 gap-4">
        <Card>
          <p className="text-[15px] font-semibold">
            Copia una notificación, SMS o correo de tu banco y la app la convierte en un movimiento.
          </p>
          <p className="mt-1 text-sm text-muted">Tú lo revisas y confirmas: nada se agrega sin que lo veas.</p>
          <div className="mt-4 space-y-1.5" aria-hidden>
            <div className="flex items-center gap-2 rounded-2xl bg-surface-2 p-3 text-xs">
              <span className="text-base">🏦</span>
              <span className="min-w-0 flex-1 truncate">
                <b>Tu banco</b> · Compra por $4.990 en STARBUCKS
              </span>
            </div>
            <ArrowDown className="mx-auto size-4 text-muted" />
            <div className="flex items-center gap-2 rounded-2xl bg-brand-soft p-3 text-xs font-semibold text-brand">
              <span className="text-base">☕</span>
              <span className="min-w-0 flex-1">Gasto de $4.990 en Starbucks · Comida y delivery</span>
            </div>
          </div>
        </Card>

        <Card>
          <ul className="space-y-2 text-sm text-ink-2">
            <li className="flex gap-2">
              <span aria-hidden>📋</span>
              <span>Copia el texto del aviso y pégalo aquí.</span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden>📤</span>
              <span>
                En Android también puedes abrir el correo o el mensaje y tocar <b>Compartir → Mis Finanzas</b> (con la app
                instalada).
              </span>
            </li>
          </ul>
          <Button block className="mt-4" icon={<ClipboardPaste className="size-5" />} onClick={() => openSheet({ kind: 'bank' })}>
            Pegar un aviso del banco
          </Button>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted">
            <Lock className="size-3.5" /> Se lee en tu teléfono: el texto no se envía a ningún lado.
          </p>
        </Card>

        {cloudConfigured && (
          <Card>
            <div className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand">
                <Mail className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="font-bold">Automático con Gmail</p>
                <p className="text-xs text-muted">Los correos de tu banco llegan solos · 2 minutos, una vez</p>
              </div>
            </div>
            <GmailSetup />
          </Card>
        )}
      </div>
    </div>
  )
}
