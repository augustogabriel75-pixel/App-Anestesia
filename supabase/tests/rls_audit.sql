-- =====================================================================
-- VetAnest – AUDITORIA DE SEGURANÇA (RLS)
-- Como usar: Supabase → SQL Editor → New query → cole este arquivo → Run.
-- Cria 3 usuários de TESTE temporários (cliente A, cliente B e um admin),
-- tenta dezenas de acessos indevidos e operações legítimas, e no final
-- APAGA tudo o que criou. O resultado é uma tabela: OK / FALHA.
-- Não altera nenhum dado real (só mexe em registros @teste-rls.invalid).
-- =====================================================================

-- ---------- preparação ----------
reset role;
delete from auth.users where email like '%@teste-rls.invalid';
drop table if exists pg_temp.rls_resultado;
create temp table rls_resultado (n serial, ok boolean, grupo text, teste text, detalhe text);
grant all on rls_resultado to anon, authenticated;
grant usage on sequence rls_resultado_n_seq to anon, authenticated;

create or replace function pg_temp.como(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), false);
  perform set_config('request.jwt.claims', case when p_uid is null then '{"role":"anon"}'
    else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, false);
end $$;

-- Espera que a operação NÃO tenha efeito (erro ou 0 linhas afetadas).
create or replace function pg_temp.bloqueio(g text, t text, q text) returns void language plpgsql as $$
declare n bigint;
begin
  execute q; get diagnostics n = row_count;
  insert into rls_resultado (ok, grupo, teste, detalhe) values (n = 0, g, t, case when n = 0 then 'sem efeito (0 linhas)' else n || ' linha(s) afetada(s)!' end);
exception when others then
  insert into rls_resultado (ok, grupo, teste, detalhe) values (true, g, t, 'bloqueado: ' || left(sqlerrm, 90));
end $$;

-- Espera que a operação funcione (para garantir que o usuário legítimo não foi travado).
create or replace function pg_temp.permitido(g text, t text, q text) returns void language plpgsql as $$
declare n bigint;
begin
  execute q; get diagnostics n = row_count;
  insert into rls_resultado (ok, grupo, teste, detalhe) values (n > 0, g, t, n || ' linha(s)');
exception when others then
  insert into rls_resultado (ok, grupo, teste, detalhe) values (false, g, t, 'erro: ' || left(sqlerrm, 90));
end $$;

-- Espera que a consulta retorne exatamente "esperado" linhas.
create or replace function pg_temp.contagem(g text, t text, q text, esperado int) returns void language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from (' || q || ') x' into n;
  insert into rls_resultado (ok, grupo, teste, detalhe) values (n = esperado, g, t, 'vê ' || n || ' (esperado ' || esperado || ')');
exception when others then
  insert into rls_resultado (ok, grupo, teste, detalhe) values (esperado = 0, g, t, 'sem acesso: ' || left(sqlerrm, 80));
end $$;

-- Espera que a expressão seja verdadeira.
create or replace function pg_temp.confere(g text, t text, q text) returns void language plpgsql as $$
declare b boolean;
begin
  execute 'select (' || q || ')' into b;
  insert into rls_resultado (ok, grupo, teste, detalhe) values (coalesce(b, false), g, t, coalesce(b::text, 'nulo'));
exception when others then
  insert into rls_resultado (ok, grupo, teste, detalhe) values (false, g, t, 'erro: ' || left(sqlerrm, 90));
end $$;

-- ---------- dados de teste ----------
select pg_temp.como(null);
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('a0000000-0000-4000-8000-00000000000a', 'cliente-a@teste-rls.invalid', '{"nome":"Cliente A","crmv":"1","uf":"SP"}', 'authenticated', 'authenticated'),
  ('b0000000-0000-4000-8000-00000000000b', 'cliente-b@teste-rls.invalid', '{"nome":"Cliente B","crmv":"2","uf":"RJ"}', 'authenticated', 'authenticated'),
  ('c0000000-0000-4000-8000-00000000000c', 'admin@teste-rls.invalid',     '{"nome":"Admin"}',                       'authenticated', 'authenticated');
