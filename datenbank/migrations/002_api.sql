-- =====================================================================
-- Weinatlas – Migration 002: Schnittstelle (Funktionen), Lernen, Profile
-- Voraussetzung: datenbank/schema.sql wurde bereits ausgeführt.
-- Ausführung: Supabase → SQL Editor → komplett einfügen → Run. Darf bei Bedarf mehrfach ausgeführt werden.
--
-- Die App spricht die Datenbank ausschließlich über die Funktionen unten an.
-- Funktionen laufen mit den Rechten des angemeldeten Nutzers ("security invoker"),
-- die Zugriffsregeln (RLS) aus schema.sql gelten also weiterhin. Ausnahmen mit
-- erhöhten Rechten sind ensure_region und get_leaderboard (jeweils mit eigener Prüfung).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. TABELLEN: Profile, Lernfortschritt, Punkte, Import-Kontingent
-- ---------------------------------------------------------------------

create table if not exists public.profiles (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null check (length(trim(display_name)) between 1 and 40),
  updated_at    timestamptz not null default now()
);

create table if not exists public.learn_progress (
  user_id        uuid not null references auth.users(id) on delete cascade,
  wine_id        uuid not null,
  restaurant_id  uuid not null,
  box            smallint not null default 1 check (box between 1 and 5),   -- Leitner-Fach
  due_at         timestamptz not null default now(),                         -- wann wieder abfragen
  seen           integer not null default 0,
  correct        integer not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (user_id, wine_id),
  foreign key (restaurant_id, wine_id) references public.wines (restaurant_id, id) on delete cascade
);
create index if not exists learn_progress_due_idx on public.learn_progress (user_id, restaurant_id, due_at);

create table if not exists public.learn_scores (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  mode           text not null check (length(mode) between 1 and 30),
  score          integer not null check (score >= 0),
  total          integer not null check (total > 0),
  created_at     timestamptz not null default now()
);
create index if not exists learn_scores_idx on public.learn_scores (restaurant_id, user_id, created_at);

-- Zähler für die automatische PDF-Auslese (wird nur von der Server-Funktion beschrieben)
create table if not exists public.import_usage (
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  month          date not null,
  count          integer not null default 0,
  primary key (restaurant_id, month)
);

alter table public.profiles        enable row level security;
alter table public.learn_progress  enable row level security;
alter table public.learn_scores    enable row level security;
alter table public.import_usage    enable row level security;   -- bewusst ohne Regeln: nur service_role

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (
  user_id = auth.uid()
  or exists (
    select 1 from public.restaurant_members a
    join public.restaurant_members b on b.restaurant_id = a.restaurant_id
    where a.user_id = auth.uid() and b.user_id = profiles.user_id));
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated with check (user_id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists progress_own on public.learn_progress;
create policy progress_own on public.learn_progress for all to authenticated
  using (user_id = auth.uid() and public.is_member(restaurant_id))
  with check (user_id = auth.uid() and public.is_member(restaurant_id));

drop policy if exists scores_read on public.learn_scores;
create policy scores_read   on public.learn_scores for select to authenticated using (user_id = auth.uid());
drop policy if exists scores_insert on public.learn_scores;
create policy scores_insert on public.learn_scores for insert to authenticated
  with check (user_id = auth.uid() and public.is_member(restaurant_id));


-- ---------------------------------------------------------------------
-- 2. KARTE: Daten lesen
-- ---------------------------------------------------------------------

create or replace function public.get_my_restaurants() returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'name', r.name, 'city', r.city, 'role', m.role) order by r.name), '[]'::jsonb)
  from public.restaurant_members m
  join public.restaurants r on r.id = m.restaurant_id
  where m.user_id = auth.uid();
$$;

