/** En el Inicio, a comienzos de mes (y para fin de año): la invitación a ver tu resumen */
import { Link } from 'react-router'
import { ChevronRight } from 'lucide-react'
import { fmtMonth, parseDate, shiftMonth } from '../../lib/dates'
import { useToday } from '../../lib/hooks'

export const WrappedDashCard = () => {
  const today = useToday()
  const d = parseDate(today)
  const day = d.getDate()
  const month = d.getMonth()
  const title =
    month === 0 && day <= 15
      ? `Tu ${d.getFullYear() - 1} en lucas ya está listo`
      : month === 11 && day >= 15
        ? `Tu ${d.getFullYear()} en lucas`
        : day <= 7
          ? `Tu ${fmtMonth(shiftMonth(d, -1), false).toLowerCase()} en lucas ya está listo`
          : null
  if (!title) return null
  return (
    <Link
      to="/resumen"
      className="flex items-center gap-3 rounded-[22px] px-4 py-3 text-white shadow-card transition active:scale-[0.99]"
      style={{ background: 'linear-gradient(135deg, #6655f5, #c2508f)' }}
    >
      <span className="text-2xl" aria-hidden>
        ✨
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold">{title}</span>
        <span className="block text-xs text-white/80">En qué se te fue, tu lugar favorito y tu personaje. Para compartir.</span>
      </span>
      <ChevronRight className="size-4 shrink-0" />
    </Link>
  )
}
