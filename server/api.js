import express from 'express';
import { randomUUID } from 'node:crypto';
import { sql, all, get, transaction, hoje, STATUS_SQL } from './db.js';
import { HttpError, check, isDate, isCents, optText, optId, idParam, pgArray, addMonths, addDays } from './util.js';
import { autenticar, authConfigurado } from './auth.js';
import { fluxoRouter } from './fluxo.js';
import { conciliacaoRouter } from './conciliacao.js';
import { equipeRouter, conviteRouter, infoConvite } from './equipe.js';

export const api = express.Router();

// Diagnóstico de implantação: diz só se cada variável existe e se o banco responde, nunca os valores.
api.get('/saude', async (req, res) => {
  const config = {
    DATABASE_URL: !!process.env.DATABASE_URL,
    VITE_SUPABASE_URL: !!(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL),
    VITE_SUPABASE_ANON_KEY: !!(process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY),
  };
  let banco = 'não configurado';
  if (sql) {
    try {
      await sql`select 1 from membros limit 1`;
      banco = 'ok';
    } catch (e) {
      banco = `erro ${e.code ?? ''}: ${String(e.message).replace(/postgres(ql)?:\/\/\S+/g, '[url]').slice(0, 120)}`;
    }
  }
  const ok = banco === 'ok' && authConfigurado;
  res.status(ok ? 200 : 503).json({ ok, config, banco });
});
// Pública: a tela de login mostra de qual empresa é o convite antes de a pessoa entrar.
api.get('/convites/:token', infoConvite);

api.use(autenticar);
api.use('/convites', conviteRouter);

// ---------- Empresas (cada usuário só vê as empresas das quais é membro) ----------

api.get('/empresas', async (req, res) => {
  res.json(
    await all(
      `SELECT e.*, m.papel FROM empresas e JOIN membros m ON m.empresa_id = e.id
       WHERE m.user_id = :uid ORDER BY e.nome`,
      { uid: req.userId },
    ),
  );
});

api.post('/empresas', async (req, res) => {
  const nome = optText(req.body.nome);
  check(nome, 'Informe o nome da empresa.');
  const empresa = await transaction(async () => {
    const e = await get('INSERT INTO empresas (nome, documento) VALUES (:nome, :doc) RETURNING *', { nome, doc: optText(req.body.documento) });
    await all("INSERT INTO membros (empresa_id, user_id, papel) VALUES (:eid, :uid, 'dono')", { eid: e.id, uid: req.userId });
    await criarCategoriasPadrao(e.id);
    return e;
  });
  res.status(201).json(empresa);
});

async function exigirMembro(eid, userId) {
  const m = await get('SELECT papel FROM membros WHERE empresa_id = :eid AND user_id = :uid', { eid, uid: userId });
  // 404 (e não 403) para não revelar que a empresa existe.
  check(m, 'Empresa não encontrada.', 404);
  return m;
}

api.put('/empresas/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const m = await exigirMembro(id, req.userId);
  check(m.papel === 'dono', 'Só o dono pode alterar os dados da empresa.', 403);
  const nome = optText(req.body.nome);
  check(nome, 'Informe o nome da empresa.');
  res.json(await get('UPDATE empresas SET nome = :nome, documento = :doc WHERE id = :id RETURNING *', { nome, doc: optText(req.body.documento), id }));
});

export async function criarCategoriasPadrao(empresaId) {
  const receitas = ['Vendas de produtos', 'Prestação de serviços', 'Receitas financeiras', 'Outras receitas'];
  const despesas = ['Fornecedores', 'Salários e encargos', 'Aluguel', 'Impostos', 'Tarifas bancárias', 'Marketing', 'Software e serviços', 'Outras despesas'];
  await all(
    `INSERT INTO categorias (empresa_id, nome, tipo)
     SELECT :eid::bigint, n, 'receita' FROM unnest(:receitas::text[]) n
     UNION ALL SELECT :eid::bigint, n, 'despesa' FROM unnest(:despesas::text[]) n`,
    { eid: empresaId, receitas: pgArray(receitas), despesas: pgArray(despesas) },
  );
}

