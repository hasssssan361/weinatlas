// Tests für Migration 004: Datenexport und Kontolöschung.
import { newDb, readSql, asUser } from './harness.mjs';
const db = await newDb();
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };
const mustFail = async (m, f, re) => { try { await f(); ok(false, m + ' (erlaubt!)'); } catch (e) { ok(!re || re.test(e.message), m + (re && !re.test(e.message) ? ' falsche Meldung: ' + e.message : '')); } };
for (const f of ['datenbank/schema.sql', 'datenbank/migrations/002_api.sql', 'datenbank/import_stammdaten.sql', 'datenbank/migrations/003_profile_tasks_plans.sql', 'datenbank/migrations/004_datenschutz.sql']) await db.exec(readSql(f));
await db.exec(readSql('datenbank/migrations/004_datenschutz.sql'));
const q = async (s, p) => (await db.query(s, p)).rows;
const one = async (s, p) => (await db.query(s, p)).rows[0];
const mkUser = async e => (await q(`insert into auth.users(email) values ($1) returning id`, [e]))[0].id;
const own = await mkUser('own@t.de'), own2 = await mkUser('own2@t.de'), vw = await mkUser('vw@t.de');
const R = (await q(`insert into restaurants(name,city) values ('Alpha','X') returning id`))[0].id;
const R2 = (await q(`insert into restaurants(name,city) values ('Beta','Y') returning id`))[0].id;
await db.exec(`update restaurants set plan='enterprise'`);
await db.exec(`insert into restaurant_members(restaurant_id,user_id,role) values ('${R}','${own}','owner'),('${R}','${vw}','viewer'),('${R2}','${own}','owner'),('${R2}','${own2}','owner')`);
const mosel = (await q(`select id from regions where name='Mosel'`))[0].id;
const w = (await asUser(db, own, () => one(`select save_wine('${R}', $1::jsonb) id`, [JSON.stringify({ producer: 'P', label: 'L', price: 9, region_id: mosel })]))).id;
await asUser(db, vw, () => q(`select set_display_name('Kai')`));
await asUser(db, vw, () => q(`select learn_record('${w}',true)`));
await asUser(db, vw, () => q(`select log_score('${R}','quiz',3,5)`));

const ex = (await asUser(db, vw, () => one(`select export_my_data() d`))).d;
ok(ex.konto.email === 'vw@t.de' && ex.anzeigename === 'Kai', 'Export: Konto und Name');
ok(ex.restaurants.length === 1 && ex.lernfortschritt.length === 1 && ex.quiz_ergebnisse.length === 1, 'Export: Restaurants, Fortschritt, Ergebnisse');
ok(!JSON.stringify(ex).includes('own@t.de'), 'Export enthält keine fremden Daten');
await mustFail('Export ohne Anmeldung', () => q(`select export_my_data()`), /Nicht angemeldet/);

await mustFail('einziger Inhaber darf nicht löschen', () => asUser(db, own, () => q(`select delete_my_account()`)), /einziger Inhaber/);
await db.exec(`insert into restaurant_members(restaurant_id,user_id,role) values ('${R}','${own2}','owner')`);
await asUser(db, own, () => q(`select delete_my_account()`));
ok(!(await one(`select 1 x from auth.users where id='${own}'`)), 'Inhaber mit Mit-Inhaber: Konto gelöscht');
ok((await one(`select count(*)::int n from restaurant_members where user_id='${own}'`)).n === 0, 'Mitgliedschaften weg');
ok((await one(`select count(*)::int n from wines where restaurant_id='${R}'`)).n === 1, 'Weine des Restaurants bleiben');

await asUser(db, vw, () => q(`select delete_my_account()`));
for (const t of ['profiles', 'learn_progress', 'learn_scores', 'restaurant_members']) ok((await one(`select count(*)::int n from ${t} where user_id='${vw}'`)).n === 0, `Kellner gelöscht: ${t} leer`);
await mustFail('Fremder Aufruf ohne Anmeldung', () => q(`select delete_my_account()`), /Nicht angemeldet/);
console.log(fails ? `\n${fails} FEHLER` : '\nalle Tests bestanden'); process.exit(fails ? 1 : 0);
