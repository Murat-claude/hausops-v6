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
