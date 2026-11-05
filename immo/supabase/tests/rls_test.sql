-- Szenarien: Admin-Bootstrap, Datentrennung, Rechte, Tarif-Limit, Versionskonflikt, Sperre
\set ON_ERROR_STOP 1
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@example.de', '{"full_name":"Owner"}'),
  ('00000000-0000-0000-0000-00000000000b', 'kunde1@example.de', '{"full_name":"Kunde Eins","company":"K1 GmbH"}'),
  ('00000000-0000-0000-0000-00000000000c', 'kunde2@example.de', '{}');
select email, role, plan, trial_ends_at is not null as has_trial from public.profiles order by email;

create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); end $$;

-- Kunde 1 speichert Daten
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.save_state('{"objects":[{"id":"o1","name":"Haus K1"}],"units":[{"id":"u1"}]}', 0) as k1_v1;
select count(*) as k1_sieht_eigene_daten from public.app_state;
select count(*) as k1_sieht_profile from public.profiles;
do $$ begin perform public.admin_users(); raise exception 'FEHLER: Kunde darf admin_users nicht'; exception when others then if sqlerrm like 'FEHLER%' then raise; end if; end $$;
do $$ begin update public.profiles set role = 'admin' where id = auth.uid(); raise exception 'FEHLER: Rolle änderbar'; exception when insufficient_privilege then null; end $$;
update public.profiles set company = 'K1 Immobilien' where id = auth.uid();
do $$ begin perform public.save_state('{"units":[]}', 0); raise exception 'FEHLER: kein Konflikt'; exception when others then if sqlerrm <> 'version_conflict' then raise; end if; end $$;
-- Tarif-Limit (trial = 20 Einheiten)
do $$ begin perform public.save_state((select jsonb_build_object('units', jsonb_agg(jsonb_build_object('id', g))) from generate_series(1, 21) g), 1); raise exception 'FEHLER: Limit'; exception when others then if sqlerrm not like 'plan_limit%' then raise; end if; end $$;
-- Storage: eigener Ordner ja, fremder nein
insert into storage.objects (bucket_id, name, metadata) values ('belege', '00000000-0000-0000-0000-00000000000b/d1', '{"size": 1234}');
do $$ begin insert into storage.objects (bucket_id, name) values ('belege', '00000000-0000-0000-0000-00000000000c/x'); raise exception 'FEHLER: fremder Ordner'; exception when insufficient_privilege then null; end $$;

-- Kunde 2 sieht nichts von Kunde 1
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select count(*) as k2_sieht_app_state_gesamt, bool_and(user_id = auth.uid()) as nur_eigene from public.app_state;
select count(*) as k2_sieht_fremde_belege from storage.objects;

-- Admin
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select email, plan, stats ->> 'units' as units, storage_bytes from public.admin_users() order by email;
select count(*) as admin_sieht_kundendaten from public.app_state where user_id <> auth.uid();
select public.admin_update_user('00000000-0000-0000-0000-00000000000b', p_plan => 'pro', p_status => 'blocked');
do $$ begin perform public.admin_update_user('00000000-0000-0000-0000-00000000000a', p_status => 'blocked'); raise exception 'FEHLER: Selbstsperre'; exception when others then if sqlerrm like 'FEHLER%' then raise; end if; end $$;
update public.app_settings set announcement = 'Wartung am Sonntag';
select count(*) as log_eintraege from public.admin_log;

-- Gesperrter Kunde 1
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select count(*) as gesperrt_sieht_daten from public.app_state;
do $$ begin perform public.save_state('{}', 1); raise exception 'FEHLER: gesperrt speichert'; exception when others then if sqlerrm <> 'account_blocked' then raise; end if; end $$;
do $$ begin update public.app_settings set announcement = 'hack'; if found then raise exception 'FEHLER: Kunde ändert Settings'; end if; end $$;

-- Anonym: nur Tarife und Rechtstexte
reset role; set role anon;
select count(*) as anon_plans from public.plans;
select announcement from public.app_settings;
do $$ begin perform count(*) from public.profiles; raise exception 'FEHLER: anon liest Profile'; exception when insufficient_privilege then null; end $$;
reset role;
-- Registrierung schließen
update public.app_settings set registration_open = false;
do $$ begin insert into auth.users (email) values ('neu@example.de'); raise exception 'FEHLER: Registrierung offen'; exception when others then if sqlerrm not like '%geschlossen%' then raise; end if; end $$;
select 'ALLE RLS-TESTS BESTANDEN' as ergebnis;