-- Ersetzt die Version aus schema.sql: liefert zusätzlich die Lagen (Einzellagen) je Gebiet.
create or replace function public.get_atlas_data(p_restaurant uuid) returns jsonb
language sql stable security invoker set search_path = public as $$
  with pw as (            -- Weine je Gebiet, Lage und Erzeuger
    select w.region_id, w.site_id, pr.name as producer_name,
           min(w.sort_order) as so,
           jsonb_agg(jsonb_build_array(w.label, w.price) order by w.sort_order, w.label) as wines
    from public.wines w
    join public.producers pr on pr.id = w.producer_id and pr.restaurant_id = w.restaurant_id
    where w.restaurant_id = p_restaurant and w.is_active and w.region_id is not null
    group by w.region_id, w.site_id, pr.id, pr.name
  ), rp as (              -- Erzeugerliste je Gebiet bzw. Lage
    select pw.region_id, pw.site_id, min(pw.so) as so,
           jsonb_agg(jsonb_build_object('name', pw.producer_name, 'wines', pw.wines)
                     order by pw.so, pw.producer_name) as producers
    from pw group by pw.region_id, pw.site_id
  ), rs as (              -- je Gebiet: direkte Erzeuger + Lagen
    select rp.region_id,
           coalesce((array_agg(rp.producers) filter (where rp.site_id is null))[1], '[]'::jsonb) as producers,
           jsonb_object_agg(s.name, jsonb_build_object('lat', s.lat, 'lon', s.lon, 'producers', rp.producers))
             filter (where rp.site_id is not null) as lagen
    from rp left join public.sites s on s.id = rp.site_id
    group by rp.region_id
  ), cw as (              -- Gebiete je Land
    select r.country_id,
           jsonb_object_agg(r.name,
             jsonb_build_object('lat', r.lat, 'lon', r.lon, 'producers', rs.producers)
             || case when rs.lagen is null then '{}'::jsonb else jsonb_build_object('lagen', rs.lagen) end) as regions
    from rs join public.regions r on r.id = rs.region_id
    group by r.country_id
  )
  select coalesce(
    jsonb_object_agg(c.name, jsonb_build_object(
      'bearing', c.bearing, 'dist', c.dist, 'borderKey', c.border_key, 'regions', cw.regions)),
    '{}'::jsonb)
  from cw join public.countries c on c.id = cw.country_id;
$$;

-- Gebietsflächen: { Land: { Gebiet: [ [[lat,lon],...], ... ] } }
create or replace function public.get_shapes() returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_object_agg(x.country, x.shapes), '{}'::jsonb)
  from (
    select c.name as country, jsonb_object_agg(r.name, s.polygons) as shapes
    from public.region_shapes s
    join public.regions r on r.id = s.region_id
    join public.countries c on c.id = r.country_id
    group by c.name
  ) x;
$$;

-- Alle Gebiete (für Auswahlfelder in der Verwaltung)
create or replace function public.get_regions() returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'country', c.name, 'name', r.name, 'lat', r.lat, 'lon', r.lon,
           'sites', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.name), '[]'::jsonb)
                     from public.sites s where s.region_id = r.id))
         order by c.name, r.name), '[]'::jsonb)
  from public.regions r join public.countries c on c.id = r.country_id;
$$;

-- Flache Weinliste eines Restaurants inkl. Geschmacksnotizen (Verwaltung und Lern-App)
create or replace function public.get_wine_list(p_restaurant uuid) returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(t.x order by (t.x->>'sort_order')::int, t.x->>'label'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', w.id, 'producer', pr.name, 'country', c.name, 'region', r.name, 'region_id', w.region_id,
      'site', s.name, 'site_id', w.site_id,
      'origin_country', w.origin_country, 'origin_region', w.origin_region,
      'label', w.label, 'price', w.price, 'category', w.category, 'is_active', w.is_active,
      'note', w.note, 'sort_order', w.sort_order,
      'notes', case when n.wine_id is null then null
                    else jsonb_build_object('aroma', n.aroma, 'taste', n.taste, 'pairing', n.pairing, 'details', n.details) end
    ) as x
    from public.wines w
    join public.producers pr on pr.id = w.producer_id and pr.restaurant_id = w.restaurant_id
    left join public.regions r on r.id = w.region_id
    left join public.countries c on c.id = r.country_id
    left join public.sites s on s.id = w.site_id
    left join public.wine_notes n on n.wine_id = w.id
    where w.restaurant_id = p_restaurant
  ) t;
