import { motion } from 'motion/react'
import { ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router'
import type { Insight, Tone } from '../lib/insights'
import { cx } from './ui'

const TONE: Record<Tone, { bg: string; label: string; dot: string }> = {
  good: { bg: 'bg-good-soft', label: 'Buena noticia', dot: 'bg-good' },
  warning: { bg: 'bg-warn-soft', label: 'Atención', dot: 'bg-warn' },
  critical: { bg: 'bg-bad-soft', label: 'Importante', dot: 'bg-bad' },
  info: { bg: 'bg-info-soft', label: 'Dato', dot: 'bg-info' },
}

export const InsightCard = ({ insight, index = 0, compact }: { insight: Insight; index?: number; compact?: boolean }) => {
  const nav = useNavigate()
  const t = TONE[insight.tone]
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      onClick={() => insight.to && nav(insight.to)}
      className={cx(
        'flex w-full items-start gap-3 rounded-3xl border border-line bg-surface p-4 text-left shadow-card transition',
        insight.to && 'hover:bg-surface-2 active:scale-[0.99]',
        compact && 'min-w-[280px] snap-start sm:min-w-0',
      )}
    >
      <span className={cx('flex size-11 shrink-0 items-center justify-center rounded-2xl text-xl', t.bg)}>{insight.emoji}</span>
      <span className="min-w-0 flex-1">
        <span className="mb-0.5 flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-muted uppercase">
          <span className={cx('size-1.5 rounded-full', t.dot)} />
          {t.label}
        </span>
        <span className="block leading-snug font-bold">{insight.title}</span>
        <span className="mt-1 block text-sm leading-snug text-ink-2">{insight.body}</span>
      </span>
      {insight.to && <ChevronRight className="mt-1 size-5 shrink-0 text-muted" />}
    </motion.button>
  )
}
