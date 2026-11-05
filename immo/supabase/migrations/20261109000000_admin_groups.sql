-- HausOps Immobilien – Admin: Vermieter-Gruppen (Inhaber + weitere Personen) verwalten
-- Der Admin kann Personen zu einem Kundenbestand hinzufügen, Rollen ändern und entfernen.
-- Schutz der Kundendaten: Über den Admin-Bereich können KEINE Admin-Konten in fremde Bestände aufgenommen werden
-- (sonst könnte sich ein Admin selbst Einsicht verschaffen). Jede Aktion wird protokolliert.

-- Alle Mitgliedschaften (für die Gruppenübersicht im Admin-Bereich)
create or replace function public.admin_memberships()
returns table (owner_id uuid, member_id uuid, role text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  return query select m.owner_id, m.member_id, m.role, m.created_at from public.workspace_members m;
end;
$$;

-- Offene Einladungen eines Bestands
create or replace function public.admin_invites(p_owner uuid)
returns table (email text, role text, token uuid, created_at timestamptz, expires_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  return query select i.email, i.role, i.token, i.created_at, i.expires_at from public.workspace_invites i
    where i.owner_id = p_owner and i.accepted_at is null and i.expires_at > now() order by i.created_at;
end;
$$;

-- Person zu einem Bestand hinzufügen: vorhandenes Konto → sofort Mitglied, sonst Einladung (Token zurück)
create or replace function public.admin_add_member(p_owner uuid, p_email text, p_role text default 'editor')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  target public.profiles; owner_prof public.profiles; t uuid; em text := lower(trim(p_email));
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  if p_role not in ('editor', 'viewer') then raise exception 'Ungültige Rolle'; end if;
  select * into owner_prof from public.profiles where id = p_owner;
  if not found then raise exception 'Bestand nicht gefunden'; end if;
  if em = lower(owner_prof.email) then raise exception 'Das ist bereits der Inhaber.'; end if;
  select * into target from public.profiles where lower(email) = em;
  if found then
    if target.role = 'admin' and target.id <> p_owner then
      raise exception 'Admin-Konten können nicht in Kundenbestände aufgenommen werden (Datenschutz). Bitte ein normales Konto verwenden.';
    end if;
    insert into public.workspace_members (owner_id, member_id, role) values (p_owner, target.id, p_role)
      on conflict (owner_id, member_id) do update set role = excluded.role;
    insert into public.admin_log (admin_id, target_id, action, details)
      values (auth.uid(), p_owner, 'group_add_member', jsonb_build_object('member', em, 'role', p_role));
    return jsonb_build_object('added', true, 'member_id', target.id);
  end if;
  insert into public.workspace_invites (owner_id, email, role) values (p_owner, em, p_role) returning token into t;
  insert into public.admin_log (admin_id, target_id, action, details)
    values (auth.uid(), p_owner, 'group_invite', jsonb_build_object('email', em, 'role', p_role));
  return jsonb_build_object('added', false, 'token', t);
end;
$$;

create or replace function public.admin_set_member_role(p_owner uuid, p_member uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  if p_role not in ('editor', 'viewer') then raise exception 'Ungültige Rolle'; end if;
  update public.workspace_members set role = p_role where owner_id = p_owner and member_id = p_member;
  insert into public.admin_log (admin_id, target_id, action, details)
    values (auth.uid(), p_owner, 'group_role', jsonb_build_object('member_id', p_member, 'role', p_role));
end;
$$;

create or replace function public.admin_remove_member(p_owner uuid, p_member uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  delete from public.workspace_members where owner_id = p_owner and member_id = p_member;
  insert into public.admin_log (admin_id, target_id, action, details)
    values (auth.uid(), p_owner, 'group_remove_member', jsonb_build_object('member_id', p_member));
end;
$$;

create or replace function public.admin_revoke_invite(p_token uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o uuid;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  delete from public.workspace_invites where token = p_token and accepted_at is null returning owner_id into o;
  insert into public.admin_log (admin_id, target_id, action, details) values (auth.uid(), o, 'group_revoke_invite', '{}'::jsonb);
end;
$$;

revoke all on function public.admin_memberships(), public.admin_invites(uuid), public.admin_add_member(uuid, text, text),
  public.admin_set_member_role(uuid, uuid, text), public.admin_remove_member(uuid, uuid), public.admin_revoke_invite(uuid) from public, anon;
grant execute on function public.admin_memberships(), public.admin_invites(uuid), public.admin_add_member(uuid, text, text),
  public.admin_set_member_role(uuid, uuid, text), public.admin_remove_member(uuid, uuid), public.admin_revoke_invite(uuid) to authenticated;

-- Hinweis: Lädt ein Inhaber selbst ein Admin-Konto ein, ist das seine Entscheidung (Einwilligung des Verantwortlichen).
-- Gesperrt ist nur, dass ein Admin über den Admin-Bereich Admin-Konten in fremde Bestände aufnimmt.
