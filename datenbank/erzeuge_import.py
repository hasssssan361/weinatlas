"""Erzeugt die SQL-Importdateien für die Datenbank aus den vorhandenen Karten-Dateien.

Aufruf:  python datenbank/erzeuge_import.py

Ausgabe
  datenbank/import_stammdaten.sql              Gebiete, Gebietsflächen, Lagen (unkritisch, darf ins Repo)
  datenbank/privat/import_chefs_warehouse.sql  Weine von Chefs Warehouse   (NICHT committen)
  datenbank/privat/import_estancia.sql         Weine von Estancia          (NICHT committen)
  datenbank/privat/import_zugang.sql           Vorlage: Login einem Restaurant zuordnen
"""
import json, os, re, sys, uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'datenbank')
PRIV = os.path.join(OUT, 'privat')
os.makedirs(PRIV, exist_ok=True)

NS = uuid.UUID('6f1c1a52-5a0e-4d57-9a53-7a3f1d0b9e11')
def uid(*parts): return str(uuid.uuid5(NS, '/'.join(parts)))

def match_braces(text, start):
    depth = 0
    for i in range(start, len(text)):
        c = text[i]
        if c == '{': depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0: return i + 1
    raise ValueError('Klammer nicht geschlossen')

def js_to_json(raw):
    raw = re.sub(r'/\*.*?\*/', '', raw, flags=re.S)
    quoted = re.sub(r'([{,\s])([A-Za-z_][A-Za-z0-9_]*)\s*:', r'\1"\2":', raw)
    return json.loads(quoted)

def load_object(path, marker):
    t = open(path, encoding='utf-8').read()
    a = t.index(marker) + len(marker)
    a = t.index('{', a - 1) if t[a - 1] != '{' else a - 1
    return js_to_json(t[a:match_braces(t, a)]), t

def q(s):
    return "'" + str(s).replace("'", "''") + "'"

def price(p):
    if p is None: return 'null'
    s = str(p).strip().replace(',', '.')
    if not s: return 'null'
    float(s)
    return s

def chunks(rows, n=60):
    for i in range(0, len(rows), n): yield rows[i:i+n]

cw, _ = load_object(os.path.join(ROOT, 'weinatlas 8.html'), 'const DATA = {')
es, es_html = load_object(os.path.join(ROOT, 'weinatlas 9 estancia.html'), 'let DATA = {')
m = re.search(r'const EXTRA_ORIGINS = ', es_html)
extra, _ = load_object(os.path.join(ROOT, 'weinatlas 9 estancia.html'), 'const EXTRA_ORIGINS = {') if m else ({}, '')

# ------------------------------------------------------------------ Stammdaten
regions, sites, shapes = {}, {}, {}
def collect(data):
    for land, c in data.items():
        for name, r in c['regions'].items():
            regions.setdefault((land, name), (r['lat'], r['lon']))
            for site, s in (r.get('lagen') or {}).items():
                sites.setdefault((land, name, site), (s['lat'], s['lon']))
        for name, sh in (c.get('shapes') or {}).items():
            shapes.setdefault((land, name), sh['polygons'])
collect(cw); collect(es)

# Gebiete mit Fläche müssen auch ohne Weine existieren
for (land, name) in shapes:
    if (land, name) not in regions:
        sys.exit('Fläche ohne Gebiet: %s/%s' % (land, name))

lines = ['-- Stammdaten: Anbaugebiete, Gebietsflächen und Lagen. Erzeugt von datenbank/erzeuge_import.py.',
         '-- Mehrfach ausführbar (on conflict do nothing / do update).', 'begin;', '']
rows = ['(%s, (select id from public.countries where name = %s), %s, %s, %s)' % (q(uid('region', l, n)), q(l), q(n), lat, lon)
        for (l, n), (lat, lon) in sorted(regions.items())]
for ch in chunks(rows):
    lines.append('insert into public.regions (id, country_id, name, lat, lon) values\n  ' + ',\n  '.join(ch) + '\non conflict (id) do nothing;\n')
for (l, n), polys in sorted(shapes.items()):
    lines.append('insert into public.region_shapes (region_id, polygons) values (%s, %s::jsonb)\non conflict (region_id) do update set polygons = excluded.polygons;\n'
                 % (q(uid('region', l, n)), q(json.dumps(polys, separators=(',', ':')))))
rows = ['(%s, %s, %s, %s, %s)' % (q(uid('site', l, n, s)), q(uid('region', l, n)), q(s), lat, lon)
        for (l, n, s), (lat, lon) in sorted(sites.items())]
if rows:
    lines.append('insert into public.sites (id, region_id, name, lat, lon) values\n  ' + ',\n  '.join(rows) + '\non conflict (id) do nothing;\n')
