/* ================= VERWALTEN: Weinliste, Bearbeiten, Team ================= */
const Admin = (function(){
  let filter = { q: '', mode: 'all' }, featuredId = null;

  function reset(){ filter = { q: '', mode: 'all' }; $('viewAdmin').innerHTML = ''; }

  function originText(w){
    if(w.region) return `${esc(w.country)} · ${esc(w.region)}` + (w.site ? `<span class="sub">Lage: ${esc(w.site)}</span>` : '');
    if(w.origin_country) return `${esc(w.origin_country)}${w.origin_region ? ' · ' + esc(w.origin_region) : ''}<span class="sub">ohne Karte</span>`;
    return '<span class="nonote">–</span>';
  }
  function hasNotes(w){ return w.notes && (w.notes.aroma || w.notes.taste || w.notes.pairing); }

  async function show(){
    const root = $('viewAdmin');
    if(!root.firstChild){
      root.innerHTML = `
        <div class="adm-head">
          <h2>Weinkarte verwalten</h2>
          <button class="tool-btn" id="admNew">＋ Wein hinzufügen</button>
          <button class="tool-btn" id="admImport">▲ Weinkarte importieren (PDF/Excel/CSV)</button>
          <button class="tool-btn" id="admNotes">▲ Geschmacks-PDF importieren</button>
          <button class="tool-btn" id="admTasks">Lernaufgaben</button>
          <button class="tool-btn quiet" id="admTeam" ${isOwner() ? '' : 'hidden'}>Team</button>
        </div>
        <div id="admSetup"></div>
        <div class="adm-tools">
          <input id="admQ" type="search" placeholder="Suchen (Wein, Erzeuger, Gebiet) …">
          <select id="admMode">
            <option value="all">Alle Weine</option>
            <option value="nomap">Nicht auf der Karte</option>
            <option value="inactive">Ausgeblendet</option>
            <option value="nonote">Ohne Geschmacksprofil</option><option value="draft">Profil nicht freigegeben</option>
          </select>
        </div>
        <div id="admList"></div>`;
      $('admNew').onclick = ()=> edit(null);
      $('admImport').onclick = ()=> Importer.open();
      $('admNotes').onclick = ()=> Importer.openNotes();
      $('admTasks').onclick = tasks;
      $('admTeam').onclick = team;
      $('admQ').oninput = e=>{ filter.q = e.target.value; renderList(); };
      $('admMode').onchange = e=>{ filter.mode = e.target.value; renderList(); };
      $('admList').addEventListener('click', e=>{
        const b = e.target.closest('[data-edit]'); if(b) return edit(b.dataset.edit);
        const p = e.target.closest('[data-prof]'); if(p) return profileEdit(p.dataset.prof);
        const f = e.target.closest('[data-feat]');
        if(f) guard(async ()=>{
          const id = f.dataset.feat, off = featuredId === id;
          await Api.rpc('set_featured', { p_restaurant: S.rid, p_wine: off ? null : id });
          featuredId = off ? null : id; renderList(); toast(off ? 'Wein der Woche entfernt.' : 'Wein der Woche gesetzt.');
        });
      });
    }
    $('admList').innerHTML = '<div class="adm-empty">Lädt …</div>';
    await ensureWines(true);
    featuredId = await Api.rpc('get_featured', { p_restaurant: S.rid }).catch(()=> null);
    renderList();
    renderSetup();
  }


  /* ---------- Einrichtung (Onboarding) und Tarif ---------- */
  const PLAN_NAME = { starter: 'Starter', professional: 'Professional', enterprise: 'Enterprise' };
  const dismissKey = ()=> 'weinatlas_setup_' + S.rid;
  async function renderSetup(){
    const box = $('admSetup'); if(!box) return;
    const rid = S.rid;
    let ent = null, taskCount = 0;
    try{
      ent = await Api.rpc('get_entitlements', { p_restaurant: rid });
      if(ent.limits.tasks) taskCount = (await Api.rpc('get_task_overview', { p_restaurant: rid }).catch(()=> [])).length;
    }catch(e){ box.innerHTML = ''; return; }
    if(rid !== S.rid || !$('admSetup')) return;
    const wines = S.wines || [];
    const approved = wines.filter(w=> w.profile && w.profile.status === 'approved').length;
    const steps = [
      { done: true, text: 'Restaurant angelegt' },
      { done: wines.length > 0, text: 'Weinkarte importieren (PDF, Excel oder CSV)', act: 'admImport', btn: 'Importieren' },
      { done: wines.some(w=> w.region_id), text: 'Zuordnung prüfen: Weine erscheinen auf der Karte', act: null },
      { done: approved > 0, text: 'Mindestens ein Geschmacksprofil freigeben (Suche und Lernen nutzen nur Freigegebenes)', act: null },
      { done: ent.usage.members > 1, text: 'Team einladen', act: 'admTeam', btn: 'Team', owner: true },
      ...(ent.limits.tasks ? [{ done: taskCount > 0, text: 'Erste Lernaufgabe anlegen', act: 'admTasks', btn: 'Aufgaben' }] : [])
    ];
    const open = steps.filter(x=> !x.done).length;
    let dismissed = false; try{ dismissed = localStorage.getItem(dismissKey()) === '1'; }catch(e){}
    const pct = (u, l)=> l == null ? 0 : Math.min(100, Math.round(u / l * 100));
    const meter = (lab, u, l)=> `<div class="lb-row" style="padding:4px 0"><span class="nm">${lab}<div class="l-bar" style="margin:4px 0 0"><i style="width:${pct(u, l)}%"></i></div></span><span class="sm" style="text-align:right">${u}${l == null ? ' (unbegrenzt)' : ' / ' + l}</span></div>`;
    box.innerHTML = `
      ${open && !dismissed ? `<div class="card" style="padding:14px 16px;margin-bottom:12px">
        <div class="team-row" style="border:none;padding:0"><span class="grow"><b>Einrichtung</b> <span class="l-sub">· ${steps.length - open} von ${steps.length} erledigt</span></span><button class="btn-s" id="setupHide">Ausblenden</button></div>
        ${steps.map(x=> `<div class="team-row" style="padding:6px 0"><span class="grow">${x.done ? '✓' : '○'} <span style="${x.done ? 'opacity:.6' : ''}">${esc(x.text)}</span></span>
          ${!x.done && x.act && (!x.owner || isOwner()) ? `<button class="btn-s" data-setup="${x.act}">${esc(x.btn)}</button>` : ''}</div>`).join('')}
      </div>` : ''}
      <details class="card" style="padding:10px 16px;margin-bottom:12px"><summary style="cursor:pointer"><b>Tarif: ${esc(PLAN_NAME[ent.plan] || ent.plan)}</b> <span class="l-sub">· Nutzung und Grenzen</span></summary>
        <div style="margin-top:8px">
          ${meter('Weine', ent.usage.wines, ent.limits.wines)}
          ${meter('Teammitglieder', ent.usage.members, ent.limits.members)}
          ${meter('PDF-Auslesen (Monat)', ent.usage.imports, ent.limits.imports)}
          <div class="l-sub" style="margin-top:6px">Lernaufgaben: ${ent.limits.tasks ? 'enthalten' : 'nicht im Tarif'} · Automatische Recherche: ${ent.limits.research ? 'enthalten' : 'nicht im Tarif'}.
          Tarifwechsel bitte beim Anbieter anfragen.</div>
        </div></details>`;
    const hide = $('setupHide'); if(hide) hide.onclick = ()=>{ try{ localStorage.setItem(dismissKey(), '1'); }catch(e){} renderSetup(); };
    box.querySelectorAll('[data-setup]').forEach(b=> b.onclick = ()=> $(b.dataset.setup).click());
  }

  function renderList(){
    const list = S.wines || [];
    const q = filter.q.trim().toLowerCase();
    const rows = list.filter(w=>{
      if(filter.mode === 'nomap' && w.region_id) return false;
      if(filter.mode === 'inactive' && w.is_active) return false;
      if(filter.mode === 'nonote' && (w.profile || hasNotes(w))) return false;
      if(filter.mode === 'draft' && !(w.profile && w.profile.status === 'draft')) return false;
      if(!q) return true;
      return [w.label, w.producer, w.country, w.region, w.origin_country, w.origin_region, w.site].some(v=> v && String(v).toLowerCase().includes(q));
    });
    const box = $('admList');
    if(!list.length){
      box.innerHTML = '<div class="adm-empty">Noch keine Weine. Importiere eine Weinkarte als PDF oder füge einen Wein hinzu.</div>'; return;
    }
    if(!rows.length){ box.innerHTML = '<div class="adm-empty">Keine Treffer.</div>'; return; }
    box.innerHTML = `<table class="wtable"><thead><tr>
        <th>Wein</th><th>Herkunft</th><th class="num" style="text-align:right">Preis</th><th class="hide-s">Profil</th><th></th></tr></thead><tbody>`
      + rows.map(w=> `<tr class="${w.is_active ? '' : 'off'}">
          <td>${esc(w.label)}<span class="sub">${esc(w.producer)}${w.is_active ? '' : '<span class="badge">ausgeblendet</span>'}</span></td>
          <td>${originText(w)}</td>
          <td class="num">${fmtPrice(w.price)}</td>
          <td class="hide-s">${profileStatus(w)}</td>
          <td class="act"><button class="btn-s" data-feat="${esc(w.id)}" title="${featuredId === w.id ? 'Wein der Woche entfernen' : 'Zum Wein der Woche machen'}" aria-label="Wein der Woche">${featuredId === w.id ? '★' : '☆'}</button> <button class="btn-s" data-prof="${esc(w.id)}">Profil</button> <button class="btn-s" data-edit="${esc(w.id)}">Bearbeiten</button></td></tr>`).join('')
      + `</tbody></table><p class="l-sub" style="margin-top:12px">${rows.length} von ${list.length} Weinen</p>`;
  }

  /* ---------- Wein bearbeiten / anlegen ---------- */
  async function edit(id){
    const regions = await ensureRegions();
    const w = id ? S.wines.find(x=> x.id === id) : null;
    const producers = [...new Set((S.wines || []).map(x=> x.producer))].sort((a,b)=> a.localeCompare(b, 'de'));
    const countries = [...new Set(regions.map(r=> r.country))];
    const selRegion = w ? (w.region_id || (w.origin_country ? '__other__' : '')) : '';
    const n = (w && w.notes) || {};

    const regionOpts = '<option value="">– bitte wählen –</option>'
      + countries.map(c=> `<optgroup label="${esc(c)}">`
          + regions.filter(r=> r.country === c).map(r=> `<option value="${esc(r.id)}" ${r.id === selRegion ? 'selected' : ''}>${esc(r.name)}</option>`).join('')
          + '</optgroup>').join('')
      + `<option value="__other__" ${selRegion === '__other__' ? 'selected' : ''}>Anderes Land / Gebiet (ohne Karte) …</option>`;

    Modal.open(w ? 'Wein bearbeiten' : 'Neuer Wein', w ? w.label : 'Wein hinzufügen', `
      <datalist id="dlProd">${producers.map(p=> `<option value="${esc(p)}">`).join('')}</datalist>
      <div class="m-grid">
        <label class="m-label">Erzeuger<input class="m-field" id="eProd" list="dlProd" maxlength="120" value="${esc(w ? w.producer : '')}"></label>
        <label class="m-label">Preis (€)<input class="m-field" id="ePrice" inputmode="decimal" placeholder="z. B. 38 oder 38,5" value="${w && w.price != null ? esc(String(w.price).replace('.', ',')) : ''}"></label>
      </div>
      <label class="m-label">Bezeichnung (Jahrgang · Lage · Rebsorte)<input class="m-field" id="eLabel" maxlength="200" value="${esc(w ? w.label : '')}"></label>
      <div class="m-grid">
        <label class="m-label">Anbaugebiet<select class="m-select" id="eRegion">${regionOpts}</select></label>
        <label class="m-label" id="eSiteWrap">Lage (optional)<select class="m-select" id="eSite"></select></label>
      </div>
      <div class="m-grid" id="eOtherWrap" hidden>
        <label class="m-label">Land<input class="m-field" id="eOC" maxlength="60" value="${esc(w && w.origin_country || '')}"></label>
        <label class="m-label">Gebiet<input class="m-field" id="eOR" maxlength="60" value="${esc(w && w.origin_region || '')}"></label>
      </div>
      <div class="m-grid">
        <label class="m-label">Kategorie (optional)<input class="m-field" id="eCat" maxlength="40" placeholder="z. B. Weißwein, Rotwein, Champagner" value="${esc(w && w.category || '')}"></label>
        <label class="m-check" style="margin-top:26px"><input type="checkbox" id="eActive" ${!w || w.is_active ? 'checked' : ''}> auf der Karte zeigen</label>
      </div>
      <h3 style="font-family:'Fraunces',serif;font-weight:500;margin:20px 0 4px">Geschmack &amp; Wissen <span class="badge">für die Lern-App</span></h3>
      <label class="m-label">Aromen<textarea class="m-field" id="nAroma" maxlength="600">${esc(n.aroma || '')}</textarea></label>
      <label class="m-label">Geschmack / Stil<textarea class="m-field" id="nTaste" maxlength="600">${esc(n.taste || '')}</textarea></label>
      <label class="m-label">Passt zu<textarea class="m-field" id="nPairing" maxlength="600">${esc(n.pairing || '')}</textarea></label>
      <div class="m-actions">
        ${w ? '<button class="m-btn secondary" id="eDel" style="margin-right:auto">Löschen</button>' : ''}
        <button class="m-btn secondary" id="eCancel">Abbrechen</button>
        <button class="m-btn" id="eSave">Speichern</button>
      </div>
      <div class="m-status err" id="eErr"></div>`);

    const fillSites = ()=>{
      const rid = $('eRegion').value;
      const reg = regions.find(r=> r.id === rid);
      const sites = reg ? reg.sites : [];
      $('eSite').innerHTML = '<option value="">– keine –</option>' + sites.map(s=> `<option value="${esc(s.id)}" ${w && w.site_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
      $('eSiteWrap').hidden = !sites.length;
      $('eOtherWrap').hidden = rid !== '__other__';
    };
    $('eRegion').onchange = fillSites; fillSites();
    $('eCancel').onclick = Modal.close;
    if(w) $('eDel').onclick = async ()=>{
      if(!confirm(`„${w.label}“ wirklich löschen?`)) return;
      await guard(async ()=>{ await Api.rpc('delete_wine', { p_wine: w.id }); winesChanged(); Modal.close(); toast('Wein gelöscht.'); await show(); });
    };
    $('eSave').onclick = async ()=>{
      const err = $('eErr'); err.textContent = '';
      const prod = $('eProd').value.trim(), label = $('eLabel').value.trim();
      const priceTxt = $('ePrice').value.trim().replace(',', '.').replace(/^€\s*/, '');
      const regionSel = $('eRegion').value;
      if(!prod) return err.textContent = 'Bitte den Erzeuger eintragen.';
      if(!label) return err.textContent = 'Bitte die Bezeichnung eintragen.';
      if(priceTxt && !(Number(priceTxt) >= 0 && Number(priceTxt) < 100000)) return err.textContent = 'Der Preis ist keine gültige Zahl.';
      if(!regionSel) return err.textContent = 'Bitte ein Anbaugebiet wählen (oder „Anderes Land“).';
      if(regionSel === '__other__' && !$('eOC').value.trim()) return err.textContent = 'Bitte das Land eintragen.';
      const p = {
        id: w ? w.id : '', producer: prod, label, price: priceTxt, category: $('eCat').value.trim(),
        region_id: regionSel === '__other__' ? '' : regionSel,
        site_id: regionSel === '__other__' ? '' : $('eSite').value,
        origin_country: regionSel === '__other__' ? $('eOC').value.trim() : '',
        origin_region: regionSel === '__other__' ? $('eOR').value.trim() : '',
        is_active: $('eActive').checked, note: w && w.note || ''
      };
      $('eSave').disabled = true;
      try{
        const wid = await Api.rpc('save_wine', { p_restaurant: S.rid, p: p });
        const notes = { aroma: $('nAroma').value, taste: $('nTaste').value, pairing: $('nPairing').value };
        if(notes.aroma.trim() || notes.taste.trim() || notes.pairing.trim() || (w && w.notes)){
          await Api.rpc('save_note', { p_wine: wid, p: notes });
        }
        winesChanged(); Modal.close(); toast('Gespeichert.'); await show();
      }catch(e){ err.textContent = e.message; }
      finally{ const b = $('eSave'); if(b) b.disabled = false; }
    };
  }

  /* ---------- Team (nur Inhaber) ---------- */
  async function team(){
    const body = Modal.open('Team', 'Zugriff verwalten', '<div class="adm-empty">Lädt …</div>');
    const render = async ()=>{
      const m = await Api.rpc('get_members', { p_restaurant: S.rid });
      body.innerHTML = `
        <p class="m-note" style="margin-top:0"><b>Inhaber</b> verwalten das Team, <b>Bearbeiter</b> pflegen die Weinkarte, <b>Mitarbeiter</b> sehen Karte und lernen.
        Konten werden im Supabase-Dashboard angelegt (Authentication → Users); hier wird ein bestehendes Konto dem Restaurant zugeordnet.</p>
        <div>${m.map(x=> `<div class="team-row"><span class="grow">${esc(x.name ? x.name + ' · ' : '')}${esc(x.email)}</span>
            <span class="badge">${esc(ROLE_NAME[x.role])}</span>
            <button class="btn-s danger" data-rm="${esc(x.user_id)}">Entfernen</button></div>`).join('')}</div>
        <h3 style="font-family:'Fraunces',serif;font-weight:500;margin:20px 0 4px">Person hinzufügen</h3>
        <div class="m-grid">
          <label class="m-label">E-Mail des Kontos<input class="m-field" id="tEmail" type="email"></label>
          <label class="m-label">Rolle<select class="m-select" id="tRole"><option value="viewer">Mitarbeiter</option><option value="editor">Bearbeiter</option><option value="owner">Inhaber</option></select></label>
        </div>
        <div class="m-actions"><button class="m-btn" id="tAdd">Hinzufügen</button></div>
        <div class="m-status err" id="tErr"></div>`;
      body.querySelectorAll('[data-rm]').forEach(b=> b.onclick = async ()=>{
        if(!confirm('Zugriff wirklich entfernen?')) return;
        try{ await Api.rpc('remove_member', { p_restaurant: S.rid, p_user: b.dataset.rm }); await render(); }
        catch(e){ $('tErr').textContent = e.message; }
      });
      $('tAdd').onclick = async ()=>{
        try{
          await Api.rpc('add_member', { p_restaurant: S.rid, p_email: $('tEmail').value.trim(), p_role: $('tRole').value });
          await render();
        }catch(e){ $('tErr').textContent = e.message; }
      };
    };
    try{ await render(); }catch(e){ body.innerHTML = `<div class="m-status err">${esc(e.message)}</div>`; }
  }


  /* ---------- Geschmacksprofil bearbeiten / freigeben ---------- */
  const SCALE_FIELDS = [['body', 'Körper', ['leicht', 'mittel', 'kräftig']], ['acidity', 'Säure', ['niedrig', 'mittel', 'hoch']],
    ['tannin', 'Tannine', ['weich', 'mittel', 'kräftig']], ['sweetness', 'Süße', ['trocken', 'halbtrocken', 'süß']],
    ['fruit', 'Frucht', ['dezent', 'mittel', 'intensiv']], ['minerality', 'Mineralität', ['wenig', 'mittel', 'ausgeprägt']],
    ['oak', 'Holz', ['kein/wenig', 'leicht', 'deutlich']]];
  const lines = a=> (a || []).join('\n');
  const originOf = w=> [w.region || w.origin_region, w.country || w.origin_country].filter(Boolean).join(', ');
  const toList = (t, sep)=> String(t || '').split(sep).map(x=> x.trim()).filter(Boolean);

  function profileStatus(w){
    if(!w.profile) return '<span class="nonote">–</span>';
    return w.profile.status === 'approved' ? '<span class="badge" style="color:#8fcf9d;border-color:#4f8a5c">freigegeben</span>' : '<span class="badge">Entwurf</span>';
  }

  function profileEdit(id){
    const w = S.wines.find(x=> x.id === id); if(!w) return;
    const p = w.profile || {};
    const scale = ([k, lab, names])=> `<label class="m-label">${lab}<select class="m-select" data-pk="${k}">
      <option value="">unbekannt</option>${[1, 2, 3, 4, 5].map(v=> `<option value="${v}" ${Number(p[k]) === v ? 'selected' : ''}>${v}${v === 1 ? ' – ' + names[0] : v === 3 ? ' – ' + names[1] : v === 5 ? ' – ' + names[2] : ''}</option>`).join('')}</select></label>`;
    Modal.open('Geschmacksprofil', w.label, `
      <p class="m-note" style="margin-top:0">${esc(w.producer)}. Nur Angaben eintragen, die du sicher weißt oder belegen kannst; alles andere auf „unbekannt“ lassen.
      Mitarbeiter sehen das Profil erst, wenn es freigegeben ist.</p>
      <div class="m-grid">
        <label class="m-label">Farbe<select class="m-select" id="pColor"><option value="">unbekannt</option>
          ${Object.keys(SearchCore.COLORS).map(k=> `<option value="${k}" ${p.color === k ? 'selected' : ''}>${SearchCore.COLORS[k]}</option>`).join('')}
          <option value="orange" ${p.color === 'orange' ? 'selected' : ''}>Orange</option><option value="suess" ${p.color === 'suess' ? 'selected' : ''}>Süßwein</option></select></label>
        <label class="m-label">Alkohol (% vol.)<input class="m-field" id="pAbv" inputmode="decimal" value="${p.abv != null ? esc(String(p.abv).replace('.', ',')) : ''}"></label>
      </div>
      <label class="m-label">Rebsorten (mit Komma trennen)<input class="m-field" id="pGrapes" value="${esc((p.grapes || []).join(', '))}"></label>
      <div class="s-sub">Skalen 1–5</div>
      <div class="m-grid">${SCALE_FIELDS.map(scale).join('')}</div>
      <label class="m-label">Aromen (mit Komma trennen)<input class="m-field" id="pAromas" value="${esc((p.aromas || []).join(', '))}"></label>
      <div class="m-grid">
        <label class="m-label">Abgang<input class="m-field" id="pFinish" maxlength="200" value="${esc(p.finish || '')}"></label>
        <label class="m-label">Trinktemperatur<input class="m-field" id="pTemp" maxlength="60" placeholder="z. B. 16–18 °C" value="${esc(p.serving_temp || '')}"></label>
      </div>
      <label class="m-label">Ausbau / Reifung<input class="m-field" id="pAging" maxlength="300" value="${esc(p.aging || '')}"></label>
      <label class="m-label">Passende Speisen (mit Komma trennen)<input class="m-field" id="pFood" value="${esc((p.pairing_dishes || []).join(', '))}"></label>
      <div style="margin:14px 0 0"><button type="button" class="btn-s" id="pGen">Texte aus den Angaben vorschlagen</button>
        <span class="l-sub"> · regelbasiert, ohne KI; nutzt nur ausgefüllte Felder und füllt nur leere Textfelder</span></div>
      <label class="m-label">Fachliche Beschreibung<textarea class="m-field" id="pTech" maxlength="1500">${esc(p.description_tech || '')}</textarea></label>
      <label class="m-label">Service-Beschreibung (so sagt es der Kellner dem Gast)<textarea class="m-field" id="pServ" maxlength="600">${esc(p.description_service || '')}</textarea></label>
      <label class="m-label">Verkaufsargumente (eins pro Zeile)<textarea class="m-field" id="pSell" maxlength="800">${esc(lines(p.selling_points))}</textarea></label>
      <label class="m-label">Empfehlungssatz für den Gast<input class="m-field" id="pHint" maxlength="300" value="${esc(p.guest_hint || '')}"></label>
      <label class="m-check" style="margin-top:14px"><input type="checkbox" id="pApprove" ${p.status === 'approved' ? 'checked' : ''}> Freigeben (für Mitarbeiter sichtbar)</label>
      <div id="pSrc"></div>
      <div class="m-actions">
        <button class="m-btn secondary" id="pCancel">Abbrechen</button>
        <button class="m-btn" id="pSave">Speichern</button>
      </div>
      <div class="m-status err" id="pErr"></div>`);

    renderSources(w.id);
    const genKeys = new Set(), edited = new Set();      // Felder, deren Text vorgeschlagen und danach nicht verändert wurde
    const TXT = { description_tech: 'pTech', description_service: 'pServ', selling_points: 'pSell', guest_hint: 'pHint' };
    Object.keys(TXT).forEach(k=> $(TXT[k]).addEventListener('input', ()=>{ genKeys.delete(k); edited.add(k); }));
    $('pGen').onclick = ()=>{
      const cur = {
        color: $('pColor').value, abv: $('pAbv').value.trim().replace(',', '.'), grapes: toList($('pGrapes').value, ','), aromas: toList($('pAromas').value, ','),
        finish: $('pFinish').value, serving_temp: $('pTemp').value, aging: $('pAging').value, pairing_dishes: toList($('pFood').value, ',')
      };
      document.querySelectorAll('[data-pk]').forEach(s=> cur[s.dataset.pk] = s.value);
      const g = TextGen.compose(cur, { producer: w.producer, origin: originOf(w) });
      let filled = 0;
      for(const k of Object.keys(TXT)){
        const el = $(TXT[k]), val = k === 'selling_points' ? lines(g[k]) : g[k];
        if(val && !el.value.trim()){ el.value = val; genKeys.add(k); filled++; }
      }
      toast(filled ? filled + ' Textfeld' + (filled === 1 ? '' : 'er') + ' vorgeschlagen — bitte prüfen und anpassen.' : 'Nichts vorgeschlagen: Textfelder sind schon gefüllt oder es fehlen Angaben.', !filled);
    };
    $('pCancel').onclick = Modal.close;
    $('pSave').onclick = async ()=>{
      const err = $('pErr'); err.textContent = '';
      const abv = $('pAbv').value.trim().replace(',', '.');
      if(abv && !(Number(abv) >= 0 && Number(abv) <= 25)) return err.textContent = 'Der Alkoholgehalt muss zwischen 0 und 25 liegen.';
      const prof = {
        color: $('pColor').value, abv, grapes: toList($('pGrapes').value, ','), aromas: toList($('pAromas').value, ','),
        finish: $('pFinish').value, serving_temp: $('pTemp').value, aging: $('pAging').value,
        pairing_dishes: toList($('pFood').value, ','), description_tech: $('pTech').value, description_service: $('pServ').value,
        selling_points: toList($('pSell').value, '\n'), guest_hint: $('pHint').value
      };
      document.querySelectorAll('[data-pk]').forEach(s=> prof[s.dataset.pk] = s.value);
      // Herkunftsstatus: bestehende Einträge behalten, neu gefüllte Felder als "vom Restaurant eingegeben" markieren
      const prov = Object.assign({}, p.provenance || {});
      Object.keys(prof).forEach(k=>{
        const v = prof[k], filled = Array.isArray(v) ? v.length : String(v).trim() !== '';
        if(filled && genKeys.has(k)) prov[k] = { src: 'generated', at: new Date().toISOString().slice(0, 10) };
        else if(filled && (!prov[k] || edited.has(k))) prov[k] = { src: 'restaurant', at: new Date().toISOString().slice(0, 10) };
        if(!filled) delete prov[k];
      });
      prof.provenance = prov;
      $('pSave').disabled = true;
      try{
        await Api.rpc('save_profile', { p_wine: w.id, p: prof, p_approve: $('pApprove').checked });
        winesChanged(); Modal.close(); toast($('pApprove') ? 'Profil gespeichert.' : 'Profil gespeichert.'); await show();
      }catch(e){ err.textContent = e.message; }
      finally{ const b = $('pSave'); if(b) b.disabled = false; }
    };
  }

  const KIND = { producer: 'Weingut', datasheet: 'Datenblatt', importer: 'Importeur', retailer: 'Händler', external: 'Sonstige' };
  async function renderSources(wineId){
    const box = $('pSrc'); if(!box) return;
    let rows = [];
    try{ rows = await Api.rpc('get_sources', { p_wine: wineId }); }catch(e){ rows = []; }
    if(!$('pSrc')) return;
    box.innerHTML = `<div class="s-sub">Quellen</div>
      ${rows.length ? rows.map(s=> `<div class="team-row"><span class="grow"><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" style="color:var(--gold-bright)">${esc(s.title || s.url)}</a>
        <span class="badge">${esc(KIND[s.kind] || s.kind)}</span><span class="l-sub"> · abgerufen ${esc(s.retrieved_at)}</span></span>
        <button type="button" class="btn-s danger" data-delsrc="${esc(s.id)}">Entfernen</button></div>`).join('') : '<p class="l-sub" style="margin:0 0 8px">Noch keine Quelle hinterlegt.</p>'}
      <div class="m-grid">
        <label class="m-label">Link (https://…)<input class="m-field" id="srcUrl" maxlength="500"></label>
        <label class="m-label">Art<select class="m-select" id="srcKind">${Object.keys(KIND).map(k=> `<option value="${k}">${KIND[k]}</option>`).join('')}</select></label>
      </div>
      <button type="button" class="btn-s" id="srcAdd" style="margin-top:8px">Quelle hinzufügen</button>`;
    box.querySelectorAll('[data-delsrc]').forEach(b=> b.onclick = async ()=>{ await guard(()=> Api.rpc('delete_source', { p_source: b.dataset.delsrc })); renderSources(wineId); });
    $('srcAdd').onclick = async ()=>{
      const url = $('srcUrl').value.trim();
      if(!/^https?:\/\//i.test(url)) return toast('Bitte einen Link mit https:// eintragen.', true);
      await guard(()=> Api.rpc('add_source', { p_wine: wineId, p_url: url, p_title: '', p_kind: $('srcKind').value, p_reliability: null }));
      renderSources(wineId);
    };
  }


  /* ---------- Lernaufgaben (Geschäftsführung) ---------- */
  const fmtDate = d=> d ? new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'ohne Frist';

  async function tasks(){
    const body = Modal.open('Lernaufgaben', 'Aufgaben und Fortschritt', '<div class="adm-empty">Lädt …</div>');
    const render = async ()=>{
      const ov = await Api.rpc('get_task_overview', { p_restaurant: S.rid });
      const now = Date.now();
      body.innerHTML = `
        <div class="m-actions" style="justify-content:flex-start;margin:0 0 12px"><button class="m-btn" id="tkNew">＋ Neue Aufgabe</button></div>
        ${ov.length ? ov.map(t=>{
          const total = t.wine_count, fin = t.assignees.filter(a=> a.completed_at).length;
          const late = t.due_at && new Date(t.due_at).getTime() < now && fin < t.assignees.length;
          return `<div class="card" style="padding:14px 16px">
            <div class="team-row" style="border:none;padding:0"><span class="grow"><b>${esc(t.title)}</b><br><span class="l-sub">${total} Weine · Frist ${esc(fmtDate(t.due_at))}${late ? ' · <span style="color:#e08a96">überfällig</span>' : ''}</span></span>
              <span class="badge">${fin} / ${t.assignees.length} fertig</span><button class="btn-s danger" data-deltask="${esc(t.id)}">Löschen</button></div>
            <div style="margin-top:8px">${t.assignees.map(a=>{
              const pct = total ? Math.round(a.done / total * 100) : 0;
              const rate = a.attempts ? Math.round(a.correct / a.attempts * 100) + ' % Trefferquote' : 'nicht begonnen';
              return `<div class="lb-row" style="padding:6px 0"><span class="nm">${esc(a.name)}<div class="l-bar" style="margin:4px 0 0"><i style="width:${pct}%"></i></div></span>
                <span class="sm" style="text-align:right">${a.completed_at ? '✓ fertig' : a.done + ' / ' + total}<br>${esc(rate)}</span></div>`;
            }).join('')}</div></div>`;
        }).join('') : '<div class="adm-empty">Noch keine Aufgaben. Lege die erste an, z. B. „Diese 5 Rotweine bis Freitag“.</div>'}`;
      $('tkNew').onclick = newTask;
      body.querySelectorAll('[data-deltask]').forEach(b=> b.onclick = async ()=>{
        if(!confirm('Aufgabe samt Fortschritt wirklich löschen?')) return;
        await guard(()=> Api.rpc('delete_task', { p_task: b.dataset.deltask })); render();
      });
    };
    try{ await render(); }catch(e){ body.innerHTML = `<div class="m-status err">${esc(e.message)}</div>`; }
    Admin._renderTasks = render;
  }

  async function newTask(){
    await ensureWines();
    let team = []; try{ team = await Api.rpc('get_team', { p_restaurant: S.rid }); }catch(e){ toast(e.message, true); return; }
    const wines = (S.wines || []).filter(w=> w.is_active);
    const cats = [...new Set(wines.map(w=> (w.country || w.origin_country || '')).filter(Boolean))].sort((a, b)=> a.localeCompare(b, 'de'));
    Modal.open('Neue Lernaufgabe', 'Wer lernt was bis wann?', `
      <label class="m-label">Titel<input class="m-field" id="ntTitle" maxlength="120" placeholder="z. B. Fünf neue Rotweine"></label>
      <div class="m-grid">
        <label class="m-label">Frist (optional)<input class="m-field" type="date" id="ntDue"></label>
        <label class="m-label">Hinweis (optional)<input class="m-field" id="ntDesc" maxlength="300"></label>
      </div>
      <div class="s-sub">Weine <span class="l-sub" id="ntCount"></span></div>
      <div class="m-grid">
        <input class="m-field" id="ntQ" type="search" placeholder="Wein suchen …" style="margin-top:0">
        <select class="m-select" id="ntCountry" style="margin-top:0"><option value="">alle Länder</option>${cats.map(c=> `<option>${esc(c)}</option>`).join('')}</select>
      </div>
      <div style="margin:8px 0"><button type="button" class="btn-s" id="ntAll">Alle angezeigten wählen</button> <button type="button" class="btn-s" id="ntNone">Keine</button></div>
      <div class="review-list" id="ntList" style="max-height:34vh"></div>
      <div class="s-sub">Zugewiesen an</div>
      <label class="m-check"><input type="checkbox" id="ntAllTeam" checked> Gesamtes Team (${team.length} Personen)</label>
      <div id="ntTeam" hidden style="margin-top:6px">${team.map(t=> `<label class="m-check" style="margin:4px 0"><input type="checkbox" value="${esc(t.user_id)}"> ${esc(t.name)}</label>`).join('')}</div>
      <div class="m-actions"><button class="m-btn secondary" id="ntCancel">Abbrechen</button><button class="m-btn" id="ntSave">Aufgabe anlegen</button></div>
      <div class="m-status err" id="ntErr"></div>`);
    const picked = new Set();
    const draw = ()=>{
      const q = $('ntQ').value.trim().toLowerCase(), c = $('ntCountry').value;
      const rows = wines.filter(w=> (!c || (w.country || w.origin_country) === c) && (!q || (w.label + ' ' + w.producer + ' ' + (w.region || w.origin_region || '')).toLowerCase().includes(q))).slice(0, 150);
      $('ntList').innerHTML = rows.map(w=> `<label class="rev-row" style="grid-template-columns:24px 1fr;cursor:pointer"><input type="checkbox" data-w="${esc(w.id)}" ${picked.has(w.id) ? 'checked' : ''} style="width:auto">
        <span>${esc(w.label)}<span class="l-sub"> · ${esc(w.producer)}</span></span></label>`).join('') || '<div class="adm-empty">Keine Weine.</div>';
      $('ntCount').textContent = '· ' + picked.size + ' gewählt';
    };
    $('ntList').onchange = e=>{ const c = e.target.closest('[data-w]'); if(!c) return; c.checked ? picked.add(c.dataset.w) : picked.delete(c.dataset.w); $('ntCount').textContent = '· ' + picked.size + ' gewählt'; };
    $('ntQ').oninput = draw; $('ntCountry').onchange = draw;
    $('ntAll').onclick = ()=>{ document.querySelectorAll('#ntList [data-w]').forEach(c=>{ c.checked = true; picked.add(c.dataset.w); }); $('ntCount').textContent = '· ' + picked.size + ' gewählt'; };
    $('ntNone').onclick = ()=>{ picked.clear(); draw(); };
    $('ntAllTeam').onchange = e=>{ $('ntTeam').hidden = e.target.checked; };
    $('ntCancel').onclick = ()=> tasks();
    draw();
    $('ntSave').onclick = async ()=>{
      const err = $('ntErr'); err.textContent = '';
      const title = $('ntTitle').value.trim();
      if(!title) return err.textContent = 'Bitte einen Titel eintragen.';
      if(!picked.size) return err.textContent = 'Bitte mindestens einen Wein wählen.';
      let users = null;
      if(!$('ntAllTeam').checked){
        users = [...document.querySelectorAll('#ntTeam input:checked')].map(c=> c.value);
        if(!users.length) return err.textContent = 'Bitte mindestens eine Person wählen oder „Gesamtes Team“.';
      }
      const due = $('ntDue').value ? new Date($('ntDue').value + 'T23:59:00').toISOString() : null;
      $('ntSave').disabled = true;
      try{
        await Api.rpc('create_task', { p_restaurant: S.rid, p_title: title, p_due: due, p_wine_ids: [...picked], p_user_ids: users, p_description: $('ntDesc').value.trim() || null });
        toast('Aufgabe angelegt.'); tasks();
      }catch(e){ err.textContent = e.message; $('ntSave').disabled = false; }
    };
  }

  return { show, reset };
})();
