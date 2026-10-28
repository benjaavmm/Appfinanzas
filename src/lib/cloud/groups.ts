/**
 * Grupos (gastos compartidos) en Supabase: los ven y anotan todos sus integrantes. Sin cuenta,
 * cualquiera con el link puede ver el grupo (group_public) y unirse después.
 */
import { create } from 'zustand'
import type { Group, GroupEntry, GroupMember } from '../../features/groups/balance'
import { cloudConfigured, cloudError, supabase, appUrl } from './client'
import { onUserChange, useAuth } from './auth'

interface GroupsState {
  groups: Group[]
  loaded: boolean
  loading: boolean
  error: string | null
}

export const useGroups = create<GroupsState>()(() => ({ groups: [], loaded: false, loading: false, error: null }))

/** Errores en palabras simples */
export const groupError = (e: unknown): string => {
  const msg = (e as { message?: string })?.message ?? String(e)
  if (/schema cache|does not exist|could not find/i.test(msg))
    return 'Falta actualizar la base de datos: vuelve a correr supabase/schema.sql en Supabase (SQL Editor).'
  if (msg.includes('not_authenticated')) return 'Inicia sesión para usar los grupos.'
  if (msg.includes('not_member')) return 'Ya no eres parte de este grupo.'
  if (msg.includes('shares_mismatch')) return 'Las partes no suman el total.'
  if (msg.includes('has_entries')) return 'No se puede quitar: tiene gastos o pagos en el grupo.'
  if (msg.includes('is_user')) return 'Esa persona tiene cuenta: solo ella puede salir del grupo.'
  if (msg.includes('too_many_members')) return 'El grupo llegó al máximo de 30 personas.'
  if (msg.includes('too_many_groups')) return 'Llegaste al máximo de grupos.'
  if (msg.includes('invalid_code')) return 'Ese link no existe o lo cambiaron. Pide uno nuevo.'
  return cloudError(e)
}

interface MemberRow {
  id: string
  user_id: string | null
  name: string
  created_at?: string
}
interface EntryRow {
  id: string
  kind: 'expense' | 'payment' | 'contribution'
  description: string | null
  amount: number | string
  entry_date: string
  paid_by: string
  shares: Record<string, number | string>
  created_at: string
}
interface GroupRow {
  id: string
  name: string
  emoji: string
  currency: string
  invite_code: string
  updated_at: string
  weights?: Record<string, number | string> | null
  goal_name?: string | null
  goal_amount?: number | string | null
  group_members: MemberRow[]
  group_entries: EntryRow[]
}

/** Reparto y meta como vienen de la base */
const rules = (r: Pick<GroupRow, 'weights' | 'goal_name' | 'goal_amount'>): Pick<Group, 'weights' | 'goal'> => ({
  weights:
    r.weights && typeof r.weights === 'object'
      ? Object.fromEntries(Object.entries(r.weights).map(([k, v]) => [k, Number(v)]))
      : undefined,
  goal: r.goal_name && Number(r.goal_amount) > 0 ? { name: r.goal_name, amount: Number(r.goal_amount) } : undefined,
})

const toEntry = (r: EntryRow): GroupEntry => ({
  id: r.id,
  kind: r.kind,
  description: r.description,
  amount: Number(r.amount),
  date: r.entry_date,
  paidBy: r.paid_by,
  shares: Object.fromEntries(Object.entries(r.shares ?? {}).map(([k, v]) => [k, Number(v)])),
  createdAt: r.created_at,
})

const sortEntries = (es: GroupEntry[]) =>
  es.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))

export const toGroup = (r: GroupRow, me: string | null): Group => ({
  id: r.id,
  name: r.name,
  emoji: r.emoji,
  currency: r.currency,
  inviteCode: r.invite_code,
  updatedAt: r.updated_at,
  ...rules(r),
  members: [...(r.group_members ?? [])]
    .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
    .map((m) => ({ id: m.id, name: m.name, joined: !!m.user_id, me: !!me && m.user_id === me })),
  entries: sortEntries((r.group_entries ?? []).map(toEntry)),
})

let lastLoad = 0

/** Trae mis grupos con sus integrantes y gastos */
export const loadGroups = async (force = false): Promise<void> => {
  const me = useAuth.getState().userId
  if (!cloudConfigured || !me) return
  if (!force && Date.now() - lastLoad < 15_000) return
  lastLoad = Date.now()
  useGroups.setState({ loading: true })
  try {
    const sb = await supabase()
    const { data, error } = await sb
      .from('groups')
      .select(
        'id, name, emoji, currency, invite_code, updated_at, weights, goal_name, goal_amount, group_members(id, user_id, name, created_at), group_entries(id, kind, description, amount, entry_date, paid_by, shares, created_at)',
      )
      .order('updated_at', { ascending: false })
    if (error) throw error
    if (useAuth.getState().userId !== me) return
    useGroups.setState({ groups: (data as GroupRow[]).map((r) => toGroup(r, me)), loaded: true, error: null })
  } catch (e) {
    useGroups.setState({ error: groupError(e), loaded: true })
  } finally {
    useGroups.setState({ loading: false })
  }
}

