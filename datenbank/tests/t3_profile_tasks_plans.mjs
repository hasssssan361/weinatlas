// Tests für Migration 003: Profil/Freigabe, Quellen, Lernaufgaben, Wein der Woche, Tarife/Kontingente.
// Arbeitet mit synthetischen Daten (keine Kundendaten nötig).
import { newDb, readSql, asUser, asAnon } from './harness.mjs';

const db = await newDb();
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };
const must = async (m, f) => { try { const r = await f(); ok(true, m); return r; } catch (e) { ok(false, m + ' -> ' + e.message); } };
const mustFail = async (m, f, re) => { try { await f(); ok(false, m + ' (erlaubt!)'); } catch (e) { ok(!re || re.test(e.message), m + (re && !re.test(e.message) ? ' falsche Meldung: ' + e.message : '')); } };

for (const f of ['datenbank/schema.sql', 'datenbank/migrations/002_api.sql', 'datenbank/import_stammdaten.sql']) await db.exec(readSql(f));
await db.exec(readSql('datenbank/migrations/003_profile_tasks_plans.sql'));
await db.exec(readSql('datenbank/migrations/003_profile_tasks_plans.sql')); // zweimal ausführbar?

const q = async (s, p) => (await db.query(s, p)).rows;
const one = async (s, p) => (await db.query(s, p)).rows[0];
const mkUser = async (e) => (await q(`insert into auth.users(email) values ($1) returning id`, [e]))[0].id;
const own = await mkUser('own@t.de'), ed = await mkUser('ed@t.de'), vw = await mkUser('vw@t.de'), vw2 = await mkUser('vw2@t.de'), fr = await mkUser('fr@t.de');

// zwei Restaurants (Starter-Tarif, Standard) und ein Enterprise-Restaurant
const R1 = (await q(`insert into restaurants(name,city) values ('Alpha','X') returning id`))[0].id;
const R2 = (await q(`insert into restaurants(name,city) values ('Beta','Y') returning id`))[0].id;
ok((await one(`select plan from restaurants where id='${R1}'`)).plan === 'starter', 'neues Restaurant = starter');
await db.exec(`update restaurants set plan='professional' where id='${R1}'`);
await db.exec(`insert into restaurant_members(restaurant_id,user_id,role) values
  ('${R1}','${own}','owner'),('${R1}','${ed}','editor'),('${R1}','${vw}','viewer'),('${R1}','${vw2}','viewer'),('${R2}','${fr}','owner')`);

const mosel = (await q(`select id from regions where name='Mosel'`))[0].id;
const mk = async (rid, user, label, producer = 'Gut A') => (await asUser(db, user, () => one(
  `select save_wine('${rid}', $1::jsonb) id`, [JSON.stringify({ producer, label, price: 30, region_id: mosel })]))).id;
const w1 = await mk(R1, ed, 'Riesling 2022'), w2 = await mk(R1, ed, 'Pinot Noir 2021', 'Gut B'), w3 = await mk(R1, ed, 'Chardonnay 2020', 'Gut C');
const wOther = await mk(R2, fr, 'Fremdwein', 'Gut F');

// ---- Tarif ----
await mustFail('Nutzer darf Tarif nicht ändern', () => asUser(db, own, () => q(`update restaurants set plan='enterprise' where id='${R1}'`)), /Tarif/);
const ent = (await asUser(db, vw, () => one(`select get_entitlements('${R1}') d`))).d;
ok(ent.plan === 'professional' && ent.usage.wines === 3 && ent.limits.tasks === true, 'get_entitlements');
await mustFail('get_entitlements fremdes Restaurant', () => asUser(db, vw, () => q(`select get_entitlements('${R2}')`)), /Berechtigung/);

// Kontingent atomar
await db.exec(`update plan_limits set ai_imports_month = 2 where plan='professional'`);
const cq = async () => (await one(`select consume_quota('${R1}','import') ok`)).ok;
ok((await cq()) === true && (await cq()) === true && (await cq()) === false, 'Kontingent: 2 erlaubt, 3. abgelehnt');
await db.exec(`select refund_quota('${R1}','import')`);
ok((await cq()) === true && (await cq()) === false, 'Rückerstattung gibt 1 frei');
await mustFail('consume_quota nicht für Nutzer', () => asUser(db, own, () => q(`select consume_quota('${R1}','import')`)), /permission|Berechtigung|denied/i);
await db.exec(`update plan_limits set ai_imports_month = 20 where plan='professional'`);