update public.profiles set is_admin = true where id = 'c0000000-0000-4000-8000-00000000000c';
insert into public.fichas (id, user_id, data, client_updated_at) values
  ('rls-ficha-a', 'a0000000-0000-4000-8000-00000000000a', '{"paciente":{"nome":"Rex do A"}}', 100),
  ('rls-ficha-b', 'b0000000-0000-4000-8000-00000000000b', '{"paciente":{"nome":"Mia do B"}}', 100);
insert into public.pix_requests (user_id, plan, txid, pagador) values
  ('a0000000-0000-4000-8000-00000000000a', 'mensal', 'RLSA1', 'Cliente A'),
  ('b0000000-0000-4000-8000-00000000000b', 'mensal', 'RLSB1', 'Cliente B');

select pg_temp.confere('0. Estrutura', 'Cadastro criou perfil e período de teste automaticamente',
  $q$(select count(*) from public.profiles p join public.subscriptions s on s.user_id = p.id where p.email like '%@teste-rls.invalid' and s.status = 'trial') = 3$q$);

-- =====================================================================
-- 1. Visitante sem login (anon)
-- =====================================================================
set role anon;
select pg_temp.como(null);
select pg_temp.contagem('1. Sem login', 'Não lê fichas',            'select * from public.fichas', 0);
select pg_temp.contagem('1. Sem login', 'Não lê perfis',            'select * from public.profiles', 0);
select pg_temp.contagem('1. Sem login', 'Não lê assinaturas',       'select * from public.subscriptions', 0);
select pg_temp.contagem('1. Sem login', 'Não lê pagamentos',        'select * from public.payments', 0);
select pg_temp.contagem('1. Sem login', 'Não lê pedidos Pix',       'select * from public.pix_requests', 0);
select pg_temp.bloqueio('1. Sem login', 'Não cria ficha',           $q$insert into public.fichas (id, user_id, data, client_updated_at) values ('rls-anon', 'a0000000-0000-4000-8000-00000000000a', '{}', 1)$q$);
select pg_temp.bloqueio('1. Sem login', 'Não cria pedido Pix',      $q$insert into public.pix_requests (plan, txid) values ('mensal', 'RLSANON')$q$);
select pg_temp.bloqueio('1. Sem login', 'Não altera preços',        $q$update public.plans set preco = 0.01$q$);
select pg_temp.bloqueio('1. Sem login', 'Não lista Pix (função admin)', $q$select public.admin_listar_pix(null)$q$);
select pg_temp.bloqueio('1. Sem login', 'Não aprova Pix (função admin)', $q$select public.admin_aprovar_pix((select id from public.pix_requests limit 1))$q$);
select pg_temp.confere('1. Sem login', 'Pode ver a tabela de preços (pública)', 'exists (select 1 from public.plans)');
reset role;

