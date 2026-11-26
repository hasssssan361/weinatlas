/* ================= WEINSUCHE: Bewertungslogik (reine Funktionen, ohne Oberfläche) =================
   Bewertet Weine des eigenen Restaurants gegen die Wünsche eines Gastes.
   Grundsätze:
   - Unbekannte Eigenschaften gelten NIE als passend: sie bringen 0 Punkte, zählen aber im Nenner mit.
   - Fakten (Land, Region, Farbe, Preis, Stichwort) schließen Weine aus, wenn sie nachweislich nicht passen.
   - Der Wert ist ein rechnerischer Match-Score, keine Qualitätsbewertung.                                   */
const SearchCore = (function(){
  const LEVELS = { low: [1, 2], mid: [3, 3], high: [4, 5] };
  const SCALES = {
    body:       { label: 'Körper',      names: { low: 'leicht', mid: 'mittel', high: 'kräftig' } },
    acidity:    { label: 'Säure',       names: { low: 'niedrig', mid: 'mittel', high: 'hoch' } },
    tannin:     { label: 'Tannine',     names: { low: 'weich', mid: 'mittel', high: 'kräftig' } },
    sweetness:  { label: 'Süße',        names: { low: 'trocken', mid: 'halbtrocken', high: 'süß' } },
    fruit:      { label: 'Frucht',      names: { low: 'dezent', mid: 'mittel', high: 'intensiv' } },
    minerality: { label: 'Mineralität', names: { low: 'wenig', mid: 'mittel', high: 'ausgeprägt' } },
    oak:        { label: 'Holz',        names: { low: 'kein/wenig', mid: 'leicht', high: 'deutlich' } }
  };
  const COLORS = { rot: 'Rot', weiss: 'Weiß', rose: 'Rosé', schaum: 'Schaumwein' };

  const norm = t => String(t == null ? '' : t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
  const has = (hay, needle) => norm(hay).includes(norm(needle).trim());

  /* Farbe: Profil vor Kategorie-Text. Gibt { value, src } oder null. */
  function colorOf(w){
    if(w.profile && w.profile.color) return { value: w.profile.color, src: 'Profil' };
    const c = norm(w.category);
    if(c){
      if(/champagner|schaum|sekt|cremant|prosecco|cava|spumante|cremant/.test(c)) return { value: 'schaum', src: 'Kategorie' };
      if(/rose/.test(c)) return { value: 'rose', src: 'Kategorie' };
      if(/rot/.test(c)) return { value: 'rot', src: 'Kategorie' };
      if(/weiss|weiß/.test(c)) return { value: 'weiss', src: 'Kategorie' };
    }
    return null;
  }

  function wineCountry(w){ return w.country || w.origin_country || ''; }
  function wineRegion(w){ return w.region || w.origin_region || ''; }

  function haystack(w){
    const p = w.profile || {}, n = w.notes || {};
    return [w.label, w.producer, wineCountry(w), wineRegion(w), w.site, (p.grapes || []).join(' '), (p.aromas || []).join(' '), n.aroma].join(' ');
  }

  /* Skala: 1 = im gewünschten Bereich, 0.5 = eine Stufe daneben, 0 = weiter weg, null = unbekannt */
  function scaleScore(value, level){
    if(value == null) return null;
    const [lo, hi] = LEVELS[level];
    if(value >= lo && value <= hi) return 1;
    if(value === lo - 1 || value === hi + 1) return 0.5;
    return 0;
  }

  function textList(w, kind){
    const p = w.profile || {}, n = w.notes || {};
    if(kind === 'aroma') return [].concat(p.aromas || [], n.aroma ? [n.aroma] : []);
    if(kind === 'food')  return [].concat(p.pairing_dishes || [], n.pairing ? [n.pairing] : []);
    if(kind === 'grape') return p.grapes || [];
    return [];
  }

  /* Prüft einen Textwunsch (Aroma/Speise/Rebsorte): 1 = gefunden, 0 = Daten vorhanden aber nicht gefunden, null = keine Daten */
  function textScore(w, kind, wanted){
    const list = textList(w, kind);
    if(kind === 'grape' && has(w.label, wanted)) return 1;          // Rebsorte steht oft in der Bezeichnung
    if(!list.length) return null;
    return list.some(x => has(x, wanted)) ? 1 : 0;
  }

  function isActive(c){
    return !!(c.q || c.color || c.priceMax != null && c.priceMax !== '' || c.country || c.region || c.grape || c.aroma || c.food ||
      Object.keys(SCALES).some(k => c[k]));
  }

  function evaluate(w, c){
    const parts = [];                 // { key, label, state: match|near|miss|unknown, text }
    const fail = reason => ({ excluded: true, reason });

    // ---- harte Filter (Fakten) ----
    if(c.q){
      const hay = haystack(w);
      if(!norm(c.q).split(/\s+/).filter(Boolean).every(t => has(hay, t))) return fail('Stichwort');
    }
    if(c.country && wineCountry(w) !== c.country) return fail('Land');
    if(c.region && wineRegion(w) !== c.region) return fail('Region');
    const max = c.priceMax === '' || c.priceMax == null ? null : Number(c.priceMax);
    if(max != null && isFinite(max) && w.price != null && Number(w.price) > max) return fail('Preis');

    let earned = 0, total = 0, known = 0;
    const add = (key, label, m, text, important) => {
      const wt = important ? 2 : 1;
      total += wt;
      if(m != null){ known += wt; earned += wt * m; }
      parts.push({ key, label, state: m == null ? 'unknown' : m === 1 ? 'match' : m === 0.5 ? 'near' : 'miss', text, weight: wt });
    };
    const imp = k => !!(c.important && c.important[k]);

    // ---- Farbe: bekannt und falsch = ausgeschlossen ----
    if(c.color){
      const col = colorOf(w);
      if(col && col.value !== c.color) return fail('Farbe');
      add('color', 'Farbe', col ? 1 : null, col ? COLORS[col.value] + (col.src === 'Kategorie' ? ' (laut Kategorie)' : '') : 'Farbe nicht hinterlegt', imp('color'));
    }
    // ---- Preis nur bei unbekanntem Preis relevant ----
    if(max != null && isFinite(max) && w.price == null) add('price', 'Preis', null, 'Preis nicht hinterlegt', false);

    // ---- Skalen ----
    for(const k of Object.keys(SCALES)){
      if(!c[k]) continue;
      const v = w.profile ? w.profile[k] : null;
      const m = scaleScore(v == null ? null : Number(v), c[k]);
      const want = SCALES[k].names[c[k]];
      add(k, SCALES[k].label, m, m == null ? SCALES[k].label + ' nicht hinterlegt'
        : m === 1 ? SCALES[k].label + ' ' + want
        : m === 0.5 ? SCALES[k].label + ' fast ' + want + ' (Stufe ' + v + ' von 5)'
        : SCALES[k].label + ' weicht ab (Stufe ' + v + ' von 5, gewünscht ' + want + ')', imp(k));
    }
    // ---- Textwünsche ----
    if(c.grape){ const m = textScore(w, 'grape', c.grape); add('grape', 'Rebsorte', m, m == null ? 'Rebsorte nicht hinterlegt' : m === 1 ? 'Rebsorte ' + c.grape : 'andere Rebsorte', imp('grape')); }
    if(c.aroma){ const m = textScore(w, 'aroma', c.aroma); add('aroma', 'Aroma', m, m == null ? 'Aromen nicht hinterlegt' : m === 1 ? 'Aroma „' + c.aroma + '“' : 'Aroma „' + c.aroma + '“ nicht genannt', imp('aroma')); }
    if(c.food){ const m = textScore(w, 'food', c.food); add('food', 'Speise', m, m == null ? 'Speiseempfehlung nicht hinterlegt' : m === 1 ? 'passt zu „' + c.food + '“' : '„' + c.food + '“ nicht empfohlen', imp('food')); }

    const score = total ? Math.round(100 * earned / total) : null;
    return { excluded: false, score, known: total ? known / total : 1, parts };
  }

  /* Weine bewerten, filtern und sortieren. Gibt [{ wine, score, known, parts }] zurück. */
  function search(wines, c){
    const out = [];
    for(const w of wines){
      if(w.is_active === false) continue;
      const r = evaluate(w, c);
      if(r.excluded) continue;
      out.push(Object.assign({ wine: w }, r));
    }
    out.sort((a, b) =>
      (b.score == null ? -1 : b.score) - (a.score == null ? -1 : a.score) ||
      b.known - a.known ||
      (a.wine.price == null ? 1e9 : Number(a.wine.price)) - (b.wine.price == null ? 1e9 : Number(b.wine.price)) ||
      String(a.wine.label).localeCompare(String(b.wine.label), 'de'));
    return out;
  }

  /* Begründung: nur belegte Treffer nennen, Unbekanntes ausdrücklich als unbekannt */
  function explain(r){
    const ok = r.parts.filter(p => p.state === 'match').map(p => p.text);
    const near = r.parts.filter(p => p.state === 'near').map(p => p.text);
    const miss = r.parts.filter(p => p.state === 'miss').map(p => p.text);
    const unk = r.parts.filter(p => p.state === 'unknown').map(p => p.label);
    let t = ok.length ? 'Passt, weil: ' + ok.join(', ') + '.' : 'Keine der gewünschten Eigenschaften ist belegt.';
    if(near.length) t += ' Knapp daneben: ' + near.join(', ') + '.';
    if(miss.length) t += ' Passt nicht: ' + miss.join(', ') + '.';
    if(unk.length) t += ' Unbekannt: ' + unk.join(', ') + '.';
    return t;
  }

  /* Satz für den Service: Freigegebene Texte zuerst, sonst nur belegte Fakten */
  function pitch(w){
    const p = w.profile || {};
    if(p.guest_hint) return p.guest_hint;
    if(p.description_service) return p.description_service;
    const bits = [];
    const grapes = (p.grapes || []);
    if(grapes.length) bits.push(grapes.join(', '));
    for(const k of ['body', 'acidity', 'tannin', 'oak']){
      if(p[k] != null){
        const lvl = p[k] <= 2 ? 'low' : p[k] === 3 ? 'mid' : 'high';
        bits.push(SCALES[k].label.toLowerCase() + ' ' + SCALES[k].names[lvl]);
      }
    }
    if((p.aromas || []).length) bits.push('Aromen von ' + p.aromas.slice(0, 3).join(', '));
    const where = [wineRegion(w), wineCountry(w)].filter(Boolean).join(', ');
    if(!bits.length) return where ? 'Ein Wein aus ' + where + '.' : '';
    return (where ? 'Aus ' + where + ': ' : '') + bits.join(', ') + '.';
  }

  /* Antwort der KI-Suche (ungeprüft!) in sichere Kriterien umwandeln: nur bekannte Schlüssel und Werte. */
  function sanitizeCriteria(raw){
    const out = { important: {} };
    if(!raw || typeof raw !== 'object') return out;
    const str = v => typeof v === 'string' ? v.trim().slice(0, 60) : '';
    if(Object.prototype.hasOwnProperty.call(COLORS, raw.color)) out.color = raw.color;
    const pm = Number(raw.priceMax); if(isFinite(pm) && pm > 0 && pm < 100000) out.priceMax = pm;
    for(const k of ['grape', 'country', 'region', 'aroma', 'food']){ const v = str(raw[k]); if(v) out[k] = v; }
    for(const k of Object.keys(SCALES)) if(['low', 'mid', 'high'].includes(raw[k])) out[k] = raw[k];
    if(Array.isArray(raw.important)) raw.important.forEach(k => { if(SCALES[k] && out[k]) out.important[k] = true; });
    return out;
  }

  return { SCALES, COLORS, LEVELS, evaluate, search, explain, pitch, isActive, colorOf, norm, sanitizeCriteria };
})();
