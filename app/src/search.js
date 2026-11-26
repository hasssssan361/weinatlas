/* ================= WEINSUCHE (Oberfläche) ================= */
const Search = (function(){
  const root = ()=> $('viewSearch');
  let crit = {}, shown = 20, featured = null;

  function reset(){ crit = { important: {} }; shown = 20; root().innerHTML = ''; }

  const originOf = w=> [w.region || w.origin_region, w.country || w.origin_country].filter(Boolean).join(', ');

  async function show(){
    if(!root().firstChild){
      root().innerHTML = '<div class="adm-empty">Lädt …</div>';
      await ensureWines();
      featured = await Api.rpc('get_featured', { p_restaurant: S.rid }).catch(()=> null);
      build();
    }else{
      await ensureWines();       // Daten könnten sich geändert haben
      featured = await Api.rpc('get_featured', { p_restaurant: S.rid }).catch(()=> null);
      $('sFeat').innerHTML = featuredHtml();
      fillCountries(); run();
    }
  }

  function build(){
    const lvl = (k)=> {
      const sc = SearchCore.SCALES[k];
      return `<div class="s-row"><label class="s-lab" for="sc_${k}">${sc.label}</label>
        <select class="m-select" id="sc_${k}" data-k="${k}">
          <option value="">egal</option>
          <option value="low">${sc.names.low}</option><option value="mid">${sc.names.mid}</option><option value="high">${sc.names.high}</option>
        </select><button type="button" class="s-star" data-star="${k}" title="Besonders wichtig" aria-label="Besonders wichtig" aria-pressed="false">★</button></div>`;
    };
    root().innerHTML = `
      <div class="l-head"><h2>Weinberatung</h2><div class="l-sub">Was wünscht sich der Gast? Gesucht wird nur im Sortiment dieses Restaurants.</div></div>
      <div id="sFeat">${featuredHtml()}</div>
      <div class="card s-form">
        <input class="l-search" id="sQ" type="search" placeholder="Stichwort (z. B. Riesling, Mosel, Kirsche) …" autocomplete="off">
        <div class="s-colors" id="sColors" role="group" aria-label="Weinfarbe">
          <button type="button" data-color="" class="on">Alle</button><button type="button" data-color="rot">Rot</button><button type="button" data-color="weiss">Weiß</button><button type="button" data-color="rose">Rosé</button><button type="button" data-color="schaum">Schaumwein</button>
        </div>
        <div class="m-grid" style="margin-top:12px">
          <label class="m-label">Preis bis (€)<input class="m-field" id="sPrice" inputmode="numeric" placeholder="egal"></label>
          <label class="m-label">Rebsorte<input class="m-field" id="sGrape" placeholder="z. B. Pinot Noir" autocomplete="off"></label>
          <label class="m-label">Land<select class="m-select" id="sCountry"></select></label>
          <label class="m-label">Region<select class="m-select" id="sRegion"></select></label>
        </div>
        <div class="s-sub">Geschmack <span class="l-sub">· ★ = besonders wichtig</span></div>
        <div class="s-scales">${Object.keys(SearchCore.SCALES).map(lvl).join('')}</div>
        <div class="m-grid">
          <label class="m-label">Aroma<input class="m-field" id="sAroma" placeholder="z. B. Vanille, Zitrus" autocomplete="off"></label>
          <label class="m-label">Passt zu (Speise)<input class="m-field" id="sFood" placeholder="z. B. Rinderfilet" autocomplete="off"></label>
        </div>
        <div class="m-actions" style="margin-top:12px"><button type="button" class="btn-s" id="sReset">Zurücksetzen</button></div>
      </div>
      <div id="sCount" class="l-sub" style="margin:6px 2px 10px"></div>
      <div id="sRes"></div>
      <p class="l-sub s-foot">Die Passung ist ein rechnerischer Wert aus den hinterlegten Eigenschaften, keine Qualitätsbewertung.
      Nicht hinterlegte Eigenschaften zählen nie als passend. Profile sind erst sichtbar, wenn sie vom Restaurant freigegeben wurden.</p>`;

    const r = root();
    r.querySelector('#sQ').oninput = e=>{ crit.q = e.target.value; shown = 20; run(); };
    r.querySelector('#sColors').onclick = e=>{
      const b = e.target.closest('button[data-color]'); if(!b) return;
      crit.color = b.dataset.color; shown = 20;
      r.querySelectorAll('#sColors button').forEach(x=> x.classList.toggle('on', x === b)); run();
    };
    r.querySelector('#sPrice').oninput = e=>{ const v = e.target.value.trim().replace(',', '.'); crit.priceMax = v === '' ? null : Number(v); if(crit.priceMax != null && !isFinite(crit.priceMax)) crit.priceMax = null; shown = 20; run(); };
    r.querySelector('#sGrape').oninput = e=>{ crit.grape = e.target.value.trim(); shown = 20; run(); };
    r.querySelector('#sAroma').oninput = e=>{ crit.aroma = e.target.value.trim(); shown = 20; run(); };
    r.querySelector('#sFood').oninput = e=>{ crit.food = e.target.value.trim(); shown = 20; run(); };
    r.querySelector('#sCountry').onchange = e=>{ crit.country = e.target.value; crit.region = ''; fillRegions(); shown = 20; run(); };
    r.querySelector('#sRegion').onchange = e=>{ crit.region = e.target.value; shown = 20; run(); };
    r.querySelectorAll('select[data-k]').forEach(s=> s.onchange = ()=>{ crit[s.dataset.k] = s.value; shown = 20; run(); });
    r.querySelectorAll('[data-star]').forEach(b=> b.onclick = ()=>{
      const k = b.dataset.star; crit.important[k] = !crit.important[k];
      b.classList.toggle('on', !!crit.important[k]); b.setAttribute('aria-pressed', String(!!crit.important[k])); run();
    });
    r.querySelector('#sReset').onclick = ()=>{ reset(); build(); };
    r.querySelector('#sRes').onclick = e=>{
      if(e.target.closest('#sMore')){ shown += 20; run(); }
      const c = e.target.closest('.s-card'); if(c && !e.target.closest('a,button')) c.classList.toggle('open');
    };
    fillCountries(); run();
  }

  /* Wein der Woche: nur belegte/freigegebene Angaben */
  function featuredHtml(){
    const w = featured && (S.wines || []).find(x=> x.id === featured && x.is_active);
    if(!w) return '';
    const p = w.profile || {};
    const pitch = SearchCore.pitch(w);
    return `<div class="card s-feat"><div class="s-sub" style="margin-top:0">★ Wein der Woche</div>
      <div class="s-head"><div class="s-title"><div class="nm">${esc(w.label)}</div><div class="mt">${esc(w.producer)} · ${esc(originOf(w))}</div></div><div class="s-price">${fmtPrice(w.price)}</div></div>
      ${chips(w)}
      ${pitch ? `<div class="s-pitch">„${esc(pitch)}“</div>` : ''}
      ${(p.selling_points || []).length ? `<ul class="s-list">${p.selling_points.map(x=> `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${(p.pairing_dishes || []).length ? `<div class="s-why"><b>Dazu:</b> ${esc(p.pairing_dishes.join(', '))}</div>` : ''}
    </div>`;
  }

  function fillCountries(){
    const wines = (S.wines || []).filter(w=> w.is_active);
    const sel = $('sCountry'); if(!sel) return;
    const cs = [...new Set(wines.map(w=> w.country || w.origin_country).filter(Boolean))].sort((a, b)=> a.localeCompare(b, 'de'));
    sel.innerHTML = '<option value="">alle</option>' + cs.map(c=> `<option ${c === crit.country ? 'selected' : ''}>${esc(c)}</option>`).join('');
    fillRegions();
  }
  function fillRegions(){
    const wines = (S.wines || []).filter(w=> w.is_active && (!crit.country || (w.country || w.origin_country) === crit.country));
    const rs = [...new Set(wines.map(w=> w.region || w.origin_region).filter(Boolean))].sort((a, b)=> a.localeCompare(b, 'de'));
    const sel = $('sRegion'); if(!sel) return;
    sel.innerHTML = '<option value="">alle</option>' + rs.map(c=> `<option ${c === crit.region ? 'selected' : ''}>${esc(c)}</option>`).join('');
    sel.disabled = !rs.length;
  }

  function chips(w){
    const p = w.profile; if(!p) return '';
    const out = [];
    if(p.color) out.push(SearchCore.COLORS[p.color]);
    (p.grapes || []).slice(0, 3).forEach(g=> out.push(g));
    for(const k of Object.keys(SearchCore.SCALES)){
      if(p[k] != null){ const lv = p[k] <= 2 ? 'low' : p[k] === 3 ? 'mid' : 'high'; out.push(SearchCore.SCALES[k].label + ' ' + SearchCore.SCALES[k].names[lv]); }
    }
    (p.aromas || []).slice(0, 4).forEach(a=> out.push(a));
    return out.length ? '<div class="s-chips">' + out.map(c=> `<span>${esc(c)}</span>`).join('') + '</div>' : '';
  }

  function card(r){
    const w = r.wine, scored = r.score != null;
    const pitch = SearchCore.pitch(w);
    const profNote = !w.profile ? 'Kein Geschmacksprofil hinterlegt' : (w.profile.status === 'draft' ? 'Profil noch nicht freigegeben' : '');
    return `<article class="s-card">
      <div class="s-head">
        <div class="s-title"><div class="nm">${esc(w.label)}</div><div class="mt">${esc(w.producer)} · ${esc(originOf(w))}</div></div>
        <div class="s-price">${fmtPrice(w.price)}</div>
      </div>
      ${scored ? `<div class="s-score"><div class="bar"><i style="width:${r.score}%"></i></div><b>${r.score} % Passung</b><span>Datenlage ${Math.round(r.known * 100)} %</span></div>` : ''}
      ${chips(w)}
      ${scored ? `<div class="s-why">${esc(SearchCore.explain(r))}</div>` : ''}
      ${pitch ? `<div class="s-pitch">„${esc(pitch)}“</div>` : ''}
      ${profNote ? `<div class="s-note">${esc(profNote)}</div>` : ''}
    </article>`;
  }

  function run(){
    const res = $('sRes'); if(!res) return;
    const wines = S.wines || [];
    const active = SearchCore.isActive(crit);
    const out = SearchCore.search(wines, crit);
    $('sCount').textContent = !wines.length ? 'Noch keine Weine vorhanden.' :
      (active ? out.length + ' passende' + (out.length === 1 ? 'r Wein' : ' Weine') : out.length + ' Weine im Sortiment — Wünsche eingeben, um zu sortieren');
    if(!out.length){ res.innerHTML = '<div class="adm-empty">Kein Wein passt zu diesen Wünschen. Einzelne Wünsche lockern?</div>'; return; }
    res.innerHTML = out.slice(0, shown).map(card).join('')
      + (out.length > shown ? `<div class="l-actions"><button class="m-btn secondary" id="sMore">Mehr anzeigen (${out.length - shown})</button></div>` : '');
  }

  return { show, reset };
})();