// Weinlimit (Endstand wird geprüft)
await db.exec(`update plan_limits set max_wines = 4 where plan='professional'`);
await mustFail('Weinlimit überschritten', () => mk(R1, ed, 'W5', 'Gut D').then(() => mk(R1, ed, 'W6', 'Gut D')), /Tariflimit/);
ok((await one(`select count(*)::int n from wines where restaurant_id='${R1}'`)).n === 4, 'Weinlimit: Rollback der überzähligen Einfügung');
// Ersetzen mit gleich vielen Weinen bleibt erlaubt
await must('Import-Ersetzen innerhalb des Limits', () => asUser(db, ed, () => q(`select import_wines('${R1}', $1::jsonb, true)`,
  [JSON.stringify([1, 2, 3, 4].map(i => ({ producer: 'Neu', label: 'N' + i, price: 5, region_id: mosel })))])));
await db.exec(`update plan_limits set max_wines = 1500 where plan='professional'`);
// Ausgangslage wiederherstellen
await asUser(db, ed, () => q(`select import_wines('${R1}', $1::jsonb, true)`, [JSON.stringify([
  { producer: 'Gut A', label: 'Riesling 2022', price: 30, region_id: mosel }, { producer: 'Gut B', label: 'Pinot Noir 2021', price: 30, region_id: mosel },
  { producer: 'Gut C', label: 'Chardonnay 2020', price: 30, region_id: mosel }])]));
const ids = (await q(`select id, label from wines where restaurant_id='${R1}'`)); const W = Object.fromEntries(ids.map(x => [x.label, x.id]));

// Mitgliederlimit
await db.exec(`update plan_limits set max_members = 4 where plan='professional'`);
await mustFail('Mitgliederlimit', () => asUser(db, own, () => q(`select add_member('${R1}','fr@t.de','viewer')`)), /Tariflimit/);
await db.exec(`update plan_limits set max_members = 25 where plan='professional'`);

// ---- Profil & Freigabe ----
const prof = { color: 'rot', grapes: ['Pinot Noir'], body: 2, acidity: 3, tannin: 2, oak: 2, aromas: ['Kirsche', 'Vanille'], abv: 12.5, provenance: { body: { src: 'restaurant' } }, description_service: 'Leicht und fruchtig.' };
await must('save_profile (Bearbeiter)', () => asUser(db, ed, () => q(`select save_profile('${W['Pinot Noir 2021']}', $1::jsonb)`, [JSON.stringify(prof)])));
const listE = (await asUser(db, ed, () => one(`select get_wine_list('${R1}') d`))).d;
const listV = (await asUser(db, vw, () => one(`select get_wine_list('${R1}') d`))).d;
const pe = listE.find(w => w.id === W['Pinot Noir 2021']).profile, pv = listV.find(w => w.id === W['Pinot Noir 2021']).profile;
ok(pe && pe.status === 'draft' && pe.body === 2 && pe.aromas.length === 2, 'Bearbeiter sieht Entwurf');
ok(pv === null, 'Mitarbeiter sieht Entwurf NICHT');
await must('Freigabe', () => asUser(db, ed, () => q(`select set_profile_status('${W['Pinot Noir 2021']}', true)`)));
const pv2 = (await asUser(db, vw, () => one(`select get_wine_list('${R1}') d`))).d.find(w => w.id === W['Pinot Noir 2021']).profile;
ok(pv2 && pv2.status === 'approved' && pv2.tannin === 2 && pv2.approved_at, 'Mitarbeiter sieht freigegebenes Profil');
await asUser(db, ed, () => q(`select save_profile('${W['Pinot Noir 2021']}', $1::jsonb)`, [JSON.stringify({ ...prof, body: 3 })]));
ok((await asUser(db, vw, () => one(`select get_wine_list('${R1}') d`))).d.find(w => w.id === W['Pinot Noir 2021']).profile === null, 'Änderung setzt Freigabe zurück');
await mustFail('Profil Wertebereich', () => asUser(db, ed, () => q(`select save_profile('${W['Riesling 2022']}', '{"body":9}'::jsonb)`)));
await mustFail('Profil durch Mitarbeiter', () => asUser(db, vw, () => q(`select save_profile('${W['Riesling 2022']}', '{}'::jsonb)`)), /Berechtigung/);
await mustFail('Profil fremder Wein', () => asUser(db, fr, () => q(`select save_profile('${W['Riesling 2022']}', '{}'::jsonb)`)));
ok((await asUser(db, vw, () => q(`select * from wine_profiles`))).length === 0, 'RLS: Mitarbeiter liest Entwurf nicht direkt');
ok((await asUser(db, fr, () => q(`select * from wine_profiles`))).length === 0, 'RLS: fremdes Restaurant liest keine Profile');

