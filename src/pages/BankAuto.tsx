import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  ArrowDown,
  ChevronDown,
  CircleCheck,
  ClipboardPaste,
  Copy,
  KeyRound,
  LoaderCircle,
  LogIn,
  RefreshCw,
  Send,
  ShieldCheck,
  Zap,
} from 'lucide-react'
import { appUrl, cloudConfigured } from '../lib/cloud/client'
import { useAuth } from '../lib/cloud/auth'
import { checkInbox, getInboxKey, inboxEndpoint, rotateInboxKey, sendTestToInbox, useInbox } from '../lib/cloud/inbox'
import { vibrate } from '../lib/hooks'
import { ask, openSheet, toast } from '../lib/ui'
import { Button, Card, PageHeader, SectionHeader, cx } from '../components/ui'

const copy = (text: string, done: string) => {
  const fail = () => toast({ message: 'No se pudo copiar. Mantén presionado el texto para copiarlo.', tone: 'bad' })
  if (!navigator.clipboard) return fail()
  navigator.clipboard.writeText(text).then(() => {
    vibrate(10)
    toast({ message: done, tone: 'good' })
  }, fail)
}

/** Texto para poner en el cuerpo del aviso: lo reemplazas por el de la notificación */
const PLACEHOLDER = 'AQUÍ_EL_TEXTO'

const SOURCES: Record<string, string> = { android: 'Android', iphone: 'iPhone', prueba: 'Prueba', correo: 'Correo' }
const sourceLabel = (s?: string | null) => (s ? (SOURCES[s.toLowerCase()] ?? s) : 'Aviso')

/* ───────────── Piezas ───────────── */

const Code = ({ children }: { children: ReactNode }) => (
  <code className="rounded-md bg-surface-3 px-1 py-0.5 font-mono text-[12px] break-all text-ink">{children}</code>
)

const CopyField = ({
  label,
  value,
  done,
  hint,
  clamp,
}: {
  label: string
  value: string
  done: string
  hint?: ReactNode
  /** Valores muy largos: se muestran en 2 líneas (se copia completo) */
  clamp?: boolean
}) => (
  <div className="min-w-0">
    <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">{label}</p>
    <div className="flex items-start gap-2 rounded-2xl border border-line bg-surface-2 p-3">
      <code className={cx('min-w-0 flex-1 font-mono text-[13px] break-all select-all', clamp && 'line-clamp-2')}>{value}</code>
      <Button size="sm" variant="secondary" icon={<Copy className="size-4" />} onClick={() => copy(value, done)}>
        Copiar
      </Button>
    </div>
    {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
  </div>
)

const OptionTitle = ({ n, title, tag, icon }: { n: number; title: string; tag?: string; icon: ReactNode }) => (
  <div className="flex items-center gap-3">
    <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand">{icon}</span>
    <div className="min-w-0 flex-1">
      <p className="text-xs font-semibold tracking-wide text-muted uppercase">Opción {n}</p>
      <h2 className="text-[17px] font-bold tracking-tight">{title}</h2>
    </div>
    {tag && <span className="shrink-0 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-bold text-ink-2">{tag}</span>}
  </div>
)

const Steps = ({ items }: { items: ReactNode[] }) => (
  <ol className="space-y-3">
    {items.map((item, i) => (
      <li key={i} className="flex gap-3">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand">
          {i + 1}
        </span>
        <div className="min-w-0 flex-1 space-y-1.5 text-sm text-ink-2">{item}</div>
      </li>
    ))}
  </ol>
)

/** Guía desplegable (sin animaciones de opacidad) */
const Guide = ({ emoji, title, subtitle, children }: { emoji: string; title: string; subtitle: string; children: ReactNode }) => (
  <details className="group rounded-2xl border border-line">
    <summary className="flex cursor-pointer list-none items-center gap-3 p-3 [&::-webkit-details-marker]:hidden">
      <span className="text-2xl" aria-hidden>
        {emoji}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-bold">{title}</span>
        <span className="block text-xs text-muted">{subtitle}</span>
      </span>
      <ChevronDown className="size-5 shrink-0 text-muted transition-transform group-open:rotate-180" />
    </summary>
    <div className="space-y-4 border-t border-line p-3">{children}</div>
  </details>
)

const Tip = ({ children }: { children: ReactNode }) => (
  <p className="rounded-2xl bg-surface-2 p-3 text-xs text-ink-2">{children}</p>
)

/* ───────────── Modo automático (con sesión) ───────────── */

const PendingList = () => {
  const { pending, loaded, error } = useInbox()
  const [refreshing, setRefreshing] = useState(false)
  const refresh = async () => {
    setRefreshing(true)
    await checkInbox()
    setRefreshing(false)
  }
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-bold">Por revisar{pending.length ? ` (${pending.length})` : ''}</p>
        <Button
          size="sm"
          variant="ghost"
          icon={<RefreshCw className={cx('size-4', refreshing && 'animate-spin')} />}
          disabled={refreshing}
          onClick={() => void refresh()}
        >
          Revisar buzón
        </Button>
      </div>
      {!loaded && !error ? (
        <div className="flex justify-center py-4">
          <LoaderCircle className="size-5 animate-spin text-muted" />
        </div>
      ) : pending.length === 0 ? (
        <p className="rounded-2xl bg-surface-2 p-3 text-sm text-muted">
          No hay avisos pendientes. Cuando llegue uno, te avisamos al abrir la app.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-line rounded-2xl bg-surface-2 px-3">
            {pending.slice(0, 4).map((p) => (
              <li key={p.id} className="py-2.5">
                <p className="line-clamp-2 text-sm break-words">{p.body}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {sourceLabel(p.source)} · {formatDistanceToNow(new Date(p.receivedAt), { addSuffix: true, locale: es })}
                </p>
              </li>
            ))}
          </ul>
          {pending.length > 4 && <p className="mt-1 text-xs text-muted">y {pending.length - 4} más…</p>}
          <Button block className="mt-3" onClick={() => openSheet({ kind: 'bank', inbox: pending })}>
            Revisar {pending.length === 1 ? 'el movimiento' : `${pending.length} movimientos`}
          </Button>
        </>
      )}
      {error && <p className="mt-2 text-xs text-bad">{error}</p>}
    </div>
  )
}

