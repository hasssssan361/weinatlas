// Sicherheits-Audit des Schemas: RLS überall, Security-Definer-Funktionen mit festem search_path,
// keine Ausführungsrechte für "anon", Mandantentrennung bei allen Tabellen mit restaurant_id.
import { newDb, readSql, asUser, asAnon } from './harness.mjs';
const db = await newDb(); let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };
for (const f of ['schema.sql', 'migrations/002_api.sql', 'import_stammdaten.sql', 'migrations/003_profile_tasks_plans.sql', 'migrations/004_datenschutz.sql', 'migrations/005_restaurant_limit.sql']) await db.exec(readSql('datenbank/' + f));
const q = async (s, p) => (await db.query(s, p)).rows;

const noRls = await q(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`);
ok(noRls.length === 0, 'RLS auf allen Tabellen aktiv' + (noRls.length ? ': ' + noRls.map(r => r.relname) : ''));

const noPath = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%')`);
ok(noPath.length === 0, 'Alle security-definer-Funktionen mit festem search_path' + (noPath.length ? ': ' + noPath.map(r => r.proname) : ''));

const anonExec = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and p.prorettype <> 'trigger'::regtype and has_function_privilege('anon', p.oid, 'execute')
  and p.proname not in ('is_member','jsonb_text_array','get_shapes','get_regions')`);
ok(anonExec.length === 0, 'anon darf keine Funktion ausführen (außer öffentliche Hilfen)' + (anonExec.length ? ': ' + anonExec.map(r => r.proname) : ''));

const quotaExec = await q(`select has_function_privilege('authenticated', 'public.consume_quota(uuid,text)', 'execute') a`);
ok(quotaExec[0].a === false, 'consume_quota nicht für angemeldete Nutzer');

// Mandantentrennung: jede Tabelle mit restaurant_id darf von einem Fremden nichts lesen
const mk = async e => (await q(`insert into auth.users(email) values ($1) returning id`, [e]))[0].id;
const a = await mk('a@t.de'), b = await mk('b@t.de');
const R1 = (await asUser(db, a, () => q(`select create_restaurant('A','X') id`)))[0].id;
await asUser(db, b, () => q(`select create_restaurant('B','Y')`));
const mosel = (await q(`select id from regions where name='Mosel'`))[0].id;
await asUser(db, a, () => q(`select save_wine('${R1}', $1::jsonb)`, [JSON.stringify({ producer: 'P', label: 'L', price: 5, region_id: mosel })]));
const tabs = await q(`select table_name from information_schema.columns where table_schema='public' and column_name='restaurant_id' order by 1`);
for (const t of tabs) {
  const n = (await asUser(db, b, () => q(`select count(*)::int n from public.${t.table_name} where restaurant_id='${R1}'`)))[0].n;
  ok(n === 0, `Fremder sieht nichts in ${t.table_name}`);
}
for (const t of tabs) {
  const n = (await asAnon(db, () => q(`select count(*)::int n from public.${t.table_name}`).catch(() => [{ n: 0 }])))[0].n;
  ok(n === 0, `Anonym sieht nichts in ${t.table_name}`);
}
console.log(fails ? `\n${fails} FEHLER` : '\nalle Prüfungen bestanden'); process.exit(fails ? 1 : 0);
