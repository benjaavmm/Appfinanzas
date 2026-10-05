import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useData, useMoney } from '../lib/hooks'
import { openSheet } from '../lib/ui'
import { Button, Card, IconBadge, PageHeader, Segmented } from '../components/ui'

export default function Categories() {
  const { categories, transactions } = useData()
  const fmt = useMoney()
  const [kind, setKind] = useState<'expense' | 'income'>('expense')
  const list = categories.filter((c) => c.kind === kind)
  const count = (id: string) => transactions.filter((t) => t.categoryId === id).length

  return (
    <div>
      <PageHeader
        title="Categorías"
        actions={
          <Button
            size="sm"
            onClick={() => openSheet({ kind: 'category', categoryKind: kind })}
            icon={<Plus className="size-4" />}
          >
            Nueva
          </Button>
        }
      />
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { value: 'expense', label: 'Gastos' },
          { value: 'income', label: 'Ingresos' },
        ]}
      />
      <Card className="mt-4">
        <ul className="-mx-2">
          {list.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => openSheet({ kind: 'category', id: c.id })}
                className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left hover:bg-surface-2"
              >
                <IconBadge icon={c.icon} color={c.color} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{c.name}</span>
                  <span className="block text-xs text-muted">
                    {count(c.id)} movimientos{c.budget ? ` · presupuesto ${fmt(c.budget)}` : ''}
                  </span>
                </span>
                <span className="size-3 rounded-full" style={{ background: c.color }} />
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
