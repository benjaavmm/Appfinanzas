import { useRef, useState, type ReactNode } from 'react'
import { Download, FileSpreadsheet, Lock, Monitor, Moon, RotateCcw, Smartphone, Sparkles, Sun, Trash, Upload } from 'lucide-react'
import { exportCSV, exportJSON, hashPin, parseBackup } from '../lib/backup'
import { buildDemoData } from '../lib/demo'
import { CURRENCIES } from '../lib/format'
import { fmtDate, toDateStr } from '../lib/dates'
import { useData } from '../lib/hooks'
import { forceUpdate, isIOS, promptInstall, usePwa } from '../lib/pwa'
import { useStore } from '../lib/store'
import { ask, toast } from '../lib/ui'
import type { ThemePref } from '../lib/types'
import { PinPad } from '../components/PinPad'
import { Button, Card, Field, Input, PageHeader, Segmented, Select, Toggle } from '../components/ui'
import { Sheet } from '../components/ui/Sheet'

const Row = ({ title, text, children }: { title: string; text?: ReactNode; children: ReactNode }) => (
  <div className="flex items-center gap-3 py-3">
    <div className="min-w-0 flex-1">
      <p className="text-sm font-semibold">{title}</p>
      {text && <p className="text-xs text-muted">{text}</p>}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
)