lines.append('commit;\n')
open(os.path.join(OUT, 'import_stammdaten.sql'), 'w', encoding='utf-8').write('\n'.join(lines))
print('Stammdaten: %d Gebiete, %d Flächen, %d Lagen' % (len(regions), len(shapes), len(sites)))

# ------------------------------------------------------------------ Restaurants
def restaurant_sql(slug, name, city, data, extra_wines, fname):
    rid = uid('restaurant', slug)
    producers, wines = {}, []
    order = 0
    for land, c in data.items():
        for rname, r in c['regions'].items():
            reg = uid('region', land, rname)
            entries = [(p, None) for p in r.get('producers', [])]
            for site, s in (r.get('lagen') or {}).items():
                entries += [(p, site) for p in s['producers']]
            for p, site in entries:
                pid = uid('producer', slug, p['name'].lower())
                producers[pid] = p['name']
                for label, pr in p['wines']:
                    order += 1
                    wines.append((pid, reg, uid('site', land, rname, site) if site else None, None, None, label, pr, order))
    for w in extra_wines:
        order += 1
        pid = uid('producer', slug, w['e'].lower())
        producers[pid] = w['e']
        wines.append((pid, None, None, w['land'], w.get('gebiet'), w['w'], w.get('p'), order))
    out = ['-- Import %s. Erzeugt von datenbank/erzeuge_import.py. NICHT ins öffentliche Repo committen.' % name,
           '-- Erneutes Ausführen ersetzt alle Weine dieses Restaurants (manuelle Änderungen gehen verloren).',
           'begin;', '',
           'insert into public.restaurants (id, name, city) values (%s, %s, %s)\non conflict (id) do update set name = excluded.name, city = excluded.city;\n' % (q(rid), q(name), q(city)),
           'delete from public.wines where restaurant_id = %s;\n' % q(rid)]
    prows = ['(%s, %s, %s)' % (q(pid), q(rid), q(n)) for pid, n in sorted(producers.items(), key=lambda x: x[1].lower())]
    for ch in chunks(prows):
        out.append('insert into public.producers (id, restaurant_id, name) values\n  ' + ',\n  '.join(ch) + '\non conflict (id) do nothing;\n')
    wrows = []
    for w in wines:
        if len(w) == 8:
            pid, reg, site, oc, orr, label, pr, o = w
        else:
            pid, reg, site, oc, orr, label, pr, o = w[0], w[1], w[2], w[3], w[4], w[5], w[6], w[7]
        wrows.append('(%s, %s, %s, %s, %s, %s, %s, %s, %s, %d)' % (
            q(rid), q(pid), q(reg) if reg else 'null', q(site) if site else 'null',
            q(oc) if oc else 'null', q(orr) if orr else 'null', q(label), price(pr), 'true', o))
    for ch in chunks(wrows):
        out.append('insert into public.wines (restaurant_id, producer_id, region_id, site_id, origin_country, origin_region, label, price, is_active, sort_order) values\n  '
                   + ',\n  '.join(ch) + ';\n')
    out.append('commit;\n')
    open(os.path.join(PRIV, fname), 'w', encoding='utf-8').write('\n'.join(out))
    print('%s: %d Erzeuger, %d Weine (davon ohne Karte: %d)' % (name, len(producers), len(wines), len(extra_wines)))
    return rid

cw_id = restaurant_sql('chefs-warehouse', 'Chefs Warehouse', 'Hamburg', cw, [], 'import_chefs_warehouse.sql')
es_extra = [dict(land=l, gebiet=w.get('gebiet'), e=w['e'], w=w['w'], p=w.get('p')) for l, ws in extra.items() for w in ws] if isinstance(extra, dict) else []
es_id = restaurant_sql('estancia', 'Estancia Steakhaus', 'Hamburg', es, es_extra, 'import_estancia.sql')

open(os.path.join(PRIV, 'import_zugang.sql'), 'w', encoding='utf-8').write('''-- Vorlage: ordnet deinen Login den Restaurants zu (als owner).
-- 1. 'DEINE@EMAIL.DE' unten durch die E-Mail ersetzen, mit der du den Nutzer in Supabase angelegt hast.
-- 2. Im SQL Editor ausführen.
insert into public.restaurant_members (restaurant_id, user_id, role)
select r.id, u.id, 'owner'
from public.restaurants r
cross join auth.users u
where u.email = 'DEINE@EMAIL.DE'
on conflict (restaurant_id, user_id) do nothing;
''')

with open(os.path.join(ROOT, '.gitignore'), 'a+', encoding='utf-8') as f:
    f.seek(0)
    if 'datenbank/privat/' not in f.read():
        f.write('\n# Kundendaten (Weinkarten, Preise) gehören nicht ins öffentliche Repo\ndatenbank/privat/\n')
print('fertig')
