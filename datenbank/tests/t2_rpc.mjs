import { newDb, readSql, asUser, asAnon } from './harness.mjs';
const db = await newDb();
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };
const must = async (m, f) => { try { const r = await f(); ok(true, m); return r; } catch (e) { ok(false, m + ' -> ' + e.message); } };
const mustFail = async (m, f) => { try { await f(); ok(false, m + ' (erlaubt!)'); } catch (e) { ok(true, m); } };

await db.exec(readSql('datenbank/schema.sql'));
await db.exec(readSql('datenbank/migrations/002_api.sql'));
await db.exec(readSql('datenbank/migrations/002_api.sql')); // zweimal ausführbar?
await db.exec(readSql('datenbank/import_stammdaten.sql'));
await db.exec(readSql('datenbank/privat/import_estancia.sql'));
await db.exec(readSql('datenbank/privat/import_chefs_warehouse.sql'));
const q = async (s, p) => (await db.query(s, p)).rows;
const rpc = async (s, p) => (await db.query(s, p)).rows[0];

const ed = (await q(`insert into auth.users(email) values ('ed@t.de') returning id`))[0].id;
const vw = (await q(`insert into auth.users(email) values ('vw@t.de') returning id`))[0].id;
const fr = (await q(`insert into auth.users(email) values ('fr@t.de') returning id`))[0].id;
const rid = (await q(`select id from restaurants where name='Estancia Steakhaus'`))[0].id;
const rid2 = (await q(`select id from restaurants where name<>'Estancia Steakhaus' limit 1`))[0].id;
await db.exec(`insert into restaurant_members(restaurant_id,user_id,role) values ('${rid}','${ed}','editor'),('${rid}','${vw}','viewer')`);

// Lesen
const mine = await asUser(db, ed, () => rpc(`select get_my_restaurants() d`));
ok(mine.d.length === 1 && mine.d[0].role === 'editor', 'get_my_restaurants');
const atlas = (await asUser(db, ed, () => rpc(`select get_atlas_data('${rid}') d`))).d;
ok(Object.keys(atlas).length >= 5, 'atlas Länder: ' + Object.keys(atlas).length);
const shapes = (await asUser(db, ed, () => rpc(`select get_shapes() d`))).d;
ok(shapes['Deutschland'] && Object.keys(shapes['Deutschland']).length >= 7, 'shapes');
const regs = (await asUser(db, ed, () => rpc(`select get_regions() d`))).d;
ok(regs.length >= 40, 'regions ' + regs.length);
const list = (await asUser(db, ed, () => rpc(`select get_wine_list('${rid}') d`))).d;
ok(list.length === 104, 'wine_list 104: ' + list.length);
const lagen = Object.values(atlas).flatMap(c => Object.values(c.regions)).filter(r => r.lagen);
console.log('Gebiete mit Lagen (Estancia):', lagen.length);

// Fremdes Restaurant: kein Zugriff
const fremd = (await asUser(db, ed, () => rpc(`select get_wine_list('${rid2}') d`))).d;
ok(fremd.length === 0, 'fremdes Restaurant leer');
await mustFail('anon darf RPC nicht', () => asAnon(db, () => q(`select get_atlas_data('${rid}')`)));

// Schreiben
const reg = regs.find(r => r.country === 'Deutschland' && r.name === 'Mosel');
const wid = (await must('save_wine neu', () => asUser(db, ed, () => rpc(
  `select save_wine('${rid}', $1::jsonb) id`, [JSON.stringify({ producer: 'Testgut', label: 'Riesling 2022', price: '39.5', region_id: reg.id })])))).id;
