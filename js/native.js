/* =====================================================================
   Native – integração com o Android (Capacitor) e fallbacks para Web/PWA
   - Botão/gesto "Voltar": @capacitor/app (nativo) ou History API (web/PWA);
   - Manter a tela acesa: @capacitor-community/keep-awake (FLAG_KEEP_SCREEN_ON)
     no Android; Screen Wake Lock API no navegador;
   - Abrir links externos (checkout com cartão): @capacitor/browser.
   ===================================================================== */
window.Native = (() => {
  const cap = () => window.Capacitor;
  const isNative = () => !!(cap() && cap().isNativePlatform && cap().isNativePlatform());
  const plugin = name => (cap() && cap().Plugins && cap().Plugins[name]) || null;
  let exiting = false;

  /* ---------------- Botão Voltar ----------------
     handler(): a aplicação decide o que fazer (fechar modal, voltar aba,
     perguntar se deseja sair). Só Native.exitApp() encerra o app. */
  function initBack(handler) {
    const App = plugin('App');
    if (isNative() && App) {
      // Com um listener registrado, o Capacitor NÃO fecha o app sozinho.
      App.addListener('backButton', () => handler());
      return 'native';
    }
    try {
      history.replaceState({ va: 'base' }, '');
      history.pushState({ va: 'trap' }, '');
      window.addEventListener('popstate', e => {
        // Só é "Voltar" quando retorna à entrada base do app; navegações por #fragmento
        // (ex.: link de redefinir senha) chegam com state null e são ignoradas.
        if (exiting || !e.state || e.state.va !== 'base') return;
        history.pushState({ va: 'trap' }, '');
        handler();
      });
    } catch {}
    return 'web';
  }
  function exitApp() {
    const App = plugin('App');
    if (isNative() && App) { App.exitApp(); return; }
    exiting = true;
    try { window.close(); } catch {}
    history.go(-2);
  }

  /* ---------------- Manter a tela acesa ---------------- */
  const Awake = (() => {
    let want = false, lock = null, mode = 'off';
    const listeners = [];
    const emit = () => listeners.forEach(cb => { try { cb(mode); } catch {} });
    async function acquire() {
      const KA = plugin('KeepAwake');
      if (isNative() && KA) {
        try { await KA.keepAwake(); mode = 'native'; emit(); return mode; } catch {}
      }
      if ('wakeLock' in navigator) {
        try {
          if (!lock) {
            lock = await navigator.wakeLock.request('screen');
            lock.addEventListener('release', () => { lock = null; if (want && document.visibilityState === 'visible') acquire(); });
          }
          mode = 'web';
        } catch { mode = 'blocked'; }
      } else mode = 'unsupported';
      emit(); return mode;
    }
    async function enable() { want = true; return acquire(); }
    async function disable() {
      want = false;
      const KA = plugin('KeepAwake');
      if (isNative() && KA) { try { await KA.allowSleep(); } catch {} }
      if (lock) { try { await lock.release(); } catch {} lock = null; }
      mode = 'off'; emit();
    }
    // O Wake Lock web é liberado quando a aba fica oculta: readquire ao voltar.
    document.addEventListener('visibilitychange', () => { if (want && document.visibilityState === 'visible') acquire(); });
    return { enable, disable, mode: () => mode, active: () => want, onChange: cb => listeners.push(cb) };
  })();

  /* ---------------- Ciclo de vida / links ---------------- */
  function onResume(cb) {
    const App = plugin('App');
    if (isNative() && App) App.addListener('resume', cb);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') cb(); });
  }
  async function openExternal(url) {
    const B = plugin('Browser');
    if (isNative() && B) { try { await B.open({ url }); return; } catch {} }
    window.open(url, '_blank', 'noopener');
  }

  return { isNative, plugin, initBack, exitApp, Awake, onResume, openExternal };
})();
