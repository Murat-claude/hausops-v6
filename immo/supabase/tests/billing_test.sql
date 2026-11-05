-- Läuft nach rls_test.sql: Schreibsperre nach Ablauf der Testphase
\set ON_ERROR_STOP 1
reset role;
update public.app_settings set registration_open = true;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000d', 'abgelaufen@example.de');
update public.profiles set trial_ends_at = now() - interval '1 day' where id = '00000000-0000-0000-0000-00000000000d';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
do $$ begin perform public.save_state('{"objects":[]}', 0); raise exception 'FEHLER: abgelaufen speichert'; exception when others then if sqlerrm <> 'trial_expired' then raise; end if; end $$;
select count(*) as abgelaufen_liest_noch from public.app_state;
do $$ begin insert into storage.objects (bucket_id, name) values ('belege', '00000000-0000-0000-0000-00000000000d/x'); raise exception 'FEHLER: Upload trotz Ablauf'; exception when insufficient_privilege then null; end $$;
reset role;
update public.profiles set plan = 'pro', subscription_status = 'active' where id = '00000000-0000-0000-0000-00000000000d';
set role authenticated;
select public.save_state('{"objects":[]}', 0) as nach_abo_speichern;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select email, subscription_status from public.admin_users() where email like 'abgel%';
reset role;
select 'ALLE BILLING-TESTS BESTANDEN' as ergebnis;
