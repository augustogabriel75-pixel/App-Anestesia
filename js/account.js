'use strict';
/* =====================================================================
   Conta, plano (freemium), checkout Pix/cartão, botão Voltar e boot().
   Usa os globais definidos no script principal do index.html.
   ===================================================================== */
const CFG = window.VA_CONFIG;
const brl = n => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dateBR = ms => new Date(ms).toLocaleDateString('pt-BR');
let leaving = false, sessionLost = false;

/* ------------------------------ Plano ------------------------------ */
// Status calculado a partir da assinatura gravada no servidor (cache local
// para funcionar offline): 'trial' | 'ativo' | 'expirado' | 'verificando'.
function planInfo() {
  const s = account && account.subscription;
  if (!s) return { status: 'verificando' };
  const now = Date.now();
  const end = Date.parse(s.current_period_end || '') || 0;
  const tEnd = Date.parse(s.trial_ends_at || '') || 0;
  const dias = t => Math.max(0, Math.ceil((t - now) / 864e5));
  if (s.status === 'active' && end > now) return { status: 'ativo', plano: s.plan, ate: end, dias: dias(end) };
  if (tEnd > now) return { status: 'trial', ate: tEnd, dias: dias(tEnd) };
  return { status: 'expirado', ate: Math.max(end, tEnd) };
}
// Enquanto a conta nunca foi verificada (ex.: 1º acesso sem rede) o app não bloqueia.
function isPro() { return planInfo().status !== 'expirado'; }

function canCreateFicha() {
  if (isPro()) return true;
  const lim = CFG.FREE_LIMIT_FICHAS_ATIVAS;
  if (live().filter(f => !f.finalizada).length < lim) return true;
  showPaywall('Limite do plano gratuito',
    `Sem assinatura ativa você pode manter até ${lim} fichas em aberto. Finalize uma ficha (Resumo/PDF → “Marcar ficha como finalizada”) ou assine o Pro para ter fichas ilimitadas.`);
  return false;
}

function showPaywall(title, text) {
  $('#pwTitle').textContent = title; $('#pwText').textContent = text;
  $('#paywallModal').classList.remove('hidden');
}
$('#pwGo').onclick = () => { closeModal($('#paywallModal')); openCheckout(); };

/* --------------------------- UI da conta --------------------------- */
const SYNC_UI = {
  ok: ['bg-emerald-400', 'Sincronizado'], syncing: ['bg-sky-400 animate-pulse', 'Sincronizando…'],
  pending: ['bg-amber-400', 'Alterações aguardando envio'], offline: ['bg-slate-400', 'Sem internet – salvando no aparelho'],
  error: ['bg-red-500', 'Falha na sincronização'], idle: ['bg-slate-300', 'Aguardando'],
};
function renderSyncUI() {
  if (!user) return;
  const i = Sync.info(), st = sessionLost ? 'error' : (!i.online ? 'offline' : (i.state === 'ok' && i.pending ? 'pending' : i.state));
  const [cls, label] = SYNC_UI[st] || SYNC_UI.idle;
  $('#syncDot').className = 'absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full ring-2 ring-brand-800 ' + cls;
  $('#syncBadge').title = label;
  const parts = [label];
  if (sessionLost) parts.push('sessão expirada – entre novamente');
  else if (i.error && st === 'error') parts.push(i.error);
  if (i.pending) parts.push(`${i.pending} alteração(ões) pendente(s)`);
  if (i.lastSync) parts.push('última: ' + new Date(i.lastSync).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }));
  $('#contaSync').textContent = '☁️ ' + parts.join(' · ');
}

