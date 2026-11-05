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
