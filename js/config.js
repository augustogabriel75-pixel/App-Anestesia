/* =====================================================================
   Configuração do VetAnest
   ---------------------------------------------------------------------
   SUPABASE_URL / SUPABASE_ANON_KEY vazios = MODO DEMONSTRAÇÃO:
   contas, assinatura e "nuvem" são simulados neste aparelho.
   Preencha com os dados do seu projeto Supabase (Settings → API) para
   ativar contas reais, sincronização na nuvem e cobrança.
   A anon key é pública por natureza; a segurança vem das políticas RLS
   (supabase/schema.sql). NUNCA coloque a service_role key aqui.
   No build do Android, as variáveis VA_SUPABASE_URL e
   VA_SUPABASE_ANON_KEY sobrescrevem estes valores.
   ===================================================================== */
window.VA_CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',

  // Plano gratuito (após o teste ou com a assinatura vencida)
  TRIAL_DAYS: 14,                 // informativo; o valor real é definido no banco
  FREE_LIMIT_FICHAS_ATIVAS: 3,    // fichas não finalizadas permitidas sem assinatura

  // Planos exibidos no checkout. Com o servidor configurado, o preço exibido e
  // cobrado vem da tabela public.plans (supabase/schema.sql); estes valores são
  // usados no modo demonstração e enquanto o app não consulta o servidor.
  PLANOS: [
    { id: 'mensal', nome: 'Pro Mensal', preco: 39.90, periodo: 'mês' },
    { id: 'anual', nome: 'Pro Anual', preco: 359.90, periodo: 'ano', destaque: 'Economize 25%' },
  ],

  // Forma de cobrança:
  //  'pix_manual'  → Pix com a SUA chave (sem API/conta de desenvolvedor). O cliente
  //                   paga e informa; você confirma na tela Administração do app.
  //  'mercadopago' → Pix/cartão com confirmação automática (exige Access Token do
  //                   Mercado Pago e as Edge Functions em supabase/functions).
  PAGAMENTO: 'pix_manual',
  PIX_CHAVE: '',          // sua chave Pix (CPF/CNPJ, e-mail, celular com DDD ou chave aleatória)
  PIX_NOME: '',           // nome do recebedor, como aparece no banco (até 25 letras)
  PIX_CIDADE: '',         // cidade do recebedor (até 15 letras)
  PRAZO_CONFIRMACAO: 'em até algumas horas (dias úteis)',

  // Endereço da versão web (usado no link de "Esqueci minha senha").
  SITE_URL: '',

  // Checkout dentro do app Android:
  //  'inapp'    → mostra Pix/cartão no app (verifique a política de pagamentos da Play Store)
  //  'external' → o botão "Assinar" abre CHECKOUT_SITE_URL no navegador
  NATIVE_CHECKOUT: 'inapp',
  CHECKOUT_SITE_URL: '',

  SUPORTE_EMAIL: '',
  SYNC_INTERVAL_MS: 60000,
};
