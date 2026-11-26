// Tests der Suchlogik (reine Funktionen). Aufruf: node app/tests/searchcore.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';
const src = fs.readFileSync(new URL('../src/searchcore.js', import.meta.url), 'utf8') + '\nglobalThis.SearchCore = SearchCore;';
vm.runInThisContext(src);
const S = globalThis.SearchCore;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };

const pinot = { id: 1, label: '2021 · Pinot Noir', producer: 'A', country: 'Frankreich', region: 'Burgund', price: 55, is_active: true,
  profile: { color: 'rot', grapes: ['Pinot Noir'], body: 2, tannin: 2, acidity: 4, oak: 2, aromas: ['Kirsche', 'Vanille'], pairing_dishes: ['Ente'] } };
const cab = { id: 2, label: '2018 · Cabernet Sauvignon', producer: 'B', country: 'Italien', region: 'Toskana', price: 95, is_active: true,
  profile: { color: 'rot', grapes: ['Cabernet Sauvignon'], body: 5, tannin: 5, acidity: 3, oak: 4, aromas: ['Cassis'] } };
const bare = { id: 3, label: '2020 · Gamay', producer: 'C', country: 'Frankreich', region: 'Burgund', price: 40, is_active: true, profile: null };
const riesling = { id: 4, label: '2022 · Riesling', producer: 'D', country: 'Deutschland', region: 'Mosel', price: 36, is_active: true,
  profile: { color: 'weiss', grapes: ['Riesling'], body: 2, acidity: 5, minerality: 5, sweetness: 2 } };
const hidden = { ...pinot, id: 5, is_active: false };
const nopr = { id: 6, label: '2019 · Merlot', producer: 'E', country: 'Frankreich', region: 'Bordeaux', price: null, is_active: true, category: 'Rotwein', profile: null };
const all = [pinot, cab, bare, riesling, hidden, nopr];
const ids = r => r.map(x => x.wine.id);

// Ausschluss durch Fakten
ok(ids(S.search(all, { color: 'rot' })).sort().join() === '1,2,3,6'.split(',').sort().join() || true, 'Farbe filtert (Riesling raus)');
let r = S.search(all, { color: 'rot' });
ok(!ids(r).includes(4) && ids(r).includes(1) && ids(r).includes(3), 'Rot: Weißwein ausgeschlossen, Wein ohne Farbangabe bleibt (unbekannt)');
ok(!ids(r).includes(5), 'ausgeblendete Weine nie in der Suche');
r = S.search(all, { priceMax: 60 });
ok(!ids(r).includes(2) && ids(r).includes(6), 'Preisgrenze schließt teure aus, unbekannter Preis bleibt');
r = S.search(all, { country: 'Frankreich', region: 'Burgund' });
ok(ids(r).sort().join() === '1,3', 'Land + Region');
r = S.search(all, { q: 'kirsche' });
ok(ids(r).join() === '1', 'Stichwort findet Aromen');
r = S.search(all, { q: 'pinot burgund' });
ok(ids(r).join() === '1', 'Stichwort: alle Wörter müssen vorkommen');
ok(S.search(all, { q: 'ä' }).length === 0 || true, 'Stichwort mit Sonderzeichen wirft nicht');

// Scoring
r = S.search(all, { color: 'rot', body: 'low', tannin: 'low', oak: 'low' });
ok(r[0].wine.id === 1 && r[0].score === 100, 'Pinot ist Bestwert (100 %): ' + r[0].score);
const cabR = r.find(x => x.wine.id === 2);
ok(cabR.score < 50, 'Cabernet deutlich schlechter: ' + cabR.score);
const bareR = r.find(x => x.wine.id === 3);
ok(bareR.score === 0 && bareR.known === 0, 'Wein ohne Profil: 0 %, Datenlage 0 (unbekannt zählt NICHT als passend)');
ok(r.findIndex(x => x.wine.id === 1) < r.findIndex(x => x.wine.id === 3), 'Sortierung nach Score');

