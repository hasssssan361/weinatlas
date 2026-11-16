/* ================= SUPABASE-ANBINDUNG (ohne Fremdbibliothek) =================
   Spricht die Supabase-REST-Schnittstelle direkt an: Anmeldung (E-Mail + Passwort),
   Sitzung erneuern, Funktionsaufrufe (RPC). Der "publishable"/anon-Key ist öffentlich gedacht;
   geschützt werden die Daten durch die Zugriffsregeln (RLS) in der Datenbank. */
const CONFIG = window.WEINATLAS_CONFIG || {
  url: 'https://txtmyvmpxtnxuyyflaws.supabase.co',
  key: 'sb_publishable_fn5EB2pjYPOhsYt92L3iQg_sBDceD-n'
};

const Api = (function(){
  const LS = 'weinatlas_session_v2';
  let session = null;        // { access_token, refresh_token, expires_at, user:{id,email} }
  let refreshing = null;
  const listeners = [];

  function save(){ try{ session ? localStorage.setItem(LS, JSON.stringify(session)) : localStorage.removeItem(LS); }catch(e){} }
  function load(){ try{ session = JSON.parse(localStorage.getItem(LS) || 'null'); }catch(e){ session = null; } }
  function emit(){ listeners.forEach(f=> { try{ f(session); }catch(e){} }); }

  function errMsg(j, status){
    const m = (j && (j.message || j.msg || j.error_description || j.error)) || '';
    if(/Invalid login credentials/i.test(m)) return 'E-Mail oder Passwort stimmt nicht.';
    if(/Email not confirmed/i.test(m)) return 'Die E-Mail-Adresse ist noch nicht bestätigt.';
    if(/rate limit|too many/i.test(m)) return 'Zu viele Versuche. Bitte kurz warten.';
    if(/JWT expired/i.test(m)) return 'Die Sitzung ist abgelaufen. Bitte neu anmelden.';
    return m || ('Fehler ' + status);
  }

  async function authCall(path, body, method, withToken){
    const headers = { 'apikey': CONFIG.key, 'content-type': 'application/json' };
    if(withToken && session) headers['authorization'] = 'Bearer ' + session.access_token;
    let res;
    try{ res = await fetch(CONFIG.url + path, { method: method || 'POST', headers, body: JSON.stringify(body) }); }
    catch(e){ throw new Error('Keine Verbindung zum Server. Internet prüfen.'); }
    let j = null; try{ j = await res.json(); }catch(e){}
    if(!res.ok) throw new Error(errMsg(j, res.status));
    return j;
  }

  function setSession(j){
    session = {
      access_token: j.access_token, refresh_token: j.refresh_token,
      expires_at: Date.now() + (j.expires_in || 3600) * 1000,
      user: { id: j.user && j.user.id, email: j.user && j.user.email }
    };
    save(); emit();
  }

  async function refresh(){
    if(!session) throw new Error('Nicht angemeldet.');
    if(!refreshing){
      refreshing = authCall('/auth/v1/token?grant_type=refresh_token', { refresh_token: session.refresh_token })
        .then(setSession)
        .catch(e=>{ session = null; save(); emit(); throw new Error('Die Sitzung ist abgelaufen. Bitte neu anmelden.'); })
        .finally(()=>{ refreshing = null; });
    }
    return refreshing;
  }

  async function rpc(fn, args){
    if(!session) throw new Error('Nicht angemeldet.');
    if(session.expires_at - Date.now() < 60000) await refresh();
    let res;
    try{
      res = await fetch(CONFIG.url + '/rest/v1/rpc/' + fn, {
        method: 'POST',
        headers: { 'apikey': CONFIG.key, 'authorization': 'Bearer ' + session.access_token, 'content-type': 'application/json' },
        body: JSON.stringify(args || {})
      });
    }catch(e){ throw new Error('Keine Verbindung zum Server. Internet prüfen.'); }
    if(res.status === 401){
      await refresh();
      return rpc(fn, args);
    }
    let j = null; const txt = await res.text(); try{ j = txt ? JSON.parse(txt) : null; }catch(e){ j = null; }
    if(!res.ok){
      const m = (j && j.message) || '';
      if(/Keine Berechtigung/.test(m)) throw new Error('Dafür fehlt die Berechtigung.');
      throw new Error(m ? m : 'Fehler ' + res.status);
    }
    return j;
  }

  return {
    init(){ load(); },
    get session(){ return session; },
    get user(){ return session && session.user; },
    onChange(f){ listeners.push(f); },
    async signIn(email, password){
      setSession(await authCall('/auth/v1/token?grant_type=password', { email, password }));
    },
    signOut(){
      const tok = session && session.access_token;
      session = null; save(); emit();
      if(tok) fetch(CONFIG.url + '/auth/v1/logout', { method:'POST', headers:{ apikey: CONFIG.key, authorization:'Bearer ' + tok } }).catch(()=>{});
    },
    /* Link aus der Passwort-zurücksetzen-Mail: Sitzung aus dem URL-Fragment übernehmen. Gibt den Typ zurück. */
    async adoptHash(){
      const h = new URLSearchParams((location.hash || '').replace(/^#/, ''));
      const at = h.get('access_token'), rt = h.get('refresh_token');
      if(!at || !rt) return null;
      const type = h.get('type') || '';
      try{ history.replaceState(null, '', location.pathname + location.search); }catch(e){}
      let user;
      try{
        const r = await fetch(CONFIG.url + '/auth/v1/user', { headers:{ apikey: CONFIG.key, authorization:'Bearer ' + at } });
        if(!r.ok) return null; user = await r.json();
      }catch(e){ return null; }
      setSession({ access_token: at, refresh_token: rt, expires_in: Number(h.get('expires_in')) || 3600, user });
      return type;
    },
    async resetPassword(email){ await authCall('/auth/v1/recover', { email }); },
    async setPassword(pw){ await authCall('/auth/v1/user', { password: pw }, 'PUT', true); },
    rpc,
    /* Edge Function (serverseitige PDF-Auslese) */
    async fn(name, body, rawBody){
      if(!session) throw new Error('Nicht angemeldet.');
      if(session.expires_at - Date.now() < 60000) await refresh();
      return fetch(CONFIG.url + '/functions/v1/' + name, {
        method: 'POST',
        headers: { 'apikey': CONFIG.key, 'authorization': 'Bearer ' + session.access_token, 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
    }
  };
})();
