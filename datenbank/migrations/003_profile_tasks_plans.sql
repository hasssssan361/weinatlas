-- =====================================================================
-- Weinatlas – Migration 003: Geschmacksprofil, Quellen, Freigabe, Lernaufgaben,
--             Wein der Woche, Tarife und Kontingente
-- Voraussetzung: schema.sql und migrations/002_api.sql wurden ausgeführt.
-- Darf mehrfach ausgeführt werden.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. TARIFE
-- ---------------------------------------------------------------------

create table if not exists public.plan_limits (
  plan              text primary key,
  max_members       integer,            -- null = unbegrenzt
  max_wines         integer,
  ai_imports_month  integer,            -- KI-Auslesen von PDFs je Monat
  ai_search_month   integer,            -- KI-Freitextsuchen je Monat
  feat_tasks        boolean not null default false,   -- Lernaufgaben & Auswertungen
  feat_research     boolean not null default false    -- Recherche / Anreicherung
);

-- Entwurf der Tarifstruktur (keine Preise). Werte können im Dashboard angepasst werden.
insert into public.plan_limits (plan, max_members, max_wines, ai_imports_month, ai_search_month, feat_tasks, feat_research) values
  ('starter',      5,    300,  3,    100,  false, false),
  ('professional', 25,   1500, 20,   1000, true,  true),
  ('enterprise',   null, null, null, null, true,  true)
on conflict (plan) do nothing;

alter table public.plan_limits enable row level security;
drop policy if exists plan_limits_read on public.plan_limits;
create policy plan_limits_read on public.plan_limits for select to authenticated using (true);

-- Tarifspalte am Restaurant. Bestehende Restaurants (Pilotkunden) werden einmalig auf "enterprise" gesetzt.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'restaurants' and column_name = 'plan') then
    alter table public.restaurants add column plan text not null default 'starter' references public.plan_limits(plan);
    update public.restaurants set plan = 'enterprise';
  end if;
end $$;

-- Den Tarif darf nur der Betreiber ändern (SQL-Editor / service_role), nie ein angemeldeter Nutzer.
create or replace function public.protect_plan() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.plan is distinct from old.plan and auth.uid() is not null then
    raise exception 'Der Tarif kann nur vom Betreiber geändert werden';
  end if;
  return new;
end $$;
drop trigger if exists restaurants_protect_plan on public.restaurants;
create trigger restaurants_protect_plan before update on public.restaurants
  for each row execute function public.protect_plan();

-- Tariflimits für Weine und Mitglieder: Prüfung am Ende der Transaktion, damit ein Import
-- (viele Einfügungen, am Schluss Löschungen) nur den Endstand gegen das Limit prüft.
create or replace function public.enforce_plan_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim integer; n integer;
begin
  if tg_table_name = 'wines' then
    select pl.max_wines into lim from public.restaurants r join public.plan_limits pl on pl.plan = r.plan where r.id = new.restaurant_id;
    if lim is not null then
      select count(*) into n from public.wines where restaurant_id = new.restaurant_id;
      if n > lim then raise exception 'Tariflimit erreicht: maximal % Weine.', lim; end if;
    end if;
  else
    select pl.max_members into lim from public.restaurants r join public.plan_limits pl on pl.plan = r.plan where r.id = new.restaurant_id;
    if lim is not null then
      select count(*) into n from public.restaurant_members where restaurant_id = new.restaurant_id;
      if n > lim then raise exception 'Tariflimit erreicht: maximal % Mitarbeiter.', lim; end if;
    end if;
  end if;
  return null;
end $$;
drop trigger if exists wines_plan_limit on public.wines;
create constraint trigger wines_plan_limit after insert on public.wines
  deferrable initially deferred for each row execute function public.enforce_plan_limit();
drop trigger if exists members_plan_limit on public.restaurant_members;
create constraint trigger members_plan_limit after insert on public.restaurant_members
  deferrable initially deferred for each row execute function public.enforce_plan_limit();

-- KI-Kontingent je Restaurant und Monat (nur für Server-Funktionen / service_role)
create table if not exists public.ai_usage (
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  month          date not null,
  kind           text not null check (kind in ('import', 'search')),
  count          integer not null default 0,
  primary key (restaurant_id, month, kind)
);
alter table public.ai_usage enable row level security;     -- bewusst ohne Regeln: nur service_role