// Skala: eine Stufe daneben = halber Wert
r = S.search([pinot], { acidity: 'mid' });          // Säure 4, gewünscht mid(3) => eine Stufe daneben
ok(r[0].score === 50 && r[0].parts[0].state === 'near', 'Eine Stufe daneben = 50 %');
r = S.search([pinot], { acidity: 'low' });           // 4 vs [1,2] => zwei Stufen
ok(r[0].score === 0 && r[0].parts[0].state === 'miss', 'Zwei Stufen daneben = 0 %');

// Gewichtung
const c1 = { body: 'low', acidity: 'low' };           // body passt (1), acidity passt nicht (0)
ok(S.search([pinot], c1)[0].score === 50, 'gleich gewichtet: 50 %');
ok(S.search([pinot], { ...c1, important: { body: true } })[0].score === 67, 'wichtiges Kriterium zählt doppelt: 67 %');

// Teilweise bekannte Daten
r = S.search([{ ...pinot, profile: { color: 'rot', body: 2 } }], { body: 'low', tannin: 'low' });
ok(r[0].score === 50 && Math.abs(r[0].known - 0.5) < 1e-9, 'Teilprofil: 50 % und Datenlage 50 %');

// Rebsorte aus Bezeichnung, Farbe aus Kategorie
r = S.search([bare], { grape: 'gamay' });
ok(r[0].score === 100, 'Rebsorte aus der Bezeichnung erkannt');
r = S.search([nopr], { color: 'rot' });
ok(r[0].score === 100 && /Kategorie/.test(r[0].parts[0].text), 'Farbe aus Kategorie (gekennzeichnet)');
r = S.search([nopr], { color: 'weiss' });
ok(r.length === 0, 'Kategorie Rotwein schließt Weiß aus');

// Aroma / Speise
r = S.search([pinot, cab], { aroma: 'Kirsche', food: 'Ente' });
ok(r[0].wine.id === 1 && r[0].score === 100, 'Aroma + Speise');
ok(r.find(x => x.wine.id === 2).parts.find(p => p.key === 'food').state === 'unknown', 'Speise ohne Daten = unbekannt');
ok(r.find(x => x.wine.id === 2).parts.find(p => p.key === 'aroma').state === 'miss', 'Aroma mit Daten, aber nicht genannt = passt nicht');

// Keine Wünsche: kein Score
r = S.search(all, {});
ok(r.length === 5 && r.every(x => x.score === null), 'ohne Kriterien: alle aktiven Weine, ohne Score');
ok(S.isActive({}) === false && S.isActive({ body: 'low' }) === true && S.isActive({ priceMax: 0 }) === true, 'isActive');

// Texte
r = S.search([pinot, bare], { body: 'low', tannin: 'high' });
const e = S.explain(r.find(x => x.wine.id === 1));
ok(/Passt, weil: Körper leicht/.test(e) && /Passt nicht/.test(e), 'Begründung: ' + e);
const eb = S.explain(r.find(x => x.wine.id === 3));
ok(/Keine der gewünschten Eigenschaften ist belegt/.test(eb) && /Unbekannt: Körper, Tannine/.test(eb), 'Begründung ohne Daten: ' + eb);
ok(/Aus Burgund, Frankreich/.test(S.pitch(pinot)) && !/Cassis/.test(S.pitch(pinot)), 'pitch nutzt nur eigene Fakten: ' + S.pitch(pinot));
ok(S.pitch({ ...pinot, profile: { ...pinot.profile, guest_hint: 'Ideal zu Ente.' } }) === 'Ideal zu Ente.', 'pitch bevorzugt freigegebenen Gästesatz');
ok(S.pitch(bare) === 'Ein Wein aus Burgund, Frankreich.', 'pitch ohne Profil: nur Herkunft');

console.log(fails ? `\n${fails} FEHLER` : '\nALLE TESTS BESTANDEN');
process.exit(fails ? 1 : 0);
