import { Pencil, Plus } from 'lucide-react'
import { fmtDate, fmtInDays } from '../lib/dates'
import { goalMonthlyNeeded, goalSaved, goalsSavedTotal } from '../lib/finance'
import { useData, useMoney, useToday } from '../lib/hooks'
import { openSheet } from '../lib/ui'
import { Button, Card, EmptyState, IconButton, PageHeader, Ring } from '../components/ui'

export default function Goals() {
  const { goals } = useData()
  const fmt = useMoney()
  const today = useToday()
  const total = goalsSavedTotal(goals)
  const target = goals.reduce((s, g) => s + g.target, 0)

  return (
    <div>
      <PageHeader
        title="Metas de ahorro"
        subtitle={goals.length ? `${fmt(total)} apartados de ${fmt(target)}` : 'Ahorra para lo que te importa'}
        actions={
          <Button size="sm" onClick={() => openSheet({ kind: 'goal' })} icon={<Plus className="size-4" />}>
            Nueva
          </Button>
        }
      />
      {goals.length === 0 ? (
        <EmptyState
          emoji="🎯"
          title="Crea tu primera meta"
          text="Un viaje, un notebook, un fondo de emergencia… Te diremos cuánto apartar cada mes para llegar."
          action={<Button onClick={() => openSheet({ kind: 'goal' })}>Crear meta</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {goals.map((g) => {
            const saved = goalSaved(g)
            const ratio = saved / g.target
            const done = ratio >= 1
            const need = goalMonthlyNeeded(g, today)
            return (
              <div key={g.id}>
                <Card className="relative overflow-hidden">
                  {done && (
                    <div
                      className="pointer-events-none absolute -top-8 -right-8 size-32 rounded-full opacity-20 blur-2xl"
                      style={{ background: g.color }}
                    />
                  )}
                  <div className="flex items-center gap-4">
                    <Ring ratio={ratio} size={84} stroke={8} color={g.color}>
                      <span className="text-3xl">{done ? '🏆' : g.icon}</span>
                    </Ring>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-lg font-bold">{g.name}</p>
                      <p className="text-2xl font-extrabold tracking-tight">{fmt(saved)}</p>
                      <p className="text-xs text-muted">
                        de {fmt(g.target)} · {Math.min(100, Math.round(ratio * 100))}%
                      </p>
                    </div>
                    <IconButton label="Editar meta" onClick={() => openSheet({ kind: 'goal', id: g.id })} className="self-start">
                      <Pencil className="size-4" />
                    </IconButton>
                  </div>
                  <div className="mt-4 rounded-2xl bg-surface-2 px-3 py-2.5 text-xs text-ink-2">
                    {done ? (
                      <>🎉 ¡Meta cumplida! Ahorraste {fmt(saved)}.</>
                    ) : g.deadline ? (
                      need !== null && g.deadline >= today ? (
                        <>
                          Para llegar al {fmtDate(g.deadline)} ({fmtInDays(g.deadline)}) aparta{' '}
                          <b className="text-ink">{fmt(need)} al mes</b>.
                        </>
                      ) : (
                        <>
                          La fecha ({fmtDate(g.deadline)}) ya pasó. Te faltan {fmt(g.target - saved)}.
                        </>
                      )
                    ) : (
                      <>Te faltan {fmt(g.target - saved)}. Ponle una fecha y te diremos cuánto apartar al mes.</>
                    )}
                  </div>
                  {!done && (
                    <Button block className="mt-3" variant="soft" onClick={() => openSheet({ kind: 'contribution', id: g.id })}>
                      Apartar dinero
                    </Button>
                  )}
                  {g.contributions.length > 0 && (
                    <p className="mt-2 text-center text-[11px] text-muted">
                      {g.contributions.length} aportes · último{' '}
                      {fmtInDays([...g.contributions].sort((a, b) => b.date.localeCompare(a.date))[0].date)}
                    </p>
                  )}
                </Card>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
