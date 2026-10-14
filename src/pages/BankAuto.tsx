import { ArrowDown, ClipboardPaste, Lock } from 'lucide-react'
import { openSheet } from '../lib/ui'
import { Button, Card, PageHeader } from '../components/ui'

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
      </div>
    </div>
  )
}
