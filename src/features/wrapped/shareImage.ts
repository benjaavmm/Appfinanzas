/** Imagen para compartir "Tu mes en lucas" (1080×1920, formato historia) */

const W = 1080
const H = 1920
const FONT = '"Plus Jakarta Sans Variable", "Plus Jakarta Sans", system-ui, sans-serif'

/** Parte un texto en líneas que caben en `max` px */
const wrap = (ctx: CanvasRenderingContext2D, text: string, max: number): string[] => {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (ctx.measureText(next).width > max && line) {
      lines.push(line)
      line = w
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}

/** Achica la letra hasta que el texto quepa en una línea */
const fit = (ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, max: number) => {
  let s = size
  ctx.font = `${weight} ${s}px ${FONT}`
  while (ctx.measureText(text).width > max && s > 40) {
    s -= 6
    ctx.font = `${weight} ${s}px ${FONT}`
  }
  return s
}

const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export const renderShareImage = async (p: { title: string; big: string; lines: string[] }): Promise<Blob> => {
  try {
    await Promise.all([document.fonts.load(`800 100px ${FONT}`), document.fonts.load(`600 50px ${FONT}`)])
  } catch {
    /* sin fuentes: usa las del sistema */
  }
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#6655f5')
  bg.addColorStop(1, '#c2508f')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  // Círculos suaves de fondo
  ctx.fillStyle = 'rgba(255,255,255,0.08)'
  ctx.beginPath()
  ctx.arc(W * 0.9, H * 0.12, 320, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(W * 0.05, H * 0.85, 380, 0, Math.PI * 2)
  ctx.fill()

  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.font = `700 40px ${FONT}`
  ctx.fillText('M I S   F I N A N Z A S', W / 2, 190)

  ctx.fillStyle = '#ffffff'
  ctx.font = `800 84px ${FONT}`
  const titleLines = wrap(ctx, p.title, W - 160)
  titleLines.forEach((l, i) => ctx.fillText(l, W / 2, 360 + i * 100))

  const bigY = 360 + titleLines.length * 100 + 220
  fit(ctx, p.big, 800, 170, W - 140)
  ctx.fillText(p.big, W / 2, bigY)
  ctx.fillStyle = 'rgba(255,255,255,0.8)'
  ctx.font = `600 50px ${FONT}`
  ctx.fillText('gastados', W / 2, bigY + 90)

  let y = bigY + 220
  for (const line of p.lines.slice(0, 4)) {
    const size = fit(ctx, line, 700, 50, W - 240)
    ctx.fillStyle = 'rgba(255,255,255,0.16)'
    roundRect(ctx, 90, y - size - 30, W - 180, size + 70, 48)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.font = `700 ${size}px ${FONT}`
    ctx.fillText(line, W / 2, y + 4)
    y += size + 110
  }

  ctx.fillStyle = 'rgba(255,255,255,0.8)'
  ctx.font = `600 42px ${FONT}`
  ctx.fillText('Hecho con Mis Finanzas 💜', W / 2, H - 140)

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo crear la imagen'))), 'image/png'),
  )
}

/** Comparte la imagen (WhatsApp, Instagram…) o la descarga si el navegador no puede */
export const shareImage = async (blob: Blob, text: string): Promise<'shared' | 'downloaded' | 'cancelled'> => {
  const file = new File([blob], 'mis-finanzas-resumen.png', { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text })
      return 'shared'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 5000)
  return 'downloaded'
}
