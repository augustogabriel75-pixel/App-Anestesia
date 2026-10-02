-- =====================================================================
-- VetAnest – schema do Supabase (Postgres)
-- Execute no SQL Editor do projeto (ou via `supabase db push`).
-- Segurança: Row Level Security em todas as tabelas. O app (anon key)
-- só lê/grava os próprios dados e NUNCA altera assinatura/pagamentos —
-- isso é feito apenas pelas Edge Functions com a service_role key.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Perfil profissional (1:1 com auth.users)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id                  uuid primary key references auth.users on delete cascade,
  email               text,
  nome                text,
  crmv                text,
  uf                  text,
  settings            jsonb  not null default '{}'::jsonb,  -- clínica, contato, logotipo, assinatura (data URLs)
  settings_updated_at bigint not null default 0,            -- relógio do cliente (ms), usado na sincronização
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Assinatura (escrita somente pelo servidor)
-- ---------------------------------------------------------------------
create table if not exists public.subscriptions (
  user_id            uuid primary key references auth.users on delete cascade,
  status             text not null default 'trial' check (status in ('trial', 'active', 'canceled')),
  plan               text,
  trial_ends_at      timestamptz not null default (now() + interval '14 days'),
  current_period_end timestamptz,
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Pagamentos recebidos (idempotência do webhook + histórico)
-- ---------------------------------------------------------------------
create table if not exists public.payments (
  id         text primary key,                 -- id do pagamento no Mercado Pago
  user_id    uuid references auth.users on delete set null,
  plan       text,
  amount     numeric(10, 2),
  method     text,
  status     text,
  raw        jsonb,
  credited   boolean not null default false,  -- período já creditado na assinatura (idempotência)
  created_at timestamptz not null default now()
);
alter table public.payments add column if not exists credited boolean not null default false;

-- ---------------------------------------------------------------------
-- Fichas anestésicas (documento JSON completo, sincronizado do app)
-- ---------------------------------------------------------------------
create table if not exists public.fichas (
  id                text primary key,
  user_id           uuid not null default auth.uid() references auth.users on delete cascade,
  data              jsonb   not null,
  client_updated_at bigint  not null,          -- updatedAt do aparelho (ms) – last-write-wins
  deleted           boolean not null default false,
  server_updated_at timestamptz not null default clock_timestamp()  -- cursor do pull incremental
);
create index if not exists fichas_user_sync_idx on public.fichas (user_id, server_updated_at);

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
-- Novo usuário: cria perfil (com nome/CRMV/UF do cadastro) e período de teste.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, nome, crmv, uf)
  values (new.id, new.email,
          new.raw_user_meta_data ->> 'nome',
          new.raw_user_meta_data ->> 'crmv',
          new.raw_user_meta_data ->> 'uf')
  on conflict (id) do nothing;
  insert into public.subscriptions (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Fichas: last-write-wins no servidor e dono imutável.
create or replace function public.fichas_before_write()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.client_updated_at < old.client_updated_at then
      return old;                                  -- versão mais antiga: ignora (não sobrescreve)
    end if;
    new.user_id := old.user_id;                    -- não permite trocar o dono
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists fichas_before_write on public.fichas;
create trigger fichas_before_write before insert or update on public.fichas
  for each row execute function public.fichas_before_write();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments      enable row level security;
alter table public.fichas        enable row level security;

drop policy if exists "perfil: ler o próprio"      on public.profiles;
drop policy if exists "perfil: editar o próprio"   on public.profiles;
create policy "perfil: ler o próprio"    on public.profiles for select using (auth.uid() = id);
create policy "perfil: editar o próprio" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- Assinatura e pagamentos: somente leitura para o dono (escrita só via service_role).
drop policy if exists "assinatura: ler a própria" on public.subscriptions;
create policy "assinatura: ler a própria" on public.subscriptions for select using (auth.uid() = user_id);
drop policy if exists "pagamentos: ler os próprios" on public.payments;
create policy "pagamentos: ler os próprios" on public.payments for select using (auth.uid() = user_id);

drop policy if exists "fichas: ler as próprias"    on public.fichas;
drop policy if exists "fichas: criar as próprias"  on public.fichas;
drop policy if exists "fichas: editar as próprias" on public.fichas;
create policy "fichas: ler as próprias"    on public.fichas for select using (auth.uid() = user_id);
create policy "fichas: criar as próprias"  on public.fichas for insert with check (auth.uid() = user_id);
create policy "fichas: editar as próprias" on public.fichas for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- Sem policy de DELETE: exclusões são "tombstones" (deleted = true) para sincronizar entre aparelhos.

-- O cliente não pode alterar colunas sensíveis do perfil além das suas.
revoke update on public.profiles from anon, authenticated;
grant  update (nome, crmv, uf, settings, settings_updated_at) on public.profiles to authenticated;

-- =====================================================================
-- PIX MANUAL (sem API/conta de desenvolvedor no Mercado Pago)
-- O cliente paga o Pix gerado com a SUA chave e toca "Já fiz o Pix";
-- você confere o recebimento no app do banco/Mercado Pago e confirma na
-- tela "Administração" do VetAnest. A confirmação libera o Pro na hora.
-- =====================================================================

-- Quem pode confirmar pagamentos. Torne-se admin com:
--   update public.profiles set is_admin = true where email = 'seu@email.com';
alter table public.profiles add column if not exists is_admin boolean not null default false;

-- Planos e preços (fonte da verdade para o valor cobrado).
create table if not exists public.plans (
  id    text primary key,
  nome  text not null,
  preco numeric(10, 2) not null,
  meses int not null check (meses > 0)
);
insert into public.plans (id, nome, preco, meses) values
  ('mensal', 'Pro Mensal', 39.90, 1),
  ('anual',  'Pro Anual', 359.90, 12)
on conflict (id) do update set nome = excluded.nome, preco = excluded.preco, meses = excluded.meses;

alter table public.plans enable row level security;
drop policy if exists "planos: leitura pública" on public.plans;
create policy "planos: leitura pública" on public.plans for select using (true);

-- Solicitações de ativação via Pix
create table if not exists public.pix_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  plan        text not null references public.plans (id),
  amount      numeric(10, 2),
  txid        text not null,
  pagador     text,
  status      text not null default 'pendente' check (status in ('pendente', 'aprovado', 'recusado')),
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid
);
create index if not exists pix_requests_status_idx on public.pix_requests (status, created_at desc);