// Tudo abaixo de /empresas/:eid é isolado por empresa: o usuário precisa ser membro, e toda consulta filtra por empresa_id.
const e = express.Router({ mergeParams: true });
api.use(
  '/empresas/:eid',
  async (req, res, next) => {
    req.eid = idParam(req.params.eid);
    req.papel = (await exigirMembro(req.eid, req.userId)).papel;
    next();
  },
  e,
);

const TABELAS_EMPRESA = new Set(['categorias', 'contas_bancarias']);
export async function pertence(tabela, id, eid) {
  if (id === null) return;
  check(TABELAS_EMPRESA.has(tabela) && Number.isInteger(id), `Registro inválido em ${tabela}.`);
  check(await get(`SELECT 1 FROM ${tabela} WHERE id = :id AND empresa_id = :eid`, { id, eid }), `Registro inválido em ${tabela}.`);
}

// ---------- Contas bancárias ----------

const SALDO_SQL = `cb.saldo_inicial + COALESCE((
  SELECT SUM(CASE WHEN l.tipo = 'receber' THEN l.valor_pago ELSE -l.valor_pago END)
  FROM lancamentos l
  WHERE l.conta_bancaria_id = cb.id AND l.data_pagamento IS NOT NULL AND l.data_pagamento >= cb.data_saldo_inicial
), 0)`;

export function listarContas(eid) {
  return all(
    `SELECT cb.*, (${SALDO_SQL})::bigint AS saldo_atual,
       (SELECT COUNT(*) FROM extrato_itens x WHERE x.conta_bancaria_id = cb.id AND x.lancamento_id IS NULL AND x.ignorado = 0) AS pendentes_conciliacao
     FROM contas_bancarias cb WHERE cb.empresa_id = :eid ORDER BY cb.ativa DESC, cb.nome`,
    { eid },
  );
}

e.get('/contas-bancarias', async (req, res) => res.json(await listarContas(req.eid)));

function lerConta(body) {
  const c = {
    nome: optText(body.nome),
    banco: optText(body.banco),
    saldo_inicial: body.saldo_inicial ?? 0,
    data_saldo_inicial: body.data_saldo_inicial || hoje(),
    ativa: body.ativa === false ? 0 : 1,
  };
  check(c.nome, 'Informe o nome da conta.');
  check(isCents(c.saldo_inicial), 'Saldo inicial inválido.');
  check(isDate(c.data_saldo_inicial), 'Data do saldo inicial inválida.');
  return c;
}

e.post('/contas-bancarias', async (req, res) => {
  const c = lerConta(req.body);
  const r = await get(
    `INSERT INTO contas_bancarias (empresa_id, nome, banco, saldo_inicial, data_saldo_inicial, ativa)
     VALUES (:eid, :nome, :banco, :saldo_inicial, :data_saldo_inicial, :ativa) RETURNING id`,
    { ...c, eid: req.eid },
  );
  res.status(201).json(r);
});

e.put('/contas-bancarias/:id', async (req, res) => {
  const c = lerConta(req.body);
  const r = await get(
    `UPDATE contas_bancarias SET nome = :nome, banco = :banco, saldo_inicial = :saldo_inicial, data_saldo_inicial = :data_saldo_inicial, ativa = :ativa
     WHERE id = :id AND empresa_id = :eid RETURNING id`,
    { ...c, id: idParam(req.params.id), eid: req.eid },
  );
  check(r, 'Conta não encontrada.', 404);
  res.json({ ok: true });
});

e.delete('/contas-bancarias/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const usada = await get('SELECT COUNT(*) AS n FROM lancamentos WHERE conta_bancaria_id = :id AND data_pagamento IS NOT NULL', { id });
  check(!usada.n, 'Esta conta tem lançamentos pagos. Desative-a em vez de excluir.', 409);
  const r = await get('DELETE FROM contas_bancarias WHERE id = :id AND empresa_id = :eid RETURNING id', { id, eid: req.eid });
  check(r, 'Conta não encontrada.', 404);
  res.json({ ok: true });
});

// ---------- Categorias ----------

e.get('/categorias', async (req, res) => {
  res.json(await all('SELECT * FROM categorias WHERE empresa_id = :eid ORDER BY tipo, nome', { eid: req.eid }));
});