function renderAccountUI() {
  if (!user) return;
  renderSyncUI();
  const pi = planInfo(), lim = CFG.FREE_LIMIT_FICHAS_ATIVAS;
  // Banner na lista de fichas
  const b = $('#planBanner'); let html = '';
  if (sessionLost) html = `<div class="card border-red-300 bg-red-50 text-red-900 text-sm flex items-center gap-3"><span class="flex-1">Sua sessão expirou. Os dados continuam salvos neste aparelho; entre novamente para voltar a sincronizar.</span><button class="btn-danger py-2" data-relogin>Entrar</button></div>`;
  else if (pi.status === 'trial') html = `<div class="card border-brand-200 bg-brand-50 text-brand-900 text-sm flex items-center gap-3"><span class="flex-1">🎁 <b>Teste grátis do Pro</b>: ${pi.dias} dia(s) restante(s).</span><button class="btn-primary py-2" data-assinar>Assinar</button></div>`;
  else if (pi.status === 'expirado') html = `<div class="card border-amber-300 bg-amber-50 text-amber-900 text-sm flex items-center gap-3"><span class="flex-1"><b>Plano gratuito:</b> até ${lim} fichas em aberto e PDF sem logotipo/assinatura.</span><button class="btn-primary py-2" data-assinar>Assinar Pro</button></div>`;
  b.innerHTML = html; b.classList.toggle('hidden', !html);
  // Cartão da conta (Perfil)
  $('#contaEmail').textContent = user.email;
  const badge = { ativo: ['bg-emerald-100 text-emerald-800', 'PRO ATIVO'], trial: ['bg-brand-100 text-brand-800', 'TESTE GRÁTIS'], expirado: ['bg-amber-100 text-amber-800', 'GRATUITO'], verificando: ['bg-slate-100 text-slate-600', 'VERIFICANDO'] }[pi.status];
  $('#contaBadge').className = 'text-xs font-bold rounded-full px-3 py-1 ' + badge[0]; $('#contaBadge').textContent = badge[1];
  const nomePlano = (CFG.PLANOS.find(p => p.id === pi.plano) || {}).nome || 'Pro';
  $('#contaPlano').textContent = {
    ativo: `${nomePlano} – válido até ${pi.ate && dateBR(pi.ate)} (${pi.dias} dia(s))`,
    trial: `Teste grátis até ${pi.ate && dateBR(pi.ate)} (${pi.dias} dia(s) restantes)`,
    expirado: `Plano gratuito – até ${lim} fichas em aberto, PDF sem logotipo e assinatura.`,
    verificando: 'Status da assinatura será verificado na próxima conexão.',
  }[pi.status];
  $('#btnAssinar').textContent = pi.status === 'ativo' ? '⭐ Renovar / estender' : '⭐ Assinar Pro';
  $('#demoTools').classList.toggle('hidden', Backend.mode !== 'demo');
  $$('.pro-tag').forEach(t => { t.className = 'pro-tag'; t.textContent = ''; if (!isPro()) { t.className = 'pro-tag normal-case text-[10px] font-bold rounded-full bg-amber-100 text-amber-800 px-2 py-0.5'; t.textContent = 'PRO – sai no PDF com assinatura ativa'; } });
}
document.addEventListener('click', e => {
  if (e.target.closest('[data-assinar]')) openCheckout();
  if (e.target.closest('[data-relogin]')) logout(true);
});
$('#btnAssinar').onclick = () => openCheckout();
$('#btnSyncNow').onclick = async () => { const i = await Sync.run('manual'); renderAccountUI(); toast(i.state === 'ok' ? 'Sincronizado' : (i.state === 'offline' ? 'Sem internet – dados salvos no aparelho' : 'Sincronização: ' + (i.error || i.state)), i.state === 'error' ? 'err' : 'ok'); };
$('#syncBadge').onclick = () => $('#btnSyncNow').click();
$('#btnLogout').onclick = () => logout(false);
$('#btnDemoExpire').onclick = async () => { Backend.demo.expireTrial(); await Sync.run('demo'); render(); toast('Teste encerrado (demonstração)'); };

/* ----------------------------- Checkout ----------------------------- */
const pay = { plano: (CFG.PLANOS.find(p => p.destaque) || CFG.PLANOS[0]).id, metodo: 'pix', poll: null, data: null, before: 0, waiting: false };

function openCheckout() {
  if (isNative() && CFG.NATIVE_CHECKOUT === 'external' && CFG.CHECKOUT_SITE_URL) return Native.openExternal(CFG.CHECKOUT_SITE_URL);
  renderPlans(); payStep('start');
  $('#payModal').classList.remove('hidden'); document.body.style.overflow = 'hidden';
}
$('#payModal')._onClose = () => { clearInterval(pay.poll); pay.poll = null; pay.waiting = false; };

