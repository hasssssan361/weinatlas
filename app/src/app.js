/* ================= APP-RAHMEN: Anmeldung, Restaurantwahl, Tabs ================= */
const $ = id => document.getElementById(id);

const S = {
  restaurants: [], rid: null, role: null, tab: 'map',
  wines: null,          // flache Weinliste (get_wine_list), wird bei Bedarf geladen
  regions: null,        // alle Gebiete (get_regions)
  shapes: null,         // Gebietsflächen (ändern sich nie während der Sitzung)
  atlasDirty: true,
  profile: null
};
const isEditor = () => S.role === 'owner' || S.role === 'editor';
const isOwner  = () => S.role === 'owner';
const ROLE_NAME = { owner: 'Inhaber', editor: 'Bearbeiter', viewer: 'Mitarbeiter' };

/* ---------- Hilfen ---------- */
let toastTimer = null;
function toast(msg, isErr){
  const t = $('toast');
  t.textContent = msg; t.classList.toggle('err', !!isErr); t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(()=> t.classList.remove('show'), isErr ? 6000 : 3000);
}
async function guard(fn, label){
  try{ return await fn(); }
  catch(e){ toast((label ? label + ': ' : '') + (e.message || e), true); return undefined; }
}

const Modal = {
  onClose: null,
  open(eyebrow, title, html, onClose){
    $('mEyebrow').textContent = eyebrow || ''; $('mTitle').textContent = title || '';
    $('mBody').innerHTML = html || '';
    $('mModal').classList.add('show'); $('mBackdrop').classList.add('show');
    Modal.onClose = onClose || null;
    return $('mBody');
  },
  close(){
    $('mModal').classList.remove('show'); $('mBackdrop').classList.remove('show');
    const f = Modal.onClose; Modal.onClose = null; if(f) f();
  },
  get isOpen(){ return $('mModal').classList.contains('show'); }
};
$('mClose').addEventListener('click', Modal.close);
$('mBackdrop').addEventListener('click', Modal.close);
document.addEventListener('keydown', e=>{ if(e.key==='Escape' && Modal.isOpen) Modal.close(); });

function show(id, on){ $(id).hidden = !on; }

/* ---------- Anmeldung ---------- */
function showScreen(which){
  show('screenLogin', which === 'login' || which === 'newpw');
  show('screenApp', which === 'app');
  show('loginForm', which === 'login');
  show('newPwForm', which === 'newpw');
}

$('loginForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const btn = $('loginBtn'), msg = $('loginMsg');
  btn.disabled = true; msg.textContent = ''; msg.classList.remove('err');
  try{
    await Api.signIn($('loginEmail').value.trim(), $('loginPw').value);
    $('loginPw').value = '';
    await startApp();
  }catch(err){ msg.textContent = err.message; msg.classList.add('err'); }
  finally{ btn.disabled = false; }
});
$('forgotBtn').addEventListener('click', async ()=>{
  const email = $('loginEmail').value.trim(), msg = $('loginMsg');
  if(!email){ msg.textContent = 'Bitte oben die E-Mail-Adresse eintragen.'; msg.classList.add('err'); return; }
  try{
    await Api.resetPassword(email);
    msg.classList.remove('err'); msg.textContent = 'Wenn ein Konto existiert, wurde eine E-Mail zum Zurücksetzen gesendet.';
  }catch(err){ msg.textContent = err.message; msg.classList.add('err'); }
});
$('newPwForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const msg = $('newPwMsg');
  try{
    await Api.setPassword($('newPw').value);
    $('newPw').value = '';
    await startApp();
  }catch(err){ msg.textContent = err.message; msg.classList.add('err'); }
});

