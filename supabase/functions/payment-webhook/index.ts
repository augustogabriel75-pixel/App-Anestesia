// =====================================================================
// payment-webhook – notificações do Mercado Pago.
// Nunca confia no corpo da notificação: consulta o pagamento na API do
// Mercado Pago e só então credita o período na assinatura do usuário.
// Idempotente: cada pagamento é creditado uma única vez (payments.credited).
// Secrets: MP_ACCESS_TOKEN, SUPABASE_SERVICE_ROLE_KEY (automático no Supabase),
//          MP_WEBHOOK_SECRET (opcional – valida o cabeçalho x-signature).
// Deploy com verify_jwt = false (ver supabase/config.toml).
// =====================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { MP_API, PLANS } from '../_shared/plans.ts';

const ok = (msg = 'ok') => new Response(msg, { status: 200 });

async function hmacHex(secret: string, msg: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
async function validSignature(req: Request, secret: string, dataId: string) {
  const header = req.headers.get('x-signature') ?? '';
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.trim().split('=') as [string, string]));
  if (!parts.ts || !parts.v1) return false;
  const requestId = req.headers.get('x-request-id') ?? '';
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
  return (await hmacHex(secret, manifest)) === parts.v1;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  let id = url.searchParams.get('data.id') ?? url.searchParams.get('id');
  let type = url.searchParams.get('type') ?? url.searchParams.get('topic');
  try {
    const body = await req.clone().json();
    id = String(body?.data?.id ?? id ?? '');
    type = body?.type ?? body?.topic ?? type;
  } catch { /* notificação só com query string */ }
  if (type !== 'payment' || !id) return ok('ignorado');

  const secret = Deno.env.get('MP_WEBHOOK_SECRET');
  if (secret && !(await validSignature(req, secret, url.searchParams.get('data.id') ?? id))) {
    return new Response('assinatura inválida', { status: 401 });
  }

  const token = Deno.env.get('MP_ACCESS_TOKEN')!;
  const r = await fetch(`${MP_API}/v1/payments/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return new Response('pagamento não encontrado', { status: 404 }); // o MP tenta novamente
  const p = await r.json();

  const [userId, plano] = String(p.external_reference ?? '').split(':');
  const plan = PLANS[plano];
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { error: upErr } = await admin.from('payments').upsert({
    id: String(p.id), user_id: userId || null, plan: plano ?? null, amount: p.transaction_amount,
    method: p.payment_method_id, status: p.status, raw: p,
  });
  if (upErr) { console.error(upErr); return new Response('erro ao registrar', { status: 500 }); }

  if (p.status !== 'approved' || !plan || !userId) return ok('sem crédito');
  if (Number(p.transaction_amount) + 0.005 < plan.price) { console.error('valor divergente', p.id, p.transaction_amount); return ok('valor divergente'); }

  // Marca como creditado de forma atômica; se já estava, não credita de novo.
  const { data: claimed, error: clErr } = await admin.from('payments')
    .update({ credited: true }).eq('id', String(p.id)).eq('credited', false).select('id');
  if (clErr) { console.error(clErr); return new Response('erro', { status: 500 }); }
  if (!claimed?.length) return ok('já creditado');

  const { data: sub } = await admin.from('subscriptions').select('current_period_end').eq('user_id', userId).maybeSingle();
  const start = Math.max(Date.now(), Date.parse(sub?.current_period_end ?? '') || 0);
  const end = new Date(start);
  end.setMonth(end.getMonth() + plan.months);
  const { error: subErr } = await admin.from('subscriptions').upsert({
    user_id: userId, status: 'active', plan: plano, current_period_end: end.toISOString(), updated_at: new Date().toISOString(),
  });
  if (subErr) {
    console.error(subErr);
    await admin.from('payments').update({ credited: false }).eq('id', String(p.id)); // permite nova tentativa
    return new Response('erro ao creditar', { status: 500 });
  }
  return ok('creditado');
});