-- =====================================================================
-- 2. Cliente A tentando acessar dados de outros / se dar vantagens
-- =====================================================================
set role authenticated;
select pg_temp.como('a0000000-0000-4000-8000-00000000000a');
select pg_temp.contagem('2. Cliente A', 'Vê só as próprias fichas',        'select * from public.fichas', 1);
select pg_temp.contagem('2. Cliente A', 'Não lê a ficha do cliente B',     $q$select * from public.fichas where id = 'rls-ficha-b'$q$, 0);
select pg_temp.contagem('2. Cliente A', 'Vê só o próprio perfil',          'select * from public.profiles', 1);
select pg_temp.contagem('2. Cliente A', 'Vê só a própria assinatura',      'select * from public.subscriptions', 1);
select pg_temp.contagem('2. Cliente A', 'Vê só os próprios pedidos Pix',   'select * from public.pix_requests', 1);
select pg_temp.contagem('2. Cliente A', 'Não vê pagamentos de outros',     'select * from public.payments', 0);
select pg_temp.bloqueio('2. Cliente A', 'Não altera ficha do B',           $q$update public.fichas set data = '{"hack":1}' where id = 'rls-ficha-b'$q$);
select pg_temp.bloqueio('2. Cliente A', 'Não apaga ficha do B',            $q$delete from public.fichas where id = 'rls-ficha-b'$q$);
select pg_temp.bloqueio('2. Cliente A', 'Não sobrescreve ficha do B via upsert', $q$insert into public.fichas (id, user_id, data, client_updated_at) values ('rls-ficha-b', 'a0000000-0000-4000-8000-00000000000a', '{"hack":1}', 999) on conflict (id) do update set data = excluded.data, client_updated_at = excluded.client_updated_at$q$);
select pg_temp.bloqueio('2. Cliente A', 'Não cria ficha em nome do B',     $q$insert into public.fichas (id, user_id, data, client_updated_at) values ('rls-falsa', 'b0000000-0000-4000-8000-00000000000b', '{}', 1)$q$);
select pg_temp.bloqueio('2. Cliente A', 'Não altera perfil do B',          $q$update public.profiles set nome = 'hack' where id = 'b0000000-0000-4000-8000-00000000000b'$q$);
select pg_temp.bloqueio('2. Cliente A', 'Não se torna administrador',      $q$update public.profiles set is_admin = true where id = 'a0000000-0000-4000-8000-00000000000a'$q$);
select pg_temp.bloqueio('2. Cliente A', 'Não cria perfil extra',           $q$insert into public.profiles (id, email) values (gen_random_uuid(), 'x@x')$q$);
select pg_temp.bloqueio('2. Cliente A', 'Não se dá assinatura (update)',   $q$update public.subscriptions set status = 'active', current_period_end = now() + interval '10 years'$q$);
select pg_temp.bloqueio('2. Cliente A', 'Não se dá assinatura (insert)',   $q$insert into public.subscriptions (user_id, status, current_period_end) values ('a0000000-0000-4000-8000-00000000000a', 'active', now() + interval '10 years') on conflict (user_id) do update set status = 'active'$q$);
select pg_temp.bloqueio('2. Cliente A', 'Não apaga a própria assinatura (renovar teste)', $q$delete from public.subscriptions$q$);
select pg_temp.bloqueio('2. Cliente A', 'Não registra pagamento falso',    $q$insert into public.payments (id, user_id, plan, amount, status) values ('fake-1', 'a0000000-0000-4000-8000-00000000000a', 'anual', 359.9, 'approved')$q$);
select pg_temp.bloqueio('2. Cliente A', 'Não altera preços',               $q$update public.plans set preco = 0.01$q$);
select pg_temp.bloqueio('2. Cliente A', 'Não cria plano',                  $q$insert into public.plans (id, nome, preco, meses) values ('vitalicio', 'x', 0.01, 1200)$q$);
select pg_temp.bloqueio('2. Cliente A', 'Não aprova o próprio Pix (update)', $q$update public.pix_requests set status = 'aprovado'$q$);
select pg_temp.bloqueio('2. Cliente A', 'Não apaga pedidos Pix',           $q$delete from public.pix_requests$q$);
select pg_temp.bloqueio('2. Cliente A', 'Não lista pedidos (função admin)', $q$select public.admin_listar_pix(null)$q$);
select pg_temp.bloqueio('2. Cliente A', 'Não aprova o próprio Pix (função admin)', $q$select public.admin_aprovar_pix((select id from public.pix_requests where txid = 'RLSA1'))$q$);
select pg_temp.bloqueio('2. Cliente A', 'Não recusa Pix (função admin)',   $q$select public.admin_recusar_pix((select id from public.pix_requests where txid = 'RLSA1'))$q$);
select pg_temp.confere('2. Cliente A', 'is_admin() = falso',               'not public.is_admin()');
-- Tentativas que "passam" mas são neutralizadas pelo servidor:
select pg_temp.permitido('2. Cliente A', 'Pedido Pix com valor adulterado (R$ 0,01) é aceito…', $q$insert into public.pix_requests (plan, amount, txid, pagador, status) values ('anual', 0.01, 'RLSVALOR', 'A', 'aprovado')$q$);
select pg_temp.confere('2. Cliente A', '…mas o servidor grava o preço oficial e status pendente', $q$(select amount = (select preco from public.plans where id = 'anual') and status = 'pendente' from public.pix_requests where txid = 'RLSVALOR')$q$);
select pg_temp.permitido('2. Cliente A', 'Pedido Pix "em nome do B" é aceito…', $q$insert into public.pix_requests (user_id, plan, txid) values ('b0000000-0000-4000-8000-00000000000b', 'mensal', 'RLSDONO')$q$);
select pg_temp.confere('2. Cliente A', '…mas fica no nome do próprio A',   $q$(select user_id = 'a0000000-0000-4000-8000-00000000000a' from public.pix_requests where txid = 'RLSDONO')$q$);
select pg_temp.bloqueio('2. Cliente A', 'Limite de 3 Pix pendentes',       $q$insert into public.pix_requests (plan, txid) values ('mensal', 'RLS4')$q$);
select pg_temp.permitido('2. Cliente A', 'Tentar transferir a própria ficha para o B…', $q$update public.fichas set user_id = 'b0000000-0000-4000-8000-00000000000b', client_updated_at = 101 where id = 'rls-ficha-a'$q$);
select pg_temp.confere('2. Cliente A', '…a ficha continua sendo do A',     $q$(select user_id = 'a0000000-0000-4000-8000-00000000000a' from public.fichas where id = 'rls-ficha-a')$q$);
select pg_temp.bloqueio('2. Cliente A', 'Não grava ficha gigante (> 5 MB)', $q$insert into public.fichas (id, user_id, data, client_updated_at) values ('rls-grande', 'a0000000-0000-4000-8000-00000000000a', jsonb_build_object('x', (select string_agg(md5(i::text), '') from generate_series(1, 400000) i)), 1)$q$);
select pg_temp.bloqueio('2. Cliente A', 'Não chama função de gatilho diretamente', $q$select public.handle_new_user()$q$);
-- Operações legítimas continuam funcionando:
select pg_temp.permitido('2. Cliente A', 'Cria a própria ficha',           $q$insert into public.fichas (id, user_id, data, client_updated_at) values ('rls-ficha-a2', 'a0000000-0000-4000-8000-00000000000a', '{"paciente":{"nome":"Nova"}}', 200)$q$);
select pg_temp.permitido('2. Cliente A', 'Atualiza a própria ficha',       $q$update public.fichas set data = '{"paciente":{"nome":"Rex editado"}}', client_updated_at = 300 where id = 'rls-ficha-a'$q$);
select pg_temp.permitido('2. Cliente A', 'Versão antiga não sobrescreve a nova (update aceito sem efeito)', $q$update public.fichas set data = '{"paciente":{"nome":"VELHA"}}', client_updated_at = 5 where id = 'rls-ficha-a'$q$);
select pg_temp.confere('2. Cliente A', '…conteúdo novo preservado',        $q$(select data->'paciente'->>'nome' = 'Rex editado' from public.fichas where id = 'rls-ficha-a')$q$);
select pg_temp.permitido('2. Cliente A', 'Atualiza o próprio perfil',      $q$update public.profiles set nome = 'Cliente A editado', settings = '{"clinica":"X"}', settings_updated_at = 10 where id = 'a0000000-0000-4000-8000-00000000000a'$q$);
reset role;