-- Atomar: zählt einen Verbrauch und meldet, ob er im Kontingent lag.
create or replace function public.consume_quota(p_restaurant uuid, p_kind text) returns boolean
language plpgsql security definer set search_path = public as $$
declare lim integer; c integer;
begin
  select case p_kind when 'import' then pl.ai_imports_month when 'search' then pl.ai_search_month end
    into lim from public.restaurants r join public.plan_limits pl on pl.plan = r.plan where r.id = p_restaurant;
  if not found then return false; end if;
  if lim is not null and lim <= 0 then return false; end if;
  insert into public.ai_usage (restaurant_id, month, kind, count)
  values (p_restaurant, date_trunc('month', now())::date, p_kind, 1)
  on conflict (restaurant_id, month, kind) do update set count = public.ai_usage.count + 1
    where lim is null or public.ai_usage.count < lim
  returning count into c;
  return c is not null;
end $$;

create or replace function public.refund_quota(p_restaurant uuid, p_kind text) returns void
language sql security definer set search_path = public as $$
  update public.ai_usage set count = greatest(count - 1, 0)
  where restaurant_id = p_restaurant and kind = p_kind and month = date_trunc('month', now())::date;
$$;

-- Tarif, Limits und aktuelle Nutzung für die Oberfläche
create or replace function public.get_entitlements(p_restaurant uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pl public.plan_limits; r public.restaurants; m date := date_trunc('month', now())::date;
begin
  if not public.is_member(p_restaurant) then raise exception 'Keine Berechtigung'; end if;
  select * into r from public.restaurants where id = p_restaurant;
  select * into pl from public.plan_limits where plan = r.plan;
  return jsonb_build_object(
    'plan', r.plan,
    'limits', jsonb_build_object('members', pl.max_members, 'wines', pl.max_wines, 'imports', pl.ai_imports_month,
                                 'searches', pl.ai_search_month, 'tasks', pl.feat_tasks, 'research', pl.feat_research),
    'usage', jsonb_build_object(
      'members', (select count(*) from public.restaurant_members where restaurant_id = p_restaurant),
      'wines',   (select count(*) from public.wines where restaurant_id = p_restaurant),
      'imports', coalesce((select count from public.ai_usage where restaurant_id = p_restaurant and month = m and kind = 'import'), 0),
      'searches',coalesce((select count from public.ai_usage where restaurant_id = p_restaurant and month = m and kind = 'search'), 0)));
end $$;


-- ---------------------------------------------------------------------
-- 2. GESCHMACKSPROFIL, HERKUNFTSSTATUS, FREIGABE, QUELLEN
-- ---------------------------------------------------------------------
-- Skalen: 1 (niedrig) bis 5 (hoch). NULL = unbekannt (wird nie als Tatsache behandelt).
-- provenance: je Feld { "src": restaurant | producer | external | ai | unknown, "url": …, "at": … }

create table if not exists public.wine_profiles (
  wine_id           uuid primary key,
  restaurant_id     uuid not null,
  color             text check (color in ('rot', 'weiss', 'rose', 'schaum', 'orange', 'suess')),
  grapes            text[] not null default '{}',
  abv               numeric(4, 1) check (abv between 0 and 25),
  body              smallint check (body between 1 and 5),
  acidity           smallint check (acidity between 1 and 5),
  tannin            smallint check (tannin between 1 and 5),
  sweetness         smallint check (sweetness between 1 and 5),
  fruit             smallint check (fruit between 1 and 5),
  minerality        smallint check (minerality between 1 and 5),
  oak               smallint check (oak between 1 and 5),
  aromas            text[] not null default '{}',
  finish            text,
  serving_temp      text,
  aging             text,
  pairing_dishes    text[] not null default '{}',
  description_tech  text,
  description_service text,
  selling_points    text[] not null default '{}',
  guest_hint        text,
  provenance        jsonb not null default '{}'::jsonb,
  status            text not null default 'draft' check (status in ('draft', 'approved')),
  approved_by       uuid references auth.users(id) on delete set null,
  approved_at       timestamptz,
  updated_at        timestamptz not null default now(),
  foreign key (restaurant_id, wine_id) references public.wines (restaurant_id, id) on delete cascade
);
create index if not exists wine_profiles_rest_idx on public.wine_profiles (restaurant_id, status);

create table if not exists public.wine_sources (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null,
  wine_id        uuid not null,
  url            text not null check (url ~* '^https?://' and length(url) <= 500),
  title          text,
  kind           text not null default 'external' check (kind in ('producer', 'datasheet', 'importer', 'retailer', 'external')),
  reliability    smallint check (reliability between 1 and 5),
  retrieved_at   date not null default current_date,
  note           text,
  created_by     uuid references auth.users(id) on delete set null,
  foreign key (restaurant_id, wine_id) references public.wines (restaurant_id, id) on delete cascade
);
create index if not exists wine_sources_wine_idx on public.wine_sources (wine_id);

alter table public.wine_profiles enable row level security;
alter table public.wine_sources  enable row level security;

drop policy if exists profiles_read on public.wine_profiles;
create policy profiles_read on public.wine_profiles for select to authenticated
  using ((status = 'approved' and public.is_member(restaurant_id)) or public.is_member(restaurant_id, 'editor'));
drop policy if exists profiles_write on public.wine_profiles;
create policy profiles_write on public.wine_profiles for all to authenticated
  using (public.is_member(restaurant_id, 'editor')) with check (public.is_member(restaurant_id, 'editor'));

drop policy if exists sources_rw on public.wine_sources;
create policy sources_rw on public.wine_sources for all to authenticated
  using (public.is_member(restaurant_id, 'editor')) with check (public.is_member(restaurant_id, 'editor'));

create or replace function public.jsonb_text_array(j jsonb) returns text[]
language sql immutable as $$
  select case when j is null or jsonb_typeof(j) <> 'array' then '{}'::text[]
              else coalesce((select array_agg(trim(x)) from jsonb_array_elements_text(j) x where trim(x) <> ''), '{}') end
$$;

-- Profil speichern. Jede Änderung setzt die Freigabe zurück (draft); p_approve = true gibt direkt frei.
create or replace function public.save_profile(p_wine uuid, p jsonb, p_approve boolean default false) returns void
language plpgsql security invoker set search_path = public as $$
declare rid uuid;
  nm text := nullif(trim(coalesce(p->>'description_tech', '')), '');
begin
  select restaurant_id into rid from public.wines where id = p_wine;
  if rid is null then raise exception 'Wein nicht gefunden'; end if;
  if not public.is_member(rid, 'editor') then raise exception 'Keine Berechtigung'; end if;
  insert into public.wine_profiles (
    wine_id, restaurant_id, color, grapes, abv, body, acidity, tannin, sweetness, fruit, minerality, oak,
    aromas, finish, serving_temp, aging, pairing_dishes, description_tech, description_service, selling_points,
    guest_hint, provenance, status, approved_by, approved_at, updated_at)
  values (
    p_wine, rid, nullif(p->>'color', ''), public.jsonb_text_array(p->'grapes'), nullif(p->>'abv', '')::numeric,
    nullif(p->>'body', '')::smallint, nullif(p->>'acidity', '')::smallint, nullif(p->>'tannin', '')::smallint,
    nullif(p->>'sweetness', '')::smallint, nullif(p->>'fruit', '')::smallint, nullif(p->>'minerality', '')::smallint,
    nullif(p->>'oak', '')::smallint, public.jsonb_text_array(p->'aromas'), nullif(trim(coalesce(p->>'finish', '')), ''),
    nullif(trim(coalesce(p->>'serving_temp', '')), ''), nullif(trim(coalesce(p->>'aging', '')), ''),
    public.jsonb_text_array(p->'pairing_dishes'), nm, nullif(trim(coalesce(p->>'description_service', '')), ''),
    public.jsonb_text_array(p->'selling_points'), nullif(trim(coalesce(p->>'guest_hint', '')), ''),
    case when jsonb_typeof(p->'provenance') = 'object' then p->'provenance' else '{}'::jsonb end,
    case when p_approve then 'approved' else 'draft' end,
    case when p_approve then auth.uid() end, case when p_approve then now() end, now())
  on conflict (wine_id) do update set
    color = excluded.color, grapes = excluded.grapes, abv = excluded.abv, body = excluded.body,
    acidity = excluded.acidity, tannin = excluded.tannin, sweetness = excluded.sweetness, fruit = excluded.fruit,
    minerality = excluded.minerality, oak = excluded.oak, aromas = excluded.aromas, finish = excluded.finish,
    serving_temp = excluded.serving_temp, aging = excluded.aging, pairing_dishes = excluded.pairing_dishes,
    description_tech = excluded.description_tech, description_service = excluded.description_service,
    selling_points = excluded.selling_points, guest_hint = excluded.guest_hint, provenance = excluded.provenance,
    status = excluded.status, approved_by = excluded.approved_by, approved_at = excluded.approved_at, updated_at = now();
end $$;

create or replace function public.set_profile_status(p_wine uuid, p_approved boolean) returns void
language plpgsql security invoker set search_path = public as $$
declare rid uuid;
begin
  select restaurant_id into rid from public.wines where id = p_wine;
  if rid is null then raise exception 'Wein nicht gefunden'; end if;
  if not public.is_member(rid, 'editor') then raise exception 'Keine Berechtigung'; end if;
  update public.wine_profiles set status = case when p_approved then 'approved' else 'draft' end,
         approved_by = case when p_approved then auth.uid() end, approved_at = case when p_approved then now() end
  where wine_id = p_wine;
  if not found then raise exception 'Der Wein hat noch kein Profil'; end if;
end $$;

create or replace function public.add_source(p_wine uuid, p_url text, p_title text, p_kind text, p_reliability integer)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare rid uuid; sid uuid;
begin
  select restaurant_id into rid from public.wines where id = p_wine;
  if rid is null then raise exception 'Wein nicht gefunden'; end if;
  if not public.is_member(rid, 'editor') then raise exception 'Keine Berechtigung'; end if;
  insert into public.wine_sources (restaurant_id, wine_id, url, title, kind, reliability, created_by)
  values (rid, p_wine, trim(p_url), nullif(trim(coalesce(p_title, '')), ''), coalesce(nullif(p_kind, ''), 'external'),
          p_reliability, auth.uid())
  returning id into sid;
  return sid;
end $$;

create or replace function public.get_sources(p_wine uuid) returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'url', s.url, 'title', s.title, 'kind', s.kind,
           'reliability', s.reliability, 'retrieved_at', s.retrieved_at, 'note', s.note) order by s.retrieved_at desc), '[]'::jsonb)
  from public.wine_sources s where s.wine_id = p_wine;
