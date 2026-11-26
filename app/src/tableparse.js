/* ================= TABELLEN-IMPORT (CSV / Excel), ohne KI und ohne Kosten ================= */
const TableParse = (function(){
  const norm = t=> String(t == null ? '' : t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim();

  /* ---------- CSV ---------- */
  function csv(text){
    text = String(text).replace(/^﻿/, '');
    const first = text.split(/\r?\n/).find(l=> l.trim()) || '';
    const cnt = ch=> (first.match(new RegExp(ch === '\t' ? '\\t' : '\\' + ch, 'g')) || []).length;
    const delim = [';', '\t', ','].sort((a, b)=> cnt(b) - cnt(a))[0];
    const rows = []; let row = [], cur = '', q = false;
    for(let i = 0; i < text.length; i++){
      const c = text[i];
      if(q){
        if(c === '"'){ if(text[i + 1] === '"'){ cur += '"'; i++; } else q = false; } else cur += c;
      }else if(c === '"') q = true;
      else if(c === delim){ row.push(cur); cur = ''; }
      else if(c === '\n' || c === '\r'){ if(c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; rows.push(row); row = []; }
      else cur += c;
    }
    if(cur !== '' || row.length){ row.push(cur); rows.push(row); }
    return rows.filter(r=> r.some(x=> String(x).trim() !== ''));
  }

  /* ---------- XLSX (nur das erste Tabellenblatt; Zip + XML ohne Fremdbibliothek) ---------- */
  const u16 = (b, o)=> b[o] | (b[o + 1] << 8), u32 = (b, o)=> (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  async function inflate(bytes){
    const ds = new DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter(); w.write(bytes); w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  }
  async function unzip(buf){
    const b = new Uint8Array(buf);
    let e = -1;
    for(let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if(u32(b, i) === 0x06054b50){ e = i; break; }
    if(e < 0) throw new Error('Die Datei ist keine gültige Excel-Datei (.xlsx).');
    const n = u16(b, e + 10); let p = u32(b, e + 16); const files = {};
    const dec = new TextDecoder();
    for(let k = 0; k < n; k++){
      if(u32(b, p) !== 0x02014b50) break;
      const method = u16(b, p + 10), csize = u32(b, p + 20), nl = u16(b, p + 28), el = u16(b, p + 30), cl = u16(b, p + 32), lo = u32(b, p + 42);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nl));
      files[name] = { method, csize, lo };
      p += 46 + nl + el + cl;
    }
    return async name=>{
      const f = files[name]; if(!f) return null;
      const o = f.lo, dataStart = o + 30 + u16(b, o + 26) + u16(b, o + 28);
      const raw = b.subarray(dataStart, dataStart + f.csize);
      if(f.method === 0) return dec.decode(raw);
      if(f.method === 8) return dec.decode(await inflate(raw));
      throw new Error('Nicht unterstützte Excel-Komprimierung.');
    };
  }
  const unesc = s=> s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, d)=> String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (m, h)=> String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');
  const textOf = x=> { let o = ''; x.replace(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, (m, t)=> (o += unesc(t))); return o; };
  const colIdx = ref=> { const l = /^[A-Z]+/.exec(ref)[0]; let n = 0; for(const c of l) n = n * 26 + c.charCodeAt(0) - 64; return n - 1; };

  async function xlsx(buf){
    const get = await unzip(buf);
    const sst = await get('xl/sharedStrings.xml'), strings = [];
    if(sst) sst.replace(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g, (m, x)=> strings.push(textOf(x)));
    let sheet = await get('xl/worksheets/sheet1.xml');
    if(!sheet) throw new Error('Kein Tabellenblatt in der Excel-Datei gefunden.');
    const rows = [];
    sheet.replace(/<row\b[^>]*>([\s\S]*?)<\/row>/g, (m, rx)=>{
      const r = [];
      rx.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (mm, attrs, inner)=>{
        const ref = /\br="([A-Z]+\d+)"/.exec(attrs); if(!ref || inner == null) return;
        const t = (/\bt="(\w+)"/.exec(attrs) || [])[1], v = /<v>([\s\S]*?)<\/v>/.exec(inner);
        let val = '';
        if(t === 's') val = v ? (strings[+v[1]] || '') : '';
        else if(t === 'inlineStr') val = textOf(inner);
        else if(v) val = unesc(v[1]);
        r[colIdx(ref[1])] = val;
      });
      rows.push(Array.from(r, x=> x == null ? '' : x));
    });
    return rows.filter(r=> r.some(x=> String(x).trim() !== ''));
  }

  /* ---------- Spalten erkennen und in das Import-Format bringen ---------- */
  const HEAD = {
    producer: ['erzeuger', 'weingut', 'produzent', 'winzer', 'producer', 'winery', 'domaine', 'haus'],
    label:    ['wein', 'weinname', 'bezeichnung', 'name', 'cuvee', 'label', 'artikel', 'produkt', 'lage'],
    vintage:  ['jahrgang', 'jahr', 'vintage', 'jg'],
    grape:    ['rebsorte', 'rebsorten', 'traube', 'grape', 'sorte', 'cepage'],
    price:    ['preis', 'flaschenpreis', 'vk', 'verkaufspreis', 'price', 'preis eur', 'preis 0 75'],
    country:  ['land', 'herkunftsland', 'country'],
    region:   ['region', 'gebiet', 'anbaugebiet', 'herkunft', 'appellation', 'area']
  };
  const COUNTRY = { germany: 'Deutschland', deutschland: 'Deutschland', france: 'Frankreich', frankreich: 'Frankreich', italy: 'Italien', italien: 'Italien', italia: 'Italien',
    spain: 'Spanien', spanien: 'Spanien', espana: 'Spanien', portugal: 'Portugal', austria: 'Österreich', osterreich: 'Österreich', oesterreich: 'Österreich',
    switzerland: 'Schweiz', schweiz: 'Schweiz', 'south africa': 'Südafrika', sudafrika: 'Südafrika', suedafrika: 'Südafrika', usa: 'USA', 'us': 'USA', 'united states': 'USA',
    australia: 'Australien', australien: 'Australien', 'new zealand': 'Neuseeland', neuseeland: 'Neuseeland', argentina: 'Argentinien', argentinien: 'Argentinien', chile: 'Chile' };

  function mapColumns(header){
    const map = {};
    header.forEach((h, i)=>{
      const n = norm(h);
      for(const k of Object.keys(HEAD)) if(map[k] == null && HEAD[k].includes(n)){ map[k] = i; break; }
    });
    return map;
  }

  /* rows[0] = Kopfzeile. Ergebnis wie die PDF-Auslese: { gebiete:[{land,gebiet}], weine:[{g,e,w,p}] } */
  function toWines(rows){
    if(!rows || rows.length < 2) throw new Error('Die Tabelle ist leer oder hat nur eine Kopfzeile.');
    const map = mapColumns(rows[0]);
    if(map.label == null) throw new Error('Keine Spalte für den Weinnamen gefunden. Die Kopfzeile braucht z. B. „Wein“ oder „Bezeichnung“. Erkannt wurden: ' + rows[0].map(x=> '„' + String(x).trim() + '“').join(', '));
    const cell = (r, k)=> map[k] == null ? '' : String(r[map[k]] == null ? '' : r[map[k]]).trim();
    const gebiete = [], gIdx = {}, weine = [], skipped = [];
    for(let n = 1; n < rows.length; n++){
      const r = rows[n];
      const parts = [cell(r, 'vintage'), cell(r, 'label'), cell(r, 'grape')].filter(Boolean);
      if(!cell(r, 'label')){ skipped.push(n + 1); continue; }
      let land = cell(r, 'country'); land = COUNTRY[norm(land)] || land;
      const gebiet = cell(r, 'region') || 'Sonstige';
      const key = land + '|' + gebiet.toLowerCase();
      if(gIdx[key] == null){ gIdx[key] = gebiete.length; gebiete.push({ land, gebiet }); }
      let p = cell(r, 'price').replace(/[€\s]|EUR/gi, '');
      if(/^\d{1,3}(\.\d{3})+,\d+$/.test(p)) p = p.replace(/\./g, '');
      p = p.replace(',', '.');
      if(p !== '' && !isFinite(Number(p))) p = '';
      weine.push({ g: gIdx[key], e: cell(r, 'producer') || '–', w: parts.join(' · '), p });
    }
    if(!weine.length) throw new Error('Keine Weine in der Tabelle gefunden.');
    return { gebiete, weine, skipped, missing: ['producer', 'price', 'country', 'region'].filter(k=> map[k] == null) };
  }

  const MISSING_NAME = { producer: 'Erzeuger', price: 'Preis', country: 'Land', region: 'Region' };

  async function fromFile(file){
    if(/\.xlsx$/i.test(file.name)) return toWines(await xlsx(await file.arrayBuffer()));
    if(/\.xls$/i.test(file.name)) throw new Error('Das alte Excel-Format (.xls) wird nicht unterstützt. Bitte in Excel „Speichern unter“ → .xlsx oder CSV wählen.');
    return toWines(csv(await file.text()));
  }

  return { csv, xlsx, toWines, fromFile, MISSING_NAME };
})();
