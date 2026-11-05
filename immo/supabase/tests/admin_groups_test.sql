-- Admin: Vermieter-Gruppen verwalten
\set ON_ERROR_STOP 1
reset role;
update public.app_settings set registration_open = true;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000021', 'vermieterin@example.de', '{"full_name":"Vermieterin"}'),
  ('00000000-0000-0000-0000-000000000022', 'ehemann@example.de', '{"full_name":"Ehemann"}');
set role authenticated;
-- Kunde darf Admin-Funktionen nicht
select pg_temp.as_user('00000000-0000-0000-0000-000000000021');
do $$ begin perform public.admin_memberships(); raise exception 'FEHLER: Kunde liest Gruppen'; exception when others then if sqlerrm like 'FEHLER%' then raise; end if; end $$;
do $$ begin perform public.admin_add_member('00000000-0000-0000-0000-000000000021', 'x@y.de'); raise exception 'FEHLER: Kunde fügt hinzu'; exception when others then if sqlerrm like 'FEHLER%' then raise; end if; end $$;
-- Admin (Konto a aus rls_test, inzwischen wieder entsperrt nötig?) 
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.admin_add_member('00000000-0000-0000-0000-000000000021', 'Ehemann@Example.de', 'editor') ->> 'added' as vorhandenes_konto_direkt;
select public.admin_add_member('00000000-0000-0000-0000-000000000021', 'neu.person@example.de', 'viewer') ->> 'added' as neues_konto_einladung;
do $$ begin perform public.admin_add_member('00000000-0000-0000-0000-000000000021', 'owner@example.de'); raise exception 'FEHLER: Admin in Kundenbestand'; exception when others then if sqlerrm not like 'Admin-Konten%' then raise; end if; end $$;
select count(*) as mitglieder from public.admin_memberships() where owner_id = '00000000-0000-0000-0000-000000000021';
select count(*) as einladungen from public.admin_invites('00000000-0000-0000-0000-000000000021');
select public.admin_set_member_role('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000022', 'viewer');
-- Admin sieht trotzdem keine Kundendaten
select count(*) as admin_sieht_bestand from public.app_state where user_id = '00000000-0000-0000-0000-000000000021';
-- Ehemann sieht Bestand der Vermieterin nur lesend
select pg_temp.as_user('00000000-0000-0000-0000-000000000022');
select role from public.my_workspaces() where owner_id = '00000000-0000-0000-0000-000000000021';
select count(*) as ehemann_sieht_bestand from public.app_state where user_id = '00000000-0000-0000-0000-000000000021';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.admin_remove_member('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000022');
select count(*) as nach_entfernen from public.admin_memberships() where owner_id = '00000000-0000-0000-0000-000000000021';
select count(*) as protokoll from public.admin_log where action like 'group_%';
reset role;
select 'ALLE ADMIN-GRUPPEN-TESTS BESTANDEN' as ergebnis;