// ---- Quellen ----
const sid = (await must('add_source', () => asUser(db, ed, () => one(`select add_source('${W['Riesling 2022']}','https://example.com/datenblatt.pdf','Datenblatt','datasheet',5) id`)))).id;
await mustFail('add_source ungültige URL', () => asUser(db, ed, () => q(`select add_source('${W['Riesling 2022']}','javascript:alert(1)','x','external',3)`)));
ok((await asUser(db, ed, () => one(`select get_sources('${W['Riesling 2022']}') d`))).d.length === 1, 'get_sources');
ok((await asUser(db, vw, () => one(`select get_sources('${W['Riesling 2022']}') d`))).d.length === 0, 'Mitarbeiter sieht Quellen nicht');
await asUser(db, vw, () => q(`select delete_source('${sid}')`));
ok((await q(`select count(*)::int n from wine_sources`))[0].n === 1, 'Mitarbeiter kann Quelle nicht löschen');
await asUser(db, ed, () => q(`select delete_source('${sid}')`));

// ---- Lernaufgaben ----
await db.exec(`update plan_limits set feat_tasks=false where plan='professional'`);
await mustFail('Aufgaben im Tarif gesperrt', () => asUser(db, own, () => q(`select create_task('${R1}','T',null,$1::uuid[])`, [[W['Riesling 2022']]])), /Tarif/);
await db.exec(`update plan_limits set feat_tasks=true where plan='professional'`);
const tid = (await must('create_task (alle)', () => asUser(db, own, () => one(
  `select create_task('${R1}','Rotweine lernen', now() + interval '3 days', $1::uuid[]) id`, [[W['Pinot Noir 2021'], W['Riesling 2022']]])))).id;
ok((await q(`select count(*)::int n from learn_task_assignees where task_id='${tid}'`))[0].n === 4, 'Aufgabe an das ganze Team');
const tid2 = (await asUser(db, ed, () => one(`select create_task('${R1}','Nur Kai', null, $1::uuid[], $2::uuid[]) id`, [[W['Chardonnay 2020']], [vw]]))).id;
ok((await q(`select count(*)::int n from learn_task_assignees where task_id='${tid2}'`))[0].n === 1, 'Aufgabe an einzelnen Mitarbeiter');
await mustFail('Aufgabe mit fremdem Wein', () => asUser(db, own, () => q(`select create_task('${R1}','X',null,$1::uuid[])`, [[wOther]])), /Restaurant/);
await mustFail('Aufgabe mit fremdem Mitarbeiter', () => asUser(db, own, () => q(`select create_task('${R1}','X',null,$1::uuid[],$2::uuid[])`, [[W['Riesling 2022']], [fr]])), /Restaurant/);
await mustFail('Aufgabe durch Mitarbeiter', () => asUser(db, vw, () => q(`select create_task('${R1}','X',null,$1::uuid[])`, [[W['Riesling 2022']]])), /Berechtigung/);
await mustFail('Aufgabe ohne Weine', () => asUser(db, own, () => q(`select create_task('${R1}','X',null,$1::uuid[])`, [[]])));

const my = (await asUser(db, vw, () => one(`select get_my_tasks('${R1}') d`))).d;
ok(my.length === 2 && my.some(t => t.id === tid && t.wines.length === 2), 'Mitarbeiter sieht seine 2 Aufgaben');
ok((await asUser(db, vw2, () => one(`select get_my_tasks('${R1}') d`))).d.length === 1, 'vw2 sieht nur die Teamaufgabe');
ok((await asUser(db, fr, () => one(`select get_my_tasks('${R2}') d`))).d.length === 0, 'fremdes Restaurant sieht keine');

