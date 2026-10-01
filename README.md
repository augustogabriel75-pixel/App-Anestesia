# VetAnest Monitor — Ficha Anestésica Veterinária

Aplicativo (PWA + Android) para **monitoramento anestésico veterinário em tempo real** e **exportação da ficha anestésica em PDF**, com **contas de usuário, assinatura freemium (Pix/cartão) e sincronização na nuvem**. Pensado para uso rápido em celular ou tablet no centro cirúrgico: botões grandes, controles −/+ com repetição ao segurar e valores pré-preenchidos a partir do último registro. Funciona **offline-first**: nada se perde se a internet cair durante a cirurgia.

## Como usar

- **Online:** publique a pasta em qualquer hospedagem estática (GitHub Pages, Netlify, Vercel…) e abra o `index.html`. No celular, use "Adicionar à tela inicial" para instalar como app.
- **Local:** `npx http-server .` e acesse `http://localhost:8080`. Abrir o arquivo direto (`file://`) também funciona, mas sem o modo offline.

Após o primeiro acesso online, o service worker guarda o app e as bibliotecas em cache, e ele passa a funcionar **offline**.

## App Android (APK)

A cada push, o workflow **Android APK** (GitHub Actions) empacota o app com [Capacitor](https://capacitorjs.com) e publica o `VetAnest.apk` na aba **Releases** do repositório. No APK, o Tailwind (CSS compilado) e o jsPDF vão embutidos, então o app funciona **100% offline** desde a primeira abertura. O PDF e o backup são salvos pela tela de compartilhamento do Android (salvar no Drive/Arquivos, WhatsApp, e-mail…).

Para instalar, baixe o `VetAnest.apk` no celular, abra o arquivo e autorize "instalar apps desconhecidos". O APK é de teste (debug). Com a keystore configurada (veja abaixo), o workflow também gera o **`VetAnest-release.aab` assinado** para a Play Store.

No Android:
- **Botão/gesto Voltar** (`@capacitor/app`): fecha o modal aberto, senão volta para a tela anterior; na tela inicial pergunta antes de sair e avisa se há anestesia em andamento. O app nunca fecha sem confirmação. No navegador/PWA, o mesmo comportamento usa a History API.
- **Tela sempre acesa** (`@capacitor-community/keep-awake`, `FLAG_KEEP_SCREEN_ON`) enquanto houver anestesia em andamento; no navegador usa a Screen Wake Lock API, readquirida ao voltar ao app. Um indicador no Monitor mostra se está ativa.

Build local (requer Android SDK + JDK 17): `npm ci && npx cap add android && npm run android:apk`.

## Contas, assinatura e nuvem

> **Para colocar no ar e vender, siga o [GUIA-DE-VENDAS.md](GUIA-DE-VENDAS.md)** (Supabase + Pix na sua chave, sem conta de desenvolvedor).

| Recurso | Como funciona |
|---|---|
| **Login / cadastro** | E-mail, senha, nome profissional, CRMV e UF (Supabase Auth). Esqueci a senha por e-mail. A sessão fica salva e o token é renovado automaticamente. O primeiro acesso em um aparelho precisa de internet; depois disso o app abre offline. |
| **Plano (freemium)** | `trial` (14 dias ao criar a conta) → `ativo` (assinatura paga) → `expirado` (plano gratuito). O status vem do servidor e fica em cache para funcionar offline. |
| **Recursos Pro** | Fichas em aberto ilimitadas (gratuito: até 3, configurável) e **PDF com logotipo e assinatura digital** (gratuito: PDF sem eles, com a marca "plano gratuito"). Fichas e PDFs já existentes nunca ficam bloqueados, e a monitoração em andamento nunca é interrompida. |
| **Checkout – Pix manual** (padrão) | O app gera o Pix (BR Code do Banco Central, QR + copia e cola) na **sua chave**, com o valor do plano e um código de identificação. O cliente paga e toca em **Já fiz o Pix**. Você confere o recebimento e toca em **Confirmar** na tela **Administração** do app, e o Pro é liberado na hora no aparelho do cliente. Não precisa de conta de desenvolvedor. |
| **Checkout – Mercado Pago** (opcional) | `PAGAMENTO: 'mercadopago'`: Pix e cartão com confirmação automática via API e webhook (Edge Functions). Exige uma aplicação no Mercado Pago Developers. |
| **Preços** | Definidos no banco (tabela `plans`). O app mostra e o servidor grava sempre o preço oficial, mesmo que alguém altere o app. |
| **Senha** | "Esqueci minha senha" envia um link por e-mail que abre a versão web em "Defina sua nova senha". |
| **Offline-first** | Os dados são gravados primeiro no aparelho (**IndexedDB**, com fallback para localStorage), e a ficha em edição também vai para um *journal* síncrono a cada alteração. |
| **Sincronização** | Automática ao entrar, ao reconectar, ao voltar ao app, ~3 s após cada alteração e a cada 60 s. Envia o que mudou e baixa o que mudou em outros aparelhos (pull incremental). Em conflito vence a edição mais recente, também no servidor. Exclusões são sincronizadas. O ícone ☁️ no topo mostra o estado (sincronizado, pendente, offline, erro). |
| **Sessão expirada** | O usuário não é desconectado no meio de uma anestesia: aparece um aviso, os dados continuam no aparelho e ele entra de novo quando puder. |

### Modo demonstração

Com `SUPABASE_URL` vazio em `js/config.js`, o app roda em **modo demonstração**: conta, assinatura e "nuvem" são simuladas no próprio aparelho. Há botões para simular o fim do teste e a aprovação do pagamento. Use para testar o fluxo antes de configurar o servidor.

### Colocando em produção (confirmação automática via Mercado Pago)

Para o Pix manual basta o [GUIA-DE-VENDAS.md](GUIA-DE-VENDAS.md). Os passos abaixo são para a cobrança automática pela API do Mercado Pago:

1. **Supabase**: crie um projeto em [supabase.com](https://supabase.com) e rode `supabase/schema.sql` no *SQL Editor*. Ele cria as tabelas, os triggers e as políticas RLS: cada usuário só acessa os próprios dados e o app não consegue alterar a assinatura.
2. **Mercado Pago**: crie uma aplicação em [mercadopago.com.br/developers](https://www.mercadopago.com.br/developers) e pegue o *Access Token* de produção. Configure o webhook (tópico *Pagamentos*) para `https://<projeto>.supabase.co/functions/v1/payment-webhook` e copie a *assinatura secreta*.
3. **Edge Functions**:
   ```bash
   supabase link --project-ref <projeto>
   supabase secrets set MP_ACCESS_TOKEN=APP_USR-... MP_WEBHOOK_SECRET=... APP_SITE_URL=https://seusite
   supabase functions deploy create-checkout
   supabase functions deploy payment-webhook --no-verify-jwt
   ```
   Os preços cobrados ficam em `supabase/functions/_shared/plans.ts`. Mantenha-os iguais aos de `PLANOS` em `js/config.js`, que são só para exibição.
4. **App**: preencha `SUPABASE_URL` e `SUPABASE_ANON_KEY` em `js/config.js` (versão web). Para o APK, crie as *Variables* `SUPABASE_URL` e `SUPABASE_ANON_KEY` em *Settings → Secrets and variables → Actions* do GitHub. A anon key é pública por natureza; **nunca** use a service_role key no app.
5. **Play Store**: gere uma keystore (`keytool -genkey -v -keystore vetanest.keystore -alias vetanest -keyalg RSA -keysize 2048 -validity 10000`) e crie os *Secrets* `ANDROID_KEYSTORE_BASE64` (`base64 -w0 vetanest.keystore`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` e `ANDROID_KEY_PASSWORD`. Guarde a keystore em local seguro: sem ela não é possível atualizar o app na loja.

### Antes de vender

- **Política de pagamentos do Google Play**: apps distribuídos pela Play Store que vendem assinaturas digitais em geral precisam usar o Google Play Billing (ou um programa de faturamento alternativo aprovado). Verifique as regras vigentes no Brasil antes de publicar com Pix/cartão dentro do app. Se necessário, use `NATIVE_CHECKOUT: 'external'` em `js/config.js` para o app Android abrir o checkout no seu site em vez de mostrá-lo no app.
- **LGPD**: o app guarda dados pessoais de tutores (nome, telefone, CPF). Publique termos de uso e uma política de privacidade e defina o processo para pedidos de exclusão de dados.
- O bloqueio de recursos é feito no app. A assinatura em si só é alterada no servidor, mas um usuário com conhecimento técnico poderia contornar os limites locais. Para limites rígidos (ex.: número de fichas), valide também no banco.

## Funcionalidades

| Tela | O que faz |
|---|---|
| **Perfil** (ícone 👤) | Conta e assinatura (status do plano, assinar/renovar, sincronizar, sair). Nome do anestesista, CRMV/UF, clínica padrão, contato, **logotipo** (upload) e **assinatura** (upload ou desenhada na tela), salvos na conta e disponíveis em todos os aparelhos. |
| **Fichas** | Lista, busca, abertura e exclusão de fichas; backup e restauração em JSON. |
| **Paciente** | Clínica (editável por paciente), tutor (nome, telefone/WhatsApp com máscara, CPF opcional), paciente (espécie, raça, idade, sexo, castração, peso), procedimento, data, cirurgião, ASA I–V (+E), risco anestésico, jejum sólido/líquido, avaliação pré-anestésica. |
| **Fármacos** | MPA, indução, manutenção, analgesia/bloqueios e resgates: fármaco, dose (mg/kg, mcg/kg, mcg/kg/min, mg/kg/h…), via e horário. **Cálculo automático** da dose total e do volume (mL) a partir do peso e da concentração (concentrações usuais são sugeridas). Fluidoterapia (tipo e taxa em mL/kg/h e mL/h). |
| **Monitor** | Cronômetro da anestesia, intervalo de registro de 5/10/15 min com **alarme sonoro e vibratório**, tela sempre acesa (nativo no Android, Wake Lock no navegador). Registro de FC, FR, PAS/PAD/PAM (PAM calculada automaticamente), SpO₂, EtCO₂, temperatura, glicemia, plano de Guedel, reflexos palpebral e corneano, globo ocular, agente e % do vaporizador, FiO₂, modo ventilatório, VC, PEEP, pressão de pico e observações. Eventos com um toque (intubação, incisão, bolus, hipotensão, extubação…). Últimos valores, gráfico de tendência e tabela editável. Valores fora da faixa aproximada da espécie aparecem em vermelho. |
| **Resumo/PDF** | Horários (início/fim da anestesia e da cirurgia, extubação), volume total de fluido (com estimativa por taxa × duração), intercorrências trans e pós-operatórias imediatas, qualidade da recuperação e **exportação do PDF** (download, visualização ou compartilhamento pelo celular). |

### Ficha em PDF (A4 paisagem)

1. Cabeçalho com logotipo, nome da clínica, anestesista, CRMV/UF e data.
2. Bloco com dados do paciente, do tutor e do procedimento.
3. Protocolo anestésico (fases, doses, vias, horários, dose total, volume) e fluidoterapia.
4. Tabela temporal com todos os parâmetros (hora, T+min, sinais vitais, plano, reflexos, vaporizador, ventilação, observações e eventos).
5. Gráfico de tendência (opcional).
6. Resumo final, assinatura digital e espaço para carimbo. Rodapé com paginação.

Anestesias curtas cabem em uma página; as mais longas ocupam duas ou mais páginas automaticamente.

## Tecnologia

- `index.html`: interface e lógica clínica (HTML + JavaScript puro, sem build).
- `js/config.js`: configuração (Supabase, planos, limites do plano gratuito, modo do checkout no Android).
- `js/store.js`: armazenamento local (IndexedDB + journal síncrono).
- `js/backend.js`: autenticação, conta, sincronização e checkout via API REST do Supabase, sem SDK. Inclui o backend de demonstração.
- `js/sync.js`: motor de sincronização offline-first.
- `js/account.js`: login/cadastro, plano freemium, checkout, administração de pagamentos, botão Voltar e inicialização.
- `js/pix.js` + `js/vendor/qrcode.js`: geração do Pix (BR Code com CRC16) e do QR Code, sem API.
- `js/native.js`: integração com o Android (voltar, tela acesa, navegador externo) e alternativas para o navegador.
- `supabase/`: schema SQL com RLS e Edge Functions (`create-checkout`, `payment-webhook`) para o Mercado Pago.
- [Tailwind CSS](https://tailwindcss.com) (Play CDN na web, CSS compilado no APK), [jsPDF](https://github.com/parallax/jsPDF) e [jsPDF-AutoTable](https://github.com/simonbengtsson/jsPDF-AutoTable).
- `manifest.webmanifest` e `sw.js` para a instalação como PWA e o uso offline; [Capacitor](https://capacitorjs.com) para o Android.
- Workflows: **Android APK** (APK/AAB em Releases) e **Web (GitHub Pages)** (versão web publicada a cada alteração).

## Avisos

- No modo demonstração os dados ficam só no aparelho. Com o servidor configurado, ficam também na nuvem da conta. O backup em JSON (Fichas → Backup) continua disponível.
- Os cálculos de dose, as concentrações sugeridas e as faixas de referência são auxílios. **Sempre confira** antes de administrar qualquer fármaco. A responsabilidade clínica é do médico veterinário.
