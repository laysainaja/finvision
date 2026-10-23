-- Integração FinVision → Farol (painel da ThunderLab, em outro Supabase).
-- Só os lançamentos da empresa configurada em farol_config. Funciona sozinha dentro do banco:
--   1. o gatilho em lancamentos coloca o lançamento criado/editado/pago/apagado na fila (farol_fila);
--   2. a cada minuto (pg_cron) farol_enviar() confere as respostas anteriores e manda até 2000 pendentes (pg_net);
--   3. se o Farol não responder 2xx, o lançamento continua pendente e vai de novo no minuto seguinte.
-- A chave de integração fica no Vault (nome 'farol_chave'), nunca no código.
-- Aplicar com: node --env-file=.env scripts/farol-setup.js  (cria as extensões e roda este arquivo; pode rodar de novo).

create table if not exists farol_config (
  id integer primary key default 1 check (id = 1),
  empresa_id bigint not null references empresas(id) on delete cascade,
  url text not null,
  apikey text not null, -- chave pública (publishable) do Supabase do Farol; quem protege é a chave de integração
  ativo boolean not null default false
);

create table if not exists farol_fila (
  lancamento_id bigint primary key,
  excluido boolean not null default false,
  atualizado_em timestamptz not null default clock_timestamp(),
  enviado_em timestamptz, -- versão (atualizado_em) que o Farol confirmou; pendente quando < atualizado_em
  tentativas integer not null default 0,
  ultimo_erro text
);
create index if not exists ix_farol_fila_pendentes on farol_fila (atualizado_em) where enviado_em is null or enviado_em < atualizado_em;

create table if not exists farol_envios (
  id bigint generated always as identity primary key,
  request_id bigint,
  itens jsonb not null, -- [{id, atualizado_em}] do lote
  criado_em timestamptz not null default now(),
  status integer,
  resposta text,
  conferido_em timestamptz
);
create index if not exists ix_farol_envios_abertos on farol_envios (criado_em) where conferido_em is null;

alter table farol_config enable row level security;
alter table farol_fila enable row level security;
alter table farol_envios enable row level security;

-- Gatilho: só enfileira (rápido e sem rede), para nunca travar quem está salvando o lançamento.
create or replace function farol_enfileirar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  eid bigint;
begin
  select empresa_id into eid from farol_config where id = 1;
  if eid is null then
    return null;
  end if;
  if tg_op = 'DELETE' then
    if old.empresa_id = eid then
      insert into farol_fila (lancamento_id, excluido, atualizado_em) values (old.id, true, clock_timestamp())
      on conflict (lancamento_id) do update set excluido = true, atualizado_em = clock_timestamp();
    end if;
  elsif new.empresa_id = eid then
    insert into farol_fila (lancamento_id, excluido, atualizado_em) values (new.id, false, clock_timestamp())
    on conflict (lancamento_id) do update set excluido = false, atualizado_em = clock_timestamp();
  end if;
  return null;
end $$;

drop trigger if exists trg_farol on lancamentos;
create trigger trg_farol after insert or update or delete on lancamentos
  for each row execute function farol_enfileirar();

-- Lê as respostas dos envios anteriores (pg_net guarda em net._http_response) e marca o que o Farol confirmou.
create or replace function farol_conferir() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  e record;
  r record;
