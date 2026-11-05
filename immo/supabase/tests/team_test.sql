-- Team-Zugriff: Einladen, Annehmen, Rollen (bearbeiten / nur lesen), Belege, Entfernen, Limits
\set ON_ERROR_STOP 1
reset role;
update public.app_settings set registration_open = true;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000011', 'inhaber@example.de', '{"full_name":"Murat"}'),
  ('00000000-0000-0000-0000-000000000012', 'partnerin@example.de', '{"full_name":"Partnerin"}'),
  ('00000000-0000-0000-0000-000000000013', 'stb@example.de', '{"full_name":"Steuerberater"}'),
  ('00000000-0000-0000-0000-000000000014', 'fremd@example.de', '{}');
create temp table tok (who text, t uuid);
grant all on tok to authenticated;

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000000011');
select public.save_state('{"objects":[{"id":"o1"}],"units":[{"id":"u1"}]}', 0) as v1;
insert into tok select 'partner', public.create_invite('Partnerin@Example.de', 'editor');
insert into tok select 'stb', public.create_invite('stb@example.de', 'viewer');
do $$ begin perform public.create_invite('inhaber@example.de'); raise exception 'FEHLER: selbst eingeladen'; exception when others then if sqlerrm like 'FEHLER%' then raise; end if; end $$;
-- Testphase: max. 2 zusätzliche Personen
do $$ begin perform public.create_invite('dritte@example.de'); raise exception 'FEHLER: Limit'; exception when others then if sqlerrm not like 'member_limit%' then raise; end if; end $$;
select count(*) as team_eintraege from public.team();

-- Fremder kann Einladung nicht annehmen und sieht nichts
select pg_temp.as_user('00000000-0000-0000-0000-000000000014');
do $$ begin perform public.accept_invite((select t from tok where who = 'partner')); raise exception 'FEHLER: fremd angenommen'; exception when others then if sqlerrm like 'FEHLER%' then raise; end if; end $$;
select count(*) as fremd_state_info from public.state_info('00000000-0000-0000-0000-000000000011');
select count(*) as fremd_sieht from public.app_state where user_id = '00000000-0000-0000-0000-000000000011';
do $$ begin perform public.save_state('{}', 1, '00000000-0000-0000-0000-000000000011'); raise exception 'FEHLER: fremd speichert'; exception when others then if sqlerrm <> 'no_access' then raise; end if; end $$;
do $$ begin perform count(*) from public.workspace_members; raise exception 'FEHLER: Tabelle direkt lesbar'; exception when insufficient_privilege then null; end $$;

-- Partnerin nimmt an, liest und schreibt gemeinsam
select pg_temp.as_user('00000000-0000-0000-0000-000000000012');
select count(*) as offene_einladungen from public.my_invites();
select public.accept_invite((select t from tok where who = 'partner')) = '00000000-0000-0000-0000-000000000011' as angenommen;
do $$ begin perform public.accept_invite((select t from tok where who = 'partner')); raise exception 'FEHLER: doppelt'; exception when others then if sqlerrm like 'FEHLER%' then raise; end if; end $$;
select role, owner_email from public.my_workspaces() order by role;
select count(*) as partner_sieht_bestand from public.app_state where user_id = '00000000-0000-0000-0000-000000000011';
select public.save_state('{"objects":[{"id":"o1"},{"id":"o2"}],"units":[{"id":"u1"}]}', 1, '00000000-0000-0000-0000-000000000011') as v2;
select updated_by = '00000000-0000-0000-0000-000000000012' as geaendert_von_partner from public.app_state where user_id = '00000000-0000-0000-0000-000000000011';
insert into storage.objects (bucket_id, name) values ('belege', '00000000-0000-0000-0000-000000000011/beleg1');
select version, updated_by_name from public.state_info('00000000-0000-0000-0000-000000000011');
do $$ begin perform public.create_invite('x@example.de'); exception when others then null; end $$;
do $$ begin perform public.team_set_role('00000000-0000-0000-0000-000000000012', 'viewer'); end $$;

-- Steuerberater: nur lesen
select pg_temp.as_user('00000000-0000-0000-0000-000000000013');
select public.accept_invite((select t from tok where who = 'stb')) is not null as stb_angenommen;
select count(*) as stb_sieht_bestand from public.app_state where user_id = '00000000-0000-0000-0000-000000000011';
select count(*) as stb_sieht_belege from storage.objects where name like '00000000-0000-0000-0000-000000000011/%';
do $$ begin perform public.save_state('{}', 2, '00000000-0000-0000-0000-000000000011'); raise exception 'FEHLER: viewer speichert'; exception when others then if sqlerrm <> 'read_only' then raise; end if; end $$;
do $$ begin insert into storage.objects (bucket_id, name) values ('belege', '00000000-0000-0000-0000-000000000011/x'); raise exception 'FEHLER: viewer lädt hoch'; exception when insufficient_privilege then null; end $$;
delete from storage.objects where name = '00000000-0000-0000-0000-000000000011/beleg1';
select count(*) = 1 as viewer_konnte_nicht_loeschen from storage.objects where name like '00000000-0000-0000-0000-000000000011/%';

-- Inhaber: Partnerin bleibt Bearbeiterin (Rollenwechsel durch Mitglied war wirkungslos), Inhaber entfernt StB
select pg_temp.as_user('00000000-0000-0000-0000-000000000011');
select email, role from public.team() order by email;
select public.team_remove('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000013');
select pg_temp.as_user('00000000-0000-0000-0000-000000000013');
select count(*) as stb_nach_entfernen from public.app_state where user_id = '00000000-0000-0000-0000-000000000011';

-- Gesperrter Inhaber: Mitglieder verlieren Zugriff
reset role;
update public.profiles set status = 'blocked' where id = '00000000-0000-0000-0000-000000000011';
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000000012');
select count(*) as partner_bei_sperre from public.app_state where user_id = '00000000-0000-0000-0000-000000000011';
do $$ begin perform public.save_state('{}', 2, '00000000-0000-0000-0000-000000000011'); raise exception 'FEHLER: gesperrt'; exception when others then if sqlerrm <> 'account_blocked' then raise; end if; end $$;
-- Partnerin verlässt den Bestand selbst
select public.team_remove('00000000-0000-0000-0000-000000000011', auth.uid());
select count(*) as workspaces_danach from public.my_workspaces();
reset role;
select 'ALLE TEAM-TESTS BESTANDEN' as ergebnis;