-- =====================================================================
-- 3. Administrador
-- =====================================================================
set role authenticated;
select pg_temp.como('c0000000-0000-4000-8000-00000000000c');
select pg_temp.confere('3. Admin', 'Lista pedidos Pix de todos',            '(select count(*) from public.admin_listar_pix(null)) >= 4');
select pg_temp.contagem('3. Admin', 'NÃO lê as fichas clínicas dos clientes', 'select * from public.fichas', 0);
select pg_temp.contagem('3. Admin', 'NÃO lê perfis dos clientes diretamente', 'select * from public.profiles where is_admin = false', 0);
select pg_temp.bloqueio('3. Admin', 'Não altera fichas de clientes',        $q$update public.fichas set data = '{}' where id = 'rls-ficha-a'$q$);
select pg_temp.bloqueio('3. Admin', 'Não altera preços pela API',           $q$update public.plans set preco = 1$q$);
select pg_temp.confere('3. Admin', 'Aprova Pix pendente',                   $q$public.admin_aprovar_pix((select id from public.pix_requests where txid = 'RLSA1')) > now() + interval '27 days'$q$);
select pg_temp.bloqueio('3. Admin', 'Não aprova o mesmo Pix duas vezes',    $q$select public.admin_aprovar_pix((select id from public.pix_requests where txid = 'RLSA1'))$q$);
select pg_temp.permitido('3. Admin', 'Recusa Pix pendente',                 $q$select public.admin_recusar_pix((select id from public.pix_requests where txid = 'RLSB1'))$q$);
reset role;