$$;


-- ---------------------------------------------------------------------
-- 3. VERWALTUNG: Weine, Notizen, Gebiete
-- ---------------------------------------------------------------------

-- Wein anlegen oder ändern. p enthält: id (leer = neu), producer, label, price, category,
-- region_id, site_id, origin_country, origin_region, is_active, note, sort_order.
-- Der Erzeuger wird bei Bedarf angelegt.
create or replace function public.save_wine(p_restaurant uuid, p jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  pid   uuid;
  wid   uuid := nullif(p->>'id', '')::uuid;
  pname text := trim(coalesce(p->>'producer', ''));
  lbl   text := trim(coalesce(p->>'label', ''));
begin
  if not public.is_member(p_restaurant, 'editor') then raise exception 'Keine Berechtigung'; end if;
  if pname = '' then raise exception 'Erzeuger fehlt'; end if;
  if lbl = '' then raise exception 'Bezeichnung fehlt'; end if;

  select id into pid from public.producers where restaurant_id = p_restaurant and lower(name) = lower(pname);
  if pid is null then
    insert into public.producers (restaurant_id, name) values (p_restaurant, pname) returning id into pid;
  end if;

  if wid is null then
    insert into public.wines (restaurant_id, producer_id, region_id, site_id, origin_country, origin_region,
                              label, price, category, is_active, note, sort_order)
    values (p_restaurant, pid, nullif(p->>'region_id', '')::uuid, nullif(p->>'site_id', '')::uuid,
            nullif(trim(coalesce(p->>'origin_country', '')), ''), nullif(trim(coalesce(p->>'origin_region', '')), ''),
            lbl, nullif(p->>'price', '')::numeric, nullif(p->>'category', ''),
            coalesce((p->>'is_active')::boolean, true), nullif(trim(coalesce(p->>'note', '')), ''),
            coalesce(nullif(p->>'sort_order', '')::int,
                     (select coalesce(max(sort_order), 0) + 1 from public.wines where restaurant_id = p_restaurant)))
    returning id into wid;
  else
    update public.wines set
      producer_id = pid,
      region_id = nullif(p->>'region_id', '')::uuid,
      site_id = nullif(p->>'site_id', '')::uuid,
      origin_country = nullif(trim(coalesce(p->>'origin_country', '')), ''),
      origin_region = nullif(trim(coalesce(p->>'origin_region', '')), ''),
      label = lbl,
      price = nullif(p->>'price', '')::numeric,
      category = nullif(p->>'category', ''),
      is_active = coalesce((p->>'is_active')::boolean, true),
      note = nullif(trim(coalesce(p->>'note', '')), ''),
      sort_order = coalesce(nullif(p->>'sort_order', '')::int, sort_order)
    where id = wid and restaurant_id = p_restaurant;
    if not found then raise exception 'Wein nicht gefunden'; end if;
    delete from public.producers pr where pr.restaurant_id = p_restaurant
      and not exists (select 1 from public.wines w where w.producer_id = pr.id);
  end if;
  return wid;
end $$;

create or replace function public.delete_wine(p_wine uuid) returns void
language plpgsql security invoker set search_path = public as $$
declare rid uuid;
begin
  select restaurant_id into rid from public.wines where id = p_wine;
  if rid is null then return; end if;
  if not public.is_member(rid, 'editor') then raise exception 'Keine Berechtigung'; end if;
  delete from public.wines where id = p_wine;
  delete from public.producers pr where pr.restaurant_id = rid
    and not exists (select 1 from public.wines w where w.producer_id = pr.id);
end $$;

-- Mehrere Weine auf einmal (PDF-Import) mit Abgleich: Ein Wein, den es beim selben Erzeuger mit
-- derselben Bezeichnung schon gibt, wird aktualisiert (Notizen, Lernfortschritt und Ausblenden bleiben
-- erhalten), alles andere wird neu angelegt. p_replace = true entfernt zusätzlich alle Weine, die in
-- der neuen Liste nicht mehr vorkommen (= die Karte wird durch die neue Liste ersetzt).
create or replace function public.import_wines(p_restaurant uuid, p_wines jsonb, p_replace boolean default false)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  rec record; ex record; wid uuid; p jsonb;
  matched uuid[] := '{}'; n_new int := 0; n_upd int := 0; n_del int := 0;
begin
  if not public.is_member(p_restaurant, 'editor') then raise exception 'Keine Berechtigung'; end if;
  if jsonb_typeof(p_wines) <> 'array' then raise exception 'Weinliste muss ein Array sein'; end if;
  if jsonb_array_length(p_wines) > 2000 then raise exception 'Zu viele Weine auf einmal (max. 2000)'; end if;

  for rec in select value, ordinality as ord from jsonb_array_elements(p_wines) with ordinality loop
    select w.id, w.is_active, w.note, w.category into ex
    from public.wines w join public.producers pr on pr.id = w.producer_id
    where w.restaurant_id = p_restaurant
      and lower(pr.name) = lower(trim(coalesce(rec.value->>'producer', '')))
      and lower(w.label) = lower(trim(coalesce(rec.value->>'label', '')))
      and w.id <> all(matched)
    limit 1;
    p := rec.value - 'id';
    if p_replace then p := p || jsonb_build_object('sort_order', rec.ord); end if;
    if ex.id is not null then
      p := p || jsonb_build_object('id', ex.id, 'is_active', ex.is_active, 'note', ex.note,
                                   'category', coalesce(nullif(p->>'category', ''), ex.category));
      wid := public.save_wine(p_restaurant, p); n_upd := n_upd + 1;
    else
      wid := public.save_wine(p_restaurant, p); n_new := n_new + 1;
    end if;
    matched := matched || wid;
  end loop;

  if p_replace then
    delete from public.wines where restaurant_id = p_restaurant and id <> all(matched);
    get diagnostics n_del = row_count;
  end if;
  delete from public.producers pr where pr.restaurant_id = p_restaurant
    and not exists (select 1 from public.wines w where w.producer_id = pr.id);
  return jsonb_build_object('added', n_new, 'updated', n_upd, 'removed', n_del);
end $$;

create or replace function public.save_note(p_wine uuid, p jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare rid uuid;
begin
  select restaurant_id into rid from public.wines where id = p_wine;
  if rid is null then raise exception 'Wein nicht gefunden'; end if;
  if not public.is_member(rid, 'editor') then raise exception 'Keine Berechtigung'; end if;
  insert into public.wine_notes (wine_id, restaurant_id, aroma, taste, pairing, details)
  values (p_wine, rid,
          nullif(trim(coalesce(p->>'aroma', '')), ''), nullif(trim(coalesce(p->>'taste', '')), ''),
          nullif(trim(coalesce(p->>'pairing', '')), ''), coalesce(p->'details', '{}'::jsonb))
  on conflict (wine_id) do update set
    aroma = excluded.aroma, taste = excluded.taste, pairing = excluded.pairing, details = excluded.details;
end $$;

-- Viele Notizen auf einmal: [ {wine_id, aroma, taste, pairing, details}, ... ]
create or replace function public.import_notes(p_restaurant uuid, p_notes jsonb) returns integer
language plpgsql security invoker set search_path = public as $$
declare rec record; n integer := 0;
begin
  if not public.is_member(p_restaurant, 'editor') then raise exception 'Keine Berechtigung'; end if;
  for rec in select value from jsonb_array_elements(p_notes) loop
    if exists (select 1 from public.wines w where w.id = (rec.value->>'wine_id')::uuid and w.restaurant_id = p_restaurant) then
      perform public.save_note((rec.value->>'wine_id')::uuid, rec.value);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Gebiet suchen oder neu anlegen (die Gebietsliste gilt für alle Restaurants, deshalb mit Prüfung:
-- nur Nutzer, die in irgendeinem Restaurant owner/editor sind, und nur zu bekannten Ländern).
create or replace function public.ensure_region(p_country text, p_name text, p_lat double precision, p_lon double precision)
returns uuid
language plpgsql security definer set search_path = public as $$
declare cid smallint; rid uuid; nm text := trim(coalesce(p_name, ''));
begin
  if auth.uid() is null or not exists (
       select 1 from public.restaurant_members
       where user_id = auth.uid() and role in ('owner', 'editor')) then
    raise exception 'Keine Berechtigung';
  end if;
  select id into cid from public.countries where name = p_country;
  if cid is null then raise exception 'Unbekanntes Land: %', p_country; end if;
  if length(nm) < 2 or length(nm) > 80 then raise exception 'Ungültiger Gebietsname'; end if;
  select id into rid from public.regions where country_id = cid and lower(name) = lower(nm);
  if rid is not null then return rid; end if;
  if p_lat is null or p_lon is null or p_lat not between -90 and 90 or p_lon not between -180 and 180 then
    raise exception 'Ungültige Koordinaten';
  end if;
  insert into public.regions (country_id, name, lat, lon) values (cid, nm, p_lat, p_lon) returning id into rid;
  return rid;
end $$;


-- ---------------------------------------------------------------------
-- 4. PROFIL, LERNEN, BESTENLISTE
-- ---------------------------------------------------------------------

create or replace function public.set_display_name(p_name text) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  insert into public.profiles (user_id, display_name) values (auth.uid(), trim(p_name))
  on conflict (user_id) do update set display_name = excluded.display_name, updated_at = now();
end $$;

create or replace function public.get_my_profile() returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object('display_name', p.display_name)
  from public.profiles p where p.user_id = auth.uid();
$$;

-- Eine Abfrage-Antwort verbuchen (Karteikasten nach Leitner: richtig = nächstes Fach, falsch = zurück in Fach 1)
create or replace function public.learn_record(p_wine uuid, p_correct boolean) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare rid uuid; b smallint; iv interval; res jsonb;
begin
  select restaurant_id into rid from public.wines where id = p_wine;
  if rid is null or not public.is_member(rid) then raise exception 'Wein nicht gefunden'; end if;
  select lp.box into b from public.learn_progress lp where lp.user_id = auth.uid() and lp.wine_id = p_wine;
  if b is null then b := 1; end if;
  if p_correct then b := least(b + 1, 5); else b := 1; end if;
  iv := case b when 1 then interval '0' when 2 then interval '1 day' when 3 then interval '3 days'
                when 4 then interval '7 days' else interval '14 days' end;
  insert into public.learn_progress (user_id, wine_id, restaurant_id, box, due_at, seen, correct)
  values (auth.uid(), p_wine, rid, b, now() + iv, 1, case when p_correct then 1 else 0 end)
  on conflict (user_id, wine_id) do update set
    box = excluded.box, due_at = excluded.due_at,
    seen = public.learn_progress.seen + 1,
    correct = public.learn_progress.correct + (case when p_correct then 1 else 0 end),
    updated_at = now()
  returning jsonb_build_object('box', learn_progress.box, 'due_at', learn_progress.due_at) into res;
  return res;
end $$;

create or replace function public.get_learn_state(p_restaurant uuid) returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'wine_id', lp.wine_id, 'box', lp.box, 'due_at', lp.due_at, 'seen', lp.seen, 'correct', lp.correct)), '[]'::jsonb)
  from public.learn_progress lp
  where lp.user_id = auth.uid() and lp.restaurant_id = p_restaurant;
