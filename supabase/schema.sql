-- ═══════════════════════════════════════════════════════════════════════════
-- Mis Finanzas · esquema de Supabase
-- Pégalo completo en Supabase → SQL Editor → New query → Run.
-- Se puede volver a ejecutar sin problemas (es idempotente).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Perfiles públicos (nombre de usuario para que tus amigos te encuentren) ──
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_.]{3,20}$'),
  display_name text not null check (char_length(display_name) between 1 and 40),
  avatar text check (char_length(avatar) <= 8),
  created_at timestamptz not null default now()
);

-- ── Respaldo de los datos de la app (uno por usuario) ──
create table if not exists public.user_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  device text check (char_length(device) <= 80)
);

-- ── Amistades ──
create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester uuid not null references public.profiles (id) on delete cascade,
  addressee uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  check (requester <> addressee)
);
create unique index if not exists friendships_pair
  on public.friendships (least(requester, addressee), greatest(requester, addressee));

-- ── Préstamos compartidos entre amigos ──
create table if not exists public.shared_loans (
  id uuid primary key default gen_random_uuid(),
  lender uuid not null references public.profiles (id) on delete cascade,
  borrower uuid not null references public.profiles (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete cascade,
  amount numeric(14, 2) not null check (amount > 0 and amount < 1e12),
  currency text not null default 'CLP' check (currency ~ '^[A-Z]{3}$'),
  description text check (char_length(description) <= 120),
  loan_date date not null default current_date,
  due_date date,
  status text not null default 'active'
    check (status in ('active', 'payment_reported', 'paid', 'rejected', 'cancelled')),
  reported_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (lender <> borrower),
  check (created_by in (lender, borrower)),
  check (due_date is null or due_date >= loan_date)
);
create index if not exists shared_loans_lender on public.shared_loans (lender);
create index if not exists shared_loans_borrower on public.shared_loans (borrower);

-- ═══════════════════════ Funciones auxiliares ═══════════════════════

create or replace function public.are_friends(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from friendships f
    where f.status = 'accepted'
      and least(f.requester, f.addressee) = least(a, b)
      and greatest(f.requester, f.addressee) = greatest(a, b)
  );
$$;

-- Perfil al registrarse (usa el usuario y nombre enviados desde la app)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  wanted text := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
  base text;
  final text;
  n int := 0;
begin
  base := regexp_replace(coalesce(nullif(wanted, ''), split_part(new.email, '@', 1)), '[^a-z0-9_.]', '', 'g');
  if char_length(base) < 3 then base := base || 'user'; end if;
  base := left(base, 16);
  final := base;
  while exists (select 1 from profiles where username = final) loop
    n := n + 1;
    final := left(base, 16) || n::text;
  end loop;
  insert into profiles (id, username, display_name, avatar)
  values (
    new.id,
    final,
    left(coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), final), 40),
    left(coalesce(new.raw_user_meta_data ->> 'avatar', '🙂'), 8)
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ¿Está libre este nombre de usuario? (se usa en el registro, antes de iniciar sesión)
create or replace function public.username_available(u text)
returns boolean language sql stable security definer set search_path = public as $$
  select lower(u) ~ '^[a-z0-9_.]{3,20}$' and not exists (select 1 from profiles where username = lower(u));
$$;

-- Buscar un perfil exacto por usuario (no permite listar a todos)
create or replace function public.find_profile(u text)
returns table (id uuid, username text, display_name text, avatar text)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.display_name, p.avatar from profiles p
  where auth.uid() is not null and p.username = lower(trim(leading '@' from u));
$$;

-- Solicitud de amistad: si el otro ya me la había enviado, queda aceptada
create or replace function public.send_friend_request(target uuid)
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); existing friendships;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if target = me then raise exception 'self_request'; end if;
  if not exists (select 1 from profiles where id = target) then raise exception 'not_found'; end if;
  select * into existing from friendships
    where least(requester, addressee) = least(me, target) and greatest(requester, addressee) = greatest(me, target);
  if found then
    if existing.status = 'accepted' then return 'already_friends'; end if;
    if existing.addressee = me then
      update friendships set status = 'accepted' where id = existing.id;
      return 'accepted';
    end if;
    return 'pending';
  end if;
  insert into friendships (requester, addressee) values (me, target);
  return 'sent';
end;
$$;

-- ═══════════════════════ Cambios de estado de préstamos ═══════════════════════
-- Las transiciones solo se hacen con estas funciones (no hay UPDATE directo).

