-- HausOps Immobilien – KOMPLETTE Einrichtung in EINEM Schritt
-- Supabase → SQL Editor → New query → diesen ganzen Inhalt einfügen → Run. Nur einmal ausführen (bei einem neuen, leeren Projekt).


-- ===== 20261105000000_hausops_immo.sql =====
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

-- ===== 20261106000000_billing.sql =====
-- HausOps Immobilien – Online-Bezahlung (Stripe-Abos)

alter table public.plans add column if not exists stripe_price_id text not null default '';

alter table public.profiles add column if not exists stripe_customer_id text not null default '';
alter table public.profiles add column if not exists stripe_subscription_id text not null default '';
alter table public.profiles add column if not exists subscription_status text not null default '';
alter table public.profiles add column if not exists current_period_end timestamptz;
alter table public.profiles add column if not exists cancel_at_period_end boolean not null default false;

-- Darf das Konto Daten ändern? Testphase abgelaufen bzw. Abo beendet → nur noch lesen und exportieren.
create or replace function public.can_write(p public.profiles) returns boolean
language sql stable as $$
  select p.status = 'active' and (
    p.role = 'admin'
    or p.plan <> 'trial'
    or p.trial_ends_at is null
    or p.trial_ends_at > now()
  );
$$;

-- save_state: zusätzlich Schreibsperre nach Ablauf der Testphase
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
  if not public.can_write(prof) then raise exception 'trial_expired'; end if;
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

-- Belege hochladen nur mit Schreibrecht (Lesen/Löschen bleibt erlaubt)
drop policy if exists belege_own_insert on storage.objects;
create policy belege_own_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'belege' and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.profiles p where p.id = auth.uid() and public.can_write(p)));

-- Admin-Liste um Abo-Daten erweitern (Rückgabetyp ändert sich → neu anlegen)
drop function if exists public.admin_users();
create function public.admin_users()
returns table (
  id uuid, email text, full_name text, company text, role text, plan text, status text,
  trial_ends_at timestamptz, admin_note text, created_at timestamptz, last_seen_at timestamptz,
  stats jsonb, data_updated_at timestamptz, storage_bytes bigint,
  subscription_status text, current_period_end timestamptz, cancel_at_period_end boolean, stripe_customer_id text
)
language plpgsql stable security definer set search_path = public, storage as $$
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  return query
    select p.id, p.email, p.full_name, p.company, p.role, p.plan, p.status, p.trial_ends_at, p.admin_note,
           p.created_at, p.last_seen_at, s.stats, s.updated_at,
           coalesce((select sum((o.metadata ->> 'size')::bigint) from storage.objects o
                     where o.bucket_id = 'belege' and (storage.foldername(o.name))[1] = p.id::text), 0)::bigint,
           p.subscription_status, p.current_period_end, p.cancel_at_period_end, p.stripe_customer_id
    from public.profiles p left join public.app_state s on s.user_id = p.id
    order by p.created_at desc;
end;
$$;
revoke all on function public.admin_users() from public, anon;
grant execute on function public.admin_users() to authenticated;

-- ===== 20261107000000_legal.sql =====
-- HausOps Immobilien – Rechtliches für den Verkauf an Kunden
-- * Nachweis der Zustimmung zu AGB/Datenschutz und zum Auftragsverarbeitungsvertrag (Art. 28 DSGVO)
-- * Widerrufsbelehrung, Preisangaben (PAngV) als pflegbare Texte
-- * Kündigungen über den Kündigungsbutton (§ 312k BGB) – auch ohne Anmeldung

alter table public.profiles add column if not exists terms_accepted_at timestamptz;
alter table public.profiles add column if not exists avv_accepted_at timestamptz;
alter table public.profiles add column if not exists legal_version text not null default '';

alter table public.app_settings add column if not exists avv text not null default '';
alter table public.app_settings add column if not exists widerruf text not null default '';
alter table public.app_settings add column if not exists price_note text not null default 'Alle Preise inkl. gesetzlicher Umsatzsteuer.';
alter table public.app_settings add column if not exists legal_version text not null default '2026-11';

