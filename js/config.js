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

  // Planos exibidos no checkout. O preço cobrado é definido no servidor
  // (supabase/functions/_shared/plans.ts); mantenha os dois iguais.
  PLANOS: [
    { id: 'mensal', nome: 'Pro Mensal', preco: 39.90, periodo: 'mês' },
    { id: 'anual', nome: 'Pro Anual', preco: 359.90, periodo: 'ano', destaque: 'Economize 25%' },
  ],

  // Checkout dentro do app Android:
  //  'inapp'    → mostra Pix/cartão no app (verifique a política de pagamentos da Play Store)
  //  'external' → o botão "Assinar" abre CHECKOUT_SITE_URL no navegador
  NATIVE_CHECKOUT: 'inapp',
  CHECKOUT_SITE_URL: '',

  SUPORTE_EMAIL: '',
  SYNC_INTERVAL_MS: 60000,
};