create or replace function public.loan_transition(loan uuid, action text)
returns public.shared_loans language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); l shared_loans;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  select * into l from shared_loans where id = loan for update;
  if not found or me not in (l.lender, l.borrower) then raise exception 'not_found'; end if;

  if action = 'report_paid' then            -- quien debe: "ya pagué"
    if me <> l.borrower or l.status <> 'active' then raise exception 'invalid_transition'; end if;
    update shared_loans set status = 'payment_reported', reported_at = now(), updated_at = now() where id = loan returning * into l;
  elsif action = 'confirm_paid' then        -- quien prestó: "sí, me pagó"
    if me <> l.lender or l.status not in ('active', 'payment_reported') then raise exception 'invalid_transition'; end if;
    update shared_loans set status = 'paid', paid_at = now(), updated_at = now() where id = loan returning * into l;
  elsif action = 'deny_paid' then           -- quien prestó: "todavía no me paga"
    if me <> l.lender or l.status <> 'payment_reported' then raise exception 'invalid_transition'; end if;
    update shared_loans set status = 'active', reported_at = null, updated_at = now() where id = loan returning * into l;
  elsif action = 'reject' then              -- el otro: "no reconozco este préstamo"
    if me = l.created_by or l.status <> 'active' then raise exception 'invalid_transition'; end if;
    update shared_loans set status = 'rejected', updated_at = now() where id = loan returning * into l;
  elsif action = 'cancel' then              -- quien lo creó lo anula
    if me <> l.created_by or l.status not in ('active', 'payment_reported') then raise exception 'invalid_transition'; end if;
    update shared_loans set status = 'cancelled', updated_at = now() where id = loan returning * into l;
  else
    raise exception 'invalid_action';
  end if;
  return l;
end;
$$;

-- ═══════════════════════ Seguridad por filas (RLS) ═══════════════════════

alter table public.profiles enable row level security;
alter table public.user_data enable row level security;
alter table public.friendships enable row level security;
alter table public.shared_loans enable row level security;

-- Perfiles: ves el tuyo y el de quienes tienen una amistad o solicitud contigo
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid() or exists (
    select 1 from friendships f
    where (f.requester = auth.uid() and f.addressee = profiles.id) or (f.addressee = auth.uid() and f.requester = profiles.id)
  ) or exists (
    select 1 from shared_loans s
    where (s.lender = auth.uid() and s.borrower = profiles.id) or (s.borrower = auth.uid() and s.lender = profiles.id)
  )
);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Respaldo: solo tú
drop policy if exists user_data_own on public.user_data;
create policy user_data_own on public.user_data for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Amistades: las ves si eres parte; aceptar solo quien la recibió; cualquiera de los dos la elimina
drop policy if exists friendships_select on public.friendships;
create policy friendships_select on public.friendships for select to authenticated
  using (auth.uid() in (requester, addressee));
drop policy if exists friendships_accept on public.friendships;
create policy friendships_accept on public.friendships for update to authenticated
  using (addressee = auth.uid() and status = 'pending') with check (addressee = auth.uid() and status = 'accepted');
-- Aceptar solo puede cambiar "status": sin esto, quien recibe una solicitud podría reescribir
-- requester y quedar "amigo" de cualquiera sin que esa persona lo acepte.
revoke update on public.friendships from authenticated, anon;
grant update (status) on public.friendships to authenticated;
drop policy if exists friendships_delete on public.friendships;
create policy friendships_delete on public.friendships for delete to authenticated
  using (auth.uid() in (requester, addressee));

-- Préstamos: los ves si eres parte; los creas solo con un amigo y siempre partiendo "activo"
drop policy if exists shared_loans_select on public.shared_loans;
create policy shared_loans_select on public.shared_loans for select to authenticated
  using (auth.uid() in (lender, borrower));
drop policy if exists shared_loans_insert on public.shared_loans;
create policy shared_loans_insert on public.shared_loans for insert to authenticated with check (
  created_by = auth.uid()
  and auth.uid() in (lender, borrower)
  and status = 'active' and reported_at is null and paid_at is null
  and public.are_friends(lender, borrower)
);

-- Permisos de las funciones
revoke all on function public.are_friends(uuid, uuid) from public, anon;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.find_profile(text) from public, anon;
revoke all on function public.send_friend_request(uuid) from public, anon;
revoke all on function public.loan_transition(uuid, text) from public, anon;
grant execute on function public.username_available(text) to anon, authenticated;
grant execute on function public.find_profile(text) to authenticated;
grant execute on function public.send_friend_request(uuid) to authenticated;
grant execute on function public.loan_transition(uuid, text) to authenticated;
grant execute on function public.are_friends(uuid, uuid) to authenticated;

-- ═══════════════════════ Asistente con IA (opcional) ═══════════════════════
-- Cuenta cuántos mensajes manda cada persona por día a la IA, para poner un límite
-- y que el costo no se dispare. Solo se modifica a través de assistant_hit().

create table if not exists public.assistant_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default current_date,
  count integer not null default 0,
  primary key (user_id, day)
);
alter table public.assistant_usage enable row level security;
revoke all on public.assistant_usage from anon, authenticated;

create or replace function public.assistant_hit()
returns integer language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); n integer;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  insert into assistant_usage (user_id, day, count) values (me, current_date, 1)
  on conflict (user_id, day) do update set count = assistant_usage.count + 1
  returning count into n;
  return n;
end;
$$;
revoke all on function public.assistant_hit() from public, anon;
grant execute on function public.assistant_hit() to authenticated;