create table if not exists public.cancellations (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  name text not null,
  email text not null,
  account_email text not null default '',
  contract_ref text not null default '',
  kind text not null default 'ordentlich' check (kind in ('ordentlich', 'ausserordentlich', 'widerruf')),
  reason text not null default '',
  wished_date text not null default 'naechstmoeglich',
  user_id uuid,
  effective_at timestamptz,
  status text not null default 'eingegangen',
  confirmation_sent boolean not null default false
);
alter table public.cancellations enable row level security;
revoke all on public.cancellations from anon, authenticated;
grant select, update on public.cancellations to authenticated;
drop policy if exists cancellations_admin on public.cancellations;
create policy cancellations_admin on public.cancellations for select to authenticated using (public.is_admin());
drop policy if exists cancellations_admin_update on public.cancellations;
create policy cancellations_admin_update on public.cancellations for update to authenticated using (public.is_admin()) with check (public.is_admin());
-- Einträge entstehen ausschließlich über die Netlify-Function immo-kuendigung (Service-Schlüssel).

-- Zustimmungen aus der Registrierung übernehmen
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
  insert into public.profiles (id, email, full_name, company, role, plan, trial_ends_at, terms_accepted_at, avv_accepted_at, legal_version)
  values (
    new.id, coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'company', ''),
    case when first_user then 'admin' else 'user' end,
    case when first_user then 'intern' else 'trial' end,
    case when first_user then null else now() + make_interval(days => coalesce(s.trial_days, 30)) end,
    case when new.raw_user_meta_data ? 'terms_accepted' then now() end,
    case when new.raw_user_meta_data ? 'avv_accepted' then now() end,
    coalesce(s.legal_version, '')
  );
  insert into public.app_state (user_id) values (new.id);
  return new;
end;
$$;

-- Zustimmung später nachholen (z. B. nach neuer AVV-Version)
create or replace function public.accept_legal() returns void
language sql security definer set search_path = public as $$
  update public.profiles set terms_accepted_at = now(), avv_accepted_at = now(),
    legal_version = (select legal_version from public.app_settings where id = 1)
  where id = auth.uid();
$$;
revoke all on function public.accept_legal() from public, anon;
grant execute on function public.accept_legal() to authenticated;

-- ===== 20261108000000_team.sql =====
-- HausOps Immobilien – Team-Zugriff: mehrere Personen auf einen gemeinsamen Bestand
-- Ein Bestand gehört seinem Inhaber (app_state.user_id = Inhaber). Mitglieder erhalten Zugriff mit Rolle:
--   editor = bearbeiten (z. B. Ehepartner, Mitarbeiter) · viewer = nur lesen (z. B. Steuerberater)
-- Abo und Tarif-Limits richten sich nach dem Inhaber.

alter table public.plans add column if not exists max_members integer; -- zusätzliche Personen; null = unbegrenzt
update public.plans set max_members = case id when 'trial' then 2 when 'basis' then 1 when 'pro' then 4 else null end where max_members is null;

alter table public.app_state add column if not exists updated_by uuid;

