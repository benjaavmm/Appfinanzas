/** Amigos y préstamos compartidos: lo que uno anota, al otro le aparece */
import { create } from 'zustand'
import { formatMoney } from '../format'
import { useStore } from '../store'
import { toast } from '../ui'
import type { DateStr, LoanDirection } from '../types'
import { cloudError, supabase } from './client'
import { onUserChange, useAuth } from './auth'
import { reconcileSharedLoans, type Profile, type SharedLoanRow } from './reconcile'

export type FriendStatus = 'accepted' | 'incoming' | 'outgoing'
export interface Friend {
  friendshipId: string
  profile: Profile
  status: FriendStatus
}

interface SocialState {
  loaded: boolean
  loading: boolean
  friends: Friend[]
  rows: SharedLoanRow[]
  profiles: Record<string, Profile>
  error: string | null
}

export const useSocial = create<SocialState>()(() => ({
  loaded: false,
  loading: false,
  friends: [],
  rows: [],
  profiles: {},
  error: null,
}))

const SEEN_KEY = 'mf-social-seen'
interface Seen {
  user: string
  loans: Record<string, string>
  requests: string[]
}
const readSeen = (user: string): Seen | null => {
  try {
    const s = JSON.parse(localStorage.getItem(SEEN_KEY) ?? 'null') as Seen | null
    return s?.user === user ? s : null
  } catch {
    return null
  }
}

const money = (n: number) => {
  const { currency, locale, hideAmounts } = useStore.getState().settings
  return hideAmounts ? 'dinero' : formatMoney(n, currency, locale)
}

/** Avisos de lo que cambió desde la última vez (lo que hizo el amigo, no uno mismo) */
const notifyChanges = (me: string, rows: SharedLoanRow[], friends: Friend[], profiles: Record<string, Profile>) => {
  const prev = readSeen(me)
  const next: Seen = {
    user: me,
    loans: Object.fromEntries(rows.map((r) => [r.id, r.status])),
    requests: friends.filter((f) => f.status === 'incoming').map((f) => f.friendshipId),
  }
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(next))
  } catch {
    /* no importa */
  }
  if (!prev) return
  const msgs: string[] = []
  for (const f of friends)
    if (f.status === 'incoming' && !prev.requests.includes(f.friendshipId))
      msgs.push(`👋 ${f.profile.display_name} quiere agregarte como amigo`)
  for (const r of rows) {
    const before = prev.loans[r.id]
    if (before === r.status) continue
    const iLent = r.lender === me
    const other = profiles[iLent ? r.borrower : r.lender]?.display_name ?? 'Tu amigo'
    const amt = money(Number(r.amount))
    if (!before && r.created_by !== me && r.status === 'active')
      msgs.push(iLent ? `💸 ${other} anotó que te debe ${amt}` : `💸 ${other} anotó que le debes ${amt}`)
    else if (r.status === 'payment_reported' && iLent) msgs.push(`💰 ${other} dice que ya te pagó ${amt}. Confírmalo.`)
    else if (r.status === 'paid' && !iLent) msgs.push(`✅ ${other} confirmó que le pagaste ${amt}`)
    else if (before === 'payment_reported' && r.status === 'active' && !iLent)
      msgs.push(`⏳ ${other} dice que todavía no le llega tu pago de ${amt}`)
    else if (r.status === 'rejected' && r.created_by === me) msgs.push(`🙅 ${other} no reconoce el préstamo de ${amt}`)
    else if (r.status === 'cancelled' && r.created_by !== me) msgs.push(`🗑️ ${other} anuló el préstamo de ${amt}`)
  }
  msgs.slice(0, 3).forEach((message, i) => window.setTimeout(() => toast({ message, tone: 'info' }), i * 3000))
}

let loading: Promise<void> | null = null

/** Descarga amigos y préstamos compartidos y los refleja en los préstamos de este dispositivo */
export const refreshSocial = (): Promise<void> => {
  const me = useAuth.getState().userId
  if (!me) return Promise.resolve()
  loading ??= (async () => {
    useSocial.setState({ loading: true })
    try {
      const sb = await supabase()
      const [f, l] = await Promise.all([
        sb.from('friendships').select('id, requester, addressee, status'),
        sb.from('shared_loans').select('*').order('created_at'),
      ])
      if (f.error) throw f.error
      if (l.error) throw l.error
      const fr = f.data as { id: string; requester: string; addressee: string; status: string }[]
      const rows = l.data as SharedLoanRow[]
      const ids = [
        ...new Set([
          ...fr.map((x) => (x.requester === me ? x.addressee : x.requester)),
          ...rows.map((r) => (r.lender === me ? r.borrower : r.lender)),
        ]),
      ]
      const profiles: Record<string, Profile> = {}
      if (ids.length) {
        const p = await sb.from('profiles').select('id, username, display_name, avatar').in('id', ids)
        if (p.error) throw p.error
        for (const x of p.data as Profile[]) profiles[x.id] = x
      }
      const friends: Friend[] = fr.flatMap((x) => {
        const other = x.requester === me ? x.addressee : x.requester
        const profile = profiles[other]
        if (!profile) return []
        const status: FriendStatus = x.status === 'accepted' ? 'accepted' : x.requester === me ? 'outgoing' : 'incoming'
        return [{ friendshipId: x.id, profile, status }]
      })
      if (useAuth.getState().userId !== me) return
      applyRows(me, rows, profiles)
      notifyChanges(me, rows, friends, profiles)
      useSocial.setState({ loaded: true, friends, rows, profiles, error: null })
    } catch (e) {
      useSocial.setState({ error: cloudError(e) })
    } finally {
      useSocial.setState({ loading: false })
      loading = null
    }
  })()
  return loading
}

