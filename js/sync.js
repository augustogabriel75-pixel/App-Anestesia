/* =====================================================================
   Sync – sincronização offline-first com a nuvem
   - Toda alteração é gravada primeiro no aparelho (Store); a nuvem é cópia.
   - Ficha "suja" = updatedAt > syncedAt. Push → pull → conta, nessa ordem.
   - Conflitos: vence a versão com o updatedAt mais recente (last-write-wins),
     regra repetida no servidor (trigger em supabase/schema.sql) para que um
     aparelho desatualizado nunca sobrescreva uma versão mais nova.
   - Exclusões viram "tombstones" (deleted: true) até serem sincronizadas.
   - Dispara: ao entrar, ao reconectar (evento "online"), ao voltar para o
     app, alguns segundos após cada alteração e a cada SYNC_INTERVAL_MS.
   Usa os globais do app: user, fichas, profile, account, curId.
   ===================================================================== */
window.Sync = (() => {
  let running = false, again = false, timer = null, interval = null;
  let state = 'idle', lastError = '', lastSync = null;
  const listeners = [];
  const meta = () => Store.get(ukey('syncmeta'), { lastPull: null, lastSync: null });

  const isDirty = f => (f.updatedAt || 0) > (f.syncedAt || 0);
  const pendingCount = () => fichas.filter(isDirty).length + ((profile.updatedAt || 0) > (profile.syncedAt || 0) ? 1 : 0);
  function setState(s, err = '') { state = s; lastError = err; listeners.forEach(cb => { try { cb(info()); } catch {} }); }
  const info = () => ({ state, error: lastError, lastSync, pending: user ? pendingCount() : 0, online: navigator.onLine });

  function toRow(f) {
    const { syncedAt, ...data } = f;
    return { id: f.id, data, client_updated_at: f.updatedAt || 0, deleted: !!f.deleted };
  }
  function profileRow() {
    const { nome = '', crmv = '', uf = '', updatedAt, syncedAt, ...settings } = profile;
    return { nome, crmv, uf, settings, settings_updated_at: updatedAt || 0 };
  }

  async function run(reason = '') {
    if (!user) return info();
    if (!Backend.getSession()) { setState('error', 'Sessão expirada'); return info(); }
    if (running) { again = true; return info(); }
    if (!navigator.onLine) { setState('offline'); return info(); }
    running = true; setState('syncing');
    let changedCur = false, changedAny = false;
    try {
      const m = await meta();

      // 1) Push das fichas alteradas (lotes de 25), lembrando a versão enviada.
      const dirty = fichas.filter(isDirty);
      for (let i = 0; i < dirty.length; i += 25) {
        const batch = dirty.slice(i, i + 25).map(f => [f, f.updatedAt || 0]);
        await Backend.pushFichas(batch.map(([f]) => toRow(f)));
        batch.forEach(([f, v]) => { f.syncedAt = v; });
      }

      // 2) Push do perfil profissional (nome, CRMV, logo, assinatura…).
      if ((profile.updatedAt || 0) > (profile.syncedAt || 0)) {
        const v = profile.updatedAt; await Backend.pushProfile(profileRow()); profile.syncedAt = v;
      }

      // 3) Pull das alterações feitas em outros aparelhos.
      const rows = await Backend.pullFichas(m.lastPull);
      for (const r of rows) {
        const i = fichas.findIndex(f => f.id === r.id), local = fichas[i];
        if (local && (local.updatedAt || 0) >= r.client_updated_at) {
          if ((local.updatedAt || 0) === r.client_updated_at) local.syncedAt = r.client_updated_at;
          continue;
        }
        if (!local && r.deleted) continue;
        const inc = { ...r.data, id: r.id, deleted: !!r.deleted, updatedAt: r.client_updated_at, syncedAt: r.client_updated_at };
        if (i < 0) fichas.push(inc); else fichas[i] = inc;
        changedAny = true; if (r.id === curId) changedCur = true;
      }
      if (rows.length) m.lastPull = rows[rows.length - 1].server_updated_at;

      // Tombstones já confirmados na nuvem podem sair do aparelho.
      fichas = fichas.filter(f => !(f.deleted && !isDirty(f)));

      // 4) Conta e assinatura (fonte da verdade: servidor) + perfil remoto.
      const acc = await Backend.getAccount();
      const sig = a => JSON.stringify(a ? [a.subscription, a.pix, a.adminPendentes, a.profile && a.profile.is_admin] : null);
      if (sig(acc) !== sig(account)) {
        const eraAtivo = account && account.subscription && account.subscription.status === 'active' && account.subscription.current_period_end;
        changedAny = true;
        if (account && acc.subscription && acc.subscription.current_period_end !== eraAtivo && acc.subscription.status === 'active' && Date.parse(acc.subscription.current_period_end) > Date.now())
          setTimeout(() => window.toast && toast('⭐ Assinatura Pro ativa até ' + new Date(acc.subscription.current_period_end).toLocaleDateString('pt-BR')), 0);
      }
      account = acc; await Store.set(ukey('account'), acc);
      const rp = acc.profile;
      if (rp && (rp.settings_updated_at || 0) > (profile.updatedAt || 0)) {
        profile = { ...(rp.settings || {}), nome: rp.nome || '', crmv: rp.crmv || '', uf: rp.uf || '', updatedAt: rp.settings_updated_at, syncedAt: rp.settings_updated_at };
        changedAny = true;
      }

      lastSync = m.lastSync = Date.now();
      await Store.set(ukey('syncmeta'), m);
      await Store.set(ukey('fichas'), fichas);
      await Store.set(ukey('profile'), profile);
      setState('ok');
    } catch (e) {
      if (e.authLost) { running = false; setState('error', e.message); onAuthLost(e.message); return info(); }
      // Grava o que já foi confirmado (syncedAt) mesmo após falha parcial.
      try { await Store.set(ukey('fichas'), fichas); } catch {}
      setState(e.offline ? 'offline' : 'error', e.message);
    } finally {
      running = false;
    }
    if (changedAny) onRemoteChange(changedCur);
    if (again) { again = false; return run('again'); }
    return info();
  }

  function schedule(ms = 3000) { clearTimeout(timer); timer = setTimeout(() => run('change'), ms); setState(state === 'syncing' ? state : 'pending'); }
  function start() {
    stop();
    meta().then(m => { lastSync = m.lastSync; });
    interval = setInterval(() => run('interval'), (window.VA_CONFIG || {}).SYNC_INTERVAL_MS || 60000);
  }
  function stop() { clearInterval(interval); clearTimeout(timer); interval = timer = null; }

  window.addEventListener('online', () => run('online'));
  window.addEventListener('offline', () => setState('offline'));

  // Ganchos que o app sobrescreve.
  let onRemoteChange = () => {}, onAuthLost = () => {};
  return {
    run, schedule, start, stop, info, onChange: cb => listeners.push(cb),
    setHandlers(h) { onRemoteChange = h.onRemoteChange || onRemoteChange; onAuthLost = h.onAuthLost || onAuthLost; },
  };
})();
