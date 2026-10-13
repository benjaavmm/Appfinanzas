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

-- ═══════════════════════ Buzón automático del banco ═══════════════════════
-- Los avisos del banco (notificación en Android, correo o SMS en iPhone) llegan solos desde
-- MacroDroid o Atajos con una clave personal, y la app los ofrece para agregar.

-- Una clave secreta por usuario (la que se pega en MacroDroid / Atajos)
create table if not exists public.inbox_keys (
  user_id uuid primary key references auth.users (id) on delete cascade,
  key text not null unique check (char_length(key) >= 32),
  created_at timestamptz not null default now()
);

-- Avisos recibidos: quedan "pendientes" hasta que se agregan o descartan en la app
create table if not exists public.bank_inbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  source text check (char_length(source) <= 40),
  received_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'added', 'dismissed'))
);
create index if not exists bank_inbox_user_status on public.bank_inbox (user_id, status, received_at);

-- Clave nueva, larga y aleatoria (gen_random_uuid usa el generador seguro de Postgres)
create or replace function public.inbox_new_key()
returns text language sql volatile set search_path = public as $$
  select 'mf_' || left(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 40);
$$;

-- Tu clave (se crea la primera vez)
create or replace function public.my_inbox_key()
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); k text;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  insert into inbox_keys (user_id, key) values (me, inbox_new_key()) on conflict (user_id) do nothing;
  select i.key into k from inbox_keys i where i.user_id = me;
  return k;
end;
$$;

-- Clave nueva: la anterior deja de funcionar
create or replace function public.rotate_inbox_key()
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); k text;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  insert into inbox_keys as i (user_id, key) values (me, inbox_new_key())
    on conflict (user_id) do update set key = excluded.key, created_at = now()
    returning i.key into k;
  return k;
end;
$$;