/* ---------- Konto-Menü ---------- */
$('userBtn').addEventListener('click', ()=>{
  const body = Modal.open('Konto', S.profile && S.profile.display_name ? S.profile.display_name : (Api.user && Api.user.email), `
    <p class="m-note" style="margin-top:0">${esc(Api.user && Api.user.email)} · ${esc(ROLE_NAME[S.role] || '')}</p>
    <label class="m-label">Anzeigename (für die Bestenliste)
      <input class="m-field" id="acName" maxlength="40" value="${esc(S.profile && S.profile.display_name || '')}">
    </label>
    <label class="m-label">Neues Passwort (leer lassen = unverändert)
      <input class="m-field" type="password" id="acPw" minlength="8" autocomplete="new-password">
    </label>
    <div class="m-actions">
      <button class="m-btn secondary" id="acOut">Abmelden</button>
      <button class="m-btn" id="acSave">Speichern</button>
    </div>
    <div class="m-status" id="acMsg"></div>
    <div class="s-sub">Datenschutz</div>
    <p class="m-note" style="margin-top:0">Gespeichert werden E-Mail, Anzeigename, Lernfortschritt und Quiz-Ergebnisse. Die Funktion „PDF auslesen“ sendet das hochgeladene PDF zur Auswertung an einen KI-Dienst (Anthropic); sie wird nur von Inhabern und Bearbeitern ausgelöst.</p>
    <div class="m-actions" style="justify-content:flex-start">
      <button class="m-btn secondary" id="acExport">Meine Daten herunterladen</button>
      <button class="m-btn secondary" id="acDelete" style="color:#e08a96">Konto löschen</button>
    </div>`);
  $('acExport').onclick = async ()=>{
    const msg = $('acMsg'); msg.classList.remove('err'); msg.textContent = '';
    try{
      const d = await Api.rpc('export_my_data', {});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }));
      a.download = 'weinatlas-meine-daten.json'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=> URL.revokeObjectURL(a.href), 2000);
    }catch(err){ msg.textContent = err.message; msg.classList.add('err'); }
  };
  $('acDelete').onclick = async ()=>{
    const msg = $('acMsg'); msg.classList.remove('err'); msg.textContent = '';
    if(!confirm('Konto endgültig löschen? Dein Lernfortschritt und deine Ergebnisse werden gelöscht. Das kann nicht rückgängig gemacht werden.')) return;
    try{ await Api.rpc('delete_my_account', {}); Modal.close(); Api.signOut(); }
    catch(err){ msg.textContent = err.message; msg.classList.add('err'); }
  };
  $('acOut').onclick = ()=>{ Modal.close(); Api.signOut(); };
  $('acSave').onclick = async ()=>{
    const msg = $('acMsg'); msg.classList.remove('err'); msg.textContent = '';
    try{
      const nm = $('acName').value.trim();
      if(nm && nm !== (S.profile && S.profile.display_name)){ await Api.rpc('set_display_name', { p_name: nm }); S.profile = { display_name: nm }; updateUserBtn(); }
      const pw = $('acPw').value;
      if(pw){ if(pw.length < 8) throw new Error('Das Passwort braucht mindestens 8 Zeichen.'); await Api.setPassword(pw); }
      Modal.close(); toast('Gespeichert.');
    }catch(err){ msg.textContent = err.message; msg.classList.add('err'); }
  };
});
function updateUserBtn(){
  $('userBtn').textContent = (S.profile && S.profile.display_name) || (Api.user && Api.user.email) || 'Konto';
}

/* ---------- Start ---------- */
async function startApp(){
  S.tab = 'map';
  showScreen('app');
  Learn.reset(); Admin.reset(); Search.reset();
  S.wines = null; S.regions = null; S.shapes = null; S.atlasDirty = true;
  const [list, prof] = await Promise.all([
    guard(()=> Api.rpc('get_my_restaurants'), 'Restaurants laden'),
    Api.rpc('get_my_profile').catch(()=> null)
  ]);
  S.profile = prof; updateUserBtn();
  S.restaurants = list || [];
  if(!S.restaurants.length){ renderNoRestaurant(); return; }
  fillRestSelect();
  let last = null; try{ last = localStorage.getItem('weinatlas_rest'); }catch(e){}
  await selectRestaurant(S.restaurants.some(r=> r.id === last) ? last : S.restaurants[0].id);
}

