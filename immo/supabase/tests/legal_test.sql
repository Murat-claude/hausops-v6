\set ON_ERROR_STOP 1
reset role;
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000e', 'zustimmung@example.de', '{"terms_accepted":true,"avv_accepted":true}');
select terms_accepted_at is not null as agb_ok, avv_accepted_at is not null as avv_ok, legal_version from public.profiles where id = '00000000-0000-0000-0000-00000000000e';
set role anon;
do $$ begin insert into public.cancellations (name, email) values ('x', 'x@y.de'); raise exception 'FEHLER: anon schreibt direkt'; exception when insufficient_privilege then null; end $$;
reset role;
insert into public.cancellations (name, email) values ('Test', 't@example.de');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', false);
select count(*) as kunde_sieht_kuendigungen from public.cancellations;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select count(*) as admin_sieht_kuendigungen from public.cancellations;
reset role;
select 'ALLE LEGAL-TESTS BESTANDEN' as ergebnis;