const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const sb = await supabase()
  const { data, error } = await sb.rpc(fn, args)
  if (error) throw new Error(groupError(error))
  return data as T
}

/** Después de cambiar algo: se vuelve a traer todo (es poco) */
const mutate = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const out = await rpc<T>(fn, args)
  await loadGroups(true)
  return out
}

export const createGroup = (p: { name: string; emoji: string; currency: string; myName: string; guests: string[] }) =>
  mutate<string>('group_create', {
    p_name: p.name,
    p_emoji: p.emoji,
    p_currency: p.currency,
    p_my_name: p.myName,
    p_guests: p.guests,
  })

export const addGroupMember = (groupId: string, name: string) =>
  mutate<string>('group_add_member', { p_group: groupId, p_name: name })

export const removeGroupMember = (memberId: string) => mutate<void>('group_remove_member', { p_member: memberId })

export const updateGroup = (groupId: string, name: string, emoji: string) =>
  mutate<void>('group_update', { p_group: groupId, p_name: name, p_emoji: emoji })

export const rotateGroupCode = (groupId: string) => mutate<string>('group_rotate_code', { p_group: groupId })

export const leaveGroup = (groupId: string) => mutate<void>('group_leave', { p_group: groupId })

export const addGroupEntry = (
  groupId: string,
  e: {
    kind: 'expense' | 'payment' | 'contribution'
    description?: string
    amount: number
    date: string
    paidBy: string
    shares: Record<string, number>
  },
) =>
  mutate<string>('group_add_entry', {
    p_group: groupId,
    p_kind: e.kind,
    p_description: e.description ?? null,
    p_amount: e.amount,
    p_date: e.date,
    p_paid_by: e.paidBy,
    p_shares: e.shares,
  })

export const deleteGroupEntry = (entryId: string) => mutate<void>('group_delete_entry', { p_entry: entryId })

/** Reparto por defecto (null = partes iguales) y meta compartida (null = sin meta) */
export const setGroupRules = (
  groupId: string,
  weights: Record<string, number> | null,
  goal: { name: string; amount: number } | null,
) =>
  mutate<void>('group_set_rules', {
    p_group: groupId,
    p_weights: weights,
    p_goal_name: goal?.name ?? null,
    p_goal_amount: goal?.amount ?? null,
  })

export interface PublicGroup extends Group {
  /** Ya soy integrante (con mi cuenta) */
  isMember: boolean
}

interface PublicRow {
  group: { id: string; name: string; emoji: string; currency: string } & Pick<GroupRow, 'weights' | 'goal_name' | 'goal_amount'>
  members: { id: string; name: string; joined: boolean; me: boolean }[]
  entries: EntryRow[]
}

/** Ver un grupo con el link (funciona sin cuenta) */
export const fetchPublicGroup = async (code: string): Promise<PublicGroup | null> => {
  const data = await rpc<PublicRow | null>('group_public', { p_code: code })
  if (!data?.group) return null
  const members: GroupMember[] = data.members.map((m) => ({ id: m.id, name: m.name, joined: m.joined, me: m.me }))
  const { weights, goal_name, goal_amount, ...g } = data.group
  return {
    ...g,
    ...rules({ weights, goal_name, goal_amount }),
    inviteCode: code,
    members,
    entries: sortEntries((data.entries ?? []).map(toEntry)),
    isMember: members.some((m) => m.me),
  }
}

/** Unirse con el link: como un invitado ("soy Jazmín") o como alguien nuevo */
export const joinGroup = (code: string, memberId?: string, name?: string) =>
  mutate<string>('group_join', { p_code: code, p_member: memberId ?? null, p_name: name ?? null })

/** Link para invitar o para ver el grupo */
export const groupLink = (code: string) => `${appUrl()}#/unirse/${code}`

/** Link pendiente: se abrió sin sesión; al iniciar sesión se vuelve a él */
export const PENDING_JOIN_KEY = 'mf-unirse'

let started = false
/** Trae los grupos al iniciar sesión y al volver a la app */
export const startGroups = () => {
  if (started || !cloudConfigured) return
  started = true
  onUserChange((userId) => {
    if (userId) {
      void loadGroups(true)
      // Abrió un link de invitación sin sesión: al entrar, vuelve a él para unirse
      try {
        const code = localStorage.getItem(PENDING_JOIN_KEY)
        if (code) {
          localStorage.removeItem(PENDING_JOIN_KEY)
          window.location.hash = `#/unirse/${code}`
        }
      } catch {
        /* sin almacenamiento */
      }
    } else useGroups.setState({ groups: [], loaded: false, error: null })
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void loadGroups()
  })
}
