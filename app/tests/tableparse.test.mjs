// Tests des Tabellen-Imports (CSV + XLSX). Aufruf: node app/tests/tableparse.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';
const src = fs.readFileSync(new URL('../src/tableparse.js', import.meta.url), 'utf8') + '\nglobalThis.TableParse = TableParse;';
vm.runInThisContext(src);
const T = globalThis.TableParse;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };

// CSV: Semikolon, Anführungszeichen, deutsches Zahlenformat, Umlaut, BOM
const c = T.csv('\uFEFFErzeuger;Wein;Jahrgang;Rebsorte;Preis;Land;Region\r\nWeingut A;"Riesling ""Alte Reben"""; 2022;Riesling;38,50 €;Germany;Mosel\r\nDomaine B;Pinot;2020;Pinot Noir;1.250,00;Frankreich;Burgund\r\n\r\n;;;;;;\r\n');
ok(c.length === 3 && c[1][1] === 'Riesling "Alte Reben"', 'CSV: Semikolon, Anführungszeichen, Leerzeilen');
const r = T.toWines(c);
ok(r.weine.length === 2 && r.weine[0].p === '38.50' && r.weine[1].p === '1250.00', 'Preise: 38,50 € / 1.250,00');
ok(r.gebiete[0].land === 'Deutschland' && r.gebiete[0].gebiet === 'Mosel', 'Land Germany -> Deutschland');
ok(r.weine[0].w === '2022 · Alte Reben · Riesling'.replace('Alte Reben', 'Riesling "Alte Reben"') , 'Bezeichnung aus Jahrgang, Name, Rebsorte');
ok(r.missing.length === 0, 'alle Spalten erkannt');

// Komma-getrennt, nur Pflichtspalten
const r2 = T.toWines(T.csv('Name,Preis\nHauswein,5\nGrauburgunder,7,5'));
ok(r2.weine.length === 2 && r2.weine[0].e === '–' && r2.missing.includes('producer') && r2.missing.includes('country'), 'Minimal-CSV, fehlende Spalten gemeldet');
try { T.toWines(T.csv('A,B\n1,2')); ok(false, 'ohne Weinspalte'); } catch (e) { ok(/Keine Spalte/.test(e.message), 'ohne Weinspalte -> verständliche Meldung'); }
const r3 = T.toWines(T.csv('Wein,Preis\n,5\nX,abc'));
ok(r3.weine.length === 1 && r3.skipped[0] === 2 && r3.weine[0].p === '', 'Zeile ohne Namen übersprungen, ungültiger Preis leer');

// XLSX bauen (Zip mit zwei Dateien, deflate), dann lesen
function zip(files) {
  const parts = [], cd = []; let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text), def = zlib.deflateRawSync(raw), nb = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(def.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nb.length, 26);
    parts.push(lh, nb, def);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(def.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    cd.push(ch, nb); off += lh.length + nb.length + def.length;
  }
  const cdb = Buffer.concat(cd), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(cd.length / 2, 10); end.writeUInt32LE(cdb.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cdb, end]);
}
const sst = '<sst><si><t>Erzeuger</t></si><si><t>Wein</t></si><si><t>Preis</t></si><si><t>Land</t></si><si><t>Gut Müller &amp; Söhne</t></si><si><r><t>Spät</t></r><r><t>burgunder</t></r></si><si><t>Deutschland</t></si></sst>';
const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>'
  + '<row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2" t="s"><v>5</v></c><c r="C2"><v>42.5</v></c><c r="D2" t="s"><v>6</v></c></row>'
  + '<row r="3"><c r="B3" t="inlineStr"><is><t>Riesling</t></is></c><c r="C3"><v>30</v></c></row></sheetData></worksheet>';
const x = zip({ 'xl/sharedStrings.xml': sst, 'xl/worksheets/sheet1.xml': sheet });
const rows = await T.xlsx(x.buffer.slice(x.byteOffset, x.byteOffset + x.length));
ok(rows.length === 3 && rows[1][0] === 'Gut Müller & Söhne' && rows[1][1] === 'Spätburgunder', 'XLSX: Strings, Entities, Rich-Text');
ok(rows[2][0] === '' && rows[2][1] === 'Riesling' && rows[2][2] === '30', 'XLSX: leere Zelle, Inline-String, Zahl');
const rx = T.toWines(rows);
ok(rx.weine[0].p === '42.5' && rx.weine[1].e === '–' && rx.gebiete[0].land === 'Deutschland', 'XLSX -> Import-Format');
try { await T.xlsx(Buffer.from('kein zip').buffer); ok(false, 'kaputte Datei'); } catch (e) { ok(/keine gültige/.test(e.message), 'kaputte Datei -> verständliche Meldung'); }
console.log(fails ? `\n${fails} FEHLER` : '\nalle Tests bestanden'); process.exit(fails ? 1 : 0);
