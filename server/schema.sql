-- Esquema do FinVision para Postgres (Supabase).
-- Rode com `npm run db:setup` ou cole no SQL Editor do Supabase. Pode ser executado de novo sem perder dados.
-- Valores monetários em centavos (bigint); datas sem hora em `date`.

create table if not exists empresas (
  id bigint generated always as identity primary key,
  nome text not null,
  documento text,
  criado_em timestamptz not null default now()
);

-- Quem pode acessar cada empresa. user_id é o id do usuário no Supabase Auth.
create table if not exists membros (
  empresa_id bigint not null references empresas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  papel text not null default 'dono' check (papel in ('dono', 'membro')),
  criado_em timestamptz not null default now(),
  primary key (empresa_id, user_id)
);
create index if not exists ix_membros_user on membros (user_id);

create table if not exists contas_bancarias (
  id bigint generated always as identity primary key,
  empresa_id bigint not null references empresas(id) on delete cascade,
  nome text not null,
  banco text,
  saldo_inicial bigint not null default 0,
  data_saldo_inicial date not null,
  ativa integer not null default 1
);
create index if not exists ix_contas_empresa on contas_bancarias (empresa_id);

create table if not exists categorias (
  id bigint generated always as identity primary key,
  empresa_id bigint not null references empresas(id) on delete cascade,
  nome text not null,
  tipo text not null check (tipo in ('receita', 'despesa'))
);
create index if not exists ix_categorias_empresa on categorias (empresa_id);

create table if not exists lancamentos (
  id bigint generated always as identity primary key,
  empresa_id bigint not null references empresas(id) on delete cascade,
  tipo text not null check (tipo in ('pagar', 'receber')),
  descricao text not null,
  contato text,
  categoria_id bigint references categorias(id) on delete set null,
  conta_bancaria_id bigint references contas_bancarias(id) on delete set null,
  valor bigint not null check (valor > 0),
  vencimento date not null,
  documento text,
  observacao text,
  data_pagamento date,
  valor_pago bigint,
  origem_baixa text check (origem_baixa in ('manual', 'conciliacao')),
  grupo_parcelas uuid,
  parcela integer,
  total_parcelas integer,
  criado_em timestamptz not null default now()
);
create index if not exists ix_lanc_empresa_venc on lancamentos (empresa_id, vencimento);
create index if not exists ix_lanc_empresa_pag on lancamentos (empresa_id, data_pagamento);
create index if not exists ix_lanc_conta on lancamentos (conta_bancaria_id);

create table if not exists extrato_itens (
  id bigint generated always as identity primary key,
  empresa_id bigint not null references empresas(id) on delete cascade,
  conta_bancaria_id bigint not null references contas_bancarias(id) on delete cascade,
  data date not null,
  descricao text,
  valor bigint not null,
  fitid text not null,
  lancamento_id bigint unique references lancamentos(id) on delete set null,
  ignorado integer not null default 0,
  importado_em timestamptz not null default now(),
  unique (conta_bancaria_id, fitid)
);
create index if not exists ix_extrato_conta_data on extrato_itens (conta_bancaria_id, data);

-- Convites para entrar numa empresa. O link carrega o token; só aceita quem estiver logado com o e-mail convidado.
create table if not exists convites (
  id bigint generated always as identity primary key,
  empresa_id bigint not null references empresas(id) on delete cascade,
  email text not null,
  papel text not null default 'membro' check (papel in ('dono', 'membro')),
  token uuid not null unique default gen_random_uuid(),
  criado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null default now() + interval '14 days',
  aceito_em timestamptz,
  aceito_por uuid references auth.users(id) on delete set null
);
create index if not exists ix_convites_empresa on convites (empresa_id);

-- Escritório (BPO): quem é membro dele acessa todas as empresas vinculadas, define o segmento de cada uma e convida os clientes.
create table if not exists escritorios (
  id bigint generated always as identity primary key,
  nome text not null,
  criado_em timestamptz not null default now()
);

