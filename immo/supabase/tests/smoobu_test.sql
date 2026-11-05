-- Smoobu-Schlüssel: nur Status sichtbar, Geheimnis nicht lesbar, fremde Bestände ohne Status
\set ON_ERROR_STOP 1
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000051', 'smoobu-a@example.de', '{}'),
  ('00000000-0000-0000-0000-000000000052', 'smoobu-b@example.de', '{}');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000051', false);
select public.smoobu_set('KEY-1234', 'SECRET');
do $$ begin
  if (public.smoobu_status('00000000-0000-0000-0000-000000000051')->>'hint') <> '1234' then raise exception 'FEHLER: Status fehlt'; end if;
  begin perform smoobu_secret from public.immo_secrets; raise exception 'FEHLER: Geheimnis lesbar';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000052', false);
do $$ begin
  if public.smoobu_status('00000000-0000-0000-0000-000000000051') is not null then raise exception 'FEHLER: Fremder sieht Status'; end if;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000051', false);
select public.smoobu_set('', '');
do $$ begin if public.smoobu_status('00000000-0000-0000-0000-000000000051') is not null then raise exception 'FEHLER: Trennen'; end if; end $$;
reset role;
select 'smoobu_test ok' as ergebnis;
