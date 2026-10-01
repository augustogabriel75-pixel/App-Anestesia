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