$$;

create or replace function public.delete_source(p_source uuid) returns void
language sql security invoker set search_path = public as $$
  delete from public.wine_sources where id = p_source;
$$;

-- Weinliste jetzt mit Geschmacksprofil. Mitarbeiter sehen nur freigegebene Profile, Bearbeiter alle.
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
                    else jsonb_build_object('aroma', n.aroma, 'taste', n.taste, 'pairing', n.pairing, 'details', n.details) end,
      'profile', case when wp.wine_id is null then null
                      else to_jsonb(wp) - 'restaurant_id' - 'wine_id' - 'approved_by' end
    ) as x
    from public.wines w
    join public.producers pr on pr.id = w.producer_id and pr.restaurant_id = w.restaurant_id
    left join public.regions r on r.id = w.region_id
    left join public.countries c on c.id = r.country_id
    left join public.sites s on s.id = w.site_id
    left join public.wine_notes n on n.wine_id = w.id
    left join public.wine_profiles wp on wp.wine_id = w.id
    where w.restaurant_id = p_restaurant
  ) t;
$$;


-- ---------------------------------------------------------------------
-- 3. LERNAUFGABEN
-- ---------------------------------------------------------------------

create table if not exists public.learn_tasks (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  title          text not null check (length(trim(title)) between 1 and 120),
  description    text check (length(description) <= 1000),
  due_at         timestamptz,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (restaurant_id, id)
);
create table if not exists public.learn_task_wines (
  task_id        uuid not null,
  wine_id        uuid not null,
  restaurant_id  uuid not null,
  primary key (task_id, wine_id),
  foreign key (restaurant_id, task_id) references public.learn_tasks (restaurant_id, id) on delete cascade,
  foreign key (restaurant_id, wine_id) references public.wines (restaurant_id, id) on delete cascade
);
create table if not exists public.learn_task_assignees (
  task_id        uuid not null,
  user_id        uuid not null references auth.users(id) on delete cascade,
  restaurant_id  uuid not null,
  completed_at   timestamptz,
  primary key (task_id, user_id),
  foreign key (restaurant_id, task_id) references public.learn_tasks (restaurant_id, id) on delete cascade
);
create index if not exists learn_task_assignees_user_idx on public.learn_task_assignees (user_id);
create table if not exists public.learn_task_progress (
  task_id    uuid not null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  wine_id    uuid not null,
  attempts   integer not null default 0,
  correct    integer not null default 0,
  done       boolean not null default false,
  primary key (task_id, user_id, wine_id),
  foreign key (task_id, wine_id) references public.learn_task_wines (task_id, wine_id) on delete cascade
);