let l2 = (await asUser(db, ed, () => rpc(`select get_wine_list('${rid}') d`))).d;
ok(l2.length === 105 && l2.find(w => w.id === wid).price == 39.5, 'Wein angelegt');
await must('save_wine ändern', () => asUser(db, ed, () => q(`select save_wine('${rid}', $1::jsonb)`, [JSON.stringify({ id: wid, producer: 'Testgut2', label: 'Riesling 2023', price: 41, region_id: reg.id })])));
ok((await q(`select count(*)::int n from producers where restaurant_id='${rid}' and name='Testgut'`))[0].n === 0, 'verwaister Erzeuger entfernt');
await must('save_note', () => asUser(db, ed, () => q(`select save_note('${wid}', $1::jsonb)`, [JSON.stringify({ aroma: 'Pfirsich', taste: 'trocken', pairing: 'Fisch' })])));
l2 = (await asUser(db, ed, () => rpc(`select get_wine_list('${rid}') d`))).d;
ok(l2.find(w => w.id === wid).notes.aroma === 'Pfirsich', 'Notiz gelesen');
await mustFail('viewer save_wine', () => asUser(db, vw, () => q(`select save_wine('${rid}', $1::jsonb)`, [JSON.stringify({ producer: 'X', label: 'Y' })])));
await mustFail('viewer delete_wine', () => asUser(db, vw, () => q(`select delete_wine('${wid}')`)));
await asUser(db, fr, () => q(`select delete_wine('${wid}')`));
ok((await q(`select count(*)::int n from wines where id='${wid}'`))[0].n === 1, 'fremder delete_wine wirkungslos');
await mustFail('fremder save_note', () => asUser(db, fr, () => q(`select save_note('${wid}', '{}'::jsonb)`)));
await must('delete_wine', () => asUser(db, ed, () => q(`select delete_wine('${wid}')`)));

// Import mit Abgleich
const base = [{ producer: 'A', label: 'W1', price: 10, origin_country: 'Georgien' }, { producer: 'A', label: 'W2', price: 12, region_id: reg.id }, { producer: 'B', label: 'W3', price: 20, region_id: reg.id }];
let r = (await must('import_wines (ersetzen)', () => asUser(db, ed, () => rpc(`select import_wines('${rid}', $1::jsonb, true) n`, [JSON.stringify(base)])))).n;
ok(r.added === 3 && r.removed === 104 + 0, 'import 1: ' + JSON.stringify(r));
const w2 = (await q(`select w.id from wines w where label='W2' and restaurant_id='${rid}'`))[0].id;
await asUser(db, ed, () => q(`select save_note('${w2}', '{"aroma":"Apfel"}'::jsonb)`));
await asUser(db, ed, () => q(`update wines set is_active=false where id='${w2}'`));
await asUser(db, ed, () => q(`select learn_record('${w2}', true)`));
r = (await asUser(db, ed, () => rpc(`select import_wines('${rid}', $1::jsonb, true) n`, [JSON.stringify([{ producer: 'a', label: 'w2', price: 15, region_id: reg.id }, { producer: 'C', label: 'W9', price: 5, region_id: reg.id }])]))).n;
ok(r.added === 1 && r.updated === 1 && r.removed === 2, 'import 2: ' + JSON.stringify(r));
const w2b = (await q(`select id, price::float p, is_active from wines where lower(label)='w2' and restaurant_id='${rid}'`))[0];
ok(w2b.id === w2 && w2b.p === 15 && w2b.is_active === false, 'W2 erhalten, Preis neu, bleibt ausgeblendet');
ok((await q(`select count(*)::int n from wine_notes where wine_id='${w2}'`))[0].n === 1, 'Notiz bleibt');
ok((await q(`select count(*)::int n from learn_progress where wine_id='${w2}'`))[0].n === 1, 'Lernfortschritt bleibt');
r = (await asUser(db, ed, () => rpc(`select import_wines('${rid}', $1::jsonb, false) n`, [JSON.stringify([{ producer: 'D', label: 'W10', price: 5, region_id: reg.id }])]))).n;
ok(r.added === 1 && r.removed === 0, 'Anhängen: ' + JSON.stringify(r));
ok((await q(`select count(*)::int n from wines where restaurant_id='${rid}'`))[0].n === 3, 'Anzahl nach Anhängen');
ok((await q(`select count(*)::int n from wines where restaurant_id='${rid2}'`))[0].n > 0, 'anderes Restaurant unberührt');
await mustFail('Wein ohne Herkunft', () => asUser(db, ed, () => q(`select save_wine('${rid}', $1::jsonb)`, [JSON.stringify({ producer: 'Z', label: 'Q' })])));