create table if not exists escritorio_membros (
  escritorio_id bigint not null references escritorios(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  papel text not null default 'admin' check (papel in ('admin', 'colaborador')),
  criado_em timestamptz not null default now(),
  primary key (escritorio_id, user_id)
);
create index if not exists ix_escritorio_membros_user on escritorio_membros (user_id);

-- Segmento define o modelo de telas da empresa (serviço ou produto). Empresas antigas viram "serviço".
alter table empresas add column if not exists escritorio_id bigint references escritorios(id) on delete set null;
alter table empresas add column if not exists segmento text not null default 'servico';
do $$ begin
  alter table empresas add constraint empresas_segmento_check check (segmento in ('servico', 'produto'));
exception when duplicate_object then null; end $$;
create index if not exists ix_empresas_escritorio on empresas (escritorio_id);

-- Linha da DRE onde cada categoria entra (receita bruta, deduções, custos, despesas operacionais, financeiras, outras).
-- "fora_resultado": transferências entre contas, empréstimos e aportes. Mexem no saldo, mas não entram na DRE nem no Forecast.
alter table categorias add column if not exists dre text;
alter table categorias drop constraint if exists categorias_dre_check;
alter table categorias add constraint categorias_dre_check check (dre in (
  'receita_bruta', 'deducao', 'custo', 'despesa_operacional', 'receita_financeira', 'despesa_financeira', 'outra_receita', 'outra_despesa', 'fora_resultado'));
-- Classifica categorias antigas pelo nome (só as que ainda não têm classificação).
update categorias set dre = case
    when tipo = 'receita' and nome ilike any (array['%financeir%', '%juros%', '%rendimento%']) then 'receita_financeira'
    when tipo = 'receita' and nome ilike 'outra%' then 'outra_receita'
    when tipo = 'receita' then 'receita_bruta'
    when nome ilike any (array['imposto%', '%simples%', '%das %', '%devolu%']) then 'deducao'
    when nome ilike any (array['%compra de mercad%', '%fornecedor%', '%frete%', '%embalag%', '%prestadores de servi%', '%mercadoria%', '%comiss%', '%materiais aplicados%']) then 'custo'
    when nome ilike any (array['%tarifa%', '%taxa%banc%', '%bancári%', '%juros%', '%financeir%', '%iof%']) then 'despesa_financeira'
    else 'despesa_operacional' end
  where dre is null;

-- Clientes e fornecedores. "chave" é o nome normalizado (minúsculas, sem acento, espaços simples):
-- é por ela que "Café Aroma" e "cafe  aroma" viram o mesmo cadastro.
create table if not exists contatos (
  id bigint generated always as identity primary key,
  empresa_id bigint not null references empresas(id) on delete cascade,
  nome text not null,
  chave text not null,
  tipo text not null default 'cliente' check (tipo in ('cliente', 'fornecedor', 'ambos')),
  documento text,
  email text,
  telefone text,
  observacao text,
  criado_em timestamptz not null default now(),
  unique (empresa_id, chave)
);
alter table lancamentos add column if not exists contato_id bigint references contatos(id) on delete set null;
create index if not exists ix_lanc_contato on lancamentos (contato_id);

-- Tipo de receita (só contas a receber): recorrente, nova venda (cliente entrando na base recorrente) ou avulsa.
alter table lancamentos add column if not exists tipo_receita text;
do $$ begin
  alter table lancamentos add constraint lancamentos_tipo_receita_check check (tipo_receita in ('recorrente', 'nova', 'avulsa'));
exception when duplicate_object then null; end $$;

-- Grupo da despesa no Forecast.
alter table categorias add column if not exists grupo_forecast text;
do $$ begin
  alter table categorias add constraint categorias_grupo_forecast_check check (grupo_forecast in ('investimento', 'imposto_anuncio', 'variavel', 'fixo'));
exception when duplicate_object then null; end $$;
update categorias set grupo_forecast = case
    when nome ilike any (array['%imposto%anúnc%', '%imposto%anunc%', '%imposto%ads%']) then 'imposto_anuncio'
    when nome ilike any (array['%anúnc%', '%anunc%', '%tráfego%', '%trafego%', '%ads%', '%mídia paga%', '%midia paga%']) then 'investimento'
    when dre in ('deducao', 'custo', 'despesa_financeira') or nome ilike any (array['%comiss%', '%taxa%']) then 'variavel'
    else 'fixo' end
  where grupo_forecast is null and tipo = 'despesa';

-- Liga os lançamentos antigos ao cadastro de contatos, criando os contatos a partir do texto digitado.
insert into contatos (empresa_id, nome, chave, tipo)
  select distinct on (empresa_id, k) empresa_id, trim(contato), k, case when tipo = 'receber' then 'cliente' else 'fornecedor' end
  from (select l.*, regexp_replace(translate(lower(trim(l.contato)), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), '\s+', ' ', 'g') as k
        from lancamentos l where l.contato_id is null and nullif(trim(l.contato), '') is not null) x
  order by empresa_id, k, criado_em
  on conflict (empresa_id, chave) do nothing;
update lancamentos l set contato_id = c.id from contatos c
  where l.contato_id is null and nullif(trim(l.contato), '') is not null and c.empresa_id = l.empresa_id
    and c.chave = regexp_replace(translate(lower(trim(l.contato)), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), '\s+', ' ', 'g');
update contatos c set tipo = 'ambos' where tipo <> 'ambos'
  and exists (select 1 from lancamentos l where l.contato_id = c.id and l.tipo = 'receber')
  and exists (select 1 from lancamentos l where l.contato_id = c.id and l.tipo = 'pagar');

-- Valores do Forecast informados à mão por mês (ex.: clientes totais, quando o cliente paga adiantado).
create table if not exists forecast_ajustes (
  empresa_id bigint not null references empresas(id) on delete cascade,
  mes text not null check (mes ~ '^\d{4}-\d{2}$'),
  campo text not null check (campo in ('clientes')),
  valor bigint not null,
  primary key (empresa_id, mes, campo)
);

-- Segurança: o Supabase expõe o schema "public" pela API REST usando a chave pública (anon),
-- que fica visível no navegador. Com RLS ligado e nenhuma policy, essa via fica totalmente bloqueada.
-- Todo acesso passa pelo nosso servidor, que verifica o login e a empresa antes de cada consulta.
alter table empresas enable row level security;
alter table membros enable row level security;
alter table contas_bancarias enable row level security;
alter table categorias enable row level security;
alter table lancamentos enable row level security;
alter table extrato_itens enable row level security;
alter table convites enable row level security;
alter table escritorios enable row level security;
alter table escritorio_membros enable row level security;
alter table contatos enable row level security;
alter table forecast_ajustes enable row level security;