-- Lo llaman MacroDroid o Atajos con la clave pública de Supabase (sin sesión): la clave dice de quién es
create or replace function public.inbox_add(key text, body text, source text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
  b text := left(regexp_replace(coalesce(inbox_add.body, ''), '^\s+|\s+$', '', 'g'), 4000);
  s text := nullif(left(btrim(coalesce(inbox_add.source, '')), 40), '');
  t text;
begin
  -- Se bloquea la clave: si llegan dos avisos iguales a la vez, el segundo espera y se ignora
  select k.user_id into uid from inbox_keys k where k.key = btrim(inbox_add.key) for update;
  if uid is null then raise exception 'invalid_key'; end if;
  if b = '' then raise exception 'empty_body'; end if;
  -- Claves dinámicas y códigos del banco (sin un monto) no se guardan nunca
  t := translate(lower(b), 'áéíóúü', 'aeiouu');
  if t ~ '(clave dinamica|superclave|super clave|digipass|multipass|coordenadas|codigo de (verificacion|seguridad|confirmacion|acceso|validacion)|codigo otp|\motp\M|\mtoken\M|clave (de un solo uso|temporal|de acceso|de transaccion)|tu codigo|ingresa (el|este) codigo|es tu (codigo|clave))'
     and t !~ '(\$|\mclp\M|\musd\M|\mpesos\M)' then
    return 'ignored';
  end if;
  -- Limpieza con el primer aviso de cada día: los ya revisados y los pendientes de más de 90 días
  -- (la app borra cada aviso apenas lo revisas; esto es por si quedó alguno)
  if not exists (select 1 from bank_inbox x where x.user_id = uid and x.received_at >= date_trunc('day', now())) then
    delete from bank_inbox x where x.user_id = uid and (x.status <> 'pending' or x.received_at < now() - interval '90 days');
  end if;
  -- Límite contra abusos (si alguien consigue tu clave, genera una nueva en la app)
  if (select count(*) from bank_inbox x where x.user_id = uid and x.received_at > now() - interval '1 day') >= 300 then
    raise exception 'too_many_messages';
  end if;
  -- Las apps a veces mandan el mismo aviso dos veces
  if exists (select 1 from bank_inbox x where x.user_id = uid and x.body = b and x.received_at > now() - interval '2 minutes') then
    return 'duplicate';
  end if;
  insert into bank_inbox (user_id, body, source) values (uid, b, s);
  return 'ok';
end;
$$;

alter table public.inbox_keys enable row level security;
alter table public.bank_inbox enable row level security;

-- Clave: solo ves la tuya (se crea y cambia con las funciones)
drop policy if exists inbox_keys_select on public.inbox_keys;
create policy inbox_keys_select on public.inbox_keys for select to authenticated using (user_id = auth.uid());

-- Avisos: solo los tuyos. No hay insert directo: entran por inbox_add
drop policy if exists bank_inbox_select on public.bank_inbox;
create policy bank_inbox_select on public.bank_inbox for select to authenticated using (user_id = auth.uid());
drop policy if exists bank_inbox_update on public.bank_inbox;
create policy bank_inbox_update on public.bank_inbox for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists bank_inbox_delete on public.bank_inbox;
create policy bank_inbox_delete on public.bank_inbox for delete to authenticated using (user_id = auth.uid());

-- De un aviso solo se cambia el estado (agregado / descartado)
revoke all on public.inbox_keys, public.bank_inbox from anon, authenticated;
grant select on public.inbox_keys to authenticated;
grant select, delete on public.bank_inbox to authenticated;
grant update (status) on public.bank_inbox to authenticated;

revoke all on function public.inbox_new_key() from public, anon, authenticated;
revoke all on function public.my_inbox_key() from public, anon;
revoke all on function public.rotate_inbox_key() from public, anon;
revoke all on function public.inbox_add(text, text, text) from public;
grant execute on function public.my_inbox_key() to authenticated;
grant execute on function public.rotate_inbox_key() to authenticated;
grant execute on function public.inbox_add(text, text, text) to anon, authenticated;

-- ═══════════════════════ Avisos al teléfono (Web Push) ═══════════════════════
-- Cada teléfono con los recordatorios activos deja aquí su "dirección" de avisos, la hora que
-- eligió y los días en que tiene algo que avisar (cobros, vencimientos, resúmenes). La función
-- "avisos" (supabase/functions/avisos) le manda un toque a esa hora y el teléfono arma el aviso
-- con sus propios datos. Aquí no se guardan montos ni movimientos.

create table if not exists public.push_subs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) between 20 and 200),
  auth text not null check (char_length(auth) between 8 and 100),
  hour smallint not null default 20 check (hour between 0 and 23),
  tz text not null default 'America/Santiago' check (char_length(tz) <= 60),
  daily boolean not null default true,
  days date[] not null default '{}' check (cardinality(days) <= 100),
  device text check (char_length(device) <= 80),
  last_sent date,
  test_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists push_subs_user on public.push_subs (user_id);

-- Claves de envío (VAPID): las crea la función la primera vez. Solo el servidor las ve.
create table if not exists public.push_config (
  id smallint primary key default 1 check (id = 1),
  public_key text not null,
  private_jwk jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.push_subs enable row level security;
alter table public.push_config enable row level security;
drop policy if exists push_subs_select on public.push_subs;
create policy push_subs_select on public.push_subs for select to authenticated using (user_id = auth.uid());
revoke all on public.push_subs, public.push_config from anon, authenticated;
grant select on public.push_subs to authenticated;

-- La clave pública (la necesita el teléfono para suscribirse). null si la función aún no corre.
create or replace function public.push_public_key()
returns text language sql stable security definer set search_path = public as $$
  select public_key from push_config where id = 1;
$$;

-- Guarda o actualiza este teléfono (si la dirección era de otra cuenta en el mismo teléfono, pasa a la tuya)
create or replace function public.push_save(
  p_endpoint text, p_p256dh text, p_auth text, p_hour int, p_tz text, p_daily boolean, p_days date[], p_device text
)
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); zone text := coalesce(nullif(btrim(p_tz), ''), 'America/Santiago');
begin
  if me is null then raise exception 'not_authenticated'; end if;
  -- Zona horaria inválida: Santiago
  begin
    perform now() at time zone zone;
  exception when others then
    zone := 'America/Santiago';
  end;
  if (select count(*) from push_subs where user_id = me and endpoint <> p_endpoint) >= 10 then
    delete from push_subs where id = (select id from push_subs where user_id = me order by updated_at limit 1);
  end if;
  insert into push_subs as s (user_id, endpoint, p256dh, auth, hour, tz, daily, days, device)
  values (
    me, p_endpoint, p_p256dh, p_auth, least(greatest(coalesce(p_hour, 20), 0), 23), left(zone, 60),
    coalesce(p_daily, true), (select coalesce(array_agg(d order by d), '{}') from (select distinct d from unnest(p_days) d where d is not null limit 100) x),
    left(p_device, 80)
  )
  on conflict (endpoint) do update set
    user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, hour = excluded.hour, tz = excluded.tz,
    daily = excluded.daily, days = excluded.days, device = excluded.device, updated_at = now(),
    -- Si cambió de cuenta o de hora, que hoy pueda volver a avisar
    last_sent = case when s.user_id = excluded.user_id and s.hour = excluded.hour then s.last_sent end;
  return 'ok';