alter table public.learn_tasks           enable row level security;
alter table public.learn_task_wines      enable row level security;
alter table public.learn_task_assignees  enable row level security;
alter table public.learn_task_progress   enable row level security;

drop policy if exists tasks_read on public.learn_tasks;
create policy tasks_read on public.learn_tasks for select to authenticated using (
  public.is_member(restaurant_id, 'editor')
  or exists (select 1 from public.learn_task_assignees a where a.task_id = id and a.user_id = auth.uid()));
drop policy if exists tasks_write on public.learn_tasks;
create policy tasks_write on public.learn_tasks for all to authenticated
  using (public.is_member(restaurant_id, 'editor')) with check (public.is_member(restaurant_id, 'editor'));

drop policy if exists task_wines_read on public.learn_task_wines;
create policy task_wines_read on public.learn_task_wines for select to authenticated using (
  public.is_member(restaurant_id, 'editor')
  or exists (select 1 from public.learn_task_assignees a where a.task_id = learn_task_wines.task_id and a.user_id = auth.uid()));
drop policy if exists task_wines_write on public.learn_task_wines;
create policy task_wines_write on public.learn_task_wines for all to authenticated
  using (public.is_member(restaurant_id, 'editor')) with check (public.is_member(restaurant_id, 'editor'));

