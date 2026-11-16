import { newDb, readSql, asUser, asAnon } from './harness.mjs';

const db = await newDb();
try {
  await db.exec(readSql('datenbank/schema.sql'));
  console.log('schema.sql: OK');
} catch (e) { console.log('schema.sql FEHLER:', e.message); process.exit(1); }

try {
  await db.exec(readSql('datenbank/import_stammdaten.sql'));
  console.log('import_stammdaten.sql: OK');
  for (const f of ['import_chefs_warehouse.sql', 'import_estancia.sql']) {
    await db.exec(readSql('datenbank/privat/' + f));
    console.log(f + ': OK');
  }
} catch (e) { console.log('Import FEHLER:', e.message); process.exit(1); }

const q = async (sql) => (await db.query(sql)).rows;
console.log(await q(`select r.name, count(*)::int n from wines w join restaurants r on r.id=w.restaurant_id group by r.name order by 1`));

// RLS: anon sieht nichts, fremder Nutzer sieht nichts, Mitglied sieht seine Weine
const [u1] = (await db.query(`insert into auth.users(email) values ('a@test.de') returning id`)).rows;
const [u2] = (await db.query(`insert into auth.users(email) values ('b@test.de') returning id`)).rows;
await db.exec(`insert into restaurant_members(restaurant_id,user_id,role)
  select id, '${u1.id}', 'viewer' from restaurants where name='Estancia Steakhaus'`);

console.log('anon wines:', (await asAnon(db, () => q('select count(*)::int n from wines')))[0].n);
console.log('fremd wines:', (await asUser(db, u2.id, () => q('select count(*)::int n from wines')))[0].n);
console.log('viewer wines:', (await asUser(db, u1.id, () => q('select count(*)::int n from wines')))[0].n);

const rid = (await q(`select id from restaurants where name='Estancia Steakhaus'`))[0].id;
const atlas = (await asUser(db, u1.id, () => q(`select get_atlas_data('${rid}') as d`)))[0].d;
console.log('atlas Länder:', Object.keys(atlas));
console.log('Mosel:', JSON.stringify(atlas['Deutschland'].regions['Mosel']).slice(0, 260));
// viewer darf nicht schreiben
try {
  await asUser(db, u1.id, () => db.exec(`insert into producers(restaurant_id,name) values ('${rid}','Hack')`));
  console.log('viewer-Schreiben: UNERWARTET ERLAUBT');
} catch (e) { console.log('viewer-Schreiben gesperrt: OK'); }