export default function Settings() {
  const data = useData()
  const { settings } = data
  const update = useStore((s) => s.updateSettings)
  const importData = useStore((s) => s.importData)
  const resetAll = useStore((s) => s.resetAll)
  const installEvent = usePwa((s) => s.installEvent)
  const installed = usePwa((s) => s.installed)
  const fileRef = useRef<HTMLInputElement>(null)
  const [pinStep, setPinStep] = useState<null | 'new' | 'confirm'>(null)
  const [firstPin, setFirstPin] = useState('')

  const onImport = async (file: File) => {
    try {
      const parsed = parseBackup(await file.text())
      const ok = await ask({
        title: '¿Restaurar este respaldo?',
        message: `Tiene ${parsed.transactions.length} movimientos y ${parsed.accounts.length} cuentas. Reemplazará todos los datos actuales.`,
        confirmLabel: 'Restaurar',
        danger: true,
      })
      if (!ok) return
      importData({ ...parsed, settings: { ...parsed.settings, pinHash: settings.pinHash } })
      toast({ message: 'Respaldo restaurado' })
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'bad' })
    }
  }

  return (
    <div>
      <PageHeader title="Ajustes" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-bold">Perfil</h2>
          <div className="space-y-4">
            <Field label="Tu nombre">
              <Input
                value={settings.userName}
                onChange={(e) => update({ userName: e.target.value })}
                placeholder="¿Cómo te llamas?"
              />
            </Field>
            <Field label="Moneda">
              <Select
                value={settings.currency}
                onChange={(e) => {
                  const c = CURRENCIES.find((x) => x.code === e.target.value)
                  if (c) update({ currency: c.code, locale: c.locale })
                }}
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Cuenta por defecto para gastos">
              <Select
                value={settings.defaultAccountId ?? ''}
                onChange={(e) => update({ defaultAccountId: e.target.value || undefined })}
              >
                {data.accounts
                  .filter((a) => !a.archived)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.icon} {a.name}
                    </option>
                  ))}
              </Select>
            </Field>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 font-bold">Apariencia y privacidad</h2>
          <Field label="Tema">
            <Segmented<ThemePref>
              value={settings.theme}
              onChange={(theme) => update({ theme })}
              options={[
                {
                  value: 'system',
                  label: (
                    <span className="flex items-center gap-1.5">
                      <Monitor className="size-4" /> Auto
                    </span>
                  ),
                },
                {
                  value: 'light',
                  label: (
                    <span className="flex items-center gap-1.5">
                      <Sun className="size-4" /> Claro
                    </span>
                  ),
                },
                {
                  value: 'dark',
                  label: (
                    <span className="flex items-center gap-1.5">
                      <Moon className="size-4" /> Oscuro
                    </span>
                  ),
                },
              ]}
            />
          </Field>
          <div className="mt-2 divide-y divide-line">
            <Row title="Ocultar montos" text="Útil si alguien mira tu pantalla. También con el ojo del inicio.">
              <Toggle checked={settings.hideAmounts} onChange={(v) => update({ hideAmounts: v })} label="Ocultar montos" />
            </Row>
            <Row
              title="Bloqueo con PIN"
              text={settings.pinHash ? 'Activado: se pedirá al abrir la app.' : 'Pide un PIN de 4 dígitos al abrir la app.'}
            >
              {settings.pinHash ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    if (await ask({ title: '¿Quitar el PIN?', confirmLabel: 'Quitar' })) {
                      update({ pinHash: undefined })
                      toast({ message: 'PIN desactivado' })
                    }
                  }}
                >
                  Quitar
                </Button>
              ) : (
                <Button size="sm" variant="soft" icon={<Lock className="size-4" />} onClick={() => setPinStep('new')}>
                  Activar
                </Button>
              )}
            </Row>
          </div>
        </Card>

        <Card>
          <h2 className="mb-1 font-bold">Tus datos</h2>
          <p className="mb-3 text-xs text-muted">
            Todo se guarda solo en este dispositivo (nada se sube a internet). Descarga un respaldo de vez en cuando, sobre todo
            antes de cambiar de teléfono.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              variant="secondary"
              icon={<Download className="size-4" />}
              onClick={() => {
                exportJSON(data)
                toast({ message: 'Respaldo descargado' })
              }}
            >
              Descargar respaldo
            </Button>
            <Button variant="secondary" icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()}>
              Restaurar respaldo
            </Button>
            <Button
              variant="secondary"
              icon={<FileSpreadsheet className="size-4" />}
              onClick={() => exportCSV(data)}
              className="sm:col-span-2"
            >
              Exportar movimientos a Excel (CSV)
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onImport(f)
              e.target.value = ''
            }}
          />
        </Card>

        <Card>
          <h2 className="mb-1 font-bold">Instalar en tu teléfono</h2>
          {installed ? (
            <p className="text-sm text-good">✓ La app ya está instalada.</p>
          ) : installEvent ? (
            <>
              <p className="mb-3 text-xs text-muted">Se abre como una app normal, a pantalla completa y funciona sin internet.</p>
              <Button icon={<Smartphone className="size-4" />} onClick={() => void promptInstall()}>
                Instalar app
              </Button>
            </>
          ) : (
            <p className="text-sm text-ink-2">
              {isIOS() ? (
                <>
                  En iPhone: abre esta página en <b>Safari</b>, toca <b>Compartir</b> (el cuadrado con flecha) y luego{' '}
                  <b>“Agregar a inicio”</b>.
                </>
              ) : (
                <>
                  En Android: abre el menú <b>⋮</b> de Chrome y toca <b>“Instalar app”</b> o{' '}
                  <b>“Agregar a la pantalla principal”</b>.
                </>
              )}{' '}
              Funciona sin internet.
            </p>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="mb-3 font-bold">Zona de pruebas</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              variant="soft"
              icon={<Sparkles className="size-4" />}
              onClick={async () => {
                if (
                  !(await ask({
                    title: '¿Cargar datos de ejemplo?',
                    message:
                      'Reemplaza tus datos actuales por 4 meses de movimientos de ejemplo. Descarga un respaldo antes si quieres conservarlos.',
                    confirmLabel: 'Cargar ejemplo',
                    danger: true,
                  }))
                )
                  return
                const demo = buildDemoData(settings.userName)
                importData({ ...demo, settings: { ...demo.settings, theme: settings.theme, pinHash: settings.pinHash } })
                toast({ message: 'Datos de ejemplo cargados' })
              }}
            >
              Cargar datos de ejemplo
            </Button>
            <Button
              variant="danger"
              icon={<Trash className="size-4" />}
              onClick={async () => {
                if (
                  !(await ask({
                    title: '¿Borrar todos tus datos?',
                    message: 'Esto no se puede deshacer. Se borrarán cuentas, movimientos, préstamos, suscripciones y metas.',
                    confirmLabel: 'Borrar todo',
                    danger: true,
                  }))
                )
                  return
                resetAll()
                toast({ message: 'Datos borrados' })
              }}
            >
              Borrar todos los datos
            </Button>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <p className="text-[11px] text-muted">
              Versión {__APP_BUILD__.sha} · publicada el {fmtDate(toDateStr(new Date(__APP_BUILD__.time)), "d 'de' MMM")} a las{' '}
              {new Date(__APP_BUILD__.time).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
              <br />
              {data.transactions.length} movimientos guardados en este dispositivo
            </p>
            <Button
              size="sm"
              variant="secondary"
              icon={<RotateCcw className="size-4" />}
              onClick={() => {
                toast({ message: 'Buscando la última versión…', tone: 'info' })
                void forceUpdate()
              }}
            >
              Actualizar app
            </Button>
          </div>
        </Card>
      </div>

      <Sheet open={pinStep !== null} onClose={() => setPinStep(null)} title="Configurar PIN">
        <div className="py-4">
          {pinStep === 'new' && (
            <PinPad
              key="new"
              title="Elige un PIN de 4 dígitos"
              subtitle="Si lo olvidas tendrás que borrar los datos de la app."
              onComplete={(p) => {
                setFirstPin(p)
                setPinStep('confirm')
              }}
            />
          )}
          {pinStep === 'confirm' && (
            <PinPad
              key="confirm"
              title="Repite tu PIN"
              onComplete={(p) => {
                if (p !== firstPin) return false
                update({ pinHash: hashPin(p) })
                setPinStep(null)
                toast({ message: '🔒 PIN activado' })
              }}
            />
          )}
        </div>
      </Sheet>
    </div>
  )
}
