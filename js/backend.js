/* =====================================================================
   Backend – autenticação, conta/assinatura, sincronização e checkout.
   Duas implementações com a mesma interface:
   - SupabaseBackend: API REST do Supabase (GoTrue + PostgREST + Edge Functions),
     sem SDK, funciona igual no navegador e no app Android;
   - DemoBackend: tudo simulado em localStorage (quando o Supabase não está
     configurado), para testar o fluxo completo sem servidor.
   ===================================================================== */
window.Backend = (() => {
  const C = window.VA_CONFIG || {};
  const configured = !!(C.SUPABASE_URL && C.SUPABASE_ANON_KEY);
  let session = null;      // { access_token, refresh_token, expires_at, user: { id, email, meta } }
  const authListeners = [];

  class BackendError extends Error {
    constructor(msg, extra = {}) { super(msg); Object.assign(this, extra); }
  }
  const MSGS = [
    [/invalid login credentials/i, 'E-mail ou senha incorretos.'],
    [/already registered|already been registered|user_already_exists/i, 'Este e-mail já está cadastrado.'],
    [/email not confirmed/i, 'Confirme seu e-mail (link enviado) antes de entrar.'],
    [/password should be at least|weak_password/i, 'A senha deve ter pelo menos 6 caracteres.'],
    [/unable to validate email|invalid format|email_address_invalid/i, 'E-mail inválido.'],
    [/rate limit|too many/i, 'Muitas tentativas. Aguarde alguns minutos.'],
    [/jwt expired|invalid jwt|refresh token/i, 'Sessão expirada. Entre novamente.'],
    [/acesso negado|permission denied/i, 'Acesso negado.'],
  ];
  const translate = m => (MSGS.find(([re]) => re.test(m)) || [0, m])[1];

  async function persistSession(s) {
    session = s;
    await Store.set('session', s);
    authListeners.forEach(cb => { try { cb(s); } catch {} });
  }

  /* ------------------------------ Supabase ------------------------------ */
  const base = (C.SUPABASE_URL || '').replace(/\/$/, '');
  const toSession = d => ({
    access_token: d.access_token, refresh_token: d.refresh_token,
    expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
    user: { id: d.user.id, email: d.user.email, meta: d.user.user_metadata || {} },
  });

  let refreshing = null;
  async function ensureFresh() {
    if (!session || session.demo) return;
    if (session.expires_at * 1000 - Date.now() > 60000) return;
    refreshing = refreshing || (async () => {
      try {
        const d = await http('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token }, auth: false });
        await persistSession(toSession(d));
      } catch (e) {
        if (!e.offline && (e.status === 400 || e.status === 401)) { await persistSession(null); throw new BackendError('Sessão expirada. Entre novamente.', { status: 401, authLost: true }); }
        throw e;
      } finally { refreshing = null; }
    })();
    return refreshing;
  }

  async function http(path, { method = 'GET', body, auth = true, headers = {} } = {}) {
    if (auth) await ensureFresh();
    let r;
    try {
      r = await fetch(base + path, {
        method,
        headers: { apikey: C.SUPABASE_ANON_KEY, 'Content-Type': 'application/json', ...(auth && session ? { Authorization: 'Bearer ' + session.access_token } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch { throw new BackendError('Sem conexão com o servidor.', { offline: true }); }
    const txt = await r.text();
    let data = null; try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
    if (!r.ok) {
      const msg = (data && (data.msg || data.error_description || data.message || data.error)) || ('Erro HTTP ' + r.status);
      throw new BackendError(translate(String(msg)), { status: r.status, code: data && (data.error_code || data.code) });
    }
    return data;
  }

  const supabase = {
    async signUp({ email, password, nome, crmv, uf }) {
      const d = await http('/auth/v1/signup', { method: 'POST', auth: false, body: { email, password, data: { nome, crmv, uf } } });
      if (d && d.access_token) { await persistSession(toSession(d)); return { session }; }
      return { needsConfirmation: true };
    },
    async signIn(email, password) {
      const d = await http('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email, password } });
      await persistSession(toSession(d)); return { session };
    },
    async signOut() {
      try { if (session) await http('/auth/v1/logout', { method: 'POST' }); } catch {}
      await persistSession(null);
    },
    async resetPassword(email) {
      const to = C.SITE_URL ? '?redirect_to=' + encodeURIComponent(C.SITE_URL) : '';
      await http('/auth/v1/recover' + to, { method: 'POST', auth: false, body: { email } });
    },
    // Link de "redefinir senha" (#access_token=…&type=recovery): abre a sessão para trocar a senha.
    async recoverSession(params) {
      const at = params.get('access_token');
      const u = await http('/auth/v1/user', { auth: false, headers: { Authorization: 'Bearer ' + at } });
      await persistSession(toSession({ access_token: at, refresh_token: params.get('refresh_token'), expires_in: +params.get('expires_in') || 3600, user: u }));
    },
    async updatePassword(password) { await http('/auth/v1/user', { method: 'PUT', body: { password } }); },
    async getAccount() {
      const uid = session.user.id;
      const [p, s, pix, plans] = await Promise.all([
        http(`/rest/v1/profiles?id=eq.${uid}&select=*`),
        http(`/rest/v1/subscriptions?user_id=eq.${uid}&select=*`),
        http(`/rest/v1/pix_requests?user_id=eq.${uid}&select=id,plan,amount,txid,status,created_at&order=created_at.desc&limit=5`).catch(() => []),
        http('/rest/v1/plans?select=id,preco,meses').catch(() => []),
      ]);
      const acc = { profile: p[0] || null, subscription: s[0] || null, pix, plans, fetchedAt: Date.now() };
      if (acc.profile && acc.profile.is_admin) acc.adminPendentes = (await supabase.adminListPix('pendente').catch(() => [])).length;
      return acc;
    },
    async createPixRequest({ plano, txid, pagador }) {
      const r = await http('/rest/v1/pix_requests', { method: 'POST', body: { plan: plano, txid, pagador }, headers: { Prefer: 'return=representation' } });
      return r[0];
    },
    adminListPix: status => http('/rest/v1/rpc/admin_listar_pix', { method: 'POST', body: { p_status: status || null } }),
    adminApprovePix: id => http('/rest/v1/rpc/admin_aprovar_pix', { method: 'POST', body: { p_id: id } }),
    adminRejectPix: id => http('/rest/v1/rpc/admin_recusar_pix', { method: 'POST', body: { p_id: id } }),
    async pushFichas(rows) {
      if (!rows.length) return;
      await http('/rest/v1/fichas?on_conflict=id', { method: 'POST', body: rows.map(r => ({ ...r, user_id: session.user.id })), headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
    },
    async pullFichas(since) {
      const out = []; let cursor = since;
      for (;;) {
        const q = `/rest/v1/fichas?select=id,data,client_updated_at,deleted,server_updated_at&user_id=eq.${session.user.id}&order=server_updated_at.asc&limit=500` + (cursor ? `&server_updated_at=gt.${encodeURIComponent(cursor)}` : '');
        const rows = await http(q);
        out.push(...rows);
        if (rows.length < 500) break;
        cursor = rows[rows.length - 1].server_updated_at;
      }
      return out;
    },
    async pushProfile(p) {
      await http(`/rest/v1/profiles?id=eq.${session.user.id}`, { method: 'PATCH', body: p, headers: { Prefer: 'return=minimal' } });
    },
    async createCheckout(plano, metodo) {
      return http('/functions/v1/create-checkout', { method: 'POST', body: { plano, metodo } });
    },
  };

  /* -------------------------------- Demo -------------------------------- */
  const DK = 'vetanest.demo.';
  const dget = (k, d) => { try { return JSON.parse(localStorage.getItem(DK + k)) ?? d; } catch { return d; } };
  const dset = (k, v) => localStorage.setItem(DK + k, JSON.stringify(v));
  const net = () => { if (!navigator.onLine) throw new BackendError('Sem conexão com o servidor.', { offline: true }); };
  const seq = () => { const n = dget('seq', 0) + 1; dset('seq', n); return String(n).padStart(12, '0'); };
  async function hash(s) {
    try { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('vetanest:' + s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
    catch { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return 'x' + h; }
  }
  const demoSession = u => ({ demo: true, access_token: 'demo', refresh_token: 'demo', expires_at: 4102444800, user: { id: u.id, email: u.email, meta: { nome: u.nome, crmv: u.crmv, uf: u.uf } } });
  const demoUser = () => dget('users', {})[session.user.email];
  const saveDemoUser = u => { const all = dget('users', {}); all[u.email] = u; dset('users', all); };

  const demo = {
    async signUp({ email, password, nome, crmv, uf }) {
      email = email.trim().toLowerCase();
      if (password.length < 6) throw new BackendError('A senha deve ter pelo menos 6 caracteres.');
      const all = dget('users', {}); if (all[email]) throw new BackendError('Este e-mail já está cadastrado.');
      const u = { id: 'demo-' + Math.random().toString(36).slice(2, 10), email, pass: await hash(password), nome, crmv, uf,
        profile: { nome, crmv, uf, settings: {}, settings_updated_at: 0 },
        subscription: { status: 'trial', plan: null, trial_ends_at: new Date(Date.now() + (C.TRIAL_DAYS || 14) * 864e5).toISOString(), current_period_end: null } };
      all[email] = u; dset('users', all);
      await persistSession(demoSession(u)); return { session };
    },
    async signIn(email, password) {
      email = email.trim().toLowerCase();
      const u = dget('users', {})[email];
      if (!u || u.pass !== await hash(password)) throw new BackendError('E-mail ou senha incorretos.');
      await persistSession(demoSession(u)); return { session };
    },
    async signOut() { await persistSession(null); },
    async resetPassword() { throw new BackendError('Modo demonstração: recuperação de senha indisponível.'); },
    async recoverSession() { throw new BackendError('Modo demonstração: recuperação de senha indisponível.'); },
    async updatePassword() {},
    async getAccount() {
      net(); const u = demoUser(), pix = dget('pix', []);
      // No modo demonstração toda conta é "admin" para testar a confirmação do Pix.
      return { profile: { id: u.id, email: u.email, ...u.profile, is_admin: true }, subscription: u.subscription,
        pix: pix.filter(r => r.user_id === u.id).reverse().slice(0, 5), plans: [],
        adminPendentes: pix.filter(r => r.status === 'pendente').length, fetchedAt: Date.now() };
    },
    async createPixRequest({ plano, txid, pagador }) {
      net(); const u = demoUser(), pix = dget('pix', []);
      if (pix.filter(r => r.user_id === u.id && r.status === 'pendente').length >= 3) throw new BackendError('Você já tem pagamentos aguardando confirmação.');
      const plan = (C.PLANOS || []).find(p => p.id === plano) || {};
      const r = { id: 'pix-' + Date.now(), user_id: u.id, email: u.email, nome: u.nome, crmv: u.crmv, uf: u.uf, plan: plano, amount: plan.preco, txid, pagador, status: 'pendente', created_at: new Date().toISOString() };
      pix.push(r); dset('pix', pix); return r;
    },
    async adminListPix(status) {
      net(); const users = Object.values(dget('users', {}));
      return dget('pix', []).filter(r => !status || r.status === status).reverse()
        .map(r => ({ ...r, current_period_end: (users.find(x => x.id === r.user_id) || { subscription: {} }).subscription.current_period_end }));
    },
    async adminApprovePix(id) {
      net(); const pix = dget('pix', []), r = pix.find(x => x.id === id);
      if (!r || r.status !== 'pendente') throw new BackendError('Solicitação não encontrada ou já analisada');
      const all = dget('users', {}), u = Object.values(all).find(x => x.id === r.user_id);
      const start = Math.max(Date.now(), Date.parse(u.subscription.current_period_end || 0) || 0);
      const end = new Date(start); end.setMonth(end.getMonth() + (r.plan === 'anual' ? 12 : 1));
      u.subscription = { ...u.subscription, status: 'active', plan: r.plan, current_period_end: end.toISOString() };
      r.status = 'aprovado'; r.reviewed_at = new Date().toISOString();
      all[u.email] = u; dset('users', all); dset('pix', pix);
      return end.toISOString();
    },
    async adminRejectPix(id) {
      net(); const pix = dget('pix', []), r = pix.find(x => x.id === id);
      if (!r || r.status !== 'pendente') throw new BackendError('Solicitação não encontrada ou já analisada');
      r.status = 'recusado'; r.reviewed_at = new Date().toISOString(); dset('pix', pix);
    },
    async pushFichas(rows) {
      net(); const k = 'cloud.' + session.user.id, cloud = dget(k, {});
      rows.forEach(r => { const old = cloud[r.id]; if (old && old.client_updated_at > r.client_updated_at) return; cloud[r.id] = { ...r, server_updated_at: seq() }; });
      dset(k, cloud);
    },
    async pullFichas(since) {
      net(); const cloud = dget('cloud.' + session.user.id, {});
      return Object.values(cloud).filter(r => !since || r.server_updated_at > since).sort((a, b) => a.server_updated_at.localeCompare(b.server_updated_at));
    },
    async pushProfile(p) { net(); const u = demoUser(); u.profile = { ...u.profile, ...p }; saveDemoUser(u); },
    async createCheckout(plano, metodo) {
      net(); const id = 'demo-pay-' + Date.now();
      dset('pending', { id, plano });
      if (metodo === 'pix') return { payment_id: id, demo: true, pix: { qr_code: '00020126580014BR.GOV.BCB.PIX-DEMONSTRACAO-' + id, qr_code_base64: null, expires_at: new Date(Date.now() + 30 * 60000).toISOString() } };
      return { payment_id: id, demo: true, url: null };
    },
    // Simula a confirmação do pagamento (o que o webhook faria no servidor).
    approvePending() {
      const p = dget('pending', null); if (!p) return false;
      const u = demoUser(), months = p.plano === 'anual' ? 12 : 1;
      const start = Math.max(Date.now(), Date.parse(u.subscription.current_period_end || 0) || 0);
      const end = new Date(start); end.setMonth(end.getMonth() + months);
      u.subscription = { ...u.subscription, status: 'active', plan: p.plano, current_period_end: end.toISOString() };
      saveDemoUser(u); localStorage.removeItem(DK + 'pending'); return true;
    },
    // Ferramenta de teste: força o fim do período de teste.
    expireTrial() { const u = demoUser(); u.subscription = { ...u.subscription, status: 'trial', trial_ends_at: new Date(Date.now() - 1000).toISOString(), current_period_end: null }; saveDemoUser(u); },
  };

  const impl = configured ? supabase : demo;
  return {
    configured, mode: configured ? 'supabase' : 'demo', BackendError,
    async restore() { session = await Store.get('session', null); return session; },
    getSession: () => session,
    onAuthChange: cb => authListeners.push(cb),
    signUp: a => impl.signUp(a),
    signIn: (e, p) => impl.signIn(e, p),
    signOut: () => impl.signOut(),
    resetPassword: e => impl.resetPassword(e),
    recoverSession: params => impl.recoverSession(params),
    updatePassword: pw => impl.updatePassword(pw),
    createPixRequest: a => impl.createPixRequest(a),
    adminListPix: st => impl.adminListPix(st),
    adminApprovePix: id => impl.adminApprovePix(id),
    adminRejectPix: id => impl.adminRejectPix(id),
    getAccount: () => impl.getAccount(),
    pushFichas: rows => impl.pushFichas(rows),
    pullFichas: since => impl.pullFichas(since),
    pushProfile: p => impl.pushProfile(p),
    createCheckout: (plano, metodo) => impl.createCheckout(plano, metodo),
    demo: configured ? null : demo,
  };
})();
