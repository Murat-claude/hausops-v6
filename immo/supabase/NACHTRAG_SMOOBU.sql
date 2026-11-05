-- Homevio – NACHTRAG für bestehende Projekte (sicher mehrfach ausführbar)
-- Supabase → SQL Editor → New query → alles einfügen → Run

-- Homevio: neuer Produktname (alter Standardname wird ersetzt, eigene Namen bleiben)
alter table public.app_settings alter column product_name set default 'Homevio';
update public.app_settings set product_name = 'Homevio' where product_name in ('', 'HausOps Immobilien');

-- Smoobu-Zugang je Konto (Bestand). Der Schlüssel ist für die App selbst nicht lesbar:
-- nur die Netlify-Funktion liest ihn mit dem Service-Schlüssel, nachdem sie die Berechtigung geprüft hat.
create table if not exists public.immo_secrets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  smoobu_key text,
  smoobu_secret text,
  updated_at timestamptz not null default now()
);
alter table public.immo_secrets enable row level security;
-- bewusst keine Policies: kein Lese-/Schreibzugriff für angemeldete Nutzer über die API
revoke all on public.immo_secrets from anon, authenticated;

-- Speichern (nur Inhaber des Bestands, also das eigene Konto)
create or replace function public.smoobu_set(p_key text, p_secret text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if coalesce(trim(p_key), '') = '' then
    delete from public.immo_secrets where user_id = auth.uid();
    return;
  end if;
  insert into public.immo_secrets (user_id, smoobu_key, smoobu_secret, updated_at)
  values (auth.uid(), trim(p_key), nullif(trim(coalesce(p_secret, '')), ''), now())
  on conflict (user_id) do update set smoobu_key = excluded.smoobu_key, smoobu_secret = excluded.smoobu_secret, updated_at = now();
end $$;

-- Status ohne Geheimnis: verbunden ja/nein + letzte 4 Zeichen des Schlüssels (für Team-Mitglieder des Bestands)
create or replace function public.smoobu_status(p_owner uuid) returns json
language sql stable security definer set search_path = public as $$
  select case when public.ws_role(p_owner) is null then null else
    (select json_build_object('connected', s.smoobu_key is not null, 'hint', right(s.smoobu_key, 4), 'secret', s.smoobu_secret is not null, 'updated_at', s.updated_at)
       from public.immo_secrets s where s.user_id = p_owner) end;
$$;

grant execute on function public.smoobu_set(text, text) to authenticated;
grant execute on function public.smoobu_status(uuid) to authenticated;