// ensure_region
await must('ensure_region neu', () => asUser(db, ed, () => q(`select ensure_region('Deutschland','Testgebiet',50.0,8.0)`)));
await mustFail('ensure_region viewer', () => asUser(db, vw, () => q(`select ensure_region('Deutschland','Hack',50.0,8.0)`)));
await mustFail('ensure_region fremd', () => asUser(db, fr, () => q(`select ensure_region('Deutschland','Hack',50.0,8.0)`)));

// Lernen
const lw = l2.length ? (await asUser(db, ed, () => rpc(`select id from wines where restaurant_id='${rid}' and id<>'${w2}' limit 1`))).id : null;
await must('set_display_name', () => asUser(db, ed, () => q(`select set_display_name('Edi')`)));
await asUser(db, vw, () => q(`select set_display_name('Vicky')`));
let r1 = (await asUser(db, ed, () => rpc(`select learn_record('${lw}', true) d`))).d;
ok(r1.box === 2, 'richtig -> Fach 2');
r1 = (await asUser(db, ed, () => rpc(`select learn_record('${lw}', false) d`))).d;
ok(r1.box === 1, 'falsch -> Fach 1');
await asUser(db, ed, () => q(`select learn_record('${lw}', true)`));
const st = (await asUser(db, ed, () => rpc(`select get_learn_state('${rid}') d`))).d;
ok(st.length === 2 && st.find(x => x.wine_id === lw).seen === 3 && st.find(x => x.wine_id === lw).correct === 2, 'Lernstand');
ok((await asUser(db, vw, () => rpc(`select get_learn_state('${rid}') d`))).d.length === 0, 'Lernstand privat');
await mustFail('fremder learn_record', () => asUser(db, fr, () => q(`select learn_record('${lw}', true)`)));
await asUser(db, ed, () => q(`select log_score('${rid}','quiz',8,10)`));
await asUser(db, vw, () => q(`select log_score('${rid}','quiz',5,10)`));
await mustFail('fremder log_score', () => asUser(db, fr, () => q(`select log_score('${rid}','quiz',5,10)`)));
const lb = (await asUser(db, vw, () => rpc(`select get_leaderboard('${rid}') d`))).d;
ok(lb.length === 2 && lb[0].name === 'Edi' && lb[0].points === 8 && lb[1].is_me, 'Bestenliste ' + JSON.stringify(lb));
ok(!JSON.stringify(lb).includes('@'), 'keine E-Mails in Bestenliste');
await mustFail('fremde Bestenliste', () => asUser(db, fr, () => q(`select get_leaderboard('${rid}')`)));
ok((await asUser(db, vw, () => q(`select * from learn_scores where user_id='${ed}'`))).length === 0, 'fremde Scores unsichtbar');

// Team
await db.exec(`update restaurant_members set role='owner' where user_id='${ed}'`);
await must('add_member', () => asUser(db, ed, () => q(`select add_member('${rid}','FR@t.de','viewer')`)));
ok((await asUser(db, ed, () => rpc(`select get_members('${rid}') d`))).d.length === 3, 'get_members 3');
await mustFail('add_member unbekannt', () => asUser(db, ed, () => q(`select add_member('${rid}','nix@t.de','viewer')`)));
await mustFail('add_member durch viewer', () => asUser(db, vw, () => q(`select add_member('${rid}','fr@t.de','owner')`)));
await mustFail('letzten Inhaber entfernen', () => asUser(db, ed, () => q(`select remove_member('${rid}','${ed}')`)));
await must('remove_member', () => asUser(db, ed, () => q(`select remove_member('${rid}','${fr}')`)));
await db.exec(`update restaurant_members set role='editor' where user_id='${ed}'`);

console.log(fails ? `\n${fails} FEHLER` : '\nALLE TESTS BESTANDEN');
process.exit(fails ? 1 : 0);
