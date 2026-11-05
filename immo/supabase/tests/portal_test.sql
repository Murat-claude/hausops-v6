-- Mieterportal: Einladung, Datentrennung, Meldungen, Fotos, Widerruf
\set ON_ERROR_STOP 1
reset role;
update public.app_settings set registration_open = true;
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-000000000031', 'vermieter.portal@example.de', '{"full_name":"Vermieter P"}');
update public.app_settings set registration_open = false;  -- Mieter dürfen trotzdem (mit Einladung)
create temp table ptok (t uuid); grant all on ptok to authenticated;

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000000031');
insert into public.portal_tenants (owner_id, tenant_key, email, info) values ('00000000-0000-0000-0000-000000000031', 't_anna', 'anna.mieterin@example.de', '{"unit":"WE 01","rent":90000}');
insert into public.portal_tenants (owner_id, tenant_key, email) values ('00000000-0000-0000-0000-000000000031', 't_bob', 'bob@example.de');
insert into ptok select token from public.portal_tenants where tenant_key = 't_anna';
insert into public.portal_items (owner_id, tenant_key, direction, kind, title, body) values ('00000000-0000-0000-0000-000000000031', 't_anna', 'vermieter', 'nachricht', 'Willkommen', 'Hallo Anna');
insert into public.portal_items (owner_id, tenant_key, direction, kind, title) values ('00000000-0000-0000-0000-000000000031', 't_bob', 'vermieter', 'nachricht', 'Nur für Bob');

-- Registrierung als Mieter ohne Einladung scheitert, mit Einladung klappt sie (trotz geschlossener Registrierung)
reset role;
do $$ begin insert into auth.users (email, raw_user_meta_data) values ('fremd.mieter@example.de', '{"account_type":"mieter"}'); raise exception 'FEHLER: ohne Einladung'; exception when others then if sqlerrm not like '%keine Einladung%' then raise; end if; end $$;
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-000000000032', 'anna.mieterin@example.de', '{"account_type":"mieter","full_name":"Anna"}');
select account_type, plan, trial_ends_at <= now() as keine_gratis_vermieterfunktion, role from public.profiles where id = '00000000-0000-0000-0000-000000000032';
update public.app_settings set registration_open = true;

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000000032');
select count(*) as vor_annahme from public.portal_items;
select public.accept_portal_invite((select t from ptok)) = '00000000-0000-0000-0000-000000000031' as angenommen;
select tenant_key, info ->> 'unit' as wohnung from public.my_portals();
select title from public.portal_items order by id;                          -- nur eigene
select count(*) as sieht_bestand from public.app_state where user_id = '00000000-0000-0000-0000-000000000031';
select count(*) as sieht_andere_mieter from public.portal_tenants where tenant_key = 't_bob';
insert into public.portal_items (owner_id, tenant_key, direction, kind, title, body, data) values ('00000000-0000-0000-0000-000000000031', 't_anna', 'mieter', 'mangel', 'Heizung kalt', 'Seit gestern', '{"photos":["00000000-0000-0000-0000-000000000031/portal/t_anna/mieter/f1.jpg"]}');
insert into public.portal_items (owner_id, tenant_key, direction, kind, title, data) values ('00000000-0000-0000-0000-000000000031', 't_anna', 'mieter', 'zaehler', 'Wasser kalt', '{"type":"wasser_kalt","value":123.4}');
do $$ begin insert into public.portal_items (owner_id, tenant_key, direction, kind, title) values ('00000000-0000-0000-0000-000000000031', 't_bob', 'mieter', 'nachricht', 'als Bob'); raise exception 'FEHLER: fremder Mieter'; exception when insufficient_privilege then null; end $$;
do $$ begin insert into public.portal_items (owner_id, tenant_key, direction, kind, title) values ('00000000-0000-0000-0000-000000000031', 't_anna', 'vermieter', 'nachricht', 'Fake Vermieter'); raise exception 'FEHLER: als Vermieter'; exception when insufficient_privilege then null; end $$;
do $$ begin insert into public.portal_items (owner_id, tenant_key, direction, kind, title) values ('00000000-0000-0000-0000-000000000031', 't_anna', 'mieter', 'dokument', 'Fake Dokument'); raise exception 'FEHLER: Dokument'; exception when insufficient_privilege then null; end $$;
update public.portal_items set status = 'erledigt' where tenant_key = 't_anna';
select count(*) = 0 as mieter_kann_status_nicht_aendern from public.portal_items where status = 'erledigt';
update public.portal_tenants set info = '{"rent":1}' where tenant_key = 't_anna';
select info ->> 'rent' = '90000' as mieter_kann_info_nicht_aendern from public.my_portals();
select public.portal_mark_read('00000000-0000-0000-0000-000000000031', 't_anna');
-- Fotos: eigener Mieterordner ja, Vermieterordner / fremder Mieter nein
insert into storage.objects (bucket_id, name) values ('belege', '00000000-0000-0000-0000-000000000031/portal/t_anna/mieter/f1.jpg');
do $$ begin insert into storage.objects (bucket_id, name) values ('belege', '00000000-0000-0000-0000-000000000031/beleg_x'); raise exception 'FEHLER: Vermieterordner'; exception when insufficient_privilege then null; end $$;
do $$ begin insert into storage.objects (bucket_id, name) values ('belege', '00000000-0000-0000-0000-000000000031/portal/t_bob/mieter/x.jpg'); raise exception 'FEHLER: fremder Mieterordner'; exception when insufficient_privilege then null; end $$;
do $$ begin insert into storage.objects (bucket_id, name) values ('belege', '00000000-0000-0000-0000-000000000031/portal/t_anna/vertrag.pdf'); raise exception 'FEHLER: außerhalb mieter/'; exception when insufficient_privilege then null; end $$;
select count(*) as mieter_sieht_dateien from storage.objects where name like '00000000-0000-0000-0000-000000000031/%';

-- Vermieter sieht Meldungen und setzt Status
select pg_temp.as_user('00000000-0000-0000-0000-000000000031');
select kind, title, status from public.portal_items where direction = 'mieter' order by id;
update public.portal_items set status = 'in_bearbeitung', read_by_owner_at = now() where kind = 'mangel';
select count(*) as gelesen_markiert from public.portal_items where read_by_tenant_at is not null;
-- Zugriff entziehen
update public.portal_tenants set revoked_at = now() where tenant_key = 't_anna';
select pg_temp.as_user('00000000-0000-0000-0000-000000000032');
select count(*) as nach_widerruf from public.portal_items;
select count(*) as portale_nach_widerruf from public.my_portals();
reset role;
select 'ALLE PORTAL-TESTS BESTANDEN' as ergebnis;