end;
$$;

-- Este teléfono ya no quiere avisos
create or replace function public.push_remove(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from push_subs where user_id = auth.uid() and endpoint = p_endpoint;
$$;

-- "Probar": la función manda un aviso de prueba a tus teléfonos en su próxima pasada
create or replace function public.push_test()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  update push_subs set test_at = now() where user_id = auth.uid();
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Solo para la función "avisos" (clave de servidor) ─────────────────────────

create or replace function public.push_vapid()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('public_key', public_key, 'private_jwk', private_jwk) from push_config where id = 1;
$$;

create or replace function public.push_vapid_set(p_public text, p_private jsonb)
returns jsonb language sql security definer set search_path = public as $$
  insert into push_config (id, public_key, private_jwk) values (1, p_public, p_private) on conflict (id) do nothing;
  select jsonb_build_object('public_key', public_key, 'private_jwk', private_jwk) from push_config where id = 1;
$$;

-- Los que toca avisar ahora (y los marca, para no repetir): a su hora o hasta 3 horas después,
-- una vez al día, si tienen el recordatorio diario o hoy hay algo que avisar. Más las pruebas.
create or replace function public.push_claim()
returns table (id uuid, endpoint text, p256dh text, auth text, kind text)
language sql security definer set search_path = public as $$
  with due as (
    select s.id,
      case when s.test_at > now() - interval '10 minutes' then 'test' else 'check' end as kind,
      (now() at time zone s.tz)::date as local_day
    from push_subs s
    where s.test_at > now() - interval '10 minutes'
      or (
        extract(hour from now() at time zone s.tz) between s.hour and s.hour + 2
        and (s.last_sent is null or s.last_sent < (now() at time zone s.tz)::date)
        and (s.daily or (now() at time zone s.tz)::date = any (s.days))
      )
    order by s.id
    limit 1000
    for update skip locked
  )
  update push_subs s set
    last_sent = case when due.kind = 'check' then due.local_day else s.last_sent end,
    test_at = null
  from due
  where s.id = due.id
  returning s.id, s.endpoint, s.p256dh, s.auth, due.kind;
$$;

-- Resultado del envío: las direcciones vencidas se borran; las que fallaron se reintentan
create or replace function public.push_result(p_gone uuid[], p_retry uuid[])
returns void language sql security definer set search_path = public as $$
  delete from push_subs where id = any (coalesce(p_gone, '{}'));
  update push_subs set last_sent = null where id = any (coalesce(p_retry, '{}'));
$$;

revoke all on function public.push_public_key() from public, anon;
revoke all on function public.push_save(text, text, text, int, text, boolean, date[], text) from public, anon;
revoke all on function public.push_remove(text) from public, anon;
revoke all on function public.push_test() from public, anon;
revoke all on function public.push_vapid() from public, anon, authenticated;
revoke all on function public.push_vapid_set(text, jsonb) from public, anon, authenticated;
revoke all on function public.push_claim() from public, anon, authenticated;
revoke all on function public.push_result(uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.push_public_key() to authenticated;
grant execute on function public.push_save(text, text, text, int, text, boolean, date[], text) to authenticated;
grant execute on function public.push_remove(text) to authenticated;
grant execute on function public.push_test() to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.push_vapid(), public.push_vapid_set(text, jsonb), public.push_claim(),
      public.push_result(uuid[], uuid[]) to service_role;
  end if;
end $$;

-- Para que la API vea las funciones nuevas al tiro
notify pgrst, 'reload schema';
