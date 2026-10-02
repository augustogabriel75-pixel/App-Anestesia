# Guia: colocar o VetAnest no ar e começar a vender

Você não precisa de conta de desenvolvedor no Mercado Pago. O cliente paga um **Pix comum na sua chave** e você confirma o recebimento com um toque na tela de **Administração** do próprio app. Leva uns 30 minutos e usa só serviços com plano gratuito.

Como funciona a venda:

1. O cliente toca em **Assinar Pro** e escolhe mensal ou anual.
2. O app mostra o **QR Code / Pix copia e cola** com o valor certo e um código (ex.: `VA7K2M9QXB`).
3. O cliente paga pelo app do banco e toca em **Já fiz o Pix**, informando o nome de quem pagou.
4. Você recebe o aviso no app ("💰 1 pagamento Pix aguardando sua confirmação"), confere no app do Mercado Pago se o dinheiro caiu e toca em **Confirmar recebimento**.
5. O Pro do cliente é liberado na hora, sem ele precisar fazer nada. A renovação soma ao tempo que ainda falta.

---

## Passo 1 – Criar o banco de dados (Supabase, grátis)

1. Acesse **https://supabase.com** → **Start your project** e entre com sua conta do GitHub.
2. Clique em **New project**:
   - **Name:** `vetanest`
   - **Database Password:** crie uma senha forte e guarde-a (o app não usa, mas o Supabase pede).
   - **Region:** **South America (São Paulo)**
   - Clique em **Create new project** e espere uns 2 minutos.
3. No menu lateral, abra **SQL Editor** → **New query**.
4. Abra o arquivo [`supabase/schema.sql`](supabase/schema.sql) no GitHub, clique em **Copy raw file** (ícone de copiar), cole tudo no editor e clique em **Run**. Deve aparecer *Success. No rows returned*.
   > Pode rodar de novo sem problema sempre que o arquivo for atualizado.
5. **Desligar a confirmação de e-mail** (recomendado no começo): **Authentication → Sign In / Providers → Email** → desmarque **Confirm email** → **Save**.
   > O e-mail gratuito do Supabase envia poucas mensagens por hora. Com a confirmação desligada, o cliente cria a conta e já entra. O "Esqueci minha senha" continua funcionando.
6. **Endereço do app**: **Authentication → URL Configuration**:
   - **Site URL:** `https://augustogabriel75-pixel.github.io/App-Anestesia/`
   - Em **Redirect URLs**, adicione o mesmo endereço → **Save**.
7. **Copie as duas chaves do app**: **Project Settings** (engrenagem) → **API** (ou **Data API / API Keys**):
   - **Project URL** (ex.: `https://abcdefgh.supabase.co`)
   - **anon public** key (um texto longo começando com `eyJ...`, ou `sb_publishable_...`)
   > ⚠️ Use só a chave **anon / publishable**. **Nunca** use a `service_role` / `secret` no app.

## Passo 2 – Sua chave Pix (Mercado Pago)

No app do Mercado Pago: **Pix → Minhas chaves**. Anote:
- **A chave**: CPF/CNPJ, e-mail, celular ou chave aleatória. Celular no formato `+5511987654321`.
- **Seu nome** como aparece para quem paga (até 25 letras).
- **Sua cidade** (até 15 letras).

## Passo 3 – Configurar o app no GitHub

No repositório: **Settings → Secrets and variables → Actions → aba Variables → New repository variable**. Crie uma variável por vez:

| Nome | Valor (exemplo) |
|---|---|
| `SUPABASE_URL` | `https://abcdefgh.supabase.co` |
| `SUPABASE_ANON_KEY` | `eyJhbGciOi...` (a chave *anon public*) |
| `PIX_CHAVE` | `+5511987654321` ou `seu@email.com` ou CPF/CNPJ |
| `PIX_NOME` | `Augusto Gabriel` |
| `PIX_CIDADE` | `Sao Paulo` |

> São **Variables**, não *Secrets*: nenhum desses valores é secreto (a chave Pix é para ser compartilhada mesmo).

## Passo 4 – Publicar na sua VPS com domínio próprio (recomendado)

Assim o cliente acessa algo como **https://app.vetanest.com.br**, com HTTPS, e baixa o app Android do seu próprio site (**https://app.vetanest.com.br/download/VetAnest.apk**). A cada alteração no código, o GitHub publica sozinho na VPS.