drop policy if exists assignees_read on public.learn_task_assignees;
create policy assignees_read on public.learn_task_assignees for select to authenticated
  using (user_id = auth.uid() or public.is_member(restaurant_id, 'editor'));
drop policy if exists assignees_write on public.learn_task_assignees;
create policy assignees_write on public.learn_task_assignees for all to authenticated
  using (public.is_member(restaurant_id, 'editor')) with check (public.is_member(restaurant_id, 'editor'));

drop policy if exists task_progress_read on public.learn_task_progress;
create policy task_progress_read on public.learn_task_progress for select to authenticated using (
  user_id = auth.uid()
  or exists (select 1 from public.learn_tasks t where t.id = task_id and public.is_member(t.restaurant_id, 'editor')));
-- Schreiben nur über task_record()

create or replace function public.create_task(
  p_restaurant uuid, p_title text, p_due timestamptz, p_wine_ids uuid[],
  p_user_ids uuid[] default null, p_description text default null) returns uuid
language plpgsql security invoker set search_path = public as $$
declare tid uuid; feat boolean;
begin
  if not public.is_member(p_restaurant, 'editor') then raise exception 'Keine Berechtigung'; end if;
  select pl.feat_tasks into feat from public.restaurants r join public.plan_limits pl on pl.plan = r.plan where r.id = p_restaurant;
  if not coalesce(feat, false) then raise exception 'Lernaufgaben sind im aktuellen Tarif nicht enthalten'; end if;
  if p_wine_ids is null or array_length(p_wine_ids, 1) is null then raise exception 'Bitte mindestens einen Wein wählen'; end if;
  if array_length(p_wine_ids, 1) > 100 then raise exception 'Zu viele Weine in einer Aufgabe (max. 100)'; end if;
  if (select count(*) from public.wines where restaurant_id = p_restaurant and id = any (p_wine_ids))
       <> (select count(distinct x) from unnest(p_wine_ids) x) then
    raise exception 'Ein gewählter Wein gehört nicht zu diesem Restaurant';
  end if;
  if p_user_ids is not null and (select count(*) from public.restaurant_members where restaurant_id = p_restaurant and user_id = any (p_user_ids))
       <> (select count(distinct x) from unnest(p_user_ids) x) then
    raise exception 'Ein gewählter Mitarbeiter gehört nicht zu diesem Restaurant';
  end if;

  insert into public.learn_tasks (restaurant_id, title, description, due_at, created_by)
  values (p_restaurant, trim(p_title), nullif(trim(coalesce(p_description, '')), ''), p_due, auth.uid())
  returning id into tid;
  insert into public.learn_task_wines (task_id, wine_id, restaurant_id)
    select tid, x, p_restaurant from (select distinct unnest(p_wine_ids) x) s;
  insert into public.learn_task_assignees (task_id, user_id, restaurant_id)
    select tid, m.user_id, p_restaurant from public.restaurant_members m
    where m.restaurant_id = p_restaurant and (p_user_ids is null or m.user_id = any (p_user_ids));
  return tid;
