/* ================= VERWALTEN: Weinliste, Bearbeiten, Team ================= */
const Admin = (function(){
  let filter = { q: '', mode: 'all' };

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
          <button class="tool-btn" id="admImport">▲ Weinkarte (PDF) importieren</button>
          <button class="tool-btn" id="admNotes">▲ Geschmacks-PDF importieren</button>
          <button class="tool-btn quiet" id="admTeam" ${isOwner() ? '' : 'hidden'}>Team</button>
        </div>
        <div class="adm-tools">
          <input id="admQ" type="search" placeholder="Suchen (Wein, Erzeuger, Gebiet) …">
          <select id="admMode">
            <option value="all">Alle Weine</option>
            <option value="nomap">Nicht auf der Karte</option>
            <option value="inactive">Ausgeblendet</option>
            <option value="nonote">Ohne Geschmacksnotizen</option>
          </select>
        </div>
        <div id="admList"></div>`;
      $('admNew').onclick = ()=> edit(null);
      $('admImport').onclick = ()=> Importer.open();
      $('admNotes').onclick = ()=> Importer.openNotes();
      $('admTeam').onclick = team;
      $('admQ').oninput = e=>{ filter.q = e.target.value; renderList(); };
      $('admMode').onchange = e=>{ filter.mode = e.target.value; renderList(); };
      $('admList').addEventListener('click', e=>{
        const b = e.target.closest('[data-edit]'); if(b) edit(b.dataset.edit);
      });
    }
    $('admList').innerHTML = '<div class="adm-empty">Lädt …</div>';
    await ensureWines(true);
    renderList();
  }

  function renderList(){
    const list = S.wines || [];
    const q = filter.q.trim().toLowerCase();
    const rows = list.filter(w=>{
      if(filter.mode === 'nomap' && w.region_id) return false;
      if(filter.mode === 'inactive' && w.is_active) return false;
      if(filter.mode === 'nonote' && hasNotes(w)) return false;
      if(!q) return true;
      return [w.label, w.producer, w.country, w.region, w.origin_country, w.origin_region, w.site].some(v=> v && String(v).toLowerCase().includes(q));
    });
    const box = $('admList');
    if(!list.length){
      box.innerHTML = '<div class="adm-empty">Noch keine Weine. Importiere eine Weinkarte als PDF oder füge einen Wein hinzu.</div>'; return;
    }
    if(!rows.length){ box.innerHTML = '<div class="adm-empty">Keine Treffer.</div>'; return; }
    box.innerHTML = `<table class="wtable"><thead><tr>
        <th>Wein</th><th>Herkunft</th><th class="num" style="text-align:right">Preis</th><th class="hide-s">Notizen</th><th></th></tr></thead><tbody>`
      + rows.map(w=> `<tr class="${w.is_active ? '' : 'off'}">
          <td>${esc(w.label)}<span class="sub">${esc(w.producer)}${w.is_active ? '' : '<span class="badge">ausgeblendet</span>'}</span></td>
          <td>${originText(w)}</td>
          <td class="num">${fmtPrice(w.price)}</td>
          <td class="hide-s">${hasNotes(w) ? '✓' : '<span class="nonote">–</span>'}</td>
          <td class="act"><button class="btn-s" data-edit="${esc(w.id)}">Bearbeiten</button></td></tr>`).join('')
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

  return { show, reset };
})();
