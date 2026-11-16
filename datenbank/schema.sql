-- =====================================================================
-- Weinatlas – Datenbankentwurf (Supabase / PostgreSQL)
-- ENTWURF: noch gegen keine echte Datenbank ausgeführt.
--
-- Ausführung: Supabase → SQL Editor → komplett einfügen → Run (einmalig, frisches Projekt).
-- Kostenfrei: nur Standard-PostgreSQL + Supabase Auth. Keine Erweiterungen (kein PostGIS),
-- keine bezahlten Funktionen. Geometrien liegen als jsonb.
--
-- Aufbau
--   Stammdaten (für alle Restaurants gleich, nur lesbar):
--     countries, regions, region_shapes, sites
--   Mandanten (jedes Restaurant sieht nur seine eigenen Zeilen):
--     restaurants, restaurant_members, producers, wines, wine_notes
--   Zugriff: Row Level Security auf allen Tabellen, Rollen owner / editor / viewer.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. STAMMDATEN
-- ---------------------------------------------------------------------

-- Länder, für die es einen Länderumriss gibt (Schlüssel wie in laendergrenzen/*.geojson)
create table public.countries (
  id          smallint generated always as identity primary key,
  name        text not null unique,          -- 'Deutschland'
  border_key  text not null unique,          -- 'Germany' (Name im Länderumriss)
  bearing     smallint not null check (bearing between 0 and 359),  -- Richtung auf der Hamburg-Karte
  dist        smallint not null check (dist > 0)                    -- Abstand auf der Hamburg-Karte
);

-- Anbaugebiete (eine Liste für alle Restaurants)
create table public.regions (
  id          uuid primary key default gen_random_uuid(),
  country_id  smallint not null references public.countries(id) on delete restrict,
  name        text not null,                 -- 'Mosel'
  lat         double precision not null check (lat between -90 and 90),
  lon         double precision not null check (lon between -180 and 180),
  unique (country_id, name)
);

-- Gebietsflächen (z. B. die in QGIS gezeichneten deutschen Gebiete).
-- polygons = [ [[lat,lon],[lat,lon],...], ... ]  → eine Liste Teilflächen pro Gebiet
create table public.region_shapes (
  region_id   uuid primary key references public.regions(id) on delete cascade,
  polygons    jsonb not null check (jsonb_typeof(polygons) = 'array')
);

-- Einzelne Lagen innerhalb eines Gebiets (z. B. Hochheimer Hölle im Rheingau)
create table public.sites (
  id          uuid primary key default gen_random_uuid(),
  region_id   uuid not null references public.regions(id) on delete cascade,
  name        text not null,
  lat         double precision not null check (lat between -90 and 90),
  lon         double precision not null check (lon between -180 and 180),
  unique (region_id, name)
);


-- ---------------------------------------------------------------------
-- 2. MANDANTEN
-- ---------------------------------------------------------------------

create table public.restaurants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  city        text,
  created_at  timestamptz not null default now()
);

create type public.member_role as enum ('owner', 'editor', 'viewer');
-- owner  = Restaurant verwalten, Mitglieder einladen
-- editor = Weine bearbeiten
-- viewer = nur ansehen (z. B. Kellner)

create table public.restaurant_members (
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  role           public.member_role not null default 'viewer',
  created_at     timestamptz not null default now(),
  primary key (restaurant_id, user_id)
);
create index restaurant_members_user_idx on public.restaurant_members(user_id);

create table public.producers (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  name           text not null check (length(trim(name)) > 0),
  unique (restaurant_id, id)                -- Grundlage für den Mandanten-Fremdschlüssel in wines
);
create unique index producers_name_uq on public.producers (restaurant_id, lower(name));

create table public.wines (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null,
  producer_id    uuid not null,
  region_id      uuid references public.regions(id) on delete restrict,   -- Gebiet erst löschbar, wenn kein Wein mehr darauf zeigt
  site_id        uuid references public.sites(id) on delete set null,
  -- Herkunft ohne Karte (z. B. Argentinien): region_id bleibt leer, Herkunft steht als Text
  origin_country text,
  origin_region  text,
  label          text not null check (length(trim(label)) > 0),   -- '2024 · Riesling · Bechtheim'
  price          numeric(8,2) check (price >= 0),                  -- Flaschenpreis in Euro
  category       text check (category in ('weiss', 'rot', 'rose', 'schaum', 'sonstige')),
  is_active      boolean not null default true,                    -- false = nicht mehr auf der Karte
  note           text,                                             -- z. B. 'Rarität', 'Ausläufer'
  sort_order     integer not null default 0,                       -- Reihenfolge wie in der Karte
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (restaurant_id, id),
  -- Erzeuger muss zum selben Restaurant gehören wie der Wein
  foreign key (restaurant_id, producer_id)
    references public.producers (restaurant_id, id) on delete cascade,
  check (region_id is not null or origin_country is not null)
);
create index wines_restaurant_idx on public.wines (restaurant_id, is_active);
create index wines_region_idx on public.wines (region_id);

-- Platz für die spätere Kellner-Lern-App (Geschmacksbeschreibungen)
create table public.wine_notes (
  wine_id        uuid primary key,
  restaurant_id  uuid not null,
  aroma          text,
  taste          text,
  pairing        text,       -- passt zu
  details        jsonb not null default '{}'::jsonb,
  updated_at     timestamptz not null default now(),
  foreign key (restaurant_id, wine_id)
    references public.wines (restaurant_id, id) on delete cascade
);


-- ---------------------------------------------------------------------
-- 3. HILFSFUNKTIONEN
-- ---------------------------------------------------------------------

create function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger wines_updated_at       before update on public.wines
  for each row execute function public.set_updated_at();
create trigger wine_notes_updated_at  before update on public.wine_notes
  for each row execute function public.set_updated_at();

-- Ist der angemeldete Nutzer Mitglied des Restaurants (mindestens in der Rolle min_role)?
-- security definer: liest restaurant_members ohne dessen Regeln erneut auszulösen.
create function public.is_member(rid uuid, min_role public.member_role default 'viewer')
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.restaurant_members m
    where m.restaurant_id = rid
      and m.user_id = auth.uid()
      and (case m.role      when 'owner' then 3 when 'editor' then 2 else 1 end)
       >= (case min_role    when 'owner' then 3 when 'editor' then 2 else 1 end)
  );
$$;

-- Neues Restaurant anlegen; der Anleger wird automatisch owner.
-- (Direktes Einfügen in restaurants ist per Regel gesperrt.)
create function public.create_restaurant(p_name text, p_city text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet';
  end if;
  insert into public.restaurants (name, city) values (p_name, p_city) returning id into rid;
  insert into public.restaurant_members (restaurant_id, user_id, role) values (rid, auth.uid(), 'owner');
  return rid;
end $$;

revoke execute on function public.create_restaurant(text, text) from public, anon;
grant  execute on function public.create_restaurant(text, text) to authenticated;


-- ---------------------------------------------------------------------
-- 4. ZUGRIFFSREGELN (Row Level Security)
-- ---------------------------------------------------------------------
-- Ohne passende Regel ist der Zugriff gesperrt – auch für den öffentlichen anon-Schlüssel.

alter table public.countries           enable row level security;
alter table public.regions             enable row level security;
alter table public.region_shapes       enable row level security;
alter table public.sites               enable row level security;
alter table public.restaurants         enable row level security;
alter table public.restaurant_members  enable row level security;
alter table public.producers           enable row level security;
alter table public.wines               enable row level security;
alter table public.wine_notes          enable row level security;

-- Stammdaten: angemeldete Nutzer dürfen lesen, geschrieben wird nur über das Supabase-Dashboard
create policy countries_read     on public.countries     for select to authenticated using (true);
create policy regions_read       on public.regions       for select to authenticated using (true);
create policy region_shapes_read on public.region_shapes for select to authenticated using (true);
create policy sites_read         on public.sites         for select to authenticated using (true);

-- Restaurants
create policy restaurants_read   on public.restaurants for select to authenticated using (public.is_member(id));
create policy restaurants_update on public.restaurants for update to authenticated
  using (public.is_member(id, 'owner')) with check (public.is_member(id, 'owner'));
create policy restaurants_delete on public.restaurants for delete to authenticated
  using (public.is_member(id, 'owner'));

-- Mitglieder: alle Mitglieder sehen die Liste, nur owner verwalten sie
create policy members_read   on public.restaurant_members for select to authenticated
  using (public.is_member(restaurant_id));
create policy members_insert on public.restaurant_members for insert to authenticated
  with check (public.is_member(restaurant_id, 'owner'));
create policy members_update on public.restaurant_members for update to authenticated
  using (public.is_member(restaurant_id, 'owner')) with check (public.is_member(restaurant_id, 'owner'));
create policy members_delete on public.restaurant_members for delete to authenticated
  using (public.is_member(restaurant_id, 'owner'));

-- Erzeuger, Weine, Geschmacksnotizen: lesen ab viewer, ändern ab editor
create policy producers_read   on public.producers for select to authenticated using (public.is_member(restaurant_id));
create policy producers_insert on public.producers for insert to authenticated with check (public.is_member(restaurant_id, 'editor'));
create policy producers_update on public.producers for update to authenticated
  using (public.is_member(restaurant_id, 'editor')) with check (public.is_member(restaurant_id, 'editor'));
create policy producers_delete on public.producers for delete to authenticated using (public.is_member(restaurant_id, 'editor'));

create policy wines_read   on public.wines for select to authenticated using (public.is_member(restaurant_id));
create policy wines_insert on public.wines for insert to authenticated with check (public.is_member(restaurant_id, 'editor'));
create policy wines_update on public.wines for update to authenticated
  using (public.is_member(restaurant_id, 'editor')) with check (public.is_member(restaurant_id, 'editor'));
create policy wines_delete on public.wines for delete to authenticated using (public.is_member(restaurant_id, 'editor'));

create policy notes_read   on public.wine_notes for select to authenticated using (public.is_member(restaurant_id));
create policy notes_insert on public.wine_notes for insert to authenticated with check (public.is_member(restaurant_id, 'editor'));
create policy notes_update on public.wine_notes for update to authenticated
  using (public.is_member(restaurant_id, 'editor')) with check (public.is_member(restaurant_id, 'editor'));
create policy notes_delete on public.wine_notes for delete to authenticated using (public.is_member(restaurant_id, 'editor'));


-- ---------------------------------------------------------------------
-- 5. ABFRAGEN FÜR DIE KARTE
-- ---------------------------------------------------------------------
-- get_atlas_data liefert alle Weine eines Restaurants in genau der Form, die die Karte heute als
--   DATA = { Land: { bearing, dist, regions: { Gebiet: { lat, lon, producers: [ {name, wines:[[label, price]]} ] } } } }
-- verwendet (Preis als Zahl, nicht als Text). security invoker: die Zugriffsregeln oben gelten,
-- ein Nutzer bekommt also nur Restaurants, in denen er Mitglied ist.
create function public.get_atlas_data(p_restaurant uuid)
returns jsonb
language sql stable security invoker set search_path = public as $$
  with pw as (            -- Weine je Region und Erzeuger
    select w.region_id, pr.id as producer_id, pr.name as producer_name,
           min(w.sort_order) as so,
           jsonb_agg(jsonb_build_array(w.label, w.price) order by w.sort_order, w.label) as wines
    from public.wines w
    join public.producers pr on pr.id = w.producer_id and pr.restaurant_id = w.restaurant_id
    where w.restaurant_id = p_restaurant and w.is_active and w.region_id is not null
    group by w.region_id, pr.id, pr.name
  ), rw as (              -- Erzeuger je Region
    select pw.region_id,
           jsonb_agg(jsonb_build_object('name', pw.producer_name, 'wines', pw.wines)
                     order by pw.so, pw.producer_name) as producers
    from pw group by pw.region_id
  ), cw as (              -- Regionen je Land
    select r.country_id,
           jsonb_object_agg(r.name, jsonb_build_object('lat', r.lat, 'lon', r.lon, 'producers', rw.producers)) as regions
    from rw join public.regions r on r.id = rw.region_id
    group by r.country_id
  )
  select coalesce(
    jsonb_object_agg(c.name, jsonb_build_object(
      'bearing', c.bearing, 'dist', c.dist, 'borderKey', c.border_key, 'regions', cw.regions)),
    '{}'::jsonb)
  from cw join public.countries c on c.id = cw.country_id;
$$;

-- Weine aus Ländern ohne Länderumriss (Abschnitt "Weitere Herkunft")
create function public.get_extra_origins(p_restaurant uuid)
returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'land', w.origin_country, 'gebiet', w.origin_region,
           'e', pr.name, 'w', w.label, 'p', w.price)
         order by w.origin_country, w.sort_order), '[]'::jsonb)
  from public.wines w
  join public.producers pr on pr.id = w.producer_id and pr.restaurant_id = w.restaurant_id
  where w.restaurant_id = p_restaurant and w.is_active and w.region_id is null;
$$;

-- Die Gebietsflächen liest die Karte direkt aus der Tabelle region_shapes (zusammen mit regions).


-- ---------------------------------------------------------------------
-- 6. START-STAMMDATEN (Länder). Gebiete und Flächen folgen aus den vorhandenen Daten
--    per Import-Skript im nächsten Schritt.
-- ---------------------------------------------------------------------

insert into public.countries (name, border_key, bearing, dist) values
  ('Deutschland', 'Germany',                  198,  95),
  ('Frankreich',  'France',                   232, 155),
  ('Österreich',  'Austria',                  168, 155),
  ('Italien',     'Italy',                    148, 205),
  ('Spanien',     'Spain',                    254, 225),
  ('Portugal',    'Portugal',                 262, 245),
  ('Südafrika',   'South Africa',             179, 300),
  ('USA',         'United States of America', 300, 300),
  ('Australien',  'Australia',                 78, 300);