e.post('/categorias', async (req, res) => {
  const nome = optText(req.body.nome);
  check(nome, 'Informe o nome da categoria.');
  check(['receita', 'despesa'].includes(req.body.tipo), 'Tipo de categoria inválido.');
  res.status(201).json(await get('INSERT INTO categorias (empresa_id, nome, tipo) VALUES (:eid, :nome, :tipo) RETURNING id', { eid: req.eid, nome, tipo: req.body.tipo }));
});

e.put('/categorias/:id', async (req, res) => {
  const nome = optText(req.body.nome);
  check(nome, 'Informe o nome da categoria.');
  const r = await get('UPDATE categorias SET nome = :nome WHERE id = :id AND empresa_id = :eid RETURNING id', { nome, id: idParam(req.params.id), eid: req.eid });
  check(r, 'Categoria não encontrada.', 404);
  res.json({ ok: true });
});

e.delete('/categorias/:id', async (req, res) => {
  const r = await get('DELETE FROM categorias WHERE id = :id AND empresa_id = :eid RETURNING id', { id: idParam(req.params.id), eid: req.eid });
  check(r, 'Categoria não encontrada.', 404);
  res.json({ ok: true });
});

// ---------- Lançamentos (contas a pagar e a receber) ----------

const LANC_SELECT = `
  SELECT l.*, ${STATUS_SQL} AS status, c.nome AS categoria_nome, cb.nome AS conta_nome,
    (SELECT x.id FROM extrato_itens x WHERE x.lancamento_id = l.id) AS extrato_id
  FROM lancamentos l
  LEFT JOIN categorias c ON c.id = l.categoria_id
  LEFT JOIN contas_bancarias cb ON cb.id = l.conta_bancaria_id`;

export async function buscarLancamento(id, eid) {
  const l = await get(`${LANC_SELECT} WHERE l.id = :id AND l.empresa_id = :eid`, { id: idParam(id), eid, hoje: hoje() });
  check(l, 'Lançamento não encontrado.', 404);
  return l;
}

e.get('/lancamentos', async (req, res) => {
  const { tipo, status, de, ate, q, conta_id, categoria_id } = req.query;
  const where = ['l.empresa_id = :eid'];
  const p = { eid: req.eid, hoje: hoje() };
  if (tipo) (where.push('l.tipo = :tipo'), (p.tipo = tipo));
  if (status === 'em_aberto') where.push('l.data_pagamento IS NULL');
  else if (status) (where.push(`${STATUS_SQL} = :status`), (p.status = status));
  // Pagos são filtrados pela data do pagamento; os demais, pelo vencimento.
  const dataRef = status === 'pago' ? 'l.data_pagamento' : 'l.vencimento';
  if (isDate(de)) (where.push(`${dataRef} >= :de`), (p.de = de));
  if (isDate(ate)) (where.push(`${dataRef} <= :ate`), (p.ate = ate));
  if (conta_id) (where.push('l.conta_bancaria_id = :conta'), (p.conta = idParam(conta_id)));
  if (categoria_id) (where.push('l.categoria_id = :cat'), (p.cat = idParam(categoria_id)));
  if (q) (where.push('(l.descricao ILIKE :q OR l.contato ILIKE :q OR l.documento ILIKE :q)'), (p.q = `%${q}%`));
  const ordem = status === 'pago' ? 'l.data_pagamento DESC' : 'l.vencimento';
  res.json(await all(`${LANC_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${ordem}, l.id LIMIT 2000`, p));
});

e.get('/lancamentos/:id', async (req, res) => res.json(await buscarLancamento(req.params.id, req.eid)));

async function lerLancamento(body, eid) {
  const l = {
    tipo: body.tipo,
    descricao: optText(body.descricao),
    contato: optText(body.contato),
    categoria_id: optId(body.categoria_id),
    conta_bancaria_id: optId(body.conta_bancaria_id),
    valor: body.valor,
    vencimento: body.vencimento,
    documento: optText(body.documento),
    observacao: optText(body.observacao),
  };
  check(['pagar', 'receber'].includes(l.tipo), 'Tipo inválido.');
  check(l.descricao, 'Informe a descrição.');
  check(isCents(l.valor) && l.valor > 0, 'Informe um valor maior que zero.');
  check(isDate(l.vencimento), 'Informe a data de vencimento.');
  await pertence('categorias', l.categoria_id, eid);
  await pertence('contas_bancarias', l.conta_bancaria_id, eid);
  return l;
}