let r = (await asUser(db, vw, () => one(`select task_record('${tid}','${W['Pinot Noir 2021']}', false) d`))).d;
ok(r.done === 0 && r.total === 2 && !r.finished, 'falsche Antwort zählt nicht als erledigt');
r = (await asUser(db, vw, () => one(`select task_record('${tid}','${W['Pinot Noir 2021']}', true) d`))).d;
ok(r.done === 1 && !r.finished, 'richtige Antwort: 1/2');
r = (await asUser(db, vw, () => one(`select task_record('${tid}','${W['Riesling 2022']}', true) d`))).d;
ok(r.done === 2 && r.finished, 'Aufgabe abgeschlossen');
await mustFail('task_record Wein nicht in Aufgabe', () => asUser(db, vw, () => q(`select task_record('${tid}','${W['Chardonnay 2020']}', true)`)), /Aufgabe/);
await mustFail('task_record ohne Zuweisung', () => asUser(db, vw2, () => q(`select task_record('${tid2}','${W['Chardonnay 2020']}', true)`)), /Aufgabe/);
await mustFail('task_record fremder Nutzer', () => asUser(db, fr, () => q(`select task_record('${tid}','${W['Riesling 2022']}', true)`)), /Aufgabe/);
await mustFail('Fortschritt direkt schreiben', () => asUser(db, vw, () => q(`insert into learn_task_progress(task_id,user_id,wine_id,done) values ('${tid}','${vw}','${W['Riesling 2022']}',true)`)));

const ov = (await asUser(db, own, () => one(`select get_task_overview('${R1}') d`))).d;
const t1 = ov.find(t => t.id === tid), a1 = t1.assignees.find(a => a.user_id === vw);
ok(ov.length === 2 && t1.assignees.length === 4 && a1.done === 2 && a1.completed_at && a1.attempts === 3 && a1.correct === 2, 'Übersicht: Fortschritt je Mitarbeiter');
ok(t1.assignees.find(a => a.user_id === vw2).done === 0, 'Übersicht: nicht begonnen');
await mustFail('Übersicht durch Mitarbeiter', () => asUser(db, vw, () => q(`select get_task_overview('${R1}')`)), /Berechtigung/);
ok((await asUser(db, vw2, () => q(`select * from learn_task_progress`))).length === 0, 'Mitarbeiter sieht Fortschritt anderer nicht');
ok((await asUser(db, vw2, () => q(`select * from learn_tasks`))).length === 1, 'Mitarbeiter sieht nur zugewiesene Aufgaben (RLS)');
await mustFail('delete_task durch Mitarbeiter', () => asUser(db, vw, () => q(`select delete_task('${tid}')`)), /Berechtigung/);
ok((await q(`select count(*)::int n from learn_tasks where id='${tid}'`))[0].n === 1, 'Mitarbeiter kann Aufgabe nicht löschen');
await asUser(db, ed, () => q(`select delete_task('${tid}')`));
ok((await q(`select count(*)::int n from learn_task_progress where task_id='${tid}'`))[0].n === 0, 'Löschen räumt Fortschritt auf');

const team = (await asUser(db, ed, () => one(`select get_team('${R1}') d`))).d;
ok(team.length === 4 && !JSON.stringify(team).includes('@'), 'get_team: 4 Personen, keine E-Mails');
await mustFail('get_team durch Mitarbeiter', () => asUser(db, vw, () => q(`select get_team('${R1}')`)), /Berechtigung/);

// ---- Wein der Woche ----
await must('set_featured', () => asUser(db, ed, () => q(`select set_featured('${R1}','${W['Pinot Noir 2021']}')`)));
ok((await asUser(db, vw, () => one(`select get_featured('${R1}') id`))).id === W['Pinot Noir 2021'], 'Mitarbeiter sieht Wein der Woche');
await mustFail('set_featured durch Mitarbeiter', () => asUser(db, vw, () => q(`select set_featured('${R1}','${W['Riesling 2022']}')`)), /Berechtigung/);
await mustFail('set_featured fremder Wein', () => asUser(db, own, () => q(`select set_featured('${R1}','${wOther}')`)), /nicht gefunden/);
await asUser(db, ed, () => q(`select set_featured('${R1}', null)`));
ok((await asUser(db, vw, () => one(`select get_featured('${R1}') id`))).id === null, 'Wein der Woche gelöscht');

// ---- Anonym ----
await mustFail('anon: get_my_tasks', () => asAnon(db, () => q(`select get_my_tasks('${R1}')`)));
await mustFail('anon: get_wine_list', () => asAnon(db, () => q(`select get_wine_list('${R1}')`)));

console.log(fails ? `\n${fails} FEHLER` : '\nALLE TESTS BESTANDEN');
process.exit(fails ? 1 : 0);