const AutoSetup = () => {
  const userId = useAuth((s) => s.userId)
  const [key, setKey] = useState<string | null>(null)
  const [keyError, setKeyError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [tested, setTested] = useState<string | null>(null)
  const [rotating, setRotating] = useState(false)
  const [tries, setTries] = useState(0)
  const { url, anonKey } = inboxEndpoint()

  useEffect(() => {
    let alive = true
    setKey(null)
    setKeyError(null)
    getInboxKey()
      .then((k) => alive && setKey(k))
      .catch((e: Error) => alive && setKeyError(e.message))
    void checkInbox()
    return () => {
      alive = false
    }
  }, [userId, tries])

  const test = async () => {
    setTesting(true)
    setTested(null)
    try {
      const res = await sendTestToInbox()
      vibrate(15)
      setTested(
        res === 'duplicate'
          ? 'Ese mismo aviso había llegado recién, así que no se repitió. Igual funciona ✅'
          : '¡Funciona! El aviso de prueba llegó a tu buzón ✅',
      )
      await checkInbox()
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'bad' })
    } finally {
      setTesting(false)
    }
  }

  const rotate = async () => {
    const ok = await ask({
      title: '¿Generar una clave nueva?',
      message:
        'La clave actual deja de funcionar al tiro: tendrás que pegar la nueva en MacroDroid o Atajos. Hazlo si crees que alguien más la tiene.',
      confirmLabel: 'Generar nueva',
      danger: true,
    })
    if (!ok) return
    setRotating(true)
    try {
      setKey(await rotateInboxKey())
      setTested(null)
      toast({ message: '🔑 Clave nueva lista. Actualízala en tu teléfono.', tone: 'good' })
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'bad' })
    } finally {
      setRotating(false)
    }
  }

  if (keyError)
    return (
      <div className="mt-4 rounded-2xl bg-bad-soft p-3 text-sm text-bad">
        <p>{keyError}</p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => setTries((n) => n + 1)}>
          Reintentar
        </Button>
      </div>
    )
  if (!key)
    return (
      <div className="flex justify-center py-8">
        <LoaderCircle className="size-6 animate-spin text-muted" />
      </div>
    )

  const bodyJson = JSON.stringify({ key, body: PLACEHOLDER, source: 'android' })
  const openLink = `${appUrl()}#/?accion=revisar-banco`

  return (
    <div className="mt-4 space-y-4">
      <PendingList />

      <div className="space-y-3 border-t border-line pt-4">
        <p className="text-sm font-bold">Tus datos para la automatización</p>
        <CopyField label="Dirección (URL)" value={url} done="Dirección copiada" />
        <CopyField
          label="Clave pública (apikey)"
          value={anonKey}
          done="Clave pública copiada"
          clamp
          hint="Es la misma de la app para todos: por sí sola no da acceso a tus datos."
        />
        <CopyField
          label="Tu clave personal"
          value={key}
          done="Clave personal copiada"
          hint="Con ella los avisos llegan a tu cuenta. No la compartas."
        />
        <CopyField
          label="Cuerpo (JSON)"
          value={bodyJson}
          done="Cuerpo copiado"
          hint={
            <>
              Para MacroDroid: cambia <Code>{PLACEHOLDER}</Code> por el texto de la notificación (ver la guía).
            </>
          }
        />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          block
          icon={testing ? <LoaderCircle className="size-5 animate-spin" /> : <Send className="size-5" />}
          disabled={testing}
          onClick={() => void test()}
        >
          Enviar aviso de prueba
        </Button>
        <Button
          block
          variant="secondary"
          icon={rotating ? <LoaderCircle className="size-5 animate-spin" /> : <KeyRound className="size-5" />}
          disabled={rotating}
          onClick={() => void rotate()}
        >
          Generar clave nueva
        </Button>
      </div>
      {tested && (
        <p className="flex items-start gap-2 rounded-2xl bg-good-soft p-3 text-sm text-good">
          <CircleCheck className="mt-0.5 size-4 shrink-0" />
          {tested}
        </p>
      )}

      <div className="space-y-2 border-t border-line pt-4">
        <p className="text-sm font-bold">Paso a paso</p>
        <Guide emoji="🤖" title="Android con MacroDroid" subtitle="Gratis · lee las notificaciones del banco">
          <Steps
            items={[
              <>
                <p>
                  Instala <b>MacroDroid</b> desde Google Play y toca <b>Agregar macro</b>.
                </p>
              </>,
              <>
                <p>
                  <b>Disparador:</b> Notificación → <b>Notificación recibida</b> → elige las apps de tu banco (puedes marcar
                  varias).
                </p>
                <p>
                  En el texto de la notificación elige <b>Contiene</b> y escribe <Code>$</Code>: así solo se mandan avisos con
                  montos, nunca tus claves dinámicas.
                </p>
                <p className="text-xs text-muted">
                  MacroDroid te pedirá permiso para leer notificaciones: acéptalo. Elige solo las apps del banco, así no se manda
                  nada más.
                </p>
              </>,
              <>
                <p>
                  <b>Acción:</b> Conectividad → <b>Solicitud HTTP</b> (si no la ves, búscala con la lupa). Configúrala así:
                </p>
                <ul className="list-disc space-y-1 pl-4">
                  <li>
                    Método: <Code>POST</Code>
                  </li>
                  <li>URL: la Dirección de arriba.</li>
                  <li>
                    Encabezados: <Code>apikey</Code> con la clave pública, y <Code>Content-Type</Code> con{' '}
                    <Code>application/json</Code>.
                  </li>
                  <li>
                    Cuerpo: pega el JSON de arriba y, con el botón de <b>texto mágico</b>, cambia <Code>{PLACEHOLDER}</Code> por
                    el título y el texto de la notificación.
                  </li>
                </ul>
              </>,
              <>
                <p>
                  <b>Guarda</b> la macro con un nombre, por ejemplo “Mis Finanzas”. ¡Listo!
                </p>
              </>,
            ]}
          />
          <Tip>
            <b>Opcional:</b> agrega otra acción de MacroDroid que muestre una notificación tuya y que al tocarla abra{' '}
            <Code>{openLink}</Code>. Así vas directo a revisar el movimiento.
          </Tip>
          <Tip>
            ¿No llega nada? Revisa que la macro esté activada y que el ahorro de batería no esté pausando a MacroDroid. Si el
            texto de la notificación trae comillas (") puede romper el JSON: prueba dejando solo el texto de la notificación.
          </Tip>
        </Guide>

        <Guide emoji="🍎" title="iPhone con Atajos" subtitle="Gratis · lee correos y SMS del banco">
          <p className="rounded-2xl bg-warn-soft p-3 text-xs text-ink-2">
            Ojo: el iPhone no deja que ninguna app lea las notificaciones de otras apps. Lo que sí se puede es reaccionar a los{' '}
            <b>correos</b> (en la app Mail) o <b>SMS</b> que te manda el banco.
          </p>
          <Steps
            items={[
              <>
                <p>
                  Abre <b>Atajos</b> → <b>Automatización</b> → <b>Nueva automatización</b> → <b>Correo</b> (elige el remitente del
                  banco) o <b>Mensaje</b> (el número o nombre del banco).
                </p>
                <p>
                  En <b>Mensaje contiene</b> escribe <Code>$</Code>, así solo se mandan avisos con montos.
                </p>
                <p className="text-xs text-muted">
                  Marca <b>Ejecutar de inmediato</b> para que no te pregunte cada vez.
                </p>
              </>,
              <>
                <p>
                  Agrega la acción <b>Obtener contenido de URL</b> con la Dirección de arriba y, en “Mostrar más”:
                </p>
                <ul className="list-disc space-y-1 pl-4">
                  <li>
                    Método: <Code>POST</Code>
                  </li>
                  <li>
                    Encabezados: <Code>apikey</Code> con la clave pública.
                  </li>
                  <li>
                    Cuerpo de la solicitud: <b>JSON</b>, con tres campos de texto: <Code>key</Code> con tu clave personal,{' '}
                    <Code>body</Code> con el contenido del correo o mensaje (elige la variable de la entrada del atajo) y{' '}
                    <Code>source</Code> con <Code>iphone</Code>.
                  </li>
                </ul>
              </>,
              <>
                <p>
                  Toca <b>Listo</b>. Cuando llegue el correo o SMS, el aviso entra solo a tu buzón.
                </p>
              </>,
            ]}
          />
          <Tip>
            <b>¿Pagas con Apple Pay?</b> Atajos también tiene la automatización <b>Transacción</b> (Wallet), que se activa al
            pagar con tu tarjeta: usa la misma acción y en <Code>body</Code> pon el comercio y el monto.
          </Tip>
        </Guide>
      </div>
    </div>
  )
}

