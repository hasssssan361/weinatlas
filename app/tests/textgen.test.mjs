// Tests der regelbasierten Textvorschläge. Aufruf: node app/tests/textgen.test.mjs
import fs from 'node:fs'; import vm from 'node:vm';
vm.runInThisContext(fs.readFileSync(new URL('../src/textgen.js', import.meta.url), 'utf8') + '\nglobalThis.TextGen = TextGen;');
const T = globalThis.TextGen; let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };
const full = T.compose({ color: 'rot', grapes: ['Pinot Noir'], abv: '13.5', body: '2', acidity: '4', tannin: '2', aromas: ['Kirsche', 'Vanille', 'Rauch'], pairing_dishes: ['Ente', 'Pilze'], finish: 'lang', serving_temp: '16 °C' },
  { producer: 'Gut A', origin: 'Burgund, Frankreich' });
console.log(full);
ok(/Rotwein aus Pinot Noir von Gut A, Burgund, Frankreich/.test(full.description_tech) && /Alkohol: 13,5 % vol/.test(full.description_tech), 'Fachtext aus Angaben');
ok(/Passt sehr gut zu Ente und Pilze/.test(full.description_service), 'Service: Speisen');
ok(full.selling_points.length === 3 && full.guest_hint.startsWith('Für Gäste'), '3 Verkaufsargumente, Empfehlungssatz');
const empty = T.compose({}, { producer: '–' });
ok(empty.description_tech === '' && empty.description_service === '' && !empty.selling_points.length && empty.guest_hint === '', 'Leeres Profil: nichts erfunden');
const some = T.compose({ aromas: ['Zitrus'] }, {});
ok(!/Rotwein|Weißwein|Alkohol|Körper/.test(some.description_tech + some.description_service), 'Unbekanntes wird nicht ergänzt');
console.log(fails ? `\n${fails} FEHLER` : '\nalle Tests bestanden'); process.exit(fails ? 1 : 0);
