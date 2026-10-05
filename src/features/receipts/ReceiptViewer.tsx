import { ImageOff } from 'lucide-react'
import { Sheet } from '../../components/ui/Sheet'
import { useReceiptUrl } from './useReceiptUrl'

/** Muestra la foto guardada de una boleta a ancho completo */
export const ReceiptViewer = ({ open, onClose, id }: { open: boolean; onClose: () => void; id: string }) => {
  // Al cerrar se libera la imagen de la memoria
  const receipt = useReceiptUrl(open ? id : undefined)
  return (
    <Sheet open={open} onClose={onClose} title="Boleta">
      {receipt.status === 'ready' ? (
        <img src={receipt.url} alt="Foto de la boleta" className="w-full rounded-2xl border border-line bg-white" />
      ) : receipt.status === 'missing' ? (
        <div className="flex flex-col items-center px-4 py-10 text-center">
          <span className="mb-3 flex size-16 items-center justify-center rounded-full bg-surface-2 text-muted">
            <ImageOff className="size-7" />
          </span>
          <p className="font-bold">No encontramos la foto</p>
          <p className="mt-1 max-w-xs text-sm text-muted">
            Las fotos se guardan solo en este teléfono y no van en el respaldo. Si restauraste un respaldo o cambiaste de
            teléfono, la foto no viene incluida.
          </p>
        </div>
      ) : (
        <div className="h-96 animate-pulse rounded-2xl bg-surface-2" aria-label="Cargando la foto" />
      )}
    </Sheet>
  )
}
