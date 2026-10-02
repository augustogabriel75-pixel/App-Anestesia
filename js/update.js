/* =====================================================================
   Update – aviso de nova versão e versão mínima obrigatória.
   O build publica "versao.json" no site:
     { "build": 112, "versao": "1.2.112", "minimo": 108, "apk_url": "...", "notas": "..." }
   - build > APP_BUILD  → aviso opcional ("Atualizar" / "Depois")
   - minimo > APP_BUILD → atualização obrigatória (tela bloqueante)
   Regras de segurança clínica:
   - Nada é exibido por cima de uma anestesia em andamento: o aviso espera o
     "Encerrar" da anestesia (só aparece uma faixa discreta no Monitor).
   - O bloqueio só acontece com confirmação online do servidor: sem internet
     o app nunca trava (o anestesista precisa poder trabalhar offline).
   ===================================================================== */
window.Update = (() => {
  const C = window.VA_CONFIG || {};
  const BUILD = Number(C.APP_BUILD) || 0;
  const KEY_ADIADO = 'vetanest.update.adiado';   // { build, ate }
  let remoto = null, checando = false, timer = null;

  const url = () => {
    if (!Native.isNative() && location.protocol.startsWith('http')) return 'versao.json';   // versão web: mesmo servidor
    return C.VERSAO_URL || (C.SITE_URL ? C.SITE_URL.replace(/\/?$/, '/') + 'versao.json' : '');
  };
  const emAnestesia = () => typeof anestesiaEmAndamento === 'function' && anestesiaEmAndamento();
  const lsGet = () => { try { return JSON.parse(localStorage.getItem(KEY_ADIADO) || 'null'); } catch { return null; } };
  const lsSet = v => { try { localStorage.setItem(KEY_ADIADO, JSON.stringify(v)); } catch {} };

  function estado() {
    if (!remoto || !BUILD) return 'ok';
    if (Number(remoto.minimo) > BUILD) return 'obrigatoria';
    if (Number(remoto.build) > BUILD) return 'disponivel';
    return 'ok';
  }

  async function verificar(manual = false) {
    if (!BUILD || !url() || checando) { if (manual) toast(BUILD ? 'Verificação de versão não configurada' : 'Versão de desenvolvimento'); return estado(); }
    checando = true;
    try {
      const r = await fetch(url() + (url().includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
      if (r.ok) { const j = await r.json(); if (j && Number(j.build)) remoto = j; }
    } catch { /* sem internet: segue sem avisar e sem bloquear */ }
    finally { checando = false; }
    aplicar(manual);
    return estado();
  }

  function aplicar(manual = false) {
    const st = estado(), faixa = $('#updFaixa');
    renderVersao();
    if (st === 'ok') { faixa.classList.add('hidden'); fecharModal(); if (manual) toast('Você está na versão mais recente ✔'); return; }
    if (emAnestesia()) {
      // Nunca interrompe a anestesia: só uma faixa discreta no Monitor.
      faixa.textContent = st === 'obrigatoria'
        ? '⬆️ Atualização obrigatória disponível – será solicitada quando a anestesia for encerrada.'
        : '⬆️ Nova versão disponível – você poderá atualizar ao encerrar a anestesia.';
      faixa.classList.remove('hidden'); fecharModal();
      return;
    }
    faixa.classList.add('hidden');
    if (st === 'disponivel' && !manual) {
      const ad = lsGet();
      if (ad && ad.build === remoto.build && ad.ate > Date.now()) return;   // "Depois" vale por 24 h
    }
    abrirModal(st === 'obrigatoria');
  }

  function abrirModal(obrigatoria) {
    const m = $('#updModal'), nativo = Native.isNative();
    m.dataset.bloqueante = obrigatoria ? '1' : '';
    $('#updTitulo').textContent = obrigatoria ? 'Atualização obrigatória' : 'Nova versão disponível';
    $('#updTexto').textContent = obrigatoria
      ? 'Esta versão do VetAnest não é mais suportada. Atualize para continuar usando o app – seus dados ficam salvos.'
      : 'Uma nova versão do VetAnest está disponível. Seus dados ficam salvos durante a atualização.';
    $('#updVersoes').textContent = `Sua versão: ${C.APP_VERSION || BUILD} → nova: ${remoto.versao || remoto.build}`;
    $('#updNotas').textContent = remoto.notas || '';
    $('#updNotas').classList.toggle('hidden', !remoto.notas);
    $('#updAgora').textContent = nativo ? '⬇️ Baixar e instalar' : '🔄 Atualizar agora';
    $('#updAjuda').classList.toggle('hidden', !nativo);
    $('#updDepois').classList.toggle('hidden', obrigatoria);
    m.classList.remove('hidden'); document.body.style.overflow = 'hidden';
  }
  function fecharModal() { const m = $('#updModal'); if (!m.classList.contains('hidden')) { m.dataset.bloqueante = ''; closeModal(m); } }

  function atualizarAgora() {
    if (!Native.isNative()) { location.reload(); return; }
    if (remoto && remoto.apk_url) Native.openExternal(remoto.apk_url);
    else toast('Link de download não configurado. Fale com o suporte.', 'err');
  }

  function renderVersao() {
    const el = $('#appVersao'); if (!el) return;
    const st = estado();
    el.textContent = `VetAnest ${C.APP_VERSION || 'dev'}${BUILD ? ' (build ' + BUILD + ')' : ''}` +
      (st === 'obrigatoria' ? ' – atualização obrigatória pendente' : st === 'disponivel' ? ` – versão ${remoto.versao || remoto.build} disponível` : '');
  }

  function iniciar() {
    $('#updAgora').onclick = atualizarAgora;
    $('#updDepois').onclick = () => { lsSet({ build: remoto && remoto.build, ate: Date.now() + 24 * 3600e3 }); fecharModal(); };
    $('#btnVerificarVersao').onclick = () => verificar(true);
    renderVersao();
    verificar();
    clearInterval(timer); timer = setInterval(() => verificar(), 30 * 60e3);
  }

  return {
    iniciar, verificar,
    // Chamado ao encerrar a anestesia: mostra o aviso que estava aguardando.
    aposAnestesia: () => { if (estado() !== 'ok') aplicar(); else verificar(); },
    bloqueante: () => $('#updModal').dataset.bloqueante === '1' && !$('#updModal').classList.contains('hidden'),
    estado,
  };
})();