begin
  for e in select * from farol_envios where conferido_em is null order by id loop
    select status_code, content, error_msg, timed_out into r from net._http_response where id = e.request_id;
    if not found then
      if e.criado_em < now() - interval '10 minutes' then
        update farol_envios set conferido_em = now(), resposta = 'sem resposta' where id = e.id;
        update farol_fila f set tentativas = f.tentativas + 1, ultimo_erro = 'Farol não respondeu'
          from jsonb_to_recordset(e.itens) as i(id bigint, atualizado_em timestamptz) where f.lancamento_id = i.id;
      end if;
      continue;
    end if;
    update farol_envios set status = r.status_code, resposta = left(coalesce(r.content, r.error_msg, ''), 2000), conferido_em = now()
      where id = e.id;
    if r.status_code between 200 and 299 then
      -- Confirma a versão enviada; se o lançamento mudou depois disso, continua pendente e vai de novo.
      update farol_fila f set enviado_em = i.atualizado_em, tentativas = 0, ultimo_erro = null
        from jsonb_to_recordset(e.itens) as i(id bigint, atualizado_em timestamptz)
        where f.lancamento_id = i.id and (f.enviado_em is null or f.enviado_em < i.atualizado_em);
    else
      update farol_fila f set tentativas = f.tentativas + 1,
          ultimo_erro = left(coalesce('HTTP ' || r.status_code || ': ' || r.content, r.error_msg, 'erro desconhecido'), 500)
        from jsonb_to_recordset(e.itens) as i(id bigint, atualizado_em timestamptz) where f.lancamento_id = i.id;
    end if;
  end loop;
end $$;

-- Monta o lote (até 2000 pendentes que não estão em voo) e envia. Não faz nada se a integração estiver desligada.
create or replace function farol_enviar() returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare
  cfg farol_config;
  chave text;
  lote jsonb;
  itens jsonb;
  rid bigint;
begin
  select * into cfg from farol_config where id = 1;
  if cfg.empresa_id is null or not cfg.ativo then
    return 0;
  end if;
  perform farol_conferir();
  select decrypted_secret into chave from vault.decrypted_secrets where name = 'farol_chave';
  if chave is null then
    return 0;
  end if;

  with em_voo as (
    select (i ->> 'id')::bigint as id from farol_envios e, jsonb_array_elements(e.itens) i where e.conferido_em is null
  ),
  pend as (
    select f.* from farol_fila f
    where (f.enviado_em is null or f.enviado_em < f.atualizado_em) and f.lancamento_id not in (select id from em_voo)
    order by f.atualizado_em
    limit 2000
  )
  select
    jsonb_agg(
      case when p.excluido or l.id is null then jsonb_build_object('id', p.lancamento_id, 'excluido', true)
      else jsonb_build_object(
        'id', l.id, 'tipo', l.tipo, 'descricao', l.descricao, 'contato', coalesce(ct.nome, l.contato),
        'categoria', c.nome, 'conta', cb.nome, 'valor', l.valor, 'vencimento', l.vencimento,
        'data_pagamento', l.data_pagamento, 'valor_pago', case when l.data_pagamento is null then null else l.valor_pago end,
        'tipo_receita', case when l.tipo = 'receber' then l.tipo_receita end, 'transferencia_id', l.transferencia_id, 'excluido', false)
      end order by p.atualizado_em),
    jsonb_agg(jsonb_build_object('id', p.lancamento_id, 'atualizado_em', p.atualizado_em))
  into lote, itens
  from pend p
  left join lancamentos l on l.id = p.lancamento_id and l.empresa_id = cfg.empresa_id
  left join categorias c on c.id = l.categoria_id
  left join contas_bancarias cb on cb.id = l.conta_bancaria_id
  left join contatos ct on ct.id = l.contato_id;

  if lote is null then
    return 0;
  end if;
  select net.http_post(
    url := cfg.url,
    body := jsonb_build_object('p_chave', chave, 'p_lancamentos', lote),
    headers := jsonb_build_object('apikey', cfg.apikey, 'Content-Type', 'application/json'),
    timeout_milliseconds := 30000
  ) into rid;
  insert into farol_envios (request_id, itens) values (rid, itens);
  return jsonb_array_length(lote);
end $$;

-- As funções ficam no schema public, que o Supabase expõe pela API: ninguém de fora pode chamá-las.
revoke all on function farol_enfileirar() from public, anon, authenticated;
revoke all on function farol_conferir() from public, anon, authenticated;
revoke all on function farol_enviar() from public, anon, authenticated;