function renderPlans() {
  $('#payPlans').innerHTML = CFG.PLANOS.map(p => `<button class="relative rounded-2xl border-2 p-3 text-left ${p.id === pay.plano ? 'border-brand-600 bg-brand-50' : 'border-slate-200 bg-white'}" data-plano="${p.id}">
    ${p.destaque ? `<span class="absolute -top-2.5 right-2 rounded-full bg-amber-400 text-amber-950 text-[10px] font-bold px-2 py-0.5">${esc(p.destaque)}</span>` : ''}
    <div class="text-sm font-semibold text-slate-700">${esc(p.nome)}</div>
    <div class="text-xl font-bold text-brand-800">${brl(p.preco)}</div><div class="text-xs text-slate-500">por ${esc(p.periodo)}</div></button>`).join('');
}
$('#payPlans').addEventListener('click', e => { const b = e.target.closest('[data-plano]'); if (!b || pay.waiting) return; pay.plano = b.dataset.plano; renderPlans(); payStep('start'); });
$('#payMethods').addEventListener('click', e => {
  const b = e.target.closest('[data-m]'); if (!b || pay.waiting) return;
  pay.metodo = b.dataset.m; $$('#payMethods button').forEach(x => x.classList.toggle('on', x === b)); payStep('start');
});

function payStep(step, extra = '') {
  const plan = CFG.PLANOS.find(p => p.id === pay.plano), el = $('#payStep'), demo = Backend.mode === 'demo';
  const demoBtn = demo ? '<button class="btn-ghost w-full border-dashed text-sm" data-pay="simular">🧪 Simular pagamento aprovado (demonstração)</button>' : '';
  if (step === 'start') {
    el.innerHTML = pay.metodo === 'pix'
      ? `<button class="btn-primary w-full py-4 text-lg" data-pay="gerar">Gerar Pix de ${brl(plan.preco)}</button><p class="text-xs text-slate-500 text-center">Liberação automática em segundos após o pagamento.</p>`
      : `<button class="btn-primary w-full py-4 text-lg" data-pay="gerar">Pagar ${brl(plan.preco)} com cartão</button><p class="text-xs text-slate-500 text-center">Você será levado ao ambiente seguro do Mercado Pago (crédito em até 12x).</p>`;
  } else if (step === 'loading') {
    el.innerHTML = '<div class="text-center py-6 text-slate-500">⏳ Gerando pagamento…</div>';
  } else if (step === 'pix') {
    const d = pay.data.pix;
    const qr = d.qr_code_base64
      ? `<img src="data:image/png;base64,${d.qr_code_base64}" class="w-56 h-56 mx-auto rounded-xl border border-slate-200 bg-white p-2" alt="QR Code Pix">`
      : `<div class="w-56 h-56 mx-auto rounded-xl border-2 border-dashed border-slate-300 bg-white flex items-center justify-center text-center text-xs text-slate-500 p-4">QR Code Pix<br>(demonstração)</div>`;
    el.innerHTML = `<div class="card space-y-3 text-center">
      <div class="font-semibold">Pague ${brl(plan.preco)} com Pix</div>${qr}
      <div class="text-left"><label class="lbl">Pix copia e cola</label><textarea id="pixCode" class="inp text-xs font-mono" rows="3" readonly>${esc(d.qr_code)}</textarea></div>
      <button class="btn-soft w-full" data-pay="copiar">📋 Copiar código Pix</button>
      <div class="text-sm text-slate-600">⏳ Aguardando confirmação do pagamento…${d.expires_at ? `<br><span class="text-xs">Válido até ${new Date(d.expires_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>` : ''}</div>
      <button class="btn-ghost w-full" data-pay="verificar">Já paguei – verificar agora</button>${demoBtn}</div>`;
  } else if (step === 'card') {
    el.innerHTML = `<div class="card space-y-3 text-center">
      <div class="text-sm text-slate-600">Abrimos o pagamento seguro no navegador. Conclua por lá e volte para o app; a assinatura é liberada automaticamente.</div>
      ${pay.data.url ? '<button class="btn-soft w-full" data-pay="abrir">Abrir pagamento novamente</button>' : ''}
      <button class="btn-ghost w-full" data-pay="verificar">Já paguei – verificar agora</button>${demoBtn}</div>`;
  } else if (step === 'done') {
    const pi = planInfo();
    el.innerHTML = `<div class="card text-center space-y-2 border-emerald-300 bg-emerald-50"><div class="text-4xl">✅</div><div class="font-bold text-emerald-900">Assinatura ativa!</div>
      <div class="text-sm text-emerald-800">Válida até ${pi.ate ? dateBR(pi.ate) : '—'}. Obrigado por assinar o VetAnest Pro.</div><button class="btn-primary w-full" data-close-pay>Continuar</button></div>`;
  } else if (step === 'error') {
    el.innerHTML = `<div class="card text-center space-y-2 border-red-200 bg-red-50 text-red-800 text-sm"><div>${esc(extra)}</div><button class="btn-ghost w-full" data-pay="voltar">Tentar novamente</button></div>`;
  }
}

async function gerarPagamento() {
  if (!navigator.onLine) return payStep('error', 'Sem conexão com a internet. Conecte-se para assinar.');
  payStep('loading');
  try {
    pay.data = await Backend.createCheckout(pay.plano, pay.metodo);
    pay.before = (planInfo().status === 'ativo' && planInfo().ate) || 0;
    pay.waiting = true;
    if (pay.metodo === 'pix') payStep('pix');
    else { payStep('card'); if (pay.data.url) Native.openExternal(pay.data.url); }
    clearInterval(pay.poll); pay.poll = setInterval(() => verificarPagamento(false), 5000);
  } catch (e) { payStep('error', e.offline ? 'Sem conexão com o servidor.' : ('Não foi possível iniciar o pagamento: ' + e.message)); }
}

async function verificarPagamento(manual) {
  if (!pay.waiting) return;
  try {
    const acc = await Backend.getAccount();
    account = acc; await Store.set(ukey('account'), acc);
    const pi = planInfo();
    if (pi.status === 'ativo' && pi.ate > pay.before) {
      pay.waiting = false; clearInterval(pay.poll); payStep('done'); render(); toast('Assinatura ativada!');
    } else if (manual) toast('Pagamento ainda não confirmado. Pode levar alguns segundos.');
  } catch (e) { if (manual) toast('Não foi possível verificar: ' + e.message, 'err'); }
}

$('#payStep').addEventListener('click', async e => {
  if (e.target.closest('[data-close-pay]')) return closeModal($('#payModal'));
  const b = e.target.closest('[data-pay]'); if (!b) return;
  const a = b.dataset.pay;
  if (a === 'gerar') gerarPagamento();
  if (a === 'voltar') payStep('start');
  if (a === 'verificar') verificarPagamento(true);
  if (a === 'abrir' && pay.data && pay.data.url) Native.openExternal(pay.data.url);
  if (a === 'simular') { Backend.demo.approvePending(); verificarPagamento(true); }
  if (a === 'copiar') {
    const t = $('#pixCode');
    try { await navigator.clipboard.writeText(t.value); } catch { t.select(); document.execCommand('copy'); }
    toast('Código Pix copiado');
  }
});

/* ------------------------- Login / Cadastro ------------------------- */
let authMode = 'login';
function setAuthMode(m) {
  authMode = m;
  $$('#authTabs button').forEach(b => b.classList.toggle('on', b.dataset.t === m));
  $$('.signup-only').forEach(el => el.classList.toggle('hidden', m !== 'signup'));
  $$('.login-only').forEach(el => el.classList.toggle('hidden', m !== 'login'));
  $('#authSubmit').textContent = m === 'login' ? 'Entrar' : 'Criar conta e iniciar teste grátis';
  $('#auPass').autocomplete = m === 'login' ? 'current-password' : 'new-password';
  authMsg('');
}
function authMsg(text, type = 'err') {
  const el = $('#authMsg'); el.textContent = text; el.classList.toggle('hidden', !text);
  el.className = 'text-sm rounded-lg px-3 py-2 ' + (type === 'err' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200') + (text ? '' : ' hidden');
}
$('#authTabs').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (b) setAuthMode(b.dataset.t); });

$('#authForm').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('#auEmail').value.trim(), pass = $('#auPass').value;
  if (!/^\S+@\S+\.\S+$/.test(email)) return authMsg('Informe um e-mail válido.');
  if (pass.length < 6) return authMsg('A senha deve ter pelo menos 6 caracteres.');
  const btn = $('#authSubmit'), txt = btn.textContent;
  try {
    if (authMode === 'signup') {
      const nome = $('#auNome').value.trim(), crmv = $('#auCrmv').value.trim(), uf = $('#auUf').value;
      if (!nome) return authMsg('Informe seu nome profissional.');
      if (!crmv || !uf) return authMsg('Informe o número do CRMV e a UF.');
      if (pass !== $('#auPass2').value) return authMsg('As senhas não conferem.');
      btn.disabled = true; btn.textContent = 'Criando conta…';
      const r = await Backend.signUp({ email, password: pass, nome, crmv, uf });
      if (r.needsConfirmation) { setAuthMode('login'); $('#auEmail').value = email; return authMsg('Conta criada! Enviamos um link de confirmação para o seu e-mail. Confirme e depois entre aqui.', 'ok'); }
    } else {
      btn.disabled = true; btn.textContent = 'Entrando…';
      await Backend.signIn(email, pass);
    }
    $('#auPass').value = $('#auPass2').value = '';
    await enterApp(Backend.getSession().user);
  } catch (err) {
    authMsg(err.offline ? 'Sem conexão. É preciso internet para entrar pela primeira vez neste aparelho.' : err.message);
  } finally { btn.disabled = false; btn.textContent = txt; if (authMode === 'login') btn.textContent = 'Entrar'; }
});
$('#authForgot').onclick = async () => {
  const email = $('#auEmail').value.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) return authMsg('Digite seu e-mail acima e toque novamente em “Esqueci minha senha”.');
  try { await Backend.resetPassword(email); authMsg('Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.', 'ok'); }
  catch (err) { authMsg(err.message); }
};

