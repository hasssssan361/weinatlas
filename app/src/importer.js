/* ================= PDF-IMPORT ================= */
const Importer = (function(){
  const MAX_PDF_BYTES = 20 * 1024 * 1024;
  const API_MODEL = 'claude-sonnet-5-5';
  const LS_KEY = 'weinatlas_apikey';
  let parsed = null, countries = [], regionsByCountry = {}, replaceMode = true;

  function knownText(){ return Object.keys(regionsByCountry).map(l=> l + ': ' + regionsByCountry[l].join(', ')).join('; '); }
  function buildPrompt(){
    const known = knownText();
    return `Du erhältst die Weinkarte eines Restaurants als PDF. Erfasse JEDEN Wein, Schaumwein und Champagner (keine Speisen, keine alkoholfreien Getränke, keine Spirituosen, kein Bier) und ordne ihn seinem Herkunftsland und Anbaugebiet zu.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt, ohne Erklärtext und ohne Markdown-Codeblock, in genau dieser Form:
{"gebiete":[{"land":"Deutschland","gebiet":"Mosel","lat":49.9,"lon":7.1}],"weine":[{"g":0,"e":"Weingut","w":"2023 · Lage · Rebsorte","p":"38"}]}

Regeln:
- "land": der deutsche Landesname (z. B. Deutschland, Frankreich, Österreich, Italien, Spanien, Portugal, Südafrika, USA, Australien, Schweiz, Neuseeland, Argentinien).
- "gebiet": Anbaugebiet bzw. Appellation in gebräuchlicher deutscher Schreibweise (z. B. Burgund, Rhône, Piemont, Südtirol, Toskana). Wenn das Gebiet zu einem dieser bekannten Namen passt, genau diese Schreibweise verwenden: ${known}.
- "lat"/"lon": ungefähre Mitte des Anbaugebiets in Dezimalgrad (WGS84).
- Jedes Gebiet steht nur einmal in "gebiete"; "g" in "weine" ist der Index (ab 0) in diese Liste.
- "e": Erzeuger, Weingut bzw. Champagnerhaus. Nicht erkennbar: "–".
- "w": Jahrgang (falls vorhanden) · Lage oder Cuvée-Name · Rebsorte bzw. Stil, getrennt mit " · ". Nichts erfinden, nur Angaben aus der Karte verwenden.
- "p": Flaschenpreis als Zahl ohne Währungszeichen (z. B. "38" oder "38.5"). Bei mehreren Größen die 0,75-l-Flasche. Kein Preis: "".
- Reihenfolge wie in der Karte.`;
  }

  function notesPrompt(){
    return `Du erhältst ein PDF mit Beschreibungen zu Weinen eines Restaurants (Geschmack, Aromen, Speiseempfehlungen, Hintergrundinfos).
Erfasse zu JEDEM Wein, der beschrieben wird, die Angaben aus dem PDF.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt, ohne Erklärtext und ohne Markdown-Codeblock, in genau dieser Form:
{"weine":[{"e":"Erzeuger","w":"Bezeichnung des Weins","aroma":"…","geschmack":"…","passt":"…","info":"…"}]}

Regeln:
- "e": Erzeuger bzw. Weingut, "w": Bezeichnung des Weins (Jahrgang, Lage, Rebsorte soweit angegeben), jeweils so wie im PDF.
- "aroma": Duft und Aromen; "geschmack": Geschmack, Stil, Struktur; "passt": Speiseempfehlungen; "info": sonstiges Wissenswertes (Region, Ausbau, Besonderheiten).
- Nur Angaben verwenden, die im PDF stehen. Nichts erfinden, nichts ergänzen. Fehlt eine Angabe: leerer Text "".
- Kurz und sachlich auf Deutsch, ggf. wörtlich aus dem PDF übernehmen.
- Reihenfolge wie im PDF.`;
  }

  function parseNotesJson(text){
    const t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if(a < 0 || b < a) throw new Error('Die Antwort enthielt keine Daten.');
    let obj;
    try{ obj = JSON.parse(t.slice(a, b + 1)); }catch(e){ throw new Error('Die Antwort war kein gültiges JSON.'); }
    if(!Array.isArray(obj.weine)) throw new Error('Die Antwort hatte nicht das erwartete Format.');
    const str = v=> String(v == null ? '' : v).trim();
    const items = obj.weine.map(w=> ({ e: str(w.e), w: str(w.w), aroma: str(w.aroma), taste: str(w.geschmack), pairing: str(w.passt), info: str(w.info) }))
      .filter(x=> x.w && (x.aroma || x.taste || x.pairing || x.info));
    if(!items.length) throw new Error('Es wurden keine Beschreibungen erkannt.');
    return items;
  }

  function fileToBase64(file){
    return new Promise((resolve, reject)=>{
      const fr = new FileReader();
      fr.onload = ()=> resolve(String(fr.result).split(',')[1]);
      fr.onerror = ()=> reject(new Error('Datei konnte nicht gelesen werden.'));
      fr.readAsDataURL(file);
    });
  }

  function parseModelJson(text){
    const t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if(a < 0 || b < a) throw new Error('Die Antwort enthielt keine Weindaten.');
    let obj;
    try{ obj = JSON.parse(t.slice(a, b + 1)); }catch(e){ throw new Error('Die Antwort war kein gültiges JSON.'); }
    if(!Array.isArray(obj.gebiete) || !Array.isArray(obj.weine)) throw new Error('Die Antwort hatte nicht das erwartete Format.');
    obj.gebiete = obj.gebiete.map(g=>({ land: String(g.land || '').trim(), gebiet: String(g.gebiet || '').trim(), lat: Number(g.lat), lon: Number(g.lon) }));
    obj.weine = obj.weine.filter(w=> w && Number.isInteger(w.g) && w.g >= 0 && w.g < obj.gebiete.length && String(w.w || '').trim());
    if(!obj.weine.length) throw new Error('Es wurden keine Weine erkannt.');
    return obj;
  }

  /* Variante A: über den eigenen Server-Dienst (Supabase Edge Function), Key liegt dort */
  async function extractServer(file, kind, onProgress){
    const data = await fileToBase64(file);
    let res;
    try{ res = await Api.fn('extract-winelist', { restaurant_id: S.rid, pdf_base64: data, mode: kind, known: knownText() }); }
    catch(e){ throw new Error('Keine Verbindung zum Server.'); }
    const ct = res.headers.get('content-type') || '';
    if(res.status === 404) throw new Error('SERVER_MISSING');
    if(!res.ok || ct.includes('application/json')){
      let m = 'Fehler ' + res.status;
      try{ const j = await res.json(); if(j.error) m = j.error; }catch(e){}
      throw new Error(m);
    }
    const reader = res.body.getReader(), dec = new TextDecoder();
    let text = '';
    for(;;){
      const { done, value } = await reader.read();
      if(done) break;
      text += dec.decode(value, { stream: true }); onProgress(text.length);
    }
    if(/^\s*\{"error"/.test(text)){ try{ throw new Error(JSON.parse(text).error); }catch(e){ throw e; } }
    return kind === 'notes' ? parseNotesJson(text) : parseModelJson(text);
  }

  /* Variante B: direkt über die Anthropic-API mit eigenem Key (Key bleibt im Browser) */
  async function extractDirect(file, apiKey, kind, onProgress){
    const data = await fileToBase64(file);
    let res;
    try{
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({
          model: API_MODEL, max_tokens: 32000, stream: true,
          messages: [{ role: 'user', content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } },
            { type: 'text', text: kind === 'notes' ? notesPrompt() : buildPrompt() }
          ]}]
        })
      });
    }catch(e){ throw new Error('Keine Verbindung zur Anthropic-API. Internet und Key prüfen.'); }
    if(!res.ok){
      let msg = 'Fehler ' + res.status;
      try{ const j = await res.json(); if(j.error && j.error.message) msg = j.error.message; }catch(e){}
      throw new Error(res.status === 401 ? 'Der API-Key wurde abgelehnt.' : msg);
    }
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '', text = '', stop = '';
    for(;;){
      const { done, value } = await reader.read();
      if(done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while((i = buf.indexOf('\n')) >= 0){
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if(!line.startsWith('data:')) continue;
        let ev; try{ ev = JSON.parse(line.slice(5).trim()); }catch(e){ continue; }
        if(ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta'){ text += ev.delta.text; onProgress(text.length); }
        else if(ev.type === 'message_delta' && ev.delta && ev.delta.stop_reason){ stop = ev.delta.stop_reason; }
        else if(ev.type === 'error'){ throw new Error((ev.error && ev.error.message) || 'Fehler der API.'); }
      }
    }
    if(stop === 'max_tokens') throw new Error('Die Weinkarte ist zu umfangreich für eine Auslese. Bitte in kleinere PDFs teilen.');
    return kind === 'notes' ? parseNotesJson(text) : parseModelJson(text);
  }

  /* ---------- Dialog ---------- */
  async function open(){
    const regions = await guard(()=> ensureRegions(), 'Gebiete laden');
    if(!regions) return;
    countries = [...new Set(regions.map(r=> r.country))];
    regionsByCountry = {};
    regions.forEach(r=> (regionsByCountry[r.country] = regionsByCountry[r.country] || []).push(r.name));
    const have = (S.wines || []).length;
    let savedKey = ''; try{ savedKey = localStorage.getItem(LS_KEY) || ''; }catch(e){}

    Modal.open('Weinkarte importieren', 'PDF hochladen', `
      <div id="imStep1">
        <p class="modal-lead">PDF auswählen — die Weine werden automatisch nach Herkunftsland und Anbaugebiet sortiert. Vor dem Speichern prüfst du die Zuordnung.
        Bereits vorhandene Weine werden erkannt (gleicher Erzeuger + gleiche Bezeichnung): Preise werden aktualisiert, Notizen und Lernfortschritt bleiben erhalten.</p>
        <label class="m-label">Weinkarte (PDF, bis 20 MB)<input class="m-field" type="file" id="imFile" accept="application/pdf,.pdf"></label>
        <label class="m-label">Eigener Anthropic-API-Key (optional)
          <input class="m-field" type="password" id="imKey" placeholder="sk-ant-… (leer = automatischer Server-Dienst)" autocomplete="off" value="${esc(savedKey)}">
        </label>
        <label class="m-check"><input type="checkbox" id="imRemember" ${savedKey ? 'checked' : ''}> Key in diesem Browser merken</label>
        <p class="m-note">Ohne eigenen Key wird der Server-Dienst des Atlas genutzt (falls eingerichtet; begrenzte Anzahl Auslesen pro Monat).
        Mit eigenem Key geht die PDF direkt an die Anthropic-API; der Key verlässt deinen Browser nicht.</p>
        <button class="m-btn" id="imRun">Weinkarte auslesen</button>
        <div class="m-status" id="imStatus" role="status"></div>
      </div>
      <div id="imStep2" hidden>
        <p class="modal-lead" id="imSummary"></p>
        <div class="review-list" id="imReview"></div>
        <label class="m-check" style="margin-top:14px"><input type="checkbox" id="imReplace" ${have ? 'checked' : ''}>
          Bisherige Karte ersetzen (Weine, die in dieser PDF nicht mehr stehen, werden entfernt${have ? ' — aktuell ' + have + ' Weine' : ''})</label>
        <div class="m-actions">
          <button class="m-btn secondary" id="imBack">Zurück</button>
          <button class="m-btn" id="imApply">Importieren</button>
        </div>
        <div class="m-status err" id="imErr"></div>
      </div>`);
    $('imBack').onclick = ()=>{ $('imStep1').hidden = false; $('imStep2').hidden = true; };
    $('imRun').onclick = run;
    $('imApply').onclick = apply;
  }

  const setStatus = (msg, err)=>{ const s = $('imStatus'); if(s){ s.textContent = msg || ''; s.classList.toggle('err', !!err); } };

  async function run(){
    const file = $('imFile').files[0], key = $('imKey').value.trim();
    if(!file) return setStatus('Bitte eine PDF-Datei auswählen.', true);
    if(file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) return setStatus('Die Datei ist keine PDF.', true);
    if(file.size > MAX_PDF_BYTES) return setStatus('Die PDF ist größer als 20 MB.', true);
    if(key && !/^sk-ant-/.test(key)) return setStatus('Der API-Key muss mit sk-ant- beginnen.', true);
    try{ if(key && $('imRemember').checked) localStorage.setItem(LS_KEY, key); else localStorage.removeItem(LS_KEY); }catch(e){}
    $('imRun').disabled = true; setStatus('Weinkarte wird gelesen …');
    const prog = n=> setStatus('Weinkarte wird ausgelesen … (' + n.toLocaleString('de-DE') + ' Zeichen)');
    try{
      parsed = key ? await extractDirect(file, key, 'wines', prog) : await extractServer(file, 'wines', prog);
      renderReview(); setStatus('');
      $('imStep1').hidden = true; $('imStep2').hidden = false;
    }catch(e){
      setStatus(e.message === 'SERVER_MISSING'
        ? 'Der automatische Server-Dienst ist noch nicht eingerichtet. Bitte einen eigenen Anthropic-API-Key eintragen (siehe Anleitung).'
        : (e.message || 'Unbekannter Fehler.'), true);
    }finally{ const b = $('imRun'); if(b) b.disabled = false; }
  }

  const OTHER = '__other__';
  function renderReview(){
    const p = parsed, counts = p.gebiete.map(()=> 0);
    p.weine.forEach(w=> counts[w.g]++);
    const order = p.gebiete.map((g, i)=> i).sort((a, b)=>{
      const ia = countries.indexOf(p.gebiete[a].land), ib = countries.indexOf(p.gebiete[b].land);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a - b;
    });
    const box = $('imReview'); box.innerHTML = '';
    let other = 0;
    order.forEach(i=>{
      const g = p.gebiete[i], known = countries.includes(g.land);
      if(!known) other += counts[i];
      const row = document.createElement('div'); row.className = 'rev-row'; row.dataset.index = String(i);
      const sel = document.createElement('select'); sel.setAttribute('aria-label', 'Land');
      countries.forEach(c=>{ const o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o); });
      const oo = document.createElement('option'); oo.value = OTHER; oo.textContent = 'Anderes Land (ohne Karte)'; sel.appendChild(oo);
      sel.value = known ? g.land : OTHER;
      const inp = document.createElement('input'); inp.value = g.gebiet; inp.setAttribute('aria-label', 'Anbaugebiet'); inp.maxLength = 60;
      const cnt = document.createElement('span'); cnt.className = 'rev-count'; cnt.textContent = counts[i] + (counts[i] === 1 ? ' Wein' : ' Weine');
      const oc = document.createElement('input'); oc.className = 'rev-w'; oc.value = g.land; oc.placeholder = 'Land'; oc.maxLength = 60; oc.setAttribute('aria-label', 'Landesname');
      oc.hidden = sel.value !== OTHER;
      sel.addEventListener('change', ()=>{ oc.hidden = sel.value !== OTHER; });
      row.append(sel, inp, cnt, oc);
      box.appendChild(row);
    });
    $('imSummary').textContent = p.weine.length + ' Weine in ' + p.gebiete.length + ' Gebieten erkannt.'
      + (other ? ' ' + other + (other === 1 ? ' davon liegt' : ' davon liegen') + ' in Ländern ohne Karte und erscheint unter „Weitere Herkunft“.' : '')
      + ' Land und Gebiet lassen sich hier noch ändern.';
    $('imErr').textContent = '';
  }

  function countryCenter(land){
    const key = BORDER_NAME[land];
    const polys = BORDERS[key] || [];
    let a = 90, b = -90, c = 180, d = -180;
    polys.forEach(poly=> poly[0].forEach(([lon, lat])=>{ if(lat < a) a = lat; if(lat > b) b = lat; if(lon < c) c = lon; if(lon > d) d = lon; }));
    return a > b ? [0, 0] : [(a + b) / 2, (c + d) / 2];
  }

  async function apply(){
    const err = $('imErr'); err.textContent = '';
    const edits = {};
    document.querySelectorAll('#imReview .rev-row').forEach(row=>{
      const [sel, inp, , oc] = row.children;
      edits[row.dataset.index] = { sel: sel.value, gebiet: inp.value.trim(), land: oc.value.trim() };
    });
    const btn = $('imApply'); btn.disabled = true;
    try{
      /* 1. Gebiete auflösen (bekannte Länder: vorhandenes Gebiet nutzen oder neues anlegen) */
      const resolved = {};
      for(let i = 0; i < parsed.gebiete.length; i++){
        const g = parsed.gebiete[i], ed = edits[i];
        const name = ed.gebiet || 'Sonstige';
        if(ed.sel === OTHER){
          if(!ed.land) throw new Error('Bitte für „Anderes Land“ den Landesnamen eintragen.');
          resolved[i] = { origin_country: ed.land, origin_region: ed.gebiet };
          continue;
        }
        const key = ed.sel + '|' + name.toLowerCase();
        if(!resolved[key]){
          let lat = g.lat, lon = g.lon;
          if(!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) [lat, lon] = countryCenter(ed.sel);
          resolved[key] = { region_id: await Api.rpc('ensure_region', { p_country: ed.sel, p_name: name, p_lat: lat, p_lon: lon }) };
        }
        resolved[i] = resolved[key];
      }
      /* 2. Weine zusammenstellen */
      const wines = parsed.weine.map(w=> ({
        producer: String(w.e || '').trim() || '–', label: String(w.w).trim(),
        price: String(w.p == null ? '' : w.p).replace(',', '.').trim(), ...resolved[w.g]
      }));
      const res = await Api.rpc('import_wines', { p_restaurant: S.rid, p_wines: wines, p_replace: $('imReplace').checked });
      S.regions = null; winesChanged();
      Modal.close();
      toast(`Import fertig: ${res.added} neu, ${res.updated} aktualisiert, ${res.removed} entfernt.`);
      await Admin.show();
    }catch(e){ err.textContent = e.message; }
    finally{ const b = $('imApply'); if(b) b.disabled = false; }
  }


  /* ================= GESCHMACKS-PDF (Notizen zu Weinen) ================= */
  const STOP = new Set(['weingut','domaine','chateau','cantina','bodega','bodegas','tenuta','azienda','maison','casa','weinhaus','the','von','de','di','du','la','le','des','und','vino','vin','wine','estate','winery','vineyards','familie','champagne']);
  const norm = t=> String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim();
  const toks = t=> norm(t).split(' ').filter(x=> x && !STOP.has(x));
  function overlap(a, b){            // Anteil der Wörter von a, die auch in b vorkommen (b darf mehr enthalten)
    if(!a.length || !b.length) return 0;
    const set = new Set(b); let hit = 0;
    a.forEach(x=>{ if(set.has(x) || b.some(y=> y.length > 3 && x.length > 3 && (y.startsWith(x) || x.startsWith(y)))) hit++; });
    return hit / Math.min(a.length, b.length);
  }
  function scoreMatch(item, w){
    const pe = overlap(toks(item.e), toks(w.producer));
    const lab = overlap(toks(item.w), toks(w.label).concat(toks(w.producer)));
    return (item.e ? pe * 0.5 : 0.25) + lab * 0.5;
  }
  const wineName = w=> w.producer + ' – ' + w.label;

  async function openNotes(){
    const wines = await guard(()=> ensureWines(true), 'Weine laden');
    if(!wines) return;
    if(!wines.length){ toast('Es gibt noch keine Weine. Importiere zuerst die Weinkarte.', true); return; }
    let savedKey = ''; try{ savedKey = localStorage.getItem(LS_KEY) || ''; }catch(e){}
    Modal.open('Geschmacksnotizen', 'Beschreibungs-PDF importieren', `
      <div id="nStep1">
        <p class="modal-lead">PDF mit Geschmacksbeschreibungen auswählen (z. B. die zweite Karte mit Aromen, Stil und Speiseempfehlungen).
        Die Beschreibungen werden den Weinen der Karte zugeordnet; vor dem Speichern prüfst du die Zuordnung.</p>
        <label class="m-label">PDF (bis 20 MB)<input class="m-field" type="file" id="nFile" accept="application/pdf,.pdf"></label>
        <label class="m-label">Eigener Anthropic-API-Key (optional)
          <input class="m-field" type="password" id="nKey" placeholder="sk-ant-… (leer = automatischer Server-Dienst)" autocomplete="off" value="${esc(savedKey)}"></label>
        <button class="m-btn" id="nRun">PDF auslesen</button>
        <div class="m-status" id="nStatus" role="status"></div>
      </div>
      <div id="nStep2" hidden>
        <p class="modal-lead" id="nSummary"></p>
        <div class="review-list" id="nReview" style="max-height:52vh"></div>
        <label class="m-check" style="margin-top:14px"><input type="checkbox" id="nOver"> Vorhandene Notizen überschreiben (sonst werden nur leere Felder ergänzt)</label>
        <div class="m-actions"><button class="m-btn secondary" id="nBack">Zurück</button><button class="m-btn" id="nApply">Notizen speichern</button></div>
        <div class="m-status err" id="nErr"></div>
      </div>`);
    const st = (m, e)=>{ const x = $('nStatus'); if(x){ x.textContent = m || ''; x.classList.toggle('err', !!e); } };
    $('nBack').onclick = ()=>{ $('nStep1').hidden = false; $('nStep2').hidden = true; };
    $('nRun').onclick = async ()=>{
      const file = $('nFile').files[0], key = $('nKey').value.trim();
      if(!file) return st('Bitte eine PDF-Datei auswählen.', true);
      if(file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) return st('Die Datei ist keine PDF.', true);
      if(file.size > MAX_PDF_BYTES) return st('Die PDF ist größer als 20 MB.', true);
      if(key && !/^sk-ant-/.test(key)) return st('Der API-Key muss mit sk-ant- beginnen.', true);
      $('nRun').disabled = true; st('PDF wird gelesen …');
      const prog = n=> st('PDF wird ausgelesen … (' + n.toLocaleString('de-DE') + ' Zeichen)');
      try{
        const items = key ? await extractDirect(file, key, 'notes', prog) : await extractServer(file, 'notes', prog);
        renderNotesReview(items, wines); st('');
        $('nStep1').hidden = true; $('nStep2').hidden = false;
      }catch(e){
        st(e.message === 'SERVER_MISSING' ? 'Der automatische Server-Dienst ist noch nicht eingerichtet. Bitte einen eigenen Anthropic-API-Key eintragen (siehe Anleitung).' : (e.message || 'Unbekannter Fehler.'), true);
      }finally{ const b = $('nRun'); if(b) b.disabled = false; }
    };
  }

  function renderNotesReview(items, wines){
    const box = $('nReview'); box.innerHTML = '';
    let matched = 0;
    items.forEach((it, idx)=>{
      const ranked = wines.map(w=> ({ w, sc: scoreMatch(it, w) })).sort((a, b)=> b.sc - a.sc);
      const best = ranked[0], ok = best && best.sc >= 0.5;
      if(ok) matched++;
      const row = document.createElement('div'); row.className = 'rev-row'; row.dataset.idx = String(idx);
      row.style.gridTemplateColumns = '24px 1fr'; row.style.alignItems = 'start';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!ok; cb.setAttribute('aria-label', 'übernehmen');
      cb.style.width = 'auto';
      const main = document.createElement('div');
      const title = document.createElement('div'); title.innerHTML = '<b>' + esc(it.e) + '</b> ' + esc(it.w);
      const sel = document.createElement('select'); sel.style.marginTop = '6px';
      const none = document.createElement('option'); none.value = ''; none.textContent = '– nicht zuordnen –'; sel.appendChild(none);
      ranked.slice(0, 8).forEach(r=>{ const o = document.createElement('option'); o.value = r.w.id; o.textContent = wineName(r.w) + (r.sc >= 0.5 ? '' : '  (unsicher)'); sel.appendChild(o); });
      sel.value = best && best.sc >= 0.34 ? best.w.id : '';
      sel.addEventListener('change', ()=>{ cb.checked = !!sel.value; });
      const txt = document.createElement('div'); txt.className = 'l-sub'; txt.style.fontSize = '12px'; txt.style.marginTop = '4px';
      txt.textContent = [it.aroma && 'Aromen: ' + it.aroma, it.taste && 'Geschmack: ' + it.taste, it.pairing && 'Passt zu: ' + it.pairing].filter(Boolean).join(' · ');
      main.append(title, sel, txt); row.append(cb, main); box.appendChild(row);
    });
    $('nSummary').textContent = items.length + ' Beschreibungen erkannt, ' + matched + ' sicher zugeordnet. Unsichere Zuordnungen sind abgewählt oder markiert; bitte kurz prüfen.';
    $('nApply').onclick = ()=> applyNotes(items, wines);
  }

  async function applyNotes(items, wines){
    const err = $('nErr'); err.textContent = '';
    const over = $('nOver').checked, byId = {}; wines.forEach(w=> byId[w.id] = w);
    const notes = []; const used = new Set();
    document.querySelectorAll('#nReview .rev-row').forEach(row=>{
      const cb = row.children[0], wid = row.querySelector('select').value;
      if(!cb.checked || !wid || used.has(wid)) return;
      used.add(wid);
      const it = items[Number(row.dataset.idx)], old = (byId[wid].notes) || {};
      const pick = (nu, ol)=> over ? (nu || ol || '') : (ol || nu || '');
      notes.push({ wine_id: wid, aroma: pick(it.aroma, old.aroma), taste: pick(it.taste, old.taste), pairing: pick(it.pairing, old.pairing),
                   details: { info: it.info || ((old.details || {}).info) || '' } });
    });
    if(!notes.length){ err.textContent = 'Es ist nichts zum Speichern ausgewählt.'; return; }
    $('nApply').disabled = true;
    try{
      const n = await Api.rpc('import_notes', { p_restaurant: S.rid, p_notes: notes });
      winesChanged(); Modal.close(); toast(n + ' Notizen gespeichert.');
      if(S.tab === 'admin') await Admin.show();
    }catch(e){ err.textContent = e.message; }
    finally{ const b = $('nApply'); if(b) b.disabled = false; }
  }

  return { open, openNotes };
})();