/* ───────────── Página ───────────── */

/** Configurar el modo automático (notificaciones del banco → app) */
export default function BankAuto() {
  const status = useAuth((s) => s.status)

  return (
    <div>
      <PageHeader title="Movimientos automáticos" />
      <div className="grid grid-cols-1 gap-4">
        <Card>
          <p className="text-[15px] font-semibold">
            Cuando te llega una notificación o un correo del banco, la app puede leerlo y proponerte el movimiento.
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
              <span className="text-base">👀</span>
              <span className="min-w-0 flex-1">Ojito: llegó 1 movimiento de tu banco. ¿Lo agregamos?</span>
            </div>
          </div>
        </Card>

        <Card>
          <OptionTitle n={1} title="Pegar o compartir" tag="Sin configurar" icon={<ClipboardPaste className="size-5" />} />
          <ul className="mt-3 space-y-2 text-sm text-ink-2">
            <li className="flex gap-2">
              <span aria-hidden>📋</span>
              <span>En cualquier teléfono: copia el texto de la notificación, el SMS o el correo del banco y pégalo aquí.</span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden>📤</span>
              <span>
                En Android: abre el correo o el mensaje y toca <b>Compartir → Mis Finanzas</b> (con la app instalada en tu
                pantalla de inicio).
              </span>
            </li>
          </ul>
          <Button block className="mt-4" icon={<ClipboardPaste className="size-5" />} onClick={() => openSheet({ kind: 'bank' })}>
            Pegar un aviso del banco
          </Button>
        </Card>

        <Card>
          <OptionTitle n={2} title="Automático" tag="Una vez y listo" icon={<Zap className="size-5" />} />
          <p className="mt-3 text-sm text-ink-2">
            Una app gratis de tu teléfono manda cada aviso del banco a tu buzón y, al abrir Mis Finanzas, te preguntamos si lo
            agregamos.
          </p>
          {!cloudConfigured ? (
            <p className="mt-3 rounded-2xl bg-surface-2 p-3 text-sm text-muted">
              Necesita la cuenta en la nube, que todavía no está activada en esta versión de la app.
            </p>
          ) : status === 'loading' ? (
            <div className="flex justify-center py-8">
              <LoaderCircle className="size-6 animate-spin text-muted" />
            </div>
          ) : status !== 'signedIn' ? (
            <div className="mt-4 rounded-2xl bg-surface-2 p-4 text-center">
              <p className="text-sm text-ink-2">
                Inicia sesión para tener tu buzón: así los avisos llegan a tu cuenta y a ningún otro lado.
              </p>
              <Link to="/cuenta" className="mt-3 inline-block">
                <Button icon={<LogIn className="size-5" />}>Iniciar sesión</Button>
              </Link>
            </div>
          ) : (
            <AutoSetup />
          )}
        </Card>

        <Card>
          <SectionHeader title="Tu privacidad" />
          <div className="flex gap-3 text-sm text-ink-2">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-good" />
            <div className="space-y-2">
              <p>Solo tú ves tus avisos. Apenas los agregas o descartas, se borran.</p>
              <p>Nunca guardamos tus claves ni códigos del banco.</p>
              <p>No compartas tu clave personal. Si crees que alguien la tiene, genera una nueva.</p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