-- Na criação: dono = usuário logado, status pendente e valor = preço oficial do plano.
create or replace function public.pix_requests_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then new.user_id := auth.uid(); end if;
  new.status := 'pendente'; new.reviewed_at := null; new.reviewed_by := null;
  new.amount := (select preco from public.plans where id = new.plan);
  new.txid := left(regexp_replace(coalesce(new.txid, ''), '[^A-Za-z0-9]', '', 'g'), 25);
  new.pagador := left(new.pagador, 120);
  if (select count(*) from public.pix_requests where user_id = new.user_id and status = 'pendente') >= 3 then
    raise exception 'Você já tem pagamentos aguardando confirmação.' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists pix_requests_before_insert on public.pix_requests;
create trigger pix_requests_before_insert before insert on public.pix_requests
  for each row execute function public.pix_requests_before_insert();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

alter table public.pix_requests enable row level security;
drop policy if exists "pix: criar a própria" on public.pix_requests;
drop policy if exists "pix: ver as próprias (ou admin)" on public.pix_requests;
create policy "pix: criar a própria" on public.pix_requests for insert with check (auth.uid() = user_id);
create policy "pix: ver as próprias (ou admin)" on public.pix_requests for select using (auth.uid() = user_id or public.is_admin());

-- Lista para a tela de administração
create or replace function public.admin_listar_pix(p_status text default 'pendente')
returns table (id uuid, user_id uuid, email text, nome text, crmv text, uf text, plan text, amount numeric,
               txid text, pagador text, status text, created_at timestamptz, reviewed_at timestamptz, current_period_end timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado' using errcode = '42501'; end if;
  return query
    select r.id, r.user_id, p.email, p.nome, p.crmv, p.uf, r.plan, r.amount, r.txid, r.pagador, r.status,
           r.created_at, r.reviewed_at, s.current_period_end
    from public.pix_requests r
    left join public.profiles p on p.id = r.user_id
    left join public.subscriptions s on s.user_id = r.user_id
    where p_status is null or r.status = p_status
    order by r.created_at desc
    limit 200;
end $$;

-- Confirma o pagamento: soma os meses do plano à assinatura (a partir do fim atual, se ainda vigente).
create or replace function public.admin_aprovar_pix(p_id uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare r public.pix_requests; m int; base timestamptz; novo timestamptz;
begin
  if not public.is_admin() then raise exception 'Acesso negado' using errcode = '42501'; end if;
  update public.pix_requests set status = 'aprovado', reviewed_at = now(), reviewed_by = auth.uid()
    where id = p_id and status = 'pendente' returning * into r;
  if not found then raise exception 'Solicitação não encontrada ou já analisada'; end if;
  select meses into m from public.plans where id = r.plan;
  select greatest(now(), coalesce(current_period_end, now())) into base from public.subscriptions where user_id = r.user_id;
  novo := coalesce(base, now()) + make_interval(months => m);
  insert into public.subscriptions (user_id, status, plan, current_period_end, updated_at)
    values (r.user_id, 'active', r.plan, novo, now())
  on conflict (user_id) do update set status = 'active', plan = excluded.plan,
    current_period_end = excluded.current_period_end, updated_at = now();
  return novo;
end $$;

create or replace function public.admin_recusar_pix(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado' using errcode = '42501'; end if;
  update public.pix_requests set status = 'recusado', reviewed_at = now(), reviewed_by = auth.uid()
    where id = p_id and status = 'pendente';
  if not found then raise exception 'Solicitação não encontrada ou já analisada'; end if;
end $$;

revoke execute on function public.admin_listar_pix(text), public.admin_aprovar_pix(uuid), public.admin_recusar_pix(uuid) from public, anon;
grant  execute on function public.admin_listar_pix(text), public.admin_aprovar_pix(uuid), public.admin_recusar_pix(uuid) to authenticated;

-- =====================================================================
-- ENDURECIMENTO (hardening)
-- =====================================================================
-- Limites de tamanho: impede que alguém encha o banco com registros gigantes.
-- (ficha completa com centenas de registros ≈ 100–300 KB; logotipo+assinatura < 1 MB)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fichas_data_tamanho') then
    alter table public.fichas add constraint fichas_data_tamanho check (pg_column_size(data) < 5 * 1024 * 1024);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_settings_tamanho') then
    alter table public.profiles add constraint profiles_settings_tamanho check (pg_column_size(settings) < 2 * 1024 * 1024);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fichas_id_tamanho') then
    alter table public.fichas add constraint fichas_id_tamanho check (length(id) between 1 and 64);
  end if;
end $$;

-- search_path fixo em todas as funções (recomendação do linter do Supabase).
alter function public.fichas_before_write() set search_path = public;
alter function public.touch_updated_at() set search_path = public;

-- Funções de gatilho não podem ser chamadas diretamente pela API.
revoke execute on function public.handle_new_user(), public.fichas_before_write(), public.touch_updated_at(),
  public.pix_requests_before_insert() from public, anon, authenticated;
