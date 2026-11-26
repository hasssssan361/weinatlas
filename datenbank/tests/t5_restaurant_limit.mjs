// Test für Migration 005: Restaurant-Limit pro Konto.
import { newDb, readSql, asUser } from './harness.mjs';
const db = await newDb(); let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };
for (const f of ['schema.sql', 'migrations/002_api.sql', 'import_stammdaten.sql', 'migrations/003_profile_tasks_plans.sql', 'migrations/004_datenschutz.sql', 'migrations/005_restaurant_limit.sql']) await db.exec(readSql('datenbank/' + f));
await db.exec(readSql('datenbank/migrations/005_restaurant_limit.sql'));
const u = (await db.query(`insert into auth.users(email) values ('a@t.de') returning id`)).rows[0].id;
for (let i = 1; i <= 3; i++) await asUser(db, u, () => db.query(`select create_restaurant('R${i}','X')`));
try { await asUser(db, u, () => db.query(`select create_restaurant('R4','X')`)); ok(false, '4. Restaurant erlaubt'); } catch (e) { ok(/höchstens 3/.test(e.message), '4. Restaurant abgelehnt'); }
try { await asUser(db, u, () => db.query(`select create_restaurant('  ')`)); ok(false, 'leerer Name'); } catch (e) { ok(/Namen/.test(e.message), 'leerer Name abgelehnt'); }
console.log(fails ? `\n${fails} FEHLER` : '\nalle Tests bestanden'); process.exit(fails ? 1 : 0);
