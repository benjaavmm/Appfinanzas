/** Garantías: lo que compraste con garantía, cuánto le queda y la boleta a mano */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowLeft, Camera, ReceiptText, ShieldCheck } from 'lucide-react'
import { Button, Card, cx, EmptyState, IconButton, PageHeader, ProgressBar } from '../components/ui'
import { fmtDate } from '../lib/dates'
import { useData, useMoney, useToday } from '../lib/hooks'
import { openSheet } from '../lib/ui'
import { warranties, warrantyLeftText, type Warranty } from '../lib/warranty'
import { ReceiptViewer } from '../features/receipts/ReceiptViewer'
import { useReceiptUrl } from '../features/receipts/useReceiptUrl'

const Thumb = ({ id }: { id?: string }) => {
  const state = useReceiptUrl(id)
  return (
    <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-2 text-muted">
      {state.status === 'ready' ? (
        <img src={state.url} alt="" className="size-full object-cover" />
      ) : (
        <ShieldCheck className="size-5" />
      )}
    </span>
  )
}

const Row = ({ w, onReceipt }: { w: Warranty; onReceipt: (id: string) => void }) => {
  const fmt = useMoney()
  const urgent = w.daysLeft <= 14
  return (
    <li className="py-3">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => openSheet({ kind: 'tx', id: w.tx.id })} className="contents text-left">
          <Thumb id={w.tx.receiptId} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{w.tx.place || w.tx.note || 'Compra'}</span>
            <span className={cx('block text-xs', urgent && w.daysLeft >= 0 ? 'font-semibold text-warn' : 'text-muted')}>
              {fmt(w.tx.amount)} · {warrantyLeftText(w.daysLeft)} ({fmtDate(w.end, 'd MMM yyyy')})
            </span>
          </span>
        </button>
        {w.tx.receiptId ? (
          <Button
            size="sm"
            variant="secondary"
            icon={<ReceiptText className="size-4" />}
            onClick={() => onReceipt(w.tx.receiptId!)}
          >
            Boleta
          </Button>
        ) : (
          <span className="text-[11px] text-muted">Sin boleta</span>
        )}
      </div>
      {w.daysLeft >= 0 && (
        <ProgressBar ratio={w.elapsed} className="mt-2" height={6} color={urgent ? 'var(--warn)' : 'var(--good)'} />
      )}
    </li>
  )
}

export default function Warranties() {
  const navigate = useNavigate()
  const { transactions } = useData()
  const today = useToday()
  const { active, expired } = useMemo(() => warranties(transactions, today), [transactions, today])
  const [receipt, setReceipt] = useState<string | null>(null)

  return (
    <div>
      <PageHeader
        title="Garantías"
        subtitle={active.length ? `${active.length} vigentes` : 'Tus compras con garantía'}
        back={
          <IconButton label="Volver" onClick={() => navigate(-1)}>
            <ArrowLeft className="size-5" />
          </IconButton>
        }
      />
      <div className="space-y-4 pb-6">
        <Card>
          <p className="text-sm text-ink-2">
            🛡️ En Chile, todo producto nuevo tiene <b>6 meses de garantía legal</b>: si falla, puedes pedir cambio, reparación o
            devolución de la plata. Algunas tiendas dan más. Te aviso 2 semanas antes de que venza y tienes la boleta a mano.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button size="sm" icon={<Camera className="size-4" />} onClick={() => openSheet({ kind: 'scan' })}>
              Escanear boleta
            </Button>
            <Button size="sm" variant="secondary" onClick={() => openSheet({ kind: 'tx', type: 'expense' })}>
              Anotar compra
            </Button>
          </div>
        </Card>

        {active.length ? (
          <Card>
            <p className="text-xs font-semibold tracking-wide text-muted uppercase">Vigentes</p>
            <ul className="divide-y divide-line">
              {active.map((w) => (
                <Row key={w.tx.id} w={w} onReceipt={setReceipt} />
              ))}
            </ul>
          </Card>
        ) : (
          <Card>
            <EmptyState
              emoji="🛡️"
              title="Sin garantías anotadas"
              text='Cuando anotes una compra (un hervidor, un celular, zapatillas), elige "Garantía" y te aviso antes de que venza.'
            />
          </Card>
        )}

        {expired.length > 0 && (
          <Card>
            <p className="text-xs font-semibold tracking-wide text-muted uppercase">Vencidas hace poco</p>
            <ul className="divide-y divide-line opacity-70">
              {expired.map((w) => (
                <Row key={w.tx.id} w={w} onReceipt={setReceipt} />
              ))}
            </ul>
          </Card>
        )}
      </div>
      {receipt && <ReceiptViewer open onClose={() => setReceipt(null)} id={receipt} />}
    </div>
  )
}