const INSERT_LANC = `INSERT INTO lancamentos
  (empresa_id, tipo, descricao, contato, categoria_id, conta_bancaria_id, valor, vencimento, documento, observacao,
   data_pagamento, valor_pago, origem_baixa, grupo_parcelas, parcela, total_parcelas)
  VALUES (:empresa_id, :tipo, :descricao, :contato, :categoria_id, :conta_bancaria_id, :valor, :vencimento, :documento, :observacao,
   :data_pagamento, :valor_pago, :origem_baixa, :grupo_parcelas, :parcela, :total_parcelas)
  RETURNING id`;

export async function inserirLancamento(l) {
  const r = await get(INSERT_LANC, {
    data_pagamento: null, valor_pago: null, origem_baixa: null, grupo_parcelas: null, parcela: null, total_parcelas: null,
    ...l,
  });
  return r.id;
}

e.post('/lancamentos', async (req, res) => {
  const base = await lerLancamento(req.body, req.eid);
  const n = Number(req.body.parcelas ?? 1);
  check(Number.isInteger(n) && n >= 1 && n <= 120, 'Número de parcelas deve ser entre 1 e 120.');
  // 'parcelar' divide o valor total entre as parcelas; 'repetir' lança o mesmo valor todo mês.
  const modo = req.body.repeticao === 'repetir' ? 'repetir' : 'parcelar';
  const pagamento = req.body.pagamento; // opcional: já lançar como pago
  if (pagamento) {
    check(n === 1, 'Lançamentos parcelados não podem ser criados como pagos.');
    check(isDate(pagamento.data_pagamento), 'Data de pagamento inválida.');
    check(base.conta_bancaria_id, 'Informe a conta bancária do pagamento.');
  }

  const ids = await transaction(async () => {
    const grupo = n > 1 ? randomUUID() : null;
    const valorParcela = modo === 'parcelar' ? Math.floor(base.valor / n) : base.valor;
    const resto = modo === 'parcelar' ? base.valor - valorParcela * n : 0;
    const ids = [];
    for (let i = 0; i < n; i++) {
      ids.push(
        await inserirLancamento({
          ...base,
          empresa_id: req.eid,
          valor: valorParcela + (i === 0 ? resto : 0),
          vencimento: addMonths(base.vencimento, i),
          grupo_parcelas: grupo,
          parcela: n > 1 ? i + 1 : null,
          total_parcelas: n > 1 ? n : null,
          ...(pagamento && {
            data_pagamento: pagamento.data_pagamento,
            valor_pago: isCents(pagamento.valor_pago) && pagamento.valor_pago > 0 ? pagamento.valor_pago : base.valor,
            origem_baixa: 'manual',
          }),
        }),
      );
    }
    return ids;
  });
  res.status(201).json({ ids });
});

e.put('/lancamentos/:id', async (req, res) => {
  const atual = await buscarLancamento(req.params.id, req.eid);
  const { tipo, ...l } = await lerLancamento({ ...req.body, tipo: atual.tipo }, req.eid);
  if (atual.data_pagamento) check(l.conta_bancaria_id, 'Lançamento pago precisa de conta bancária.');
  await all(
    `UPDATE lancamentos SET descricao = :descricao, contato = :contato, categoria_id = :categoria_id, conta_bancaria_id = :conta_bancaria_id,
       valor = :valor, vencimento = :vencimento, documento = :documento, observacao = :observacao
     WHERE id = :id AND empresa_id = :eid`,
    { ...l, id: atual.id, eid: req.eid },
  );
  res.json(await buscarLancamento(atual.id, req.eid));
});

e.delete('/lancamentos/:id', async (req, res) => {
  const atual = await buscarLancamento(req.params.id, req.eid);
  const escopo = req.query.escopo; // 'grupo' apaga também as parcelas em aberto do mesmo grupo
  await transaction(async () => {
    await all('DELETE FROM lancamentos WHERE id = :id', { id: atual.id });
    if (escopo === 'grupo' && atual.grupo_parcelas) {
      await all('DELETE FROM lancamentos WHERE grupo_parcelas = :g AND empresa_id = :eid AND data_pagamento IS NULL', { g: atual.grupo_parcelas, eid: req.eid });
    }
  });
  res.json({ ok: true });
});