create table if not exists public.workspace_members (
  owner_id uuid not null references auth.users (id) on delete cascade,
  member_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'editor' check (role in ('editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (owner_id, member_id),
  check (owner_id <> member_id)
);

create table if not exists public.workspace_invites (
  id bigserial primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'editor' check (role in ('editor', 'viewer')),
  token uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid
);

-- Rolle des angemeldeten Nutzers im Bestand eines Inhabers: owner / editor / viewer / null
create or replace function public.ws_role(p_owner uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p_owner = auth.uid() then 'owner'
    else (select m.role from public.workspace_members m where m.owner_id = p_owner and m.member_id = auth.uid())
  end;
$$;

-- Darf in den Bestand geschrieben werden? (Inhaber aktiv, Testphase/Abo gültig) – security definer, da Profile per RLS privat sind
create or replace function public.ws_owner_active(p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = p_owner and p.status = 'active');
$$;
create or replace function public.ws_can_write(p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = p_owner and public.can_write(p));
$$;

-- Bestände, auf die ich Zugriff habe (eigener + geteilte)
create or replace function public.my_workspaces()
returns table (owner_id uuid, owner_name text, owner_email text, role text)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(nullif(p.company, ''), nullif(p.full_name, ''), p.email), p.email, 'owner'::text from public.profiles p where p.id = auth.uid()
  union all
  select p.id, coalesce(nullif(p.company, ''), nullif(p.full_name, ''), p.email), p.email, m.role
  from public.workspace_members m join public.profiles p on p.id = m.owner_id
  where m.member_id = auth.uid() and p.status = 'active';
$$;

-- Lesen: Inhaber und Mitglieder (Inhaber-Konto muss aktiv sein)
drop policy if exists app_state_select_own on public.app_state;
create policy app_state_select_own on public.app_state for select to authenticated
  using (public.ws_role(user_id) is not null and public.ws_owner_active(user_id) and public.is_active());

-- Speichern in einen Bestand (eigener oder geteilter) – Rechte, Sperre, Testphase und Tarif des Inhabers
drop function if exists public.save_state(jsonb, integer);
create or replace function public.save_state(p_data jsonb, p_version integer, p_owner uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  owner uuid := coalesce(p_owner, auth.uid());
  me public.profiles;
  prof public.profiles;
  r text;
  lim integer;
  new_units integer := coalesce(jsonb_array_length(p_data -> 'units'), 0);
  old_units integer;
  new_version integer;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into me from public.profiles where id = uid;
  if me.status <> 'active' then raise exception 'account_blocked'; end if;
  r := public.ws_role(owner);
  if r is null then raise exception 'no_access'; end if;
  if r = 'viewer' then raise exception 'read_only'; end if;
  select * into prof from public.profiles where id = owner;
  if prof.status <> 'active' then raise exception 'account_blocked'; end if;
  if not public.can_write(prof) then raise exception 'trial_expired'; end if;
  select max_units into lim from public.plans where id = prof.plan;
  select coalesce((stats ->> 'units')::int, 0) into old_units from public.app_state where user_id = owner;
  if lim is not null and new_units > lim and new_units > coalesce(old_units, 0) then
    raise exception 'plan_limit:%', lim;
  end if;
  update public.app_state set
    data = p_data, version = version + 1, updated_at = now(), updated_by = uid,
    stats = jsonb_build_object(
      'objects', coalesce(jsonb_array_length(p_data -> 'objects'), 0), 'units', new_units,
      'contracts', coalesce(jsonb_array_length(p_data -> 'contracts'), 0), 'documents', coalesce(jsonb_array_length(p_data -> 'documents'), 0),
      'transactions', coalesce(jsonb_array_length(p_data -> 'transactions'), 0), 'invoices', coalesce(jsonb_array_length(p_data -> 'invoices'), 0),
      'bytes', octet_length(p_data::text))
  where user_id = owner and version = p_version
  returning version into new_version;
  if new_version is null then raise exception 'version_conflict'; end if;
  return new_version;
end;
$$;
revoke all on function public.save_state(jsonb, integer, uuid) from public, anon;
grant execute on function public.save_state(jsonb, integer, uuid), public.ws_role(uuid), public.ws_owner_active(uuid), public.ws_can_write(uuid), public.my_workspaces() to authenticated;

-- Leichter Abruf für den Abgleich im Team: aktuelle Version + wer zuletzt geändert hat (ohne die Daten selbst)
create or replace function public.state_info(p_owner uuid)
returns table (version integer, updated_at timestamptz, updated_by uuid, updated_by_name text)
language sql stable security definer set search_path = public as $$
  select s.version, s.updated_at, s.updated_by, coalesce(nullif(p.full_name, ''), p.email)
  from public.app_state s left join public.profiles p on p.id = s.updated_by
  where s.user_id = p_owner and public.ws_role(p_owner) is not null;
$$;
revoke all on function public.state_info(uuid) from public, anon;
grant execute on function public.state_info(uuid) to authenticated;

-- Einladungen (nur Inhaber)
create or replace function public.create_invite(p_email text, p_role text default 'editor') returns uuid
language plpgsql security definer set search_path = public as $$
declare
  prof public.profiles; lim integer; used integer; t uuid;
begin
  select * into prof from public.profiles where id = auth.uid();
  if prof.status <> 'active' then raise exception 'account_blocked'; end if;
  if p_role not in ('editor', 'viewer') then raise exception 'Ungültige Rolle'; end if;
  if lower(trim(p_email)) = lower(prof.email) then raise exception 'Du kannst dich nicht selbst einladen.'; end if;
  select max_members into lim from public.plans where id = prof.plan;
  select (select count(*) from public.workspace_members where owner_id = prof.id)
       + (select count(*) from public.workspace_invites where owner_id = prof.id and accepted_at is null and expires_at > now()) into used;
  if lim is not null and used >= lim then raise exception 'member_limit:%', lim; end if;
  insert into public.workspace_invites (owner_id, email, role) values (prof.id, lower(trim(p_email)), p_role) returning token into t;
  return t;
end;
$$;

-- Einladung annehmen: nur mit der eingeladenen E-Mail-Adresse
create or replace function public.accept_invite(p_token uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare inv public.workspace_invites; my_email text;
begin
  select email into my_email from public.profiles where id = auth.uid();
  select * into inv from public.workspace_invites where token = p_token;
  if not found or inv.accepted_at is not null or inv.expires_at < now() then raise exception 'Einladung ungültig oder abgelaufen.'; end if;
  if lower(my_email) <> lower(inv.email) then raise exception 'Diese Einladung gilt für %. Bitte mit dieser E-Mail-Adresse anmelden.', inv.email; end if;
  insert into public.workspace_members (owner_id, member_id, role) values (inv.owner_id, auth.uid(), inv.role)
    on conflict (owner_id, member_id) do update set role = excluded.role;
  update public.workspace_invites set accepted_at = now(), accepted_by = auth.uid() where id = inv.id;
  return inv.owner_id;
end;
$$;

-- Offene Einladungen an meine E-Mail-Adresse
create or replace function public.my_invites()
returns table (token uuid, owner_name text, role text, expires_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.token, coalesce(nullif(p.company, ''), nullif(p.full_name, ''), p.email), i.role, i.expires_at
  from public.workspace_invites i join public.profiles p on p.id = i.owner_id
  where lower(i.email) = (select lower(email) from public.profiles where id = auth.uid()) and i.accepted_at is null and i.expires_at > now();
$$;

-- Team verwalten (Inhaber): Mitglieder und offene Einladungen
create or replace function public.team()
returns table (kind text, member_id uuid, email text, name text, role text, since timestamptz, token uuid)
language sql stable security definer set search_path = public as $$
  select 'member', m.member_id, p.email, p.full_name, m.role, m.created_at, null::uuid
  from public.workspace_members m join public.profiles p on p.id = m.member_id where m.owner_id = auth.uid()
  union all
  select 'invite', null, i.email, '', i.role, i.created_at, i.token
  from public.workspace_invites i where i.owner_id = auth.uid() and i.accepted_at is null and i.expires_at > now();
$$;

create or replace function public.team_set_role(p_member uuid, p_role text) returns void
language sql security definer set search_path = public as $$
  update public.workspace_members set role = p_role where owner_id = auth.uid() and member_id = p_member and p_role in ('editor', 'viewer');
$$;

-- Inhaber entfernt Mitglied – oder Mitglied verlässt den Bestand
create or replace function public.team_remove(p_owner uuid, p_member uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.workspace_members where owner_id = p_owner and member_id = p_member and (auth.uid() = p_owner or auth.uid() = p_member);
$$;

create or replace function public.team_revoke_invite(p_token uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.workspace_invites where token = p_token and owner_id = auth.uid() and accepted_at is null;
$$;

alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;
revoke all on public.workspace_members, public.workspace_invites from anon, authenticated;
revoke all on function public.create_invite(text, text), public.accept_invite(uuid), public.my_invites(), public.team(), public.team_set_role(uuid, text), public.team_remove(uuid, uuid), public.team_revoke_invite(uuid) from public, anon;
grant execute on function public.create_invite(text, text), public.accept_invite(uuid), public.my_invites(), public.team(), public.team_set_role(uuid, text), public.team_remove(uuid, uuid), public.team_revoke_invite(uuid) to authenticated;

-- Belege: Ordner des Inhabers, Zugriff für Mitglieder (Hochladen/Löschen nur mit Bearbeitungsrecht)
create or replace function public.ws_folder_owner(p_name text) returns uuid
language sql immutable as $$
  select case when (storage.foldername(p_name))[1] ~ '^[0-9a-fA-F-]{36}$' then ((storage.foldername(p_name))[1])::uuid end;
$$;
drop policy if exists belege_own_select on storage.objects;
create policy belege_own_select on storage.objects for select to authenticated
  using (bucket_id = 'belege' and public.ws_role(public.ws_folder_owner(name)) is not null and public.ws_owner_active(public.ws_folder_owner(name)) and public.is_active());
drop policy if exists belege_own_insert on storage.objects;
create policy belege_own_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'belege' and public.ws_role(public.ws_folder_owner(name)) in ('owner', 'editor')
    and public.ws_can_write(public.ws_folder_owner(name)));
drop policy if exists belege_own_update on storage.objects;
create policy belege_own_update on storage.objects for update to authenticated
  using (bucket_id = 'belege' and public.ws_role(public.ws_folder_owner(name)) in ('owner', 'editor'));
drop policy if exists belege_own_delete on storage.objects;
create policy belege_own_delete on storage.objects for delete to authenticated
  using (bucket_id = 'belege' and public.ws_role(public.ws_folder_owner(name)) in ('owner', 'editor'));

-- Admin-Übersicht: Teamgröße je Kunde
create or replace function public.admin_team_sizes() returns table (owner_id uuid, members bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  return query select m.owner_id, count(*) from public.workspace_members m group by m.owner_id;
end;
$$;
revoke all on function public.admin_team_sizes() from public, anon;
grant execute on function public.admin_team_sizes() to authenticated;

-- ===== 20261109000000_admin_groups.sql =====
-- HausOps Immobilien – Admin: Vermieter-Gruppen (Inhaber + weitere Personen) verwalten
-- Der Admin kann Personen zu einem Kundenbestand hinzufügen, Rollen ändern und entfernen.
-- Schutz der Kundendaten: Über den Admin-Bereich können KEINE Admin-Konten in fremde Bestände aufgenommen werden
-- (sonst könnte sich ein Admin selbst Einsicht verschaffen). Jede Aktion wird protokolliert.

-- Alle Mitgliedschaften (für die Gruppenübersicht im Admin-Bereich)
create or replace function public.admin_memberships()
returns table (owner_id uuid, member_id uuid, role text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  return query select m.owner_id, m.member_id, m.role, m.created_at from public.workspace_members m;
end;
$$;

-- Offene Einladungen eines Bestands
create or replace function public.admin_invites(p_owner uuid)
returns table (email text, role text, token uuid, created_at timestamptz, expires_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  return query select i.email, i.role, i.token, i.created_at, i.expires_at from public.workspace_invites i
    where i.owner_id = p_owner and i.accepted_at is null and i.expires_at > now() order by i.created_at;
end;
$$;

-- Person zu einem Bestand hinzufügen: vorhandenes Konto → sofort Mitglied, sonst Einladung (Token zurück)
create or replace function public.admin_add_member(p_owner uuid, p_email text, p_role text default 'editor')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  target public.profiles; owner_prof public.profiles; t uuid; em text := lower(trim(p_email));
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  if p_role not in ('editor', 'viewer') then raise exception 'Ungültige Rolle'; end if;
  select * into owner_prof from public.profiles where id = p_owner;
  if not found then raise exception 'Bestand nicht gefunden'; end if;
  if em = lower(owner_prof.email) then raise exception 'Das ist bereits der Inhaber.'; end if;
  select * into target from public.profiles where lower(email) = em;
  if found then
    if target.role = 'admin' and target.id <> p_owner then
      raise exception 'Admin-Konten können nicht in Kundenbestände aufgenommen werden (Datenschutz). Bitte ein normales Konto verwenden.';
    end if;
    insert into public.workspace_members (owner_id, member_id, role) values (p_owner, target.id, p_role)
      on conflict (owner_id, member_id) do update set role = excluded.role;
    insert into public.admin_log (admin_id, target_id, action, details)
      values (auth.uid(), p_owner, 'group_add_member', jsonb_build_object('member', em, 'role', p_role));
    return jsonb_build_object('added', true, 'member_id', target.id);
  end if;
  insert into public.workspace_invites (owner_id, email, role) values (p_owner, em, p_role) returning token into t;
  insert into public.admin_log (admin_id, target_id, action, details)
    values (auth.uid(), p_owner, 'group_invite', jsonb_build_object('email', em, 'role', p_role));
  return jsonb_build_object('added', false, 'token', t);
end;
$$;

create or replace function public.admin_set_member_role(p_owner uuid, p_member uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  if p_role not in ('editor', 'viewer') then raise exception 'Ungültige Rolle'; end if;
  update public.workspace_members set role = p_role where owner_id = p_owner and member_id = p_member;
  insert into public.admin_log (admin_id, target_id, action, details)
    values (auth.uid(), p_owner, 'group_role', jsonb_build_object('member_id', p_member, 'role', p_role));
end;
$$;

create or replace function public.admin_remove_member(p_owner uuid, p_member uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  delete from public.workspace_members where owner_id = p_owner and member_id = p_member;
  insert into public.admin_log (admin_id, target_id, action, details)
    values (auth.uid(), p_owner, 'group_remove_member', jsonb_build_object('member_id', p_member));
end;
$$;

create or replace function public.admin_revoke_invite(p_token uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o uuid;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  delete from public.workspace_invites where token = p_token and accepted_at is null returning owner_id into o;
  insert into public.admin_log (admin_id, target_id, action, details) values (auth.uid(), o, 'group_revoke_invite', '{}'::jsonb);
end;
$$;

revoke all on function public.admin_memberships(), public.admin_invites(uuid), public.admin_add_member(uuid, text, text),
  public.admin_set_member_role(uuid, uuid, text), public.admin_remove_member(uuid, uuid), public.admin_revoke_invite(uuid) from public, anon;
grant execute on function public.admin_memberships(), public.admin_invites(uuid), public.admin_add_member(uuid, text, text),
  public.admin_set_member_role(uuid, uuid, text), public.admin_remove_member(uuid, uuid), public.admin_revoke_invite(uuid) to authenticated;

-- Hinweis: Lädt ein Inhaber selbst ein Admin-Konto ein, ist das seine Entscheidung (Einwilligung des Verantwortlichen).
-- Gesperrt ist nur, dass ein Admin über den Admin-Bereich Admin-Konten in fremde Bestände aufnimmt.

-- ===== 20261110000000_portal.sql =====
-- HausOps Immobilien – Mieterportal
-- Mieter bekommen einen eigenen Zugang (Einladung per Link, nur mit der eingeladenen E-Mail).
-- Sie sehen NUR ihre eigenen Infos, geteilte Dokumente und ihre Nachrichten – nie den Bestand des Vermieters.
-- Sie können Schäden melden (mit Foto), Zählerstände melden und Nachrichten schreiben.

alter table public.profiles add column if not exists account_type text not null default 'vermieter'
  check (account_type in ('vermieter', 'mieter'));

create table if not exists public.portal_tenants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,   -- Bestand (Vermieter)
  tenant_key text not null,                                              -- Mieter-ID im Bestand
  email text not null,
  user_id uuid references auth.users (id) on delete set null,           -- Konto des Mieters nach Annahme
  token uuid not null default gen_random_uuid() unique,
  info jsonb not null default '{}'::jsonb,                               -- vom Vermieter freigegebene Infos (Wohnung, Miete, Kontakt)
  invited_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  accepted_at timestamptz,
  revoked_at timestamptz,
  unique (owner_id, tenant_key)
);

create table if not exists public.portal_items (
  id bigserial primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  tenant_key text not null,
  direction text not null check (direction in ('mieter', 'vermieter')),
  kind text not null check (kind in ('nachricht', 'mangel', 'zaehler', 'dokument')),
  title text not null default '' check (length(title) <= 200),
  body text not null default '' check (length(body) <= 5000),
  data jsonb not null default '{}'::jsonb,                               -- Fotos (Pfade), Zählerart/-stand, Dokumentpfad …
  status text not null default 'neu' check (status in ('neu', 'gesehen', 'in_bearbeitung', 'erledigt')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  read_by_owner_at timestamptz,
  read_by_tenant_at timestamptz
);
create index if not exists portal_items_owner on public.portal_items (owner_id, created_at desc);
create index if not exists portal_items_tenant on public.portal_items (owner_id, tenant_key, created_at desc);

-- Bin ich (als Mieter) für diesen Bestand + Mieter freigeschaltet?
create or replace function public.portal_is_tenant(p_owner uuid, p_tenant_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.portal_tenants t where t.owner_id = p_owner and t.tenant_key = p_tenant_key
    and t.user_id = auth.uid() and t.accepted_at is not null and t.revoked_at is null)
    and public.ws_owner_active(p_owner);
$$;

alter table public.portal_tenants enable row level security;
alter table public.portal_items enable row level security;
revoke all on public.portal_tenants, public.portal_items from anon;
grant select, insert, update, delete on public.portal_tenants to authenticated;
grant select, insert, update on public.portal_items to authenticated;
grant usage on sequence public.portal_items_id_seq to authenticated;

-- Vermieter-Team: alles im eigenen Bestand (Nur-Lesen-Mitglieder nur lesen)
drop policy if exists portal_tenants_team_read on public.portal_tenants;
create policy portal_tenants_team_read on public.portal_tenants for select to authenticated
  using (public.ws_role(owner_id) is not null);
drop policy if exists portal_tenants_team_write on public.portal_tenants;
create policy portal_tenants_team_write on public.portal_tenants for all to authenticated
  using (public.ws_role(owner_id) in ('owner', 'editor')) with check (public.ws_role(owner_id) in ('owner', 'editor'));
-- Mieter: nur die eigene Freischaltung lesen
drop policy if exists portal_tenants_self on public.portal_tenants;
create policy portal_tenants_self on public.portal_tenants for select to authenticated
  using (user_id = auth.uid() and revoked_at is null);

drop policy if exists portal_items_team_read on public.portal_items;
create policy portal_items_team_read on public.portal_items for select to authenticated
  using (public.ws_role(owner_id) is not null);
drop policy if exists portal_items_team_insert on public.portal_items;
create policy portal_items_team_insert on public.portal_items for insert to authenticated
  with check (public.ws_role(owner_id) in ('owner', 'editor') and direction = 'vermieter' and created_by = auth.uid());
drop policy if exists portal_items_team_update on public.portal_items;
create policy portal_items_team_update on public.portal_items for update to authenticated
  using (public.ws_role(owner_id) in ('owner', 'editor')) with check (public.ws_role(owner_id) in ('owner', 'editor'));
drop policy if exists portal_items_tenant_read on public.portal_items;
create policy portal_items_tenant_read on public.portal_items for select to authenticated
  using (public.portal_is_tenant(owner_id, tenant_key));
drop policy if exists portal_items_tenant_insert on public.portal_items;
create policy portal_items_tenant_insert on public.portal_items for insert to authenticated
  with check (public.portal_is_tenant(owner_id, tenant_key) and direction = 'mieter' and kind in ('nachricht', 'mangel', 'zaehler')
    and created_by = auth.uid() and status = 'neu' and read_by_owner_at is null);

-- Mieter markiert Nachrichten als gelesen (ohne sonstige Änderungsrechte)
create or replace function public.portal_mark_read(p_owner uuid, p_tenant_key text) returns void
language sql security definer set search_path = public as $$
  update public.portal_items set read_by_tenant_at = now()
  where owner_id = p_owner and tenant_key = p_tenant_key and direction = 'vermieter' and read_by_tenant_at is null
    and public.portal_is_tenant(p_owner, p_tenant_key);
$$;

-- Meine Mieterportale (für den Mieter)
create or replace function public.my_portals()
returns table (id uuid, owner_id uuid, tenant_key text, owner_name text, info jsonb)
language sql stable security definer set search_path = public as $$
  select t.id, t.owner_id, t.tenant_key, coalesce(nullif(p.company, ''), nullif(p.full_name, ''), p.email), t.info
  from public.portal_tenants t join public.profiles p on p.id = t.owner_id
  where t.user_id = auth.uid() and t.accepted_at is not null and t.revoked_at is null and p.status = 'active';
$$;

-- Einladung ansehen (vor der Anmeldung: nur Name des Vermieters und E-Mail-Hinweis)
create or replace function public.portal_invite_info(p_token uuid)
returns table (owner_name text, email_hint text, valid boolean)
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(p.company, ''), nullif(p.full_name, ''), 'Ihr Vermieter'),
    regexp_replace(t.email, '^(.).*(@.*)$', '\1…\2'),
    t.accepted_at is null and t.revoked_at is null and t.expires_at > now()
  from public.portal_tenants t join public.profiles p on p.id = t.owner_id where t.token = p_token;
$$;

-- Einladung annehmen (nur mit der eingeladenen E-Mail-Adresse)
create or replace function public.accept_portal_invite(p_token uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare t public.portal_tenants; my_email text;
begin
  select email into my_email from public.profiles where id = auth.uid();
  select * into t from public.portal_tenants where token = p_token;
  if not found or t.revoked_at is not null or (t.accepted_at is not null and t.user_id <> auth.uid()) or (t.accepted_at is null and t.expires_at < now()) then
    raise exception 'Einladung ungültig oder abgelaufen – bitte beim Vermieter eine neue anfordern.';
  end if;
  if lower(my_email) <> lower(t.email) then raise exception 'Diese Einladung gilt für eine andere E-Mail-Adresse. Bitte mit der Adresse anmelden, an die die Einladung ging.'; end if;
  update public.portal_tenants set user_id = auth.uid(), accepted_at = coalesce(accepted_at, now()) where id = t.id;
  return t.owner_id;
end;
$$;

-- Offene Portal-Einladungen an meine E-Mail
create or replace function public.my_portal_invites()
returns table (token uuid, owner_name text)
language sql stable security definer set search_path = public as $$
  select t.token, coalesce(nullif(p.company, ''), nullif(p.full_name, ''), p.email)
  from public.portal_tenants t join public.profiles p on p.id = t.owner_id
  where lower(t.email) = (select lower(email) from public.profiles where id = auth.uid())
    and t.accepted_at is null and t.revoked_at is null and t.expires_at > now();
$$;

revoke all on function public.portal_is_tenant(uuid, text), public.portal_mark_read(uuid, text), public.my_portals(), public.accept_portal_invite(uuid), public.my_portal_invites() from public, anon;
grant execute on function public.portal_is_tenant(uuid, text), public.portal_mark_read(uuid, text), public.my_portals(), public.accept_portal_invite(uuid), public.my_portal_invites() to authenticated;
revoke all on function public.portal_invite_info(uuid) from public;
grant execute on function public.portal_invite_info(uuid) to anon, authenticated;

-- Registrierung: Mieter-Konten (account_type = mieter) – auch bei geschlossener Registrierung, wenn eine Einladung existiert
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s public.app_settings;
  first_user boolean;
  is_tenant boolean := coalesce(new.raw_user_meta_data ->> 'account_type', '') = 'mieter';
  invited boolean;
begin
  select * into s from public.app_settings where id = 1;
  first_user := not exists (select 1 from public.profiles);
  invited := exists (select 1 from public.portal_tenants t where lower(t.email) = lower(coalesce(new.email, '')) and t.revoked_at is null);
  if is_tenant and not invited then raise exception 'Für diese E-Mail-Adresse liegt keine Einladung zum Mieterportal vor.'; end if;
  if not first_user and not is_tenant and not coalesce(s.registration_open, true) then
    raise exception 'Die Registrierung ist derzeit geschlossen.';
  end if;
  insert into public.profiles (id, email, full_name, company, role, plan, trial_ends_at, terms_accepted_at, avv_accepted_at, legal_version, account_type)
  values (
    new.id, coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when is_tenant then '' else coalesce(new.raw_user_meta_data ->> 'company', '') end,
    case when first_user and not is_tenant then 'admin' else 'user' end,
    case when first_user and not is_tenant then 'intern' else 'trial' end,
    -- Mieter-Konten: keine Vermieter-Testphase (eigener Bestand nur lesbar, bis ein Tarif gebucht wird)
    case when first_user then null when is_tenant then now() else now() + make_interval(days => coalesce(s.trial_days, 30)) end,
    case when new.raw_user_meta_data ? 'terms_accepted' then now() end,
    case when new.raw_user_meta_data ? 'avv_accepted' then now() end,
    coalesce(s.legal_version, ''),
    case when is_tenant then 'mieter' else 'vermieter' end
  );
  insert into public.app_state (user_id) values (new.id);
  return new;
end;
$$;

-- Fotos & Dokumente im Portal: Ablage unter <vermieter>/portal/<mieter>/…
-- Mieter dürfen dort lesen und hochladen (nur im eigenen Mieter-Ordner)
create or replace function public.portal_path_ok(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select (storage.foldername(p_name))[2] = 'portal'
    and public.portal_is_tenant(public.ws_folder_owner(p_name), (storage.foldername(p_name))[3]);
$$;
grant execute on function public.portal_path_ok(text) to authenticated;
drop policy if exists belege_portal_tenant_select on storage.objects;
create policy belege_portal_tenant_select on storage.objects for select to authenticated
  using (bucket_id = 'belege' and public.portal_path_ok(name));
drop policy if exists belege_portal_tenant_insert on storage.objects;
create policy belege_portal_tenant_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'belege' and public.portal_path_ok(name) and (storage.foldername(name))[4] = 'mieter');

-- Admin-Liste: Kontoart mitliefern
create or replace function public.admin_account_types() returns table (id uuid, account_type text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  return query select p.id, p.account_type from public.profiles p;
end;
$$;
revoke all on function public.admin_account_types() from public, anon;
grant execute on function public.admin_account_types() to authenticated;