set role authenticated;
select pg_temp.como('a0000000-0000-4000-8000-00000000000a');
select pg_temp.confere('3. Admin', 'Cliente A vê a própria assinatura ativa após aprovação', $q$(select status = 'active' and current_period_end > now() from public.subscriptions)$q$);
reset role;

-- =====================================================================
-- 4. Configuração do banco
-- =====================================================================
select pg_temp.como(null);
select pg_temp.confere('4. Configuração', 'Todas as tabelas públicas com RLS ativado',
  $q$not exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity)$q$);
select pg_temp.confere('4. Configuração', 'Funções SECURITY DEFINER com search_path fixo',
  $q$not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'))$q$);
select pg_temp.confere('4. Configuração', 'Funções admin não executáveis por visitantes',
  $q$not has_function_privilege('anon', 'public.admin_aprovar_pix(uuid)', 'execute') and not has_function_privilege('anon', 'public.admin_listar_pix(text)', 'execute') and not has_function_privilege('anon', 'public.admin_recusar_pix(uuid)', 'execute')$q$);
select pg_temp.confere('4. Configuração', 'Coluna is_admin não editável por usuários',
  $q$not has_column_privilege('authenticated', 'public.profiles', 'is_admin', 'UPDATE') and not has_column_privilege('anon', 'public.profiles', 'is_admin', 'UPDATE')$q$);
select pg_temp.confere('4. Configuração', 'Única política aberta (using true) é a de preços',
  $q$not exists (select 1 from pg_policies where schemaname = 'public' and qual = 'true' and tablename <> 'plans')$q$);
select pg_temp.confere('4. Configuração', 'Nenhuma política de DELETE (exclusões só via tombstone)',
  $q$not exists (select 1 from pg_policies where schemaname = 'public' and cmd = 'DELETE')$q$);

-- ---------- limpeza ----------
reset role;
select pg_temp.como(null);
delete from public.payments where id = 'fake-1';
delete from auth.users where email like '%@teste-rls.invalid';

-- ---------- resultado ----------
select case when ok then '✅ OK' else '❌ FALHA' end as status, grupo, teste, detalhe
from (
  select 0 as ord, ok, grupo, teste, detalhe, n from rls_resultado
  union all
  select 1, (select bool_and(ok) from rls_resultado), 'RESUMO',
         (select count(*) filter (where ok) || ' de ' || count(*) || ' verificações aprovadas' from rls_resultado), '', 0
) r
order by ord, n;
