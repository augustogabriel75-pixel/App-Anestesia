// =====================================================================
// create-checkout – inicia o pagamento da assinatura no Mercado Pago.
//   POST { plano: 'mensal' | 'anual', metodo: 'pix' | 'cartao' }
//   Pix    → cria o pagamento e devolve QR Code + "copia e cola".
//   Cartão → cria uma preferência do Checkout Pro e devolve a URL
//            (os dados do cartão são digitados só no ambiente do Mercado Pago).
// Secrets: MP_ACCESS_TOKEN (obrigatório), APP_SITE_URL (opcional, retorno do cartão).
// =====================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { cors, json, MP_API, PLANS } from '../_shared/plans.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
    if (authError || !user) return json({ error: 'Não autenticado' }, 401);

    const { plano, metodo } = await req.json().catch(() => ({}));
    const plan = PLANS[plano];
    if (!plan || !['pix', 'cartao'].includes(metodo)) return json({ error: 'Plano ou forma de pagamento inválida' }, 400);

    const token = Deno.env.get('MP_ACCESS_TOKEN');
    if (!token) return json({ error: 'Pagamentos não configurados no servidor' }, 500);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() };
    const external_reference = `${user.id}:${plano}`;
    const notification_url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/payment-webhook`;

    if (metodo === 'pix') {
      const expires = new Date(Date.now() + 30 * 60_000).toISOString().replace('Z', '+00:00');
      const r = await fetch(`${MP_API}/v1/payments`, {
        method: 'POST', headers,
        body: JSON.stringify({
          transaction_amount: plan.price, description: plan.name, payment_method_id: 'pix',
          payer: { email: user.email }, external_reference, notification_url, date_of_expiration: expires,
        }),
      });
      const p = await r.json();
      if (!r.ok) return json({ error: p.message || 'Falha ao gerar o Pix' }, 502);
      const td = p.point_of_interaction?.transaction_data ?? {};
      return json({
        payment_id: String(p.id),
        pix: { qr_code: td.qr_code, qr_code_base64: td.qr_code_base64, ticket_url: td.ticket_url, expires_at: p.date_of_expiration },
      });
    }

    const site = Deno.env.get('APP_SITE_URL');
    const r = await fetch(`${MP_API}/checkout/preferences`, {
      method: 'POST', headers,
      body: JSON.stringify({
        items: [{ id: plano, title: plan.name, quantity: 1, unit_price: plan.price, currency_id: 'BRL' }],
        payer: { email: user.email }, external_reference, notification_url,
        payment_methods: { excluded_payment_types: [{ id: 'ticket' }], installments: 12 },
        ...(site ? { back_urls: { success: site, failure: site, pending: site }, auto_return: 'approved' } : {}),
      }),
    });
    const pref = await r.json();
    if (!r.ok) return json({ error: pref.message || 'Falha ao iniciar o pagamento com cartão' }, 502);
    return json({ url: pref.init_point, preference_id: pref.id });
  } catch (e) {
    console.error(e);
    return json({ error: 'Erro interno ao iniciar o pagamento' }, 500);
  }
});
