/* =====================================================================
   Autocomplete – lista de sugestões própria (substitui o <datalist>, que
   não filtra por espécie, não busca por sigla e varia entre navegadores).
   Uso: <input data-ac="nomeDaFonte"> + Autocomplete.register(nome, fn),
   onde fn() devolve [{ value, label, hint?, keys? }]. A busca ignora
   acentos/maiúsculas e encontra qualquer palavra do nome, sigla ou apelidos.
   Ao escolher, o input recebe o valor e dispara "input" e "change".
   ===================================================================== */
window.Autocomplete = (() => {
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const sources = {};
  let box = null, input = null, shown = [], idx = -1, closeT = null;

  function ensureBox() {
    if (box) return box;
    box = document.createElement('div');
    box.id = 'acBox';
    box.setAttribute('role', 'listbox');
    box.className = 'hidden fixed z-[45] bg-white border border-slate-300 rounded-xl shadow-xl overflow-y-auto overscroll-contain';
    box.addEventListener('pointerdown', e => {           // pointerdown: escolhe antes de o input perder o foco
      const it = e.target.closest('[data-i]'); if (!it) return;
      e.preventDefault(); choose(+it.dataset.i);
    });
    document.body.appendChild(box);
    return box;
  }

  function filter(list, q) {
    const nq = norm(q).trim();
    if (!nq) return list.slice(0, 300);
    const toks = nq.split(/\s+/);
    const out = [];
    list.forEach((it, i) => {
      const label = norm(it.label), keys = norm([it.label, it.hint, ...(it.keys || [])].join(' | '));
      if (!toks.every(t => keys.includes(t))) return;
      const words = keys.split(/[\s|(),/+-]+/);
      const score = label.startsWith(nq) || norm(it.hint).startsWith(nq) ? 0 : words.some(w => w.startsWith(toks[0])) ? 1 : 2;
      out.push({ it, score, i });
    });
    return out.sort((a, b) => a.score - b.score || a.i - b.i).slice(0, 80).map(x => x.it);
  }

  function position() {
    if (!input || !box) return;
    const r = input.getBoundingClientRect(), vh = window.innerHeight;
    const below = vh - r.bottom - 8, above = r.top - 8;
    const up = below < 180 && above > below;
    const max = Math.min(288, up ? above : below);
    Object.assign(box.style, { left: r.left + 'px', width: r.width + 'px', maxHeight: max + 'px', top: up ? '' : (r.bottom + 4) + 'px', bottom: up ? (vh - r.top + 4) + 'px' : '' });
  }

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function render() {
    const src = sources[input.dataset.ac];
    shown = src ? filter(src(input), input.value) : [];
    if (!shown.length) return hide();
    idx = Math.min(idx, shown.length - 1);
    ensureBox().innerHTML = shown.map((it, i) => `<div data-i="${i}" role="option" class="flex items-center gap-2 px-3 py-2.5 text-sm cursor-pointer border-b border-slate-100 last:border-0 ${i === idx ? 'bg-brand-50' : 'hover:bg-slate-50'}">
      <span class="flex-1 text-slate-800">${esc(it.label)}</span>${it.hint ? `<span class="shrink-0 rounded-md bg-brand-100 text-brand-800 text-xs font-bold px-2 py-0.5">${esc(it.hint)}</span>` : ''}</div>`).join('');
    box.classList.remove('hidden'); position();
    const cur = box.querySelector(`[data-i="${idx}"]`); if (cur) cur.scrollIntoView({ block: 'nearest' });
  }
  function hide() { if (box) box.classList.add('hidden'); shown = []; idx = -1; }
  function choose(i) {
    const it = shown[i]; if (!it || !input) return;
    input.value = it.value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    hide();
  }

  document.addEventListener('focusin', e => {
    const el = e.target.closest && e.target.closest('input[data-ac]'); if (!el) return;
    clearTimeout(closeT); input = el; idx = -1; render();
  });
  document.addEventListener('input', e => { if (e.target === input && e.isTrusted) { idx = -1; render(); } });
  document.addEventListener('focusout', e => { if (e.target === input) closeT = setTimeout(hide, 150); });
  document.addEventListener('keydown', e => {
    if (e.target !== input || !box || box.classList.contains('hidden')) return;
    if (e.key === 'ArrowDown') { idx = Math.min(shown.length - 1, idx + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { idx = Math.max(0, idx - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter' && idx >= 0) { choose(idx); e.preventDefault(); }
    else if (e.key === 'Escape') { hide(); e.preventDefault(); }
  });
  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, true);

  return { register: (name, fn) => { sources[name] = fn; }, hide, norm, isOpen: () => !!box && !box.classList.contains('hidden') };
})();