function showAuth(msg) {
  user = null; fichas = []; profile = {}; account = null; curId = null;
  $('#demoNote').classList.toggle('hidden', Backend.mode !== 'demo');
  setAuthMode('login'); if (msg) authMsg(msg);
  go('auth', false);
}

async function enterApp(u) {
  user = u; sessionLost = false;
  await loadUserData();
  if (curId && !cur()) curId = null;
  navStack = [];
  const c = cur(), last = LS.get(K.view, 'fichas');
  go(c && c.monitor.inicio && !c.monitor.fim ? 'monitor' : (['perfil', 'auth'].includes(last) ? 'fichas' : last), false);
  navStack = [];
  if (anestesiaEmAndamento()) keepAwake(true);
  Sync.start();
  await Sync.run('login');
  render();
}

async function logout(skipConfirm) {
  if (!skipConfirm) {
    const pend = Sync.info().pending;
    if (anestesiaEmAndamento() && !confirm('Há uma anestesia em andamento. Sair da conta mesmo assim?')) return;
    if (pend && !confirm(`Há ${pend} alteração(ões) ainda não enviadas à nuvem. Elas ficam guardadas neste aparelho e serão enviadas quando você entrar novamente. Sair mesmo assim?`)) return;
    if (!pend && !confirm('Sair da sua conta neste aparelho?')) return;
    if (navigator.onLine && !sessionLost) await Sync.run('logout');
  }
  clearTimeout(saveT);
  await Store.set(ukey('fichas'), fichas);
  await Store.set(ukey('profile'), profile);
  leaving = true; Sync.stop();
  await Native.Awake.disable();
  try { await Backend.signOut(); } finally { leaving = false; }
  sessionLost = false;
  showAuth();
}

