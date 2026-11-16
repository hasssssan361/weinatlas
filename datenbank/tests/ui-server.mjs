// Test-Server: bildet die Supabase-REST-Schnittstelle (Auth + RPC) auf einer PGlite-Datenbank nach.
import http from 'node:http';
import fs from 'node:fs';
import { newDb, readSql } from './harness.mjs';

const PORT = 54321;
const db = await newDb();
await db.exec(readSql('datenbank/schema.sql'));
await db.exec(readSql('datenbank/migrations/002_api.sql'));
await db.exec(readSql('datenbank/import_stammdaten.sql'));
await db.exec(readSql('datenbank/privat/import_estancia.sql'));
await db.exec(readSql('datenbank/privat/import_chefs_warehouse.sql'));
await db.exec(`create table test_pw(email text primary key, password text, id uuid)`);

async function mkUser(email, pw, role, restName) {
  const id = (await db.query(`insert into auth.users(email) values ($1) returning id`, [email])).rows[0].id;
  await db.query(`insert into test_pw values ($1,$2,$3)`, [email, pw, id]);
  if (restName) await db.query(`insert into restaurant_members(restaurant_id,user_id,role) select id,$1,$2::member_role from restaurants where name=$3`, [id, role, restName]);
  return id;
}
await mkUser('chef@test.de', 'test1234', 'owner', 'Estancia Steakhaus');
await mkUser('kellner@test.de', 'test1234', 'viewer', 'Estancia Steakhaus');
await mkUser('neu@test.de', 'test1234', null, null);
await mkUser('cw@test.de', 'test1234', 'editor', 'Chefs Warehouse');

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const send = (res, code, obj, extra = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...cors, ...extra }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => b += c); req.on('end', () => ok(b)); });
const tok = (id, email) => Buffer.from(JSON.stringify({ sub: id, email })).toString('base64url');
const untok = (h) => { try { return JSON.parse(Buffer.from((h || '').replace(/^Bearer /, ''), 'base64url').toString()); } catch { return null; } };

let queue = Promise.resolve();
const serial = (f) => (queue = queue.then(f, f));

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(new URL('../../app/dist/test.html', import.meta.url))); }
  const body = await readBody(req);
  const j = body ? JSON.parse(body) : {};
  try {
    if (url.pathname === '/auth/v1/token') {
      if (url.searchParams.get('grant_type') === 'password') {
        const r = (await db.query(`select * from test_pw where email=$1 and password=$2`, [j.email, j.password])).rows[0];
        if (!r) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
        return send(res, 200, { access_token: tok(r.id, r.email), refresh_token: 'r-' + tok(r.id, r.email), expires_in: 3600, user: { id: r.id, email: r.email } });
      }
      const u = untok(j.refresh_token.replace(/^r-/, ''));
      return send(res, 200, { access_token: tok(u.sub, u.email), refresh_token: j.refresh_token, expires_in: 3600, user: { id: u.sub, email: u.email } });
    }
    if (url.pathname === '/auth/v1/logout' || url.pathname === '/auth/v1/recover') return send(res, 200, {});
    if (url.pathname === '/auth/v1/user') return send(res, 200, { id: untok(req.headers.authorization)?.sub, email: untok(req.headers.authorization)?.email });
    if (url.pathname.startsWith('/functions/v1/extract-winelist')) {
      const u = untok(req.headers.authorization); if (!u) return send(res, 401, { error: 'x' });
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', ...cors });
      const mode = (j && j.mode) || 'wines';
      const out = mode === 'notes' ? JSON.stringify({ weine: [
        { e: 'Weingut Test', w: '2022 Riesling', aroma: 'Pfirsich, Zitrus', geschmack: 'trocken, mineralisch', passt: 'Fisch', info: 'Test' },
        { e: 'Domaine X', w: 'Savagnin 2019', aroma: 'Nuss', geschmack: 'kräftig', passt: 'Käse', info: '' },
        { e: 'Unbekannt', w: 'Gibt es nicht', aroma: 'x', geschmack: '', passt: '', info: '' }] }) : JSON.stringify({
        gebiete: [{ land: 'Deutschland', gebiet: 'Mosel', lat: 49.9, lon: 7.1 }, { land: 'Georgien', gebiet: 'Kachetien', lat: 41.9, lon: 45.5 }, { land: 'Frankreich', gebiet: 'Jura', lat: 46.8, lon: 5.7 }],
        weine: [{ g: 0, e: 'Weingut Test', w: '2022 · Riesling trocken', p: '38' }, { g: 0, e: 'Weingut Test', w: '2021 · Spätburgunder', p: '45.5' }, { g: 1, e: 'Pheasant', w: '2020 · Rkatsiteli', p: '55' }, { g: 2, e: 'Domaine X', w: '2019 · Savagnin', p: '' }]
      });
      for (let i = 0; i < out.length; i += 40) { res.write(out.slice(i, i + 40)); await new Promise(r => setTimeout(r, 30)); }
      return res.end();
    }
    const m = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
    if (m) {
      const u = untok(req.headers.authorization);
      return await serial(async () => {
        if (!u) return send(res, 401, { message: 'JWT expired' });
        const fn = m[1];
        const sig = (await db.query(`select p.proargnames names, p.proargtypes::oid[] types from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1 limit 1`, [fn])).rows[0];
        if (!sig) return send(res, 404, { message: 'function not found' });
        const types = (await db.query(`select format_type(t,null) ft from unnest($1::oid[]) t`, [sig.types])).rows.map(r => r.ft);
        const names = sig.names || [];
        const keys = Object.keys(j);
        const params = [], parts = [];
        keys.forEach((k, i) => { const ti = names.indexOf(k); params.push(typeof j[k] === 'object' && j[k] !== null ? JSON.stringify(j[k]) : j[k]); parts.push(`${k} => $${i + 1}::${types[ti]}`); });
        await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${u.sub}',false);`);
        try {
          const r = await db.query(`select ${fn}(${parts.join(',')}) as r`, params);
          send(res, 200, r.rows[0].r);
        } catch (e) {
          send(res, 400, { message: e.message });
        } finally { await db.exec(`reset role;`); }
      });
    }
    send(res, 404, { message: 'nicht gefunden ' + url.pathname });
  } catch (e) { send(res, 500, { message: String(e.message || e) }); }
}).listen(PORT, () => console.log('Testserver läuft auf http://localhost:' + PORT));
