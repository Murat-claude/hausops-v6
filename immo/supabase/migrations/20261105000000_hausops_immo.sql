-- HausOps Immobilien – Mehrbenutzer-Backend (Supabase)
-- Jeder Nutzer sieht ausschließlich seine eigenen Daten (Row Level Security).
-- Admins verwalten Konten, Tarife und Rechtstexte, sehen aber KEINE Mieter-/Objektdaten
-- der Kunden – nur Kennzahlen (Anzahl Objekte, Einheiten, Speicher).

-- ------------------------------------------------------------------ Tarife
create table if not exists public.plans (
  id text primary key,
  name text not null,
  price_month_cents integer not null default 0,
  max_units integer,                -- null = unbegrenzt
  ki_included boolean not null default false,
  description text not null default '',
  sort integer not null default 0,
  active boolean not null default true
);

insert into public.plans (id, name, price_month_cents, max_units, ki_included, description, sort) values
  ('trial',    'Testphase', 0,    20,   false, 'Alle Funktionen zum Ausprobieren', 0),
  ('basis',    'Basis',     990,  10,   false, 'Bis 10 Einheiten', 1),
  ('pro',      'Pro',       1990, 50,   false, 'Bis 50 Einheiten, Ferienwohnungen, DATEV', 2),
  ('business', 'Business',  3990, null, true,  'Unbegrenzte Einheiten, KI inklusive', 3),
  ('intern',   'Intern / kostenlos', 0, null, true, 'Für eigene Nutzung und Partner', 9)
on conflict (id) do nothing;

-- ------------------------------------------------------------------ Globale App-Einstellungen (eine Zeile)
create table if not exists public.app_settings (
  id integer primary key default 1 check (id = 1),
  product_name text not null default 'HausOps Immobilien',
  announcement text not null default '',
  registration_open boolean not null default true,
  trial_days integer not null default 30,
  support_email text not null default '',
  impressum text not null default '',
  datenschutz text not null default '',
  agb text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id) values (1) on conflict (id) do nothing;

-- ------------------------------------------------------------------ Profile
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  company text not null default '',
  role text not null default 'user' check (role in ('user', 'admin')),
  plan text not null default 'trial' references public.plans (id),
  status text not null default 'active' check (status in ('active', 'blocked')),
  trial_ends_at timestamptz,
  admin_note text not null default '',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

-- ------------------------------------------------------------------ Daten je Nutzer (ein JSON-Dokument, versioniert)
create table if not exists public.app_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  version integer not null default 0,
  stats jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ Admin-Protokoll
create table if not exists public.admin_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  admin_id uuid,
  target_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb
);

-- ------------------------------------------------------------------ Hilfsfunktionen
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and status = 'active');
$$;

create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active');
$$;

-- Neues Konto: Profil + leeres Datendokument. Das allererste Konto wird Admin.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s public.app_settings;
  first_user boolean;
