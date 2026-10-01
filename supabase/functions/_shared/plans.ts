// Preços cobrados (fonte da verdade). Mantenha igual a PLANOS em js/config.js.
export const PLANS: Record<string, { name: string; price: number; months: number }> = {
  mensal: { name: 'VetAnest Pro Mensal', price: 39.9, months: 1 },
  anual: { name: 'VetAnest Pro Anual', price: 359.9, months: 12 },
};

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

export const MP_API = Deno.env.get('MP_API_URL') ?? 'https://api.mercadopago.com';