> Os scripts são para **Ubuntu/Debian**. Troque `app.seudominio.com.br` pelo seu domínio em todos os passos.

1. **DNS:** no painel onde você registrou o domínio (Registro.br, Hostinger, Cloudflare…), crie um registro **A** com nome `app` apontando para o **IP da VPS**. Espere alguns minutos.
2. **Chave de publicação:** no seu computador (Windows: PowerShell), gere uma chave só para o GitHub publicar:
   ```bash
   ssh-keygen -t ed25519 -N "" -C github-deploy -f deploy_vetanest
   ```
   Isso cria `deploy_vetanest` (chave **privada**, vai para o GitHub) e `deploy_vetanest.pub` (pública, vai para a VPS).
3. **Preparar a VPS** (uma vez), entrando nela por SSH como root:
   ```bash
   git clone https://github.com/augustogabriel75-pixel/App-Anestesia.git /opt/vetanest
   sudo bash /opt/vetanest/deploy/setup-vps.sh app.seudominio.com.br seu@email.com "COLE AQUI O CONTEÚDO DE deploy_vetanest.pub"
   ```
   O script instala nginx e o certificado HTTPS gratuito (Let's Encrypt) e cria o usuário `deploy`, que só pode publicar o site.
   > Faça este passo **antes** de deixar o repositório privado (depois disso o `git clone` pede login). Se já estiver privado, copie a pasta `deploy/` para a VPS (ex.: pelo WinSCP) e rode o mesmo comando a partir dela.
4. **Chave fixa do app Android** (uma vez, na VPS): sem ela cada APK sai com uma assinatura diferente e o celular do cliente **recusa a atualização**.
   ```bash
   cd ~ && bash /opt/vetanest/deploy/gerar-keystore.sh
   ```
   Guarde o arquivo `vetanest-release.keystore` e a senha mostrada (faça uma cópia fora da VPS). O script mostra os 4 *Secrets* a criar no próximo item.
5. **Secrets no GitHub:** **Settings → Secrets and variables → Actions → aba Secrets → New repository secret**:

   | Nome | Valor |
   |---|---|
   | `VPS_HOST` | IP da VPS (ou o domínio) |
   | `VPS_USER` | `deploy` |
   | `VPS_SSH_KEY` | conteúdo inteiro do arquivo `deploy_vetanest` (chave privada) |
   | `VPS_PORT` | só se o SSH não for na porta 22 |
   | `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | os valores mostrados pelo `gerar-keystore.sh` |

6. **Variável do endereço:** na aba **Variables**, crie `SITE_URL` = `https://app.seudominio.com.br/` (com a barra no final).
7. **Supabase:** em **Authentication → URL Configuration**, troque o **Site URL** e o **Redirect URL** para `https://app.seudominio.com.br/`.
8. **Publicar:** **Actions → Web (site) → Run workflow** e **Actions → Android APK → Run workflow**. Em ~4 minutos o site e o APK estão no ar. Na tela de login da versão web aparece o botão **📱 Baixar o app para Android**.

> **Deixe o repositório privado** (*Settings → General → Danger Zone → Change visibility*): assim ninguém copia o código do seu produto. Tudo acima continua funcionando no plano gratuito do GitHub (o GitHub Pages é que deixa de funcionar em repositório privado gratuito, mas com a VPS você não precisa dele).

### Alternativa sem VPS: GitHub Pages

1. **Settings → Pages** → em **Source**, escolha **GitHub Actions** (só funciona com o repositório público no plano gratuito).
2. **Actions → Web (site) → Run workflow**. O app fica em **https://augustogabriel75-pixel.github.io/App-Anestesia/**, e o APK continua na aba **Releases**.

No iPhone (qualquer das opções): abra o site no Safari → Compartilhar → **Adicionar à Tela de Início**.

## Passo 5 – Gerar o APK de produção

**Actions → Android APK → Run workflow** (ou qualquer alteração no código). Em ~3 minutos o novo APK está em **Releases** e, se a VPS estiver configurada, também em `https://SEU_DOMINIO/download/VetAnest.apk`, já ligado ao seu banco e à sua chave Pix. Na descrição da versão deve aparecer **"Modo: nuvem (Supabase)"**. Com a chave fixa (Passo 4, item 4), o cliente atualiza instalando o novo APK por cima, sem perder nada.

## Passo 6 – Virar administrador

1. Abra o app (APK ou web) e **crie sua conta** normalmente.
2. No Supabase → **SQL Editor** → rode, trocando pelo seu e-mail:
   ```sql
   update public.profiles set is_admin = true where email = 'seu@email.com';
   ```
3. No app, toque em **↻ Sincronizar** (Perfil). Aparece o cartão **💰 Administração – pagamentos Pix**.

## Passo 6b – Teste de segurança do banco (RLS)

No Supabase → **SQL Editor → New query**, cole o arquivo [`supabase/tests/rls_audit.sql`](supabase/tests/rls_audit.sql) e clique em **Run**. Ele cria 3 usuários de teste temporários, tenta 65 acessos indevidos e operações legítimas (ler fichas de outro cliente, virar admin, se dar assinatura, mudar preço, aprovar o próprio Pix…) e apaga tudo no final. Deve terminar com **"✅ OK – 66 de 66 verificações aprovadas"**. Rode de novo sempre que alterar o banco.

## Passo 7 – Testar uma venda de verdade (R$ 1,00)

1. Baixe o preço temporariamente (SQL Editor):
   ```sql
   update public.plans set preco = 1.00 where id = 'mensal';
   ```
2. Em outro celular, ou numa janela anônima do navegador, crie uma conta de cliente com outro e-mail → **Assinar Pro → Pro Mensal (R$ 1,00) → Pagar com Pix**. Pague e toque em **Já fiz o Pix**.
3. Na sua conta (admin) → **Perfil → Administração** → confira no Mercado Pago → **Confirmar recebimento**.
4. Em até 15 segundos o cliente vê **"Assinatura ativa!"**.
5. Volte o preço:
   ```sql
   update public.plans set preco = 39.90 where id = 'mensal';
   ```

## Dia a dia

- **Confirmar pagamentos:** Perfil → Administração. Confira no Mercado Pago o **valor** e o **nome de quem pagou** (informado pelo cliente). O código `VA…` também vai no Pix, mas nem todo banco o mostra ao recebedor. Se o dinheiro não caiu, toque em **Recusar**.
- **Mudar preços:** só no banco (o app passa a mostrar e cobrar o novo valor sozinho):
  ```sql
  update public.plans set preco = 49.90 where id = 'mensal';
  update public.plans set preco = 449.00 where id = 'anual';
  ```
- **Ver assinantes:**
  ```sql
  select p.nome, p.email, s.status, s.plan, s.trial_ends_at, s.current_period_end
  from public.subscriptions s join public.profiles p on p.id = s.user_id
  order by s.current_period_end desc nulls last;
  ```
- **Dar dias de cortesia a alguém:**
  ```sql
  update public.subscriptions set status = 'active', plan = 'mensal',
    current_period_end = greatest(now(), coalesce(current_period_end, now())) + interval '30 days'
  where user_id = (select id from public.profiles where email = 'cliente@email.com');
  ```

## Pontos de atenção

- **Play Store:** a Google exige o faturamento dela (Google Play Billing) para venda de assinaturas digitais dentro de apps da loja. Pix manual dentro do app pode levar à rejeição. Para vender com Pix sem problemas, distribua o **APK direto** (link do Releases ou do seu site) e a **versão web**. Se for publicar na Play Store, configure a variável `CHECKOUT_SITE_URL` com o link da versão web para o app Android abrir o pagamento fora do app, e confira as regras vigentes no Brasil.
- **Supabase gratuito:** projetos sem nenhum acesso por 7 dias são pausados (reativa com um clique no painel) e não têm backup automático diário. Quando tiver clientes pagantes, considere o plano Pro do Supabase.
- **E-mails:** para muitos usuários usando "Esqueci minha senha", configure um SMTP próprio em **Authentication → Emails → SMTP Settings** (ex.: Brevo ou Resend, ambos com plano gratuito).
- **LGPD:** o app guarda dados de tutores (nome, telefone, CPF). Publique **Termos de Uso** e **Política de Privacidade** e informe um e-mail de contato.
- **Confirmação automática no futuro:** quando quiser que o Pix seja liberado sem você conferir, crie uma aplicação no Mercado Pago Developers, configure `PAGAMENTO = mercadopago` e publique as Edge Functions (veja o README, seção "Colocando em produção").
