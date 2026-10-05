/**
 * Dictado con el reconocimiento de voz del navegador (Chrome/Android y Safari lo traen;
 * Firefox no). Escucha una frase en español de Chile y se detiene solo al callar.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

/** Lo que usamos de SpeechRecognition (TypeScript no trae la clase en lib.dom) */
interface Recognition {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onstart: (() => void) | null
  onresult: ((e: SpeechRecognitionEvent) => void) | null
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
}

type RecognitionCtor = new () => Recognition

const getRecognition = (): RecognitionCtor | undefined => {
  if (typeof window === 'undefined') return undefined
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

export const speechSupported = () => !!getRecognition()

/** Mensaje para cada error del reconocimiento (null = no vale la pena avisar) */
export const dictationErrorMessage = (code: string): string | null => {
  switch (code) {
    case 'aborted':
      return null
    case 'no-speech':
      return 'No te escuché. Toca el micrófono e intenta de nuevo.'
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Para dictar, permite el uso del micrófono y vuelve a tocarlo.'
    case 'audio-capture':
      return 'No encontramos un micrófono en este dispositivo.'
    case 'network':
      return 'El dictado necesita internet en este teléfono. Puedes escribirlo.'
    case 'language-not-supported':
      return 'Tu teléfono no reconoce dictado en español. Puedes escribirlo.'
    default:
      return 'No pude escucharte. Puedes escribirlo.'
  }
}

/**
 * `onText(texto, final)` recibe la frase completa cada vez que cambia
 * (también los resultados intermedios mientras hablas).
 */
export const useDictation = (onText: (text: string, final: boolean) => void) => {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rec = useRef<Recognition | null>(null)
  const cb = useRef(onText)
  useEffect(() => {
    cb.current = onText
  }, [onText])

  const stop = useCallback(() => rec.current?.stop(), [])

  /** Empieza a escuchar. Devuelve false si el navegador no lo permite. */
  const start = useCallback((): boolean => {
    const Ctor = getRecognition()
    if (!Ctor) return false
    rec.current?.abort()
    const r = new Ctor()
    r.lang = 'es-CL'
    r.interimResults = true
    r.continuous = false
    r.maxAlternatives = 1
    r.onstart = () => setListening(true)
    r.onresult = (e) => {
      let text = ''
      let final = true
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0]?.transcript ?? ''
        if (!e.results[i].isFinal) final = false
      }
      cb.current(text.replace(/\s+/g, ' ').trim(), final)
    }
    r.onerror = (e) => setError(dictationErrorMessage(e.error))
    r.onend = () => {
      if (rec.current === r) rec.current = null
      setListening(false)
    }
    rec.current = r
    setError(null)
    try {
      r.start()
      setListening(true)
      return true
    } catch {
      rec.current = null
      setListening(false)
      return false
    }
  }, [])

  // Al cerrar la hoja se deja de escuchar
  useEffect(
    () => () => {
      const r = rec.current
      rec.current = null
      r?.abort()
    },
    [],
  )

  return { supported: speechSupported(), listening, error, start, stop, clearError: () => setError(null) }
}