begin
  select * into s from public.app_settings where id = 1;
  first_user := not exists (select 1 from public.profiles);
  if not first_user and not coalesce(s.registration_open, true) then
    raise exception 'Die Registrierung ist derzeit geschlossen.';
  end if;
  insert into public.profiles (id, email, full_name, company, role, plan, trial_ends_at)
  values (
    new.id, coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'company', ''),
    case when first_user then 'admin' else 'user' end,
    case when first_user then 'intern' else 'trial' end,
    case when first_user then null else now() + make_interval(days => coalesce(s.trial_days, 30)) end
  );
  insert into public.app_state (user_id) values (new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Speichern mit Versionsprüfung (verhindert, dass zwei Geräte sich überschreiben)
-- und serverseitiger Prüfung des Tarif-Limits.
create or replace function public.save_state(p_data jsonb, p_version integer) returns integer
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  prof public.profiles;
  lim integer;
  new_units integer := coalesce(jsonb_array_length(p_data -> 'units'), 0);
  old_units integer;
  new_version integer;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into prof from public.profiles where id = uid;
  if prof.status <> 'active' then raise exception 'account_blocked'; end if;
  select max_units into lim from public.plans where id = prof.plan;
  select coalesce((stats ->> 'units')::int, 0) into old_units from public.app_state where user_id = uid;
  if lim is not null and new_units > lim and new_units > coalesce(old_units, 0) then
    raise exception 'plan_limit:%', lim;
  end if;
  update public.app_state set
    data = p_data,
    version = version + 1,
    updated_at = now(),
    stats = jsonb_build_object(
      'objects', coalesce(jsonb_array_length(p_data -> 'objects'), 0),
      'units', new_units,
      'contracts', coalesce(jsonb_array_length(p_data -> 'contracts'), 0),
      'documents', coalesce(jsonb_array_length(p_data -> 'documents'), 0),
      'transactions', coalesce(jsonb_array_length(p_data -> 'transactions'), 0),
      'invoices', coalesce(jsonb_array_length(p_data -> 'invoices'), 0),
      'bytes', octet_length(p_data::text))
  where user_id = uid and version = p_version
  returning version into new_version;
  if new_version is null then raise exception 'version_conflict'; end if;
  return new_version;
end;
$$;

create or replace function public.touch_last_seen() returns void
language sql security definer set search_path = public as $$
  update public.profiles set last_seen_at = now() where id = auth.uid();
$$;

-- ------------------------------------------------------------------ Admin-Funktionen
create or replace function public.admin_users()
returns table (
  id uuid, email text, full_name text, company text, role text, plan text, status text,
  trial_ends_at timestamptz, admin_note text, created_at timestamptz, last_seen_at timestamptz,
  stats jsonb, data_updated_at timestamptz, storage_bytes bigint
)
language plpgsql stable security definer set search_path = public, storage as $$
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  return query
    select p.id, p.email, p.full_name, p.company, p.role, p.plan, p.status, p.trial_ends_at, p.admin_note,
           p.created_at, p.last_seen_at, s.stats, s.updated_at,
           coalesce((select sum((o.metadata ->> 'size')::bigint) from storage.objects o
                     where o.bucket_id = 'belege' and (storage.foldername(o.name))[1] = p.id::text), 0)::bigint
    from public.profiles p left join public.app_state s on s.user_id = p.id
    order by p.created_at desc;
end;
$$;

create or replace function public.admin_update_user(
  p_id uuid, p_plan text default null, p_status text default null, p_role text default null,
  p_trial_ends_at timestamptz default null, p_clear_trial boolean default false, p_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare before public.profiles;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  if p_id = auth.uid() and (p_status = 'blocked' or p_role = 'user') then
    raise exception 'Du kannst dich nicht selbst sperren oder dir die Admin-Rechte entziehen.';
  end if;
  select * into before from public.profiles where id = p_id;
  if not found then raise exception 'Nutzer nicht gefunden'; end if;
  update public.profiles set
    plan = coalesce(p_plan, plan),
    status = coalesce(p_status, status),
    role = coalesce(p_role, role),
    trial_ends_at = case when p_clear_trial then null else coalesce(p_trial_ends_at, trial_ends_at) end,
    admin_note = coalesce(p_note, admin_note)
  where id = p_id;
  insert into public.admin_log (admin_id, target_id, action, details)
  values (auth.uid(), p_id, 'update_user', jsonb_build_object(
    'plan', jsonb_build_array(before.plan, p_plan), 'status', jsonb_build_array(before.status, p_status),
    'role', jsonb_build_array(before.role, p_role), 'trial_ends_at', p_trial_ends_at));
end;
$$;

-- ------------------------------------------------------------------ Rechte & Row Level Security
alter table public.profiles enable row level security;
alter table public.app_state enable row level security;
alter table public.plans enable row level security;
alter table public.app_settings enable row level security;
alter table public.admin_log enable row level security;

revoke all on public.profiles, public.app_state, public.plans, public.app_settings, public.admin_log from anon, authenticated;
grant select on public.plans, public.app_settings to anon, authenticated;
grant select on public.profiles, public.app_state, public.admin_log to authenticated;
grant update (full_name, company) on public.profiles to authenticated;
grant insert, update, delete on public.plans to authenticated;
grant update on public.app_settings to authenticated;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists app_state_select_own on public.app_state;
create policy app_state_select_own on public.app_state for select to authenticated
  using (user_id = auth.uid() and public.is_active());

drop policy if exists plans_read on public.plans;
create policy plans_read on public.plans for select to anon, authenticated using (true);
drop policy if exists plans_admin_write on public.plans;
create policy plans_admin_write on public.plans for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists settings_read on public.app_settings;
create policy settings_read on public.app_settings for select to anon, authenticated using (true);
drop policy if exists settings_admin_write on public.app_settings;
create policy settings_admin_write on public.app_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists admin_log_read on public.admin_log;
create policy admin_log_read on public.admin_log for select to authenticated using (public.is_admin());

revoke all on function public.save_state(jsonb, integer), public.touch_last_seen(), public.admin_users(),
  public.admin_update_user(uuid, text, text, text, timestamptz, boolean, text) from public, anon;
grant execute on function public.save_state(jsonb, integer), public.touch_last_seen(), public.admin_users(),
  public.admin_update_user(uuid, text, text, text, timestamptz, boolean, text), public.is_admin(), public.is_active() to authenticated;

-- ------------------------------------------------------------------ Belege (Storage): Ordner je Nutzer
insert into storage.buckets (id, name, public) values ('belege', 'belege', false) on conflict (id) do nothing;

drop policy if exists belege_own_select on storage.objects;
create policy belege_own_select on storage.objects for select to authenticated
  using (bucket_id = 'belege' and (storage.foldername(name))[1] = auth.uid()::text and public.is_active());
drop policy if exists belege_own_insert on storage.objects;
create policy belege_own_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'belege' and (storage.foldername(name))[1] = auth.uid()::text and public.is_active());
drop policy if exists belege_own_update on storage.objects;
create policy belege_own_update on storage.objects for update to authenticated
  using (bucket_id = 'belege' and (storage.foldername(name))[1] = auth.uid()::text and public.is_active());
drop policy if exists belege_own_delete on storage.objects;
create policy belege_own_delete on storage.objects for delete to authenticated
  using (bucket_id = 'belege' and (storage.foldername(name))[1] = auth.uid()::text and public.is_active());
