/* =====================================================================
   Pix – gera o "BR Code" (padrão EMV do Banco Central) de um Pix com
   valor e identificador, a partir de uma chave Pix comum, e o QR Code.
   Não usa nenhuma API: o dinheiro cai direto na conta dona da chave.
   Manual de Padrões para Iniciação do Pix (BCB) – QR Code estático.
   ===================================================================== */
window.Pix = (() => {
  const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '');
  const campo = (id, valor) => id + String(valor.length).padStart(2, '0') + valor;

  // CRC16-CCITT (polinômio 0x1021, valor inicial 0xFFFF), exigido no campo 63.
  function crc16(str) {
    let crc = 0xFFFF;
    for (let i = 0; i < str.length; i++) {
      crc ^= str.charCodeAt(i) << 8;
      for (let b = 0; b < 8; b++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  // Normaliza a chave: CPF/CNPJ só dígitos, telefone em +55DDDNÚMERO, e-mail minúsculo, aleatória como está.
  function normalizarChave(chave) {
    let k = String(chave || '').trim();
    if (/@/.test(k)) return k.toLowerCase();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) return k.toLowerCase();
    if (/^\+/.test(k)) return '+' + k.replace(/\D/g, '');
    const d = k.replace(/\D/g, '');
    if (/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(k) || /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(k)) return d;
    if (/[()\s-]/.test(k) && (d.length === 10 || d.length === 11)) return '+55' + d;   // (11) 98765-4321
    return d.length >= 11 && d.length === k.length ? d : k;
  }

  /** Gera o "Pix copia e cola". valor em reais (número), txid até 25 caracteres [A-Za-z0-9]. */
  function payload({ chave, nome, cidade, valor, txid, descricao }) {
    const gui = campo('00', 'br.gov.bcb.pix') + campo('01', normalizarChave(chave)) + (descricao ? campo('02', semAcento(descricao).slice(0, 40)) : '');
    const tx = (String(txid || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25)) || '***';
    let s = campo('00', '01')
      + campo('26', gui)
      + campo('52', '0000')
      + campo('53', '986')
      + (valor ? campo('54', Number(valor).toFixed(2)) : '')
      + campo('58', 'BR')
      + campo('59', semAcento(nome).toUpperCase().slice(0, 25).trim() || 'RECEBEDOR')
      + campo('60', semAcento(cidade).toUpperCase().slice(0, 15).trim() || 'BRASIL')
      + campo('62', campo('05', tx))
      + '6304';
    return s + crc16(s);
  }

  /** QR Code do payload como <svg> (nítido em qualquer tela). */
  function qrSvg(texto, px = 240) {
    const qr = qrcode(0, 'M'); qr.addData(texto); qr.make();
    const n = qr.getModuleCount(), m = 4, size = n + m * 2;
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + m},${r + m}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${px}" height="${px}" shape-rendering="crispEdges" role="img" aria-label="QR Code Pix"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }

  const novoTxid = () => 'VA' + Array.from(crypto.getRandomValues(new Uint8Array(8)), b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');

  return { payload, qrSvg, crc16, normalizarChave, novoTxid };
})();
