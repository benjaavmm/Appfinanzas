import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReminderSettings } from '../../../lib/types'

// El store real usa IndexedDB: aquí basta con los ajustes de recordatorios
const state: { settings: { reminders?: Partial<ReminderSettings> } } = { settings: {} }
vi.mock('../../../lib/store', () => ({ useStore: { getState: () => state } }))

const {
  capabilities,
  checkRemindersNow,
  CHECK_EVERY_MS,
  disableReminders,
  enableReminders,
  resetCheckThrottle,
  sendTestNotification,
  SYNC_TAG,
} = await import('../notify')

type Perm = 'default' | 'granted' | 'denied'

const setup = ({
  permission = 'granted' as Perm,
  answer = 'granted' as Perm,
  sw = true,
  periodicSync = true,
  tags = [] as string[],
  periodicPermission = 'granted' as PermissionState | 'throws',
} = {}) => {
  const requestPermission = vi.fn(async () => {
    Notif.permission = answer
    return answer
  })
  const Notif = Object.assign(vi.fn(), { permission, requestPermission })
  const sync = {
    register: vi.fn(async (tag: string) => {
      if (!tags.includes(tag)) tags.push(tag)
    }),
    unregister: vi.fn(async () => undefined),
    getTags: vi.fn(async () => [...tags]),
  }
  const active = { postMessage: vi.fn() }
  const reg = { active, showNotification: vi.fn(async () => undefined), ...(periodicSync ? { periodicSync: sync } : {}) }
  const store = new Map<string, string>()
  vi.stubGlobal('Notification', Notif)
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
  vi.stubGlobal('location', { origin: 'https://ejemplo.cl', href: 'https://ejemplo.cl/' })
  vi.stubGlobal('navigator', {
    userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/140',
    maxTouchPoints: 5,
    permissions: {
      query: vi.fn(async () => {
        if (periodicPermission === 'throws') throw new TypeError('no existe')
        return { state: periodicPermission }
      }),
    },
    ...(sw
      ? { serviceWorker: { getRegistration: vi.fn(async () => reg), ready: Promise.resolve(reg) } }
      : { serviceWorker: undefined }),
  })
  return { Notif, sync, active, reg, requestPermission }
}

beforeEach(() => {
  state.settings = { reminders: { enabled: true } }
})

