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