const applyRows = (me: string, rows: SharedLoanRow[], profiles: Record<string, Profile>) => {
  const store = useStore.getState()
  const plan = reconcileSharedLoans(store.loans, rows, me, profiles)
  for (const { payments: _p, ...l } of plan.add) store.addLoan(l)
  for (const u of plan.update) store.updateLoan(u.id, u.patch)
  for (const s of plan.settle)
    store.addLoanPayment(s.id, { amount: s.amount, date: s.date, accountId: s.accountId, note: 'Pago confirmado en la app' })
  for (const id of plan.remove) store.deleteLoan(id)
}

const rpc = async <T>(fn: string, args: Record<string, unknown>) => {
  const sb = await supabase()
  const { data, error } = await sb.rpc(fn, args)
  if (error) throw new Error(cloudError(error))
  return data as T
}

/** Agregar amigo por nombre de usuario. Devuelve un texto para mostrar. */
export const addFriend = async (username: string): Promise<string> => {
  const u = username.trim().replace(/^@/, '').toLowerCase()
  const found = await rpc<Profile[]>('find_profile', { u })
  const p = found[0]
  if (!p) throw new Error(`No encontramos a @${u}. Revisa que esté bien escrito.`)
  if (p.id === useAuth.getState().userId) throw new Error('Ese eres tú 🙂')
  const res = await rpc<string>('send_friend_request', { target: p.id })
  await refreshSocial()
  return res === 'accepted' || res === 'already_friends'
    ? `🤝 Ahora tú y ${p.display_name} son amigos`
    : `Solicitud enviada a ${p.display_name}. Le aparecerá al abrir la app.`
}

export const acceptFriend = async (friendshipId: string) => {
  const sb = await supabase()
  const { error } = await sb.from('friendships').update({ status: 'accepted' }).eq('id', friendshipId)
  if (error) throw new Error(cloudError(error))
  await refreshSocial()
}

export const removeFriend = async (friendshipId: string) => {
  const sb = await supabase()
  const { error } = await sb.from('friendships').delete().eq('id', friendshipId)
  if (error) throw new Error(cloudError(error))
  await refreshSocial()
}

export interface NewSharedLoan {
  friendId: string
  direction: LoanDirection
  amount: number
  date: DateStr
  dueDate?: DateStr
  note?: string
  accountId?: string
}

/** Crea el préstamo en la nube y su copia en este dispositivo */
export const createSharedLoan = async (n: NewSharedLoan) => {
  const me = useAuth.getState().userId
  if (!me) throw new Error('Inicia sesión para compartir préstamos')
  const friend = useSocial.getState().friends.find((f) => f.profile.id === n.friendId)?.profile
  if (!friend) throw new Error('Ese amigo ya no está en tu lista')
  const sb = await supabase()
  const { data, error } = await sb
    .from('shared_loans')
    .insert({
      lender: n.direction === 'lent' ? me : n.friendId,
      borrower: n.direction === 'lent' ? n.friendId : me,
      created_by: me,
      amount: n.amount,
      currency: useStore.getState().settings.currency,
      description: n.note?.slice(0, 120) || null,
      loan_date: n.date,
      due_date: n.dueDate ?? null,
    })
    .select('*')
    .single()
  if (error) throw new Error(cloudError(error))
  const row = data as SharedLoanRow
  const loan = useStore.getState().addLoan({
    direction: n.direction,
    person: friend.display_name,
    amount: n.amount,
    date: n.date,
    dueDate: n.dueDate,
    note: n.note,
    accountId: n.accountId,
    shared: {
      id: row.id,
      friendId: n.friendId,
      username: friend.username,
      role: n.direction === 'lent' ? 'lender' : 'borrower',
      status: 'active',
      createdByMe: true,
    },
  })
  useSocial.setState((s) => ({ rows: [...s.rows, row] }))
  return loan
}

export type LoanAction = 'report_paid' | 'confirm_paid' | 'deny_paid' | 'reject' | 'cancel'

export const transitionSharedLoan = async (sharedId: string, action: LoanAction) => {
  await rpc('loan_transition', { loan: sharedId, action })
  await refreshSocial()
}

/** Cosas que esperan una respuesta mía (para el globito en Amigos) */
export const pendingActions = (s: SocialState, me: string | null) =>
  s.friends.filter((f) => f.status === 'incoming').length +
  s.rows.filter((r) => r.status === 'payment_reported' && r.lender === me).length

let started = false
export const startSocial = () => {
  if (started) return
  started = true
  onUserChange((userId) => {
    if (userId) void refreshSocial()
    else useSocial.setState({ loaded: false, friends: [], rows: [], profiles: {}, error: null })
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && useAuth.getState().userId) void refreshSocial()
  })
}
