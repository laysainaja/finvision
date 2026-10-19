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
