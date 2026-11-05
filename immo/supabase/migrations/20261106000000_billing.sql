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