// Sessão perdida (token revogado/expirado): não derruba o usuário no meio de
// uma anestesia; mostra aviso e pede novo login quando ele quiser.
function onAuthLost(msg) {
  if (!user || leaving) return;
  sessionLost = true; Sync.stop();
  toast('Sessão expirada – seus dados continuam salvos neste aparelho', 'err');
  render();
}

/* --------------------------- Botão Voltar --------------------------- */
function handleBack() {
  const open = $$('.overlay:not(.hidden)');
  if (open.length) { closeModal(open[open.length - 1]); return; }
  if (view === 'auth') return askExit();
  while (navStack.length) { const v = navStack.pop(); if (v !== view) { go(v, false); return; } }
  if (view !== 'fichas') { go('fichas', false); return; }
  askExit();
}
function askExit() {
  $('#exitWarn').classList.toggle('hidden', !(user && anestesiaEmAndamento()));
  $('#exitModal').classList.remove('hidden');
}
$('#exitConfirm').onclick = async () => {
  closeModal($('#exitModal'));
  if (user) { clearTimeout(saveT); await Store.set(ukey('fichas'), fichas); }
  Native.exitApp();
};

/* ------------------------------- Boot ------------------------------- */
async function boot() {
  $('#auUf').innerHTML = '<option value="">UF</option>' + UFS.map(u => `<option>${u}</option>`).join('');
  $('#trialDays').textContent = CFG.TRIAL_DAYS;
  await Store.init();
  Native.initBack(handleBack);
  Native.onResume(() => {
    if (!user) return;
    if (!sessionLost) Sync.run('resume');
    if (pay.waiting) verificarPagamento(false);
    if (anestesiaEmAndamento()) keepAwake(true);
  });
  Sync.onChange(renderSyncUI);
  Sync.setHandlers({ onRemoteChange: () => render(), onAuthLost });
  Backend.onAuthChange(s => { if (!s && user && !leaving) onAuthLost(); });
  const s = await Backend.restore();
  if (s && s.user) await enterApp(s.user); else showAuth();
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !isNative()) navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