$$;

create or replace function public.log_score(p_restaurant uuid, p_mode text, p_score integer, p_total integer) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if not public.is_member(p_restaurant) then raise exception 'Keine Berechtigung'; end if;
  insert into public.learn_scores (user_id, restaurant_id, mode, score, total)
  values (auth.uid(), p_restaurant, p_mode, greatest(p_score, 0), greatest(p_total, 1));
end $$;

-- Bestenliste eines Restaurants. Mit erhöhten Rechten, weil sie die Punkte aller Mitglieder zeigt;
-- geprüft wird die Mitgliedschaft. Es werden nur Anzeigenamen ausgegeben, nie E-Mail-Adressen.
create or replace function public.get_leaderboard(p_restaurant uuid, p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member(p_restaurant) then raise exception 'Keine Berechtigung'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'name', t.name, 'points', t.points, 'quizzes', t.quizzes, 'mastered', t.mastered,
             'is_me', t.user_id = auth.uid())
           order by t.points desc, t.mastered desc, t.name)
    from (
      select m.user_id,
             coalesce(pf.display_name, 'Kollege ' || substr(m.user_id::text, 1, 4)) as name,
             coalesce((select sum(s.score) from public.learn_scores s
                       where s.user_id = m.user_id and s.restaurant_id = p_restaurant
                         and s.created_at > now() - make_interval(days => p_days)), 0)::int as points,
             (select count(*) from public.learn_scores s
              where s.user_id = m.user_id and s.restaurant_id = p_restaurant
                and s.created_at > now() - make_interval(days => p_days))::int as quizzes,
             (select count(*) from public.learn_progress lp
              where lp.user_id = m.user_id and lp.restaurant_id = p_restaurant and lp.box >= 4)::int as mastered
      from public.restaurant_members m
      left join public.profiles pf on pf.user_id = m.user_id
      where m.restaurant_id = p_restaurant
    ) t), '[]'::jsonb);