function fillRestSelect(){
  const sel = $('restSelect');
  sel.innerHTML = S.restaurants.map(r=> `<option value="${esc(r.id)}">${esc(r.name)}${r.city ? ' · ' + esc(r.city) : ''}</option>`).join('');
  sel.hidden = S.restaurants.length < 2;
  sel.value = S.rid || S.restaurants[0].id;
}
$('restSelect').addEventListener('change', e=> selectRestaurant(e.target.value));

function renderNoRestaurant(){
  ['viewMap','viewSearch','viewLearn','viewAdmin'].forEach(id=> show(id, false));
  $('tabs').hidden = true; $('restSelect').hidden = true;
  let box = $('noRest');
  if(!box){
    box = document.createElement('section'); box.id = 'noRest'; box.className = 'wrap narrow';
    $('screenApp').querySelector('main').appendChild(box);
  }
  box.hidden = false;
  box.innerHTML = `<div class="card" style="margin-top:40px">
    <h3>Noch kein Restaurant</h3>
    <p class="l-sub">Dein Konto ist noch keinem Restaurant zugeordnet. Frag den Inhaber deines Restaurants, dich unter „Verwalten → Team“ hinzuzufügen,
    oder lege ein neues Restaurant an.</p>
    <div class="m-grid">
      <label class="m-label">Name<input class="m-field" id="nrName" maxlength="60"></label>
      <label class="m-label">Ort<input class="m-field" id="nrCity" maxlength="40"></label>
    </div>
    <div class="m-actions"><button class="m-btn" id="nrGo">Restaurant anlegen</button></div>
  </div>`;
  $('nrGo').onclick = ()=> guard(async ()=>{
    const name = $('nrName').value.trim();
    if(!name) throw new Error('Bitte einen Namen eintragen.');
    await Api.rpc('create_restaurant', { p_name: name, p_city: $('nrCity').value.trim() || null });
    box.hidden = true; $('tabs').hidden = false;
    await startApp();
  });
}

async function selectRestaurant(rid){
  const nr = $('noRest'); if(nr) nr.hidden = true;
  $('tabs').hidden = false;
  S.rid = rid;
  const r = S.restaurants.find(x=> x.id === rid);
  S.role = r.role;
  try{ localStorage.setItem('weinatlas_rest', rid); }catch(e){}
  $('restSelect').value = rid;
  $('tabAdmin').hidden = !isEditor();
  S.wines = null; S.atlasDirty = true;
  Learn.reset(); Admin.reset(); Search.reset();
  const title = r.city ? `${r.name}` : r.name;
  $('mapTitle').textContent = 'Der Weinatlas';
  $('subtitle').textContent = `Die Weinkarte von ${title}: jedes Land führt zu seinen Anbaugebieten auf einer Landkarte, jedes Gebiet zu den Erzeugern und Weinen der Karte.`;
  $('footerText').textContent = `${r.name}${r.city ? ' ' + r.city : ''} · Jahrgangs- und Preisänderungen vorbehalten`;
  if(!isEditor() && S.tab === 'admin') S.tab = 'map';
  await switchTab(S.tab, true);
}

/* ---------- Karte laden ---------- */
async function loadAtlas(){
  const rid = S.rid, r = S.restaurants.find(x=> x.id === rid);
  const [data, shapes, extra] = await Promise.all([
    Api.rpc('get_atlas_data', { p_restaurant: rid }),
    S.shapes ? Promise.resolve(S.shapes) : Api.rpc('get_shapes'),
    Api.rpc('get_extra_origins', { p_restaurant: rid })
  ]);
  if(rid !== S.rid) return;      // Restaurant wurde inzwischen gewechselt
  S.shapes = shapes;
  Atlas.load(data, shapes, { name: r.name, city: r.city || '' });
  renderExtra(extra || []);
  const empty = !Object.keys(data || {}).length && !(extra || []).length;
  $('emptyMap').hidden = !empty;
  $('emptyMap').textContent = isEditor() ? 'Diese Weinkarte ist noch leer. Unter „Verwalten“ kannst du eine Weinkarte als PDF importieren oder Weine einzeln hinzufügen.' : 'Diese Weinkarte ist noch leer.';
  S.atlasDirty = false;
}