end $$;

create or replace function public.delete_task(p_task uuid) returns void
language plpgsql security invoker set search_path = public as $$
declare rid uuid;
begin
  select restaurant_id into rid from public.learn_tasks where id = p_task;
  if rid is null then return; end if;
  if not public.is_member(rid, 'editor') then raise exception 'Keine Berechtigung'; end if;
  delete from public.learn_tasks where id = p_task;
end $$;

-- Antwort zu einem Wein einer Aufgabe verbuchen. Ein Wein gilt als erledigt, sobald er einmal richtig beantwortet wurde.
create or replace function public.task_record(p_task uuid, p_wine uuid, p_correct boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rid uuid; total integer; ndone integer; finished boolean;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  select restaurant_id into rid from public.learn_task_assignees where task_id = p_task and user_id = auth.uid();
  if rid is null or not public.is_member(rid) then raise exception 'Aufgabe nicht gefunden'; end if;
  if not exists (select 1 from public.learn_task_wines where task_id = p_task and wine_id = p_wine) then
    raise exception 'Wein gehört nicht zur Aufgabe';
  end if;
  insert into public.learn_task_progress (task_id, user_id, wine_id, attempts, correct, done)
  values (p_task, auth.uid(), p_wine, 1, case when p_correct then 1 else 0 end, p_correct)
  on conflict (task_id, user_id, wine_id) do update set
    attempts = public.learn_task_progress.attempts + 1,
    correct = public.learn_task_progress.correct + (case when p_correct then 1 else 0 end),
    done = public.learn_task_progress.done or p_correct;
  select count(*) into total from public.learn_task_wines where task_id = p_task;
  select count(*) into ndone from public.learn_task_progress where task_id = p_task and user_id = auth.uid() and done;
  finished := ndone >= total;
  if finished then
    update public.learn_task_assignees set completed_at = coalesce(completed_at, now()) where task_id = p_task and user_id = auth.uid();
  end if;
  return jsonb_build_object('done', ndone, 'total', total, 'finished', finished);
end $$;

-- Meine Aufgaben
create or replace function public.get_my_tasks(p_restaurant uuid) returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'title', t.title, 'description', t.description, 'due_at', t.due_at, 'completed_at', a.completed_at,
    'wines', (select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'label', w.label, 'producer', pr.name,
                       'done', coalesce(p.done, false)) order by w.sort_order), '[]'::jsonb)
              from public.learn_task_wines tw
              join public.wines w on w.id = tw.wine_id
              join public.producers pr on pr.id = w.producer_id
              left join public.learn_task_progress p on p.task_id = t.id and p.wine_id = w.id and p.user_id = auth.uid()
              where tw.task_id = t.id))
    order by a.completed_at is not null, t.due_at nulls last, t.created_at), '[]'::jsonb)
  from public.learn_task_assignees a
  join public.learn_tasks t on t.id = a.task_id
  where a.user_id = auth.uid() and a.restaurant_id = p_restaurant;
$$;