end $$;



-- ---------------------------------------------------------------------
-- 4b. TEAMVERWALTUNG (nur Inhaber). Konten werden im Supabase-Dashboard angelegt
--     (Authentication → Users); hier werden bestehende Konten dem Restaurant zugeordnet.
-- ---------------------------------------------------------------------

create or replace function public.get_members(p_restaurant uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member(p_restaurant, 'owner') then raise exception 'Keine Berechtigung'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
            'user_id', m.user_id, 'email', u.email, 'role', m.role, 'name', pf.display_name)
          order by m.role, u.email)
          from public.restaurant_members m
          join auth.users u on u.id = m.user_id
          left join public.profiles pf on pf.user_id = m.user_id
          where m.restaurant_id = p_restaurant), '[]'::jsonb);
end $$;

create or replace function public.add_member(p_restaurant uuid, p_email text, p_role public.member_role) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not public.is_member(p_restaurant, 'owner') then raise exception 'Keine Berechtigung'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'Kein Konto mit dieser E-Mail-Adresse. Konto zuerst im Supabase-Dashboard anlegen.'; end if;
  insert into public.restaurant_members (restaurant_id, user_id, role) values (p_restaurant, uid, p_role)
  on conflict (restaurant_id, user_id) do update set role = excluded.role;
  if not exists (select 1 from public.restaurant_members where restaurant_id = p_restaurant and role = 'owner') then
    raise exception 'Es muss mindestens ein Inhaber bleiben';
  end if;
end $$;

create or replace function public.remove_member(p_restaurant uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_restaurant, 'owner') then raise exception 'Keine Berechtigung'; end if;
  delete from public.restaurant_members where restaurant_id = p_restaurant and user_id = p_user;
  if not exists (select 1 from public.restaurant_members where restaurant_id = p_restaurant and role = 'owner') then
    raise exception 'Es muss mindestens ein Inhaber bleiben';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. BERECHTIGUNGEN: nur angemeldete Nutzer dürfen die Funktionen aufrufen
-- ---------------------------------------------------------------------

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('get_my_restaurants', 'get_atlas_data', 'get_shapes', 'get_regions', 'get_wine_list',
                        'save_wine', 'delete_wine', 'import_wines', 'save_note', 'import_notes', 'ensure_region',
                        'set_display_name', 'get_my_profile', 'learn_record', 'get_learn_state', 'log_score',
                        'get_leaderboard', 'get_extra_origins', 'get_members', 'add_member', 'remove_member')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