async function baixar(l, { data_pagamento, valor_pago, conta_bancaria_id }, eid) {
  check(!l.data_pagamento, `"${l.descricao}" já está pago.`, 409);
  check(isDate(data_pagamento), 'Data de pagamento inválida.');
  const conta = optId(conta_bancaria_id) ?? l.conta_bancaria_id;
  check(conta, 'Informe a conta bancária.');
  await pertence('contas_bancarias', conta, eid);
  const valor = valor_pago ?? l.valor;
  check(isCents(valor) && valor > 0, 'Valor pago inválido.');
  await all("UPDATE lancamentos SET data_pagamento = :data, valor_pago = :valor, conta_bancaria_id = :conta, origem_baixa = 'manual' WHERE id = :id", {
    data: data_pagamento, valor, conta, id: l.id,
  });
}

e.post('/lancamentos/baixa-lote', async (req, res) => {
  const { ids, data_pagamento, conta_bancaria_id } = req.body;
  check(Array.isArray(ids) && ids.length, 'Selecione ao menos um lançamento.');
  await transaction(async () => {
    for (const id of ids) await baixar(await buscarLancamento(id, req.eid), { data_pagamento, conta_bancaria_id }, req.eid);
  });
  res.json({ ok: true, quantidade: ids.length });
});

e.post('/lancamentos/:id/baixa', async (req, res) => {
  const l = await buscarLancamento(req.params.id, req.eid);
  await baixar(l, req.body, req.eid);
  res.json(await buscarLancamento(l.id, req.eid));
});

e.post('/lancamentos/:id/estorno', async (req, res) => {
  const l = await buscarLancamento(req.params.id, req.eid);
  check(l.data_pagamento, 'Este lançamento não está pago.', 409);
  await transaction(async () => {
    await all('UPDATE extrato_itens SET lancamento_id = NULL WHERE lancamento_id = :id', { id: l.id });
    await all('UPDATE lancamentos SET data_pagamento = NULL, valor_pago = NULL, origem_baixa = NULL WHERE id = :id', { id: l.id });
  });
  res.json(await buscarLancamento(l.id, req.eid));
});

// ---------- Painel ----------

e.get('/resumo', async (req, res) => {
  const h = hoje();
  const fimSemana = addDays(h, 7);
  const fimMes = addDays(addMonths(h.slice(0, 8) + '01', 1), -1);
  const totais = (tipo) =>
    get(
      `SELECT
         COALESCE(SUM(CASE WHEN vencimento < :h THEN valor END), 0)::bigint AS vencido,
         COUNT(CASE WHEN vencimento < :h THEN 1 END) AS qtd_vencido,
         COALESCE(SUM(CASE WHEN vencimento = :h THEN valor END), 0)::bigint AS hoje,
         COUNT(CASE WHEN vencimento = :h THEN 1 END) AS qtd_hoje,
         COALESCE(SUM(CASE WHEN vencimento > :h AND vencimento <= :semana THEN valor END), 0)::bigint AS semana,
         COALESCE(SUM(CASE WHEN vencimento >= :h AND vencimento <= :mes THEN valor END), 0)::bigint AS mes
       FROM lancamentos WHERE empresa_id = :eid AND tipo = :tipo AND data_pagamento IS NULL`,
      { eid: req.eid, tipo, h, semana: fimSemana, mes: fimMes },
    );

  const [contas, pagar, receber, proximos] = await Promise.all([
    listarContas(req.eid),
    totais('pagar'),
    totais('receber'),
    all(`${LANC_SELECT} WHERE l.empresa_id = :eid AND l.data_pagamento IS NULL AND l.vencimento <= :ate ORDER BY l.vencimento, l.id LIMIT 12`, {
      eid: req.eid, hoje: h, ate: fimSemana,
    }),
  ]);

  res.json({
    hoje: h,
    saldo_total: contas.filter((c) => c.ativa).reduce((s, c) => s + c.saldo_atual, 0),
    contas,
    pagar,
    receber,
    proximos,
    pendentes_conciliacao: contas.reduce((s, c) => s + c.pendentes_conciliacao, 0),
  });
});

e.use(fluxoRouter);
e.use(conciliacaoRouter);
e.use(equipeRouter);

// ---------- Erros ----------

api.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));
api.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ erro: err.message });
  console.error(err);
  res.status(500).json({ erro: 'Erro interno no servidor.' });
});
