-- =====================================================================
-- Weinatlas – Migration 005: Missbrauchsschutz beim Anlegen von Restaurants
-- Ein Konto darf höchstens 3 Restaurants als Inhaber führen. Mehrfach ausführbar.
-- =====================================================================
create or replace function public.create_restaurant(p_name text, p_city text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  if length(trim(coalesce(p_name, ''))) = 0 or length(p_name) > 60 then raise exception 'Bitte einen Namen (bis 60 Zeichen) eintragen.'; end if;
  if (select count(*) from public.restaurant_members where user_id = auth.uid() and role = 'owner') >= 3 then
    raise exception 'Pro Konto sind höchstens 3 Restaurants möglich.';
  end if;
  insert into public.restaurants (name, city) values (trim(p_name), nullif(trim(coalesce(p_city, '')), '')) returning id into rid;
  insert into public.restaurant_members (restaurant_id, user_id, role) values (rid, auth.uid(), 'owner');
  return rid;
end $$;
revoke execute on function public.create_restaurant(text, text) from public, anon;
grant  execute on function public.create_restaurant(text, text) to authenticated;
