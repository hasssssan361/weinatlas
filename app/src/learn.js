/* ================= LERNEN: Karteikarten, Quiz, Nachschlagen, Bestenliste ================= */
const Learn = (function(){
  let wines = [], st = {};      // wines: aktive Weine; st: wine_id -> {box, due_at, seen, correct}
  const ROUND = 10;

  const root = ()=> $('viewLearn');
  const shuffle = a=>{ a = a.slice(); for(let i = a.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const wineName = w=> `${w.producer} – ${w.label}`;
  const originOf = w=> w.region ? `${w.country} · ${w.region}` : (w.origin_country ? `${w.origin_country}${w.origin_region ? ' · ' + w.origin_region : ''}` : '');
  const hasTaste = w=> w.notes && (w.notes.aroma || w.notes.taste);
  const hasPairing = w=> w.notes && w.notes.pairing;

  function reset(){ wines = []; st = {}; root().innerHTML = ''; }

  async function load(){
    const [list, state] = await Promise.all([ ensureWines(true), Api.rpc('get_learn_state', { p_restaurant: S.rid }) ]);
    await loadTasks();
    wines = list.filter(w=> w.is_active);
    st = {}; (state || []).forEach(s=> st[s.wine_id] = s);
  }

  async function show(){
    root().innerHTML = '<div class="adm-empty">Lädt …</div>';
    await load();
    menu();
    if(!S.profile && !nameAsked){ nameAsked = true; askName(); }
  }

  /* Beim ersten Besuch nach einem Anzeigenamen für die Bestenliste fragen (überspringbar) */
  let nameAsked = false;
  function askName(){
    Modal.open('Bestenliste', 'Wie sollen dich die Kollegen sehen?', `
      <p class="m-note" style="margin-top:0">Dein Name erscheint in der Bestenliste deines Restaurants (nie deine E-Mail-Adresse).</p>
      <label class="m-label">Anzeigename<input class="m-field" id="dnName" maxlength="40" placeholder="z. B. Anna"></label>
      <div class="m-actions"><button class="m-btn secondary" id="dnSkip">Später</button><button class="m-btn" id="dnSave">Speichern</button></div>
      <div class="m-status err" id="dnErr"></div>`);
    $('dnSkip').onclick = Modal.close;
    $('dnSave').onclick = async ()=>{
      const nm = $('dnName').value.trim();
      if(!nm) return $('dnErr').textContent = 'Bitte einen Namen eintragen.';
      try{ await Api.rpc('set_display_name', { p_name: nm }); S.profile = { display_name: nm }; updateUserBtn(); Modal.close(); }
      catch(e){ $('dnErr').textContent = e.message; }
    };
  }

  /* ---------- Menü ---------- */
  function stats(){
    const now = Date.now();
    const ids = new Set(wines.map(w=> w.id));
    const mine = Object.values(st).filter(s=> ids.has(s.wine_id));
    const due = wines.filter(w=> !st[w.id] || new Date(st[w.id].due_at).getTime() <= now).length;
    const mastered = mine.filter(s=> s.box >= 4).length;
    const seen = mine.reduce((a, s)=> a + s.seen, 0), ok = mine.reduce((a, s)=> a + s.correct, 0);
    return { total: wines.length, due, mastered, acc: seen ? Math.round(ok / seen * 100) : null, started: mine.length };
  }

  function menu(){
    const s = stats();
    const regions = new Set(wines.map(w=> originOf(w)).filter(Boolean)).size;
    const producers = new Set(wines.map(w=> w.producer)).size;
    const nTaste = wines.filter(hasTaste).length, nPair = wines.filter(hasPairing).length;
    const tile = (id, t, d, n, ok)=> `<button class="l-tile" data-go="${id}" ${ok ? '' : 'disabled'}><span class="t">${t}</span><span class="d">${d}</span><span class="n">${n}</span></button>`;
    root().innerHTML = `
      <div class="l-head"><h2>Wein-Training</h2><div class="l-sub">Lerne die Weinkarte von ${esc(S.restaurants.find(r=> r.id === S.rid).name)} Schritt für Schritt.</div></div>
      <div class="l-stats">
        <div class="l-stat"><b>${s.total}</b><span>Weine</span></div>
        <div class="l-stat"><b>${s.mastered}</b><span>sicher gelernt</span></div>
        <div class="l-stat"><b>${s.due}</b><span>heute dran</span></div>
        <div class="l-stat"><b>${s.acc == null ? '–' : s.acc + ' %'}</b><span>Trefferquote</span></div>
      </div>
      <div class="l-bar"><i style="width:${s.total ? Math.round(s.mastered / s.total * 100) : 0}%"></i></div>
      <div class="l-menu">
        ${myTasks.length ? tile('tasks', 'Meine Aufgaben', 'Von der Geschäftsführung zugewiesene Lernziele.', openTasks().length + ' offen', true) : ''}
        ${tile('cards', 'Karteikarten', 'Wiederholt mit System: was du kannst, kommt seltener, was nicht, öfter.', s.due + ' fällig', wines.length > 0)}
        ${tile('quiz-origin', 'Woher kommt der Wein?', 'Ordne Weine ihrem Anbaugebiet zu.', regions + ' Herkünfte', regions >= 4)}
        ${tile('quiz-producer', 'Wer macht den Wein?', 'Ordne Weine ihrem Erzeuger zu.', producers + ' Erzeuger', producers >= 4)}
        ${tile('quiz-taste', 'Blind-Verkostung', 'Aus Aromen und Geschmack den Wein erraten.', nTaste + ' Weine mit Notizen', nTaste >= 4)}
        ${tile('quiz-pair', 'Passt zu …', 'Welcher Wein passt zum Gericht?', nPair + ' Weine mit Pairing', nPair >= 4)}
        ${tile('lookup', 'Nachschlagen', 'Suche nach Wein, Erzeuger oder Gebiet.', wines.length + ' Weine', wines.length > 0)}
        ${tile('board', 'Bestenliste', 'Wer im Team hat in den letzten 30 Tagen am meisten gelernt?', '', true)}
      </div>
      ${(nTaste < 4 || nPair < 4) ? `<p class="l-sub" style="text-align:center">Blind-Verkostung und „Passt zu …“ brauchen Geschmacksnotizen (mind. 4 Weine). ${isEditor() ? 'Du kannst sie unter „Verwalten“ bei jedem Wein ergänzen.' : ''}</p>` : ''}`;
    root().querySelectorAll('[data-go]').forEach(b=> b.onclick = ()=> go(b.dataset.go));
  }

  function go(id){
    if(id === 'tasks') return tasksView();
    if(id === 'cards') return cards();
    if(id === 'quiz-origin') return quiz('origin');
    if(id === 'quiz-producer') return quiz('producer');
    if(id === 'quiz-taste') return quiz('taste');
    if(id === 'quiz-pair') return quiz('pair');
    if(id === 'lookup') return lookup();
    if(id === 'board') return board();
  }

  const top = (title, prog)=> `<div class="l-top"><button class="btn-s" id="lBack">← Menü</button><div class="grow"></div><div class="l-prog">${prog || ''}</div></div>`;
  const backToMenu = async ()=>{ await load().catch(()=>{}); menu(); };
  const bindBack = ()=>{ const b = $('lBack'); if(b) b.onclick = backToMenu; };

  async function record(w, correct){
    try{
      const r = await Api.rpc('learn_record', { p_wine: w.id, p_correct: correct });
      st[w.id] = Object.assign(st[w.id] || { wine_id: w.id, seen: 0, correct: 0 }, r, { seen: ((st[w.id] || {}).seen || 0) + 1, correct: ((st[w.id] || {}).correct || 0) + (correct ? 1 : 0) });
    }catch(e){ toast('Fortschritt konnte nicht gespeichert werden: ' + e.message, true); }
  }
  async function logScore(mode, score, total){
    try{ await Api.rpc('log_score', { p_restaurant: S.rid, p_mode: mode, p_score: score, p_total: total }); }
    catch(e){ toast('Punkte konnten nicht gespeichert werden: ' + e.message, true); }
  }

  function result(mode, score, total, again){
    const pct = Math.round(score / total * 100);
    root().innerHTML = top() + `<div class="l-result card"><div class="big">${score} / ${total}</div>
      <p>${pct >= 90 ? 'Hervorragend!' : pct >= 70 ? 'Sehr gut!' : pct >= 50 ? 'Ordentlich — weiter üben!' : 'Noch Luft nach oben — bleib dran!'}</p>
      <div class="l-actions"><button class="m-btn" id="lAgain">Noch eine Runde</button><button class="m-btn secondary" id="lMenu">Zum Menü</button></div></div>`;
    bindBack(); $('lAgain').onclick = again; $('lMenu').onclick = backToMenu;
    logScore(mode, score, total);
  }


  /* ---------- Meine Aufgaben ---------- */
  let myTasks = [];
  async function loadTasks(){
    try{ myTasks = await Api.rpc('get_my_tasks', { p_restaurant: S.rid }) || []; }catch(e){ myTasks = []; }
  }
  const openTasks = ()=> myTasks.filter(t=> !t.completed_at);

  async function tasksView(){
    root().innerHTML = top() + '<div class="adm-empty">Lädt …</div>'; bindBack();
    await loadTasks();
    const fmt = d=> d ? new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'ohne Frist';
    root().innerHTML = top() + `<div class="l-head"><h2>Meine Aufgaben</h2><div class="l-sub">Von der Geschäftsführung zugewiesen</div></div>
      ${myTasks.length ? myTasks.map(t=>{
        const done = t.wines.filter(w=> w.done).length, late = t.due_at && !t.completed_at && new Date(t.due_at).getTime() < Date.now();
        return `<div class="l-item" data-task="${esc(t.id)}" style="cursor:pointer"><div class="nm">${esc(t.title)} ${t.completed_at ? '<span class="badge" style="color:#8fcf9d;border-color:#4f8a5c">erledigt</span>' : ''}</div>
          <div class="mt">Frist ${esc(fmt(t.due_at))}${late ? ' · <span style="color:#e08a96">überfällig</span>' : ''} · ${done} von ${t.wines.length} Weinen gelernt</div>
          ${t.description ? `<div class="mt">${esc(t.description)}</div>` : ''}
          <div class="l-bar"><i style="width:${t.wines.length ? Math.round(done / t.wines.length * 100) : 0}%"></i></div></div>`;
      }).join('') : '<div class="adm-empty">Keine Aufgaben zugewiesen.</div>'}`;
    bindBack();
    root().querySelectorAll('[data-task]').forEach(el=> el.onclick = ()=> runTask(myTasks.find(t=> t.id === el.dataset.task)));
  }

  /* Eine Runde: jeder noch nicht gelernte Wein der Aufgabe wird einmal abgefragt (Herkunft, sonst Erzeuger, sonst Karteikarte). */
  function runTask(task){
    const byId = {}; wines.forEach(w=> byId[w.id] = w);
    const todo = shuffle(task.wines.filter(w=> !w.done && byId[w.id]));
    if(!todo.length){ toast('Alle Weine dieser Aufgabe sind gelernt.'); return tasksView(); }
    const origins = [...new Set(wines.map(originOf).filter(Boolean))], prods = [...new Set(wines.map(w=> w.producer))];
    let i = 0, right = 0;
    const record2 = async (w, ok)=>{
      await record(w, ok);
      try{ await Api.rpc('task_record', { p_task: task.id, p_wine: w.id, p_correct: ok }); }catch(e){ toast('Aufgabe: ' + e.message, true); }
    };
    const next = ()=>{
      if(i >= todo.length){
        root().innerHTML = top() + `<div class="l-result card"><div class="big">${right} / ${todo.length}</div>
          <p>${right === todo.length ? 'Alle richtig!' : 'Falsch beantwortete Weine kommen in der nächsten Runde wieder dran.'}</p>
          <div class="l-actions"><button class="m-btn" id="tkAgain">Nächste Runde</button><button class="m-btn secondary" id="tkBack">Zu den Aufgaben</button></div></div>`;
        bindBack(); logScore('aufgabe', right, todo.length);
        $('tkBack').onclick = tasksView;
        $('tkAgain').onclick = async ()=>{ await loadTasks(); const t = myTasks.find(x=> x.id === task.id); t && !t.completed_at ? runTask(t) : tasksView(); };
        return;
      }
      const tw = todo[i], w = byId[tw.id];
      let q = null;
      if(originOf(w) && origins.length >= 4){
        const right_ = originOf(w);
        q = { prompt: 'Woher kommt dieser Wein?', q: wineName(w), right: right_, opts: shuffle([right_].concat(shuffle(origins.filter(x=> x !== right_)).slice(0, 3))) };
      }else if(prods.length >= 4){
        q = { prompt: 'Wer hat diesen Wein gemacht?', q: w.label, right: w.producer, opts: shuffle([w.producer].concat(shuffle(prods.filter(x=> x !== w.producer)).slice(0, 3))) };
      }
      const head = top('', `${task.title} · ${i + 1} / ${todo.length}`);
      if(!q){   // Karteikarte
        root().innerHTML = head + `<div class="l-card"><div class="qs">Kennst du diesen Wein?</div><div class="q">${esc(w.label)}</div><div class="l-sub">${esc(w.producer)}</div>
          <div class="ans" id="lAns" hidden><dl><dt>Herkunft</dt><dd>${esc(originOf(w)) || '–'}</dd><dt>Preis</dt><dd>${fmtPrice(w.price)}</dd></dl></div></div>
          <div class="l-actions" id="lAct"><button class="m-btn" id="lFlip">Antwort zeigen</button></div>`;
        bindBack();
        $('lFlip').onclick = ()=>{ $('lAns').hidden = false; $('lAct').innerHTML = '<button class="m-btn secondary" id="lNo">Nicht gewusst</button><button class="m-btn" id="lYes">Gewusst</button>';
          const ans = async ok=>{ $('lNo').disabled = $('lYes').disabled = true; if(ok) right++; await record2(w, ok); i++; next(); };
          $('lNo').onclick = ()=> ans(false); $('lYes').onclick = ()=> ans(true); };
        return;
      }
      root().innerHTML = head + `<div class="l-card"><div class="qs">${esc(q.prompt)}</div><div class="q">${esc(q.q)}</div></div>
        <div class="l-opts">${q.opts.map((o, k)=> `<button class="l-opt" data-k="${k}">${esc(o)}</button>`).join('')}</div><div class="l-actions" id="lNext"></div>`;
      bindBack();
      root().querySelectorAll('.l-opt').forEach(b=> b.onclick = ()=>{
        const ok = q.opts[b.dataset.k] === q.right;
        root().querySelectorAll('.l-opt').forEach(x=>{ x.disabled = true; if(q.opts[x.dataset.k] === q.right) x.classList.add('right'); });
        if(!ok) b.classList.add('wrong'); else right++;
        $('lNext').innerHTML = '<button class="m-btn" id="lGo">' + (i + 1 < todo.length ? 'Weiter' : 'Ergebnis') + '</button>';
        const done = record2(w, ok);
        $('lGo').onclick = async ()=>{ await done; i++; next(); };
      });
    };
    next();
  }

  /* ---------- Karteikarten (Leitner) ---------- */
  function pickDue(){
    const now = Date.now();
    const due = wines.filter(w=> st[w.id] && new Date(st[w.id].due_at).getTime() <= now)
      .sort((a, b)=> new Date(st[a.id].due_at) - new Date(st[b.id].due_at));
    const fresh = shuffle(wines.filter(w=> !st[w.id]));
    return due.concat(fresh).slice(0, ROUND);
  }

  function cards(){
    const deck = pickDue();
    if(!deck.length){
      root().innerHTML = top() + `<div class="l-result card"><div class="big">✓</div><p>Heute ist nichts mehr fällig. Probier ein Quiz!</p></div>`;
      return bindBack();
    }
    let i = 0, right = 0;
    const next = ()=>{
      if(i >= deck.length) return result('karten', right, deck.length, ()=> cards());
      const w = deck[i], n = w.notes || {};
      root().innerHTML = top('', `Karte ${i + 1} / ${deck.length}`) + `
        <div class="l-card" id="lCard">
          <div class="qs">Was weißt du über diesen Wein?</div>
          <div class="q">${esc(w.label)}</div>
          <div class="l-sub">${esc(w.producer)}</div>
          <div class="ans" id="lAns" hidden>
            <dl><dt>Herkunft</dt><dd>${esc(originOf(w)) || '–'}</dd>
            <dt>Preis</dt><dd>${fmtPrice(w.price)}</dd>
            ${n.aroma ? `<dt>Aromen</dt><dd>${esc(n.aroma)}</dd>` : ''}
            ${n.taste ? `<dt>Geschmack</dt><dd>${esc(n.taste)}</dd>` : ''}
            ${n.pairing ? `<dt>Passt zu</dt><dd>${esc(n.pairing)}</dd>` : ''}</dl>
          </div>
        </div>
        <div class="l-actions" id="lAct"><button class="m-btn" id="lFlip">Antwort zeigen</button></div>`;
      bindBack();
      $('lFlip').onclick = ()=>{
        $('lAns').hidden = false;
        $('lAct').innerHTML = '<button class="m-btn secondary" id="lNo">Nicht gewusst</button><button class="m-btn" id="lYes">Gewusst</button>';
        const answer = async ok=>{
          $('lNo').disabled = $('lYes').disabled = true;
          if(ok) right++;
          await record(w, ok); i++; next();
        };
        $('lNo').onclick = ()=> answer(false); $('lYes').onclick = ()=> answer(true);
      };
    };
    next();
  }

  /* ---------- Quiz ---------- */
  function buildQuestions(kind){
    let pool, qs = [];
    if(kind === 'origin'){
      pool = wines.filter(w=> originOf(w));
      const all = [...new Set(pool.map(originOf))];
      shuffle(pool).slice(0, ROUND).forEach(w=>{
        const right = originOf(w);
        const opts = shuffle([right].concat(shuffle(all.filter(x=> x !== right)).slice(0, 3)));
        qs.push({ w, prompt: 'Woher kommt dieser Wein?', q: wineName(w), opts, right });
      });
    }else if(kind === 'producer'){
      pool = wines;
      const all = [...new Set(pool.map(w=> w.producer))];
      shuffle(pool).slice(0, ROUND).forEach(w=>{
        const opts = shuffle([w.producer].concat(shuffle(all.filter(x=> x !== w.producer)).slice(0, 3)));
        qs.push({ w, prompt: 'Wer hat diesen Wein gemacht?', q: w.label + ' (' + originOf(w) + ')', opts, right: w.producer });
      });
    }else{
      pool = wines.filter(kind === 'taste' ? hasTaste : hasPairing);
      shuffle(pool).slice(0, ROUND).forEach(w=>{
        const n = w.notes;
        const q = kind === 'taste'
          ? [n.aroma && 'Aromen: ' + n.aroma, n.taste && 'Geschmack: ' + n.taste].filter(Boolean).join('\n')
          : n.pairing;
        const others = shuffle(wines.filter(x=> x.id !== w.id && wineName(x) !== wineName(w))).slice(0, 3).map(wineName);
        qs.push({ w, prompt: kind === 'taste' ? 'Welcher Wein ist das?' : 'Welcher Wein passt zu:', q, opts: shuffle([wineName(w)].concat(others)), right: wineName(w) });
      });
    }
    return qs;
  }

  function quiz(kind){
    const qs = buildQuestions(kind);
    if(!qs.length){ toast('Dafür gibt es noch nicht genug Daten.', true); return; }
    let i = 0, score = 0;
    const next = ()=>{
      if(i >= qs.length) return result('quiz-' + kind, score, qs.length, ()=> quiz(kind));
      const Q = qs[i];
      root().innerHTML = top('', `Frage ${i + 1} / ${qs.length}`) + `
        <div class="l-card"><div class="qs">${esc(Q.prompt)}</div><div class="q" style="white-space:pre-line">${esc(Q.q)}</div></div>
        <div class="l-opts">${Q.opts.map((o, k)=> `<button class="l-opt" data-k="${k}">${esc(o)}</button>`).join('')}</div>
        <div class="l-actions" id="lNext"></div>`;
      bindBack();
      root().querySelectorAll('.l-opt').forEach(b=> b.onclick = async ()=>{
        const ok = Q.opts[b.dataset.k] === Q.right;
        root().querySelectorAll('.l-opt').forEach(x=>{ x.disabled = true; if(Q.opts[x.dataset.k] === Q.right) x.classList.add('right'); });
        if(!ok) b.classList.add('wrong');
        if(ok) score++;
        $('lNext').innerHTML = '<button class="m-btn" id="lGo">' + (i + 1 < qs.length ? 'Weiter' : 'Ergebnis') + '</button>';
        const done = record(Q.w, ok);
        $('lGo').onclick = async ()=>{ await done; i++; next(); };
      });
    };
    next();
  }

  /* ---------- Nachschlagen ---------- */
  function lookup(){
    root().innerHTML = top() + `<input class="l-search" id="lQ" type="search" placeholder="Wein, Erzeuger, Gebiet, Rebsorte …" autofocus><div id="lRes"></div>`;
    bindBack();
    const draw = ()=>{
      const q = $('lQ').value.trim().toLowerCase();
      const rows = wines.filter(w=> !q || [w.label, w.producer, originOf(w), w.site, w.notes && w.notes.aroma, w.notes && w.notes.taste].some(v=> v && String(v).toLowerCase().includes(q))).slice(0, 60);
      $('lRes').innerHTML = rows.length ? rows.map(w=>{
        const n = w.notes || {};
        return `<div class="l-item"><div class="nm">${esc(w.label)}</div><div class="mt">${esc(w.producer)} · ${esc(originOf(w))} · ${fmtPrice(w.price)}</div>
          <div class="dt">${n.aroma ? `<b>Aromen:</b> ${esc(n.aroma)}<br>` : ''}${n.taste ? `<b>Geschmack:</b> ${esc(n.taste)}<br>` : ''}${n.pairing ? `<b>Passt zu:</b> ${esc(n.pairing)}` : ''}${(n.aroma || n.taste || n.pairing) ? '' : '<span class="l-sub">Noch keine Geschmacksnotizen hinterlegt.</span>'}</div></div>`;
      }).join('') : '<div class="adm-empty">Keine Treffer.</div>';
    };
    $('lQ').oninput = draw; draw();
    $('lRes').onclick = e=>{ const it = e.target.closest('.l-item'); if(it) it.classList.toggle('open'); };
  }

  /* ---------- Bestenliste ---------- */
  async function board(){
    root().innerHTML = top() + '<div class="adm-empty">Lädt …</div>';
    bindBack();
    let rows;
    try{ rows = await Api.rpc('get_leaderboard', { p_restaurant: S.rid, p_days: 30 }); }
    catch(e){ root().innerHTML = top() + `<div class="m-status err">${esc(e.message)}</div>`; return bindBack(); }
    root().innerHTML = top() + `<div class="l-head"><h2>Bestenliste</h2><div class="l-sub">Punkte der letzten 30 Tage (1 Punkt je richtiger Antwort)</div></div>
      <div class="card">${rows.length ? rows.map((r, i)=> `<div class="lb-row ${r.is_me ? 'me' : ''}"><span class="rk">${i + 1}.</span>
        <span class="nm">${esc(r.name)}${r.is_me ? ' (du)' : ''}<div class="sm">${r.quizzes} Runden · ${r.mastered} Weine sicher</div></span><span class="pt">${r.points}</span></div>`).join('') : '<div class="adm-empty">Noch keine Punkte.</div>'}</div>
      <p class="l-sub" style="text-align:center">Den Anzeigenamen änderst du oben rechts im Konto-Menü.</p>`;
    bindBack();
  }

  return { show, reset };
})();