afterEach(() => {
  resetCheckThrottle()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('capabilities', () => {
  it('sin APIs del navegador: no soportado', async () => {
    vi.stubGlobal('navigator', undefined)
    const caps = await capabilities()
    expect(caps).toMatchObject({ notifications: false, permission: 'unsupported', background: false, backgroundActive: false })
  })

  it('detecta permiso, periodicSync y si la revisión quedó registrada', async () => {
    setup({ tags: [SYNC_TAG] })
    expect(await capabilities()).toMatchObject({
      notifications: true,
      permission: 'granted',
      background: true,
      backgroundActive: true,
      ios: false,
    })
  })

  it('sin periodicSync (Firefox, Safari)', async () => {
    setup({ periodicSync: false })
    expect(await capabilities()).toMatchObject({ background: false, backgroundActive: false })
  })
})

describe('enableReminders', () => {
  it('pide permiso y registra la revisión cada 12 h', async () => {
    const { sync, requestPermission } = setup({ permission: 'default', answer: 'granted' })
    expect(await enableReminders()).toEqual({ permission: 'granted', background: true })
    expect(requestPermission).toHaveBeenCalledOnce()
    expect(sync.register).toHaveBeenCalledWith(SYNC_TAG, { minInterval: 12 * 60 * 60 * 1000 })
  })

  it('si se niega el permiso no registra nada', async () => {
    const { sync } = setup({ permission: 'default', answer: 'denied' })
    expect(await enableReminders()).toEqual({ permission: 'denied', background: false })
    expect(sync.register).not.toHaveBeenCalled()
  })

  it('no vuelve a preguntar si ya estaba bloqueado', async () => {
    const { requestPermission } = setup({ permission: 'denied' })
    expect((await enableReminders()).permission).toBe('denied')
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('sin permiso de segundo plano (app no instalada) quedan solo avisos al abrir', async () => {
    const { sync } = setup({ periodicPermission: 'denied' })
    expect(await enableReminders()).toEqual({ permission: 'granted', background: false })
    expect(sync.register).not.toHaveBeenCalled()
  })

  it('si la consulta del permiso no existe, intenta registrar igual', async () => {
    const { sync } = setup({ periodicPermission: 'throws' })
    expect((await enableReminders()).background).toBe(true)
    expect(sync.register).toHaveBeenCalled()
  })

  it('si el registro falla no lanza error', async () => {
    const { sync } = setup()
    sync.register.mockRejectedValueOnce(new DOMException('no permitido', 'NotAllowedError'))
    expect(await enableReminders()).toEqual({ permission: 'granted', background: false })
  })

  it('sin service worker', async () => {
    setup({ sw: false })
    expect(await enableReminders()).toEqual({ permission: 'granted', background: false })
  })

  it('navegador sin notificaciones', async () => {
    vi.stubGlobal('Notification', undefined)
    expect(await enableReminders()).toEqual({ permission: 'unsupported', background: false })
  })
})

describe('disableReminders', () => {
  it('quita la revisión periódica', async () => {
    const { sync } = setup({ tags: [SYNC_TAG] })
    await disableReminders()
    expect(sync.unregister).toHaveBeenCalledWith(SYNC_TAG)
  })

  it('no falla sin service worker', async () => {
    setup({ sw: false })
    await expect(disableReminders()).resolves.toBeUndefined()
  })
})

describe('checkRemindersNow', () => {
  it('pide la revisión al service worker, a lo más cada 30 min', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-05T09:00:00'))
    const { active } = setup({ tags: [SYNC_TAG] })
    await checkRemindersNow()
    expect(active.postMessage).toHaveBeenCalledWith({ type: 'revisar-recordatorios' })
    await checkRemindersNow()
    expect(active.postMessage).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + CHECK_EVERY_MS - 1000)
    await checkRemindersNow()
    expect(active.postMessage).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + 2000)
    await checkRemindersNow()
    expect(active.postMessage).toHaveBeenCalledTimes(2)
  })

  it('con force no espera los 30 min', async () => {
    const { active } = setup({ tags: [SYNC_TAG] })
    await checkRemindersNow()
    await checkRemindersNow({ force: true })
    expect(active.postMessage).toHaveBeenCalledTimes(2)
  })

  it('no hace nada si están desactivados o sin permiso', async () => {
    state.settings = { reminders: { enabled: false } }
    const { active } = setup()
    await checkRemindersNow({ force: true })
    state.settings = {}
    await checkRemindersNow({ force: true })
    expect(active.postMessage).not.toHaveBeenCalled()

    state.settings = { reminders: { enabled: true } }
    const other = setup({ permission: 'default' })
    await checkRemindersNow({ force: true })
    expect(other.active.postMessage).not.toHaveBeenCalled()
  })

  it('registra la revisión en segundo plano si faltaba (app instalada después)', async () => {
    const { sync, active } = setup({ tags: [] })
    await checkRemindersNow()
    expect(sync.register).toHaveBeenCalledWith(SYNC_TAG, expect.anything())
    expect(active.postMessage).toHaveBeenCalled()
  })

  it('funciona aunque localStorage no esté disponible', async () => {
    const { active } = setup({ tags: [SYNC_TAG] })
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('bloqueado')
      },
      setItem: () => {
        throw new Error('bloqueado')
      },
      removeItem: () => undefined,
    })
    await checkRemindersNow()
    await checkRemindersNow()
    // El límite queda en memoria
    expect(active.postMessage).toHaveBeenCalledTimes(1)
  })

  it('no lanza errores sin service worker', async () => {
    setup({ sw: false })
    await expect(checkRemindersNow({ force: true })).resolves.toBeUndefined()
  })
})

describe('sendTestNotification', () => {
  it('la muestra a través del service worker', async () => {
    const { reg } = setup()
    expect(await sendTestNotification()).toBe('shown')
    expect(reg.showNotification).toHaveBeenCalledWith(
      'Así se verán tus recordatorios',
      expect.objectContaining({ tag: 'recordatorio-prueba', data: { url: 'https://ejemplo.cl/#/ajustes' } }),
    )
  })

  it('sin service worker usa new Notification', async () => {
    const { Notif } = setup({ sw: false })
    expect(await sendTestNotification()).toBe('shown')
    expect(Notif).toHaveBeenCalledWith('Así se verán tus recordatorios', expect.objectContaining({ body: expect.any(String) }))
  })

  it('informa si está bloqueado, sin soporte o si falla', async () => {
    setup({ permission: 'denied' })
    expect(await sendTestNotification()).toBe('denied')
    const { reg } = setup()
    reg.showNotification.mockRejectedValueOnce(new TypeError('falló'))
    expect(await sendTestNotification()).toBe('error')
    vi.stubGlobal('Notification', undefined)
    expect(await sendTestNotification()).toBe('unsupported')
  })
})