-- Übersicht für die Geschäftsführung (nur Inhaber/Bearbeiter)
create or replace function public.get_task_overview(p_restaurant uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member(p_restaurant, 'editor') then raise exception 'Keine Berechtigung'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'title', t.title, 'due_at', t.due_at, 'created_at', t.created_at,
      'wine_count', (select count(*) from public.learn_task_wines where task_id = t.id),
      'assignees', (select coalesce(jsonb_agg(jsonb_build_object(
            'user_id', a.user_id, 'name', coalesce(pf.display_name, split_part(u.email, '@', 1)),
            'completed_at', a.completed_at,
            'done', (select count(*) from public.learn_task_progress p where p.task_id = t.id and p.user_id = a.user_id and p.done),
            'attempts', (select coalesce(sum(attempts), 0) from public.learn_task_progress p where p.task_id = t.id and p.user_id = a.user_id),
            'correct', (select coalesce(sum(correct), 0) from public.learn_task_progress p where p.task_id = t.id and p.user_id = a.user_id))
            order by coalesce(pf.display_name, u.email)), '[]'::jsonb)
          from public.learn_task_assignees a
          join auth.users u on u.id = a.user_id
          left join public.profiles pf on pf.user_id = a.user_id
          where a.task_id = t.id))
      order by t.due_at nulls last, t.created_at desc)
    from public.learn_tasks t where t.restaurant_id = p_restaurant), '[]'::jsonb);
end $$;



-- Teamliste für die Zuweisung von Aufgaben (Inhaber/Bearbeiter; nur Anzeigenamen, keine E-Mail-Adressen)
create or replace function public.get_team(p_restaurant uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member(p_restaurant, 'editor') then raise exception 'Keine Berechtigung'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
            'user_id', m.user_id, 'name', coalesce(pf.display_name, split_part(u.email, '@', 1)), 'role', m.role)
          order by coalesce(pf.display_name, u.email))
          from public.restaurant_members m
          join auth.users u on u.id = m.user_id
          left join public.profiles pf on pf.user_id = m.user_id
          where m.restaurant_id = p_restaurant), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- 4. WEIN DER WOCHE
-- ---------------------------------------------------------------------

create table if not exists public.featured_wine (
  restaurant_id  uuid primary key references public.restaurants(id) on delete cascade,
  wine_id        uuid not null,
  set_by         uuid references auth.users(id) on delete set null,
  set_at         timestamptz not null default now(),
  foreign key (restaurant_id, wine_id) references public.wines (restaurant_id, id) on delete cascade
);
alter table public.featured_wine enable row level security;
drop policy if exists featured_read on public.featured_wine;
create policy featured_read on public.featured_wine for select to authenticated using (public.is_member(restaurant_id));
drop policy if exists featured_write on public.featured_wine;
create policy featured_write on public.featured_wine for all to authenticated
  using (public.is_member(restaurant_id, 'editor')) with check (public.is_member(restaurant_id, 'editor'));

-- p_wine = null löscht die Auswahl
create or replace function public.set_featured(p_restaurant uuid, p_wine uuid) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if not public.is_member(p_restaurant, 'editor') then raise exception 'Keine Berechtigung'; end if;
  if p_wine is null then
    delete from public.featured_wine where restaurant_id = p_restaurant;
  else
    if not exists (select 1 from public.wines where id = p_wine and restaurant_id = p_restaurant) then raise exception 'Wein nicht gefunden'; end if;
    insert into public.featured_wine (restaurant_id, wine_id, set_by) values (p_restaurant, p_wine, auth.uid())
    on conflict (restaurant_id) do update set wine_id = excluded.wine_id, set_by = excluded.set_by, set_at = now();
  end if;
end $$;

create or replace function public.get_featured(p_restaurant uuid) returns uuid
language sql stable security invoker set search_path = public as $$
  select wine_id from public.featured_wine where restaurant_id = p_restaurant;
$$;


-- ---------------------------------------------------------------------
-- 5. BERECHTIGUNGEN
-- ---------------------------------------------------------------------

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('save_profile', 'set_profile_status', 'add_source', 'get_sources', 'delete_source', 'get_wine_list',
                        'create_task', 'delete_task', 'task_record', 'get_my_tasks', 'get_task_overview',
                        'set_featured', 'get_featured', 'get_team', 'get_entitlements', 'consume_quota', 'refund_quota')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.proname in ('consume_quota', 'refund_quota') then
      execute format('revoke execute on function %s from authenticated', f.sig);   -- nur Server-Funktionen
      execute format('grant execute on function %s to service_role', f.sig);
    else
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