function renderExtra(rows){
  const box = $('extraOrigins');
  if(!rows.length){ box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  const byLand = {};
  rows.forEach(w=> (byLand[w.land || 'Sonstige'] = byLand[w.land || 'Sonstige'] || []).push(w));
  let html = `<h2 id="extraTitle">Weitere Herkunft</h2><p class="extra-lead">${rows.length === 1 ? '1 Wein liegt' : rows.length + ' Weine liegen'} in Ländern bzw. Gebieten, für die es (noch) keine Karte gibt.</p>`;
  Object.keys(byLand).forEach(l=>{
    html += `<h3>${esc(l)}</h3>`;
    byLand[l].forEach(w=>{
      html += `<div class="ex-prod">${esc(w.e)}<span class="ex-region">${esc(w.gebiet || '')}</span></div>`
        + `<div class="wine-row"><span class="wine-label">${esc(w.w)}</span><span class="wine-dots"></span><span class="wine-price">${fmtPrice(w.p)}</span></div>`;
    });
  });
  box.innerHTML = html;
}

/* ---------- Daten für Verwalten/Lernen ---------- */
async function ensureWines(force){
  if(S.wines && !force) return S.wines;
  S.wines = await Api.rpc('get_wine_list', { p_restaurant: S.rid });
  return S.wines;
}
async function ensureRegions(force){
  if(S.regions && !force) return S.regions;
  S.regions = await Api.rpc('get_regions');
  return S.regions;
}
/* Nach Änderungen an Weinen: Listen neu laden, Karte beim nächsten Besuch neu aufbauen */
function winesChanged(){ S.wines = null; S.atlasDirty = true; }

/* ---------- Tabs ---------- */
async function switchTab(tab, force){
  if(tab === 'admin' && !isEditor()) tab = 'map';
  S.tab = tab;
  document.querySelectorAll('#tabs button').forEach(b=> b.classList.toggle('active', b.dataset.tab === tab));
  show('viewMap', tab === 'map'); show('viewSearch', tab === 'search'); show('viewLearn', tab === 'learn'); show('viewAdmin', tab === 'admin');
  window.scrollTo(0, 0);
  if(tab !== 'map') Atlas.reset();
  if(tab === 'map' && S.atlasDirty) await guard(loadAtlas, 'Karte laden');
  if(tab === 'search') await guard(()=> Search.show(), 'Suche');
  if(tab === 'learn') await guard(()=> Learn.show(), 'Lernen');
  if(tab === 'admin') await guard(()=> Admin.show(), 'Verwalten');
}
$('tabs').addEventListener('click', e=>{
  const b = e.target.closest('button[data-tab]'); if(b) switchTab(b.dataset.tab);
});

/* ---------- Start der Seite ---------- */
Api.onChange(sess=>{
  if(sess) return;
  /* Abgemeldet: alle Daten aus dem Speicher und von der Seite entfernen */
  S.restaurants = []; S.rid = null; S.role = null; S.wines = null; S.regions = null; S.shapes = null; S.profile = null; S.tab = 'map';
  Atlas.load({}, {}, { name: '', city: '' }); renderExtra([]);
  Learn.reset(); Admin.reset(); Search.reset(); Modal.close();
  showScreen('login');
});
(async function boot(){
  Api.init();
  const type = await Api.adoptHash();
  if(type === 'recovery'){ showScreen('newpw'); return; }
  if(Api.session){
    try{ await startApp(); return; }
    catch(e){ /* fällt auf Anmeldung zurück */ }
  }
  showScreen('login');
})();
