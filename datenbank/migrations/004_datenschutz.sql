-- =====================================================================
-- Weinatlas – Migration 004: Datenschutz (Auskunft und Löschung)
-- Voraussetzung: 002 und 003. Mehrfach ausführbar.
--  * export_my_data()    – gibt alle zur eigenen Person gespeicherten Daten zurück (Art. 15/20 DSGVO)
--  * delete_my_account() – löscht das eigene Konto samt Lernfortschritt (Art. 17 DSGVO)
-- =====================================================================

create or replace function public.export_my_data()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Nicht angemeldet'; end if;
  return jsonb_build_object(
    'exportiert_am', now(),
    'konto', (select jsonb_build_object('id', u.id, 'email', u.email, 'angelegt_am', to_jsonb(u)->>'created_at') from auth.users u where u.id = uid),
    'anzeigename', (select p.display_name from public.profiles p where p.user_id = uid),
    'restaurants', coalesce((select jsonb_agg(jsonb_build_object('restaurant', r.name, 'rolle', m.role, 'seit', m.created_at))
        from public.restaurant_members m join public.restaurants r on r.id = m.restaurant_id where m.user_id = uid), '[]'::jsonb),
    'lernfortschritt', coalesce((select jsonb_agg(jsonb_build_object('wein', w.label, 'fach', lp.box,
        'gesehen', lp.seen, 'richtig', lp.correct, 'naechste_abfrage', lp.due_at))
        from public.learn_progress lp join public.wines w on w.id = lp.wine_id where lp.user_id = uid), '[]'::jsonb),
    'quiz_ergebnisse', coalesce((select jsonb_agg(jsonb_build_object('modus', s.mode, 'punkte', s.score, 'von', s.total, 'am', s.created_at))
        from public.learn_scores s where s.user_id = uid), '[]'::jsonb),
    'lernaufgaben', coalesce((select jsonb_agg(jsonb_build_object('titel', t.title, 'frist', t.due_at, 'erledigt_am', a.completed_at))
        from public.learn_task_assignees a join public.learn_tasks t on t.id = a.task_id where a.user_id = uid), '[]'::jsonb)
  );
end $$;

create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := auth.uid(); blocked text;
begin
  if uid is null then raise exception 'Nicht angemeldet'; end if;
  -- Einziger Inhaber eines Restaurants darf nicht gehen, sonst bliebe es ohne Verwaltung zurück.
  select string_agg(r.name, ', ') into blocked
    from public.restaurant_members m join public.restaurants r on r.id = m.restaurant_id
   where m.user_id = uid and m.role = 'owner'
     and not exists (select 1 from public.restaurant_members o where o.restaurant_id = m.restaurant_id and o.role = 'owner' and o.user_id <> uid);
  if blocked is not null then
    raise exception 'Du bist einziger Inhaber von: %. Bitte zuerst eine weitere Person als Inhaber eintragen lassen.', blocked;
  end if;
  -- Zugehörige Daten (Mitgliedschaft, Profil, Fortschritt, Punkte, Aufgaben) werden über "on delete cascade" mitgelöscht,
  -- Verweise wie "angelegt von" werden auf leer gesetzt.
  delete from auth.users where id = uid;
end $$;

revoke all on function public.export_my_data()   from public, anon;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.export_my_data()   to authenticated;
grant execute on function public.delete_my_account() to authenticated;
